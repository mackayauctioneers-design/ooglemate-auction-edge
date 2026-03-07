/**
 * valo-perplexity-scan — Perplexity-powered market comp discovery for VALO.
 *
 * Uses Perplexity Sonar to find real, currently-advertised comparable vehicles
 * across Australian marketplaces. Returns structured listings that feed into
 * the VALO scoring pipeline as supplementary comps.
 *
 * NOT a standalone endpoint — called internally by run-valo-v1.
 */

import type { AdapterResult, ParsedIntent } from "../_shared/outward-search/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const intent: ParsedIntent = body.intent;

    if (!intent?.make || !intent?.model) {
      return new Response(
        JSON.stringify({ status: "error", error: "Missing make/model in intent", results: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      console.error("PERPLEXITY_API_KEY not configured");
      return new Response(
        JSON.stringify({ status: "error", error: "Perplexity not configured", results: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build search query — include series to prevent cross-generation contamination
    const yearPart = intent.year_min ? `${intent.year_min}` : "";
    const badgePart = intent.badge ?? "";
    const kmPart = intent.max_km ? `under ${intent.max_km.toLocaleString()} km` : "";

    // If series is known, inject it into the model string for precision
    // e.g. "LandCruiser" → "LandCruiser 300" to prevent LC70 results
    let modelPart = intent.model ?? "";
    if (intent.series) {
      const seriesNum = intent.series.replace(/[^0-9]/g, "");
      if (seriesNum && !modelPart.includes(seriesNum)) {
        modelPart = `${modelPart} ${seriesNum}`;
      }
    }

    const query = [
      yearPart,
      intent.make,
      modelPart,
      badgePart,
      "for sale Australia",
      kmPart,
      "price",
    ].filter(Boolean).join(" ");

    console.log("Perplexity VALO query:", query);

    // Call Perplexity with structured output via tool calling
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // Build exclusion guidance for series precision
    let seriesExclusion = "";
    if (intent.series === "LC300") {
      seriesExclusion = "\n- EXCLUDE any LandCruiser 70 Series, 76, 78, 79, or 200 Series listings. Only include LandCruiser 300 Series.";
    } else if (intent.series === "LC70") {
      seriesExclusion = "\n- EXCLUDE any LandCruiser 200 or 300 Series listings. Only include LandCruiser 70 Series (70, 76, 78, 79).";
    } else if (intent.series === "LC200") {
      seriesExclusion = "\n- EXCLUDE any LandCruiser 70 Series or 300 Series listings. Only include LandCruiser 200 Series.";
    }

    const systemPrompt = `You are a vehicle market research assistant. Search Australian automotive marketplaces (Carsales, Drive, CarsGuide, AutoTrader, dealer websites) for currently advertised vehicles matching the query.

RULES:
- Only return REAL listings you find. Do NOT fabricate or hallucinate listings.
- Extract: price (AUD, numbers only), kilometres, year, variant/badge, dealer name, location/state, listing URL, source site.
- If you cannot confirm a listing URL, set url to null.
- Return up to 5 of the cheapest comparable listings.
- Prices must be in AUD as integers (no $ or commas).
- KM must be integers.
- State should be abbreviated (NSW, VIC, QLD, etc).${seriesExclusion}`;

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        temperature: 0.1,
        search_domain_filter: [
          "drive.com.au",
          "autotrader.com.au",
          "carsguide.com.au",
          "carsales.com.au",
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Perplexity API error:", response.status, errText);
      return new Response(
        JSON.stringify({ status: "error", error: `Perplexity API error: ${response.status}`, results: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const citations = data.citations ?? [];

    console.log("Perplexity raw response length:", content.length);

    // Now use Gemini to extract structured data from Perplexity's response
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ status: "error", error: "AI gateway not configured", results: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const extractionResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "Extract vehicle listings from the provided text into structured JSON. Return ONLY a JSON array.",
          },
          {
            role: "user",
            content: `Extract all vehicle listings from this market research into a JSON array. Each object must have: price (number), km (number), year (number), variant (string or null), dealer (string or null), state (string or null, abbreviated), url (string or null — MUST be the full listing URL from the source, e.g. "https://www.carsales.com.au/cars/details/..."), source (string like "carsales", "drive", "carsguide", "autotrader", "dealer").

IMPORTANT: The url field is critical. Extract the actual listing URL from the citations or text. If a citation URL corresponds to a listing, use it. Do NOT leave url as null if there is a source URL available in the citations.

Citations: ${JSON.stringify(citations)}

If a field is unknown, use null. Price and km must be integers.

Text:
${content}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_listings",
              description: "Return extracted vehicle listings",
              parameters: {
                type: "object",
                properties: {
                  listings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        price: { type: "number" },
                        km: { type: "number" },
                        year: { type: "number" },
                        variant: { type: "string" },
                        dealer: { type: "string" },
                        state: { type: "string" },
                        url: { type: "string" },
                        source: { type: "string" },
                      },
                      required: ["price"],
                    },
                  },
                },
                required: ["listings"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_listings" } },
      }),
    });

    if (!extractionResponse.ok) {
      const errText = await extractionResponse.text();
      console.error("Gemini extraction error:", extractionResponse.status, errText);
      return new Response(
        JSON.stringify({ status: "error", error: "Extraction failed", results: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const extractionData = await extractionResponse.json();
    let listings: any[] = [];

    try {
      const toolCall = extractionData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        listings = parsed.listings ?? [];
      }
    } catch (e) {
      console.error("Failed to parse extraction:", e);
    }

    // Convert to AdapterResult format
    const results: AdapterResult[] = listings
      .filter((l: any) => l.price && l.price > 0)
      .map((l: any) => ({
        source: "caroogleai",
        title: [l.year, intent.make, intent.model, l.variant].filter(Boolean).join(" "),
        year: l.year ?? null,
        km: l.km ?? null,
        price: l.price,
        effective_cost: l.price,
        location: l.state ?? null,
        state: l.state ?? null,
        variant: l.variant ?? null,
        url: l.url ?? null,
        image_url: null,
        seller_name: l.dealer ?? null,
        score: 50, // base score for external discovery
        match_reason: ["CAROOGLEAI_DISCOVERY"],
        source_class: l.source ?? "caroogleai",
        auction_house: null,
        drivetrain: null,
        fuel: null,
        transmission: null,
        days_listed: null,
        is_dealer_grade: null,
      }));

    console.log(`Perplexity scan: ${results.length} listings extracted`);

    return new Response(
      JSON.stringify({ status: "complete", results, citation_count: citations.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("valo-perplexity-scan error:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        results: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
