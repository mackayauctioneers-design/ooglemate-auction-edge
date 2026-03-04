/**
 * valo-gemini-scan — Gemini-powered parallel market discovery for VALO.
 *
 * Uses Gemini with grounded search to independently discover comparable
 * vehicles across Australian marketplaces. Runs in parallel with
 * valo-perplexity-scan to maximize listing coverage.
 *
 * NOT a standalone endpoint — called internally by run-valo-v1.
 */

import type { AdapterResult, ParsedIntent } from "../_shared/outward-search/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Extract a listing ID from known marketplace URLs */
function extractListingId(url: string): string | null {
  if (!url) return null;
  try {
    // Carsales: OAG-AD-12345678
    const carsales = url.match(/OAG-AD-\d+/i);
    if (carsales) return carsales[0];

    // Drive: /car/970083226/
    const drive = url.match(/drive\.com\.au\/.*\/car\/(\d+)/i);
    if (drive) return `drive-${drive[1]}`;

    // Autotrader: /car-details/12345678
    const autotrader = url.match(/autotrader\.com\.au\/.*?(\d{6,})/i);
    if (autotrader) return `at-${autotrader[1]}`;

    // CarsGuide: /listing/12345678
    const carsguide = url.match(/carsguide\.com\.au\/.*?(\d{6,})/i);
    if (carsguide) return `cg-${carsguide[1]}`;

    // Gumtree: /s-ad/listing/12345678
    const gumtree = url.match(/gumtree\.com\.au\/.*?(\d{8,})/i);
    if (gumtree) return `gt-${gumtree[1]}`;
  } catch {
    // ignore
  }
  return null;
}

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ status: "error", error: "AI gateway not configured", results: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build variant/badge string
    const badgePart = intent.badge ?? "";
    const bodyPart = intent.body_keywords?.length ? intent.body_keywords.join(" ") : "";
    const yearPart = intent.year_min ? `${intent.year_min}` : "";
    const kmPart = intent.max_km ? `under ${intent.max_km.toLocaleString()} km` : "";

    // Series-aware model string
    let modelPart = intent.model ?? "";
    if (intent.series) {
      const seriesNum = intent.series.replace(/[^0-9]/g, "");
      if (seriesNum && !modelPart.includes(seriesNum)) {
        modelPart = `${modelPart} ${seriesNum}`;
      }
    }

    // Series exclusion guidance
    let seriesExclusion = "";
    if (intent.series === "LC300") {
      seriesExclusion = "\n- EXCLUDE any LandCruiser 70 Series, 76, 78, 79, or 200 Series listings. Only include LandCruiser 300 Series.";
    } else if (intent.series === "LC70") {
      seriesExclusion = "\n- EXCLUDE any LandCruiser 200 or 300 Series listings. Only include LandCruiser 70 Series (70, 76, 78, 79).";
    } else if (intent.series === "LC200") {
      seriesExclusion = "\n- EXCLUDE any LandCruiser 70 Series or 300 Series listings. Only include LandCruiser 200 Series.";
    }

    const searchQueries = [
      `"${yearPart} ${intent.make} ${modelPart} ${badgePart} ${bodyPart} for sale"`.trim(),
      `site:carsales.com.au "${yearPart} ${modelPart} ${badgePart}"`.trim(),
      `"${yearPart} ${intent.make} ${modelPart} ${badgePart} dealer Australia"`.trim(),
    ].filter(q => q.length > 10);

    const systemPrompt = `You are performing a strict vehicle market discovery search across Australian automotive marketplaces.

OBJECTIVE
Find currently advertised vehicles matching the criteria and return only listings that include a verified listing page URL and exact kilometres.

SEARCH CRITERIA
Make: ${intent.make}
Model: ${modelPart}
${badgePart ? `Variant: ${badgePart}` : ""}
${bodyPart ? `Body: ${bodyPart}` : ""}
Year: ${yearPart || "any"}
${kmPart ? `Odometer: ${kmPart}` : ""}
Location: Australia-wide

IMPORTANT RULES
1. Every listing must include a direct listing URL (not a search results page).
2. Kilometres must be taken from the listing page — never estimate.
3. If a URL or odometer cannot be verified, exclude the listing.
4. Only include the exact variant requested.${seriesExclusion}
5. Return up to 8 of the cheapest comparable listings.

VALID SOURCES
carsales.com.au, drive.com.au, carsguide.com.au, autotrader.com.au, gumtree.com.au, dealer inventory websites (.com.au)

SEARCH QUERIES TO USE
${searchQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Prices must be in AUD as integers. KM must be integers. State should be abbreviated (NSW, VIC, QLD, etc).`;

    console.log("Gemini VALO scan: starting discovery for", intent.make, modelPart, badgePart);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Search Australian vehicle marketplaces for ${yearPart} ${intent.make} ${modelPart} ${badgePart} ${bodyPart} ${kmPart} for sale. Return structured listing data.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_listings",
              description: "Return discovered vehicle listings from market search",
              parameters: {
                type: "object",
                properties: {
                  listings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        price_aud: { type: "number", description: "Price in AUD as integer" },
                        odometer_km: { type: "number", description: "Kilometres as integer" },
                        year: { type: "number" },
                        variant: { type: "string" },
                        seller_name: { type: "string" },
                        seller_type: { type: "string", enum: ["dealer", "private"] },
                        location_state: { type: "string", description: "Abbreviated state e.g. NSW" },
                        direct_listing_url: { type: "string" },
                        stock_number: { type: "string" },
                        listing_id: { type: "string" },
                        source_site: { type: "string" },
                        image_url: { type: "string" },
                      },
                      required: ["price_aud", "direct_listing_url"],
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
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini scan API error:", response.status, errText);
      return new Response(
        JSON.stringify({ status: "error", error: `Gemini API error: ${response.status}`, results: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    let listings: any[] = [];

    try {
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        listings = parsed.listings ?? [];
      }
    } catch (e) {
      console.error("Failed to parse Gemini extraction:", e);
    }

    // Convert to AdapterResult format
    const results: AdapterResult[] = listings
      .filter((l: any) => l.price_aud && l.price_aud > 0)
      .map((l: any) => {
        const listingId = l.listing_id || extractListingId(l.direct_listing_url || "");
        return {
          source: "gemini_discovery",
          title: [l.year, intent.make, intent.model, l.variant].filter(Boolean).join(" "),
          year: l.year ?? null,
          km: l.odometer_km ?? null,
          price: l.price_aud,
          effective_cost: l.price_aud,
          location: l.location_state ?? null,
          state: l.location_state ?? null,
          variant: l.variant ?? null,
          url: l.direct_listing_url ?? null,
          image_url: l.image_url ?? null,
          seller_name: l.seller_name ?? null,
          score: 50,
          match_reason: ["GEMINI_DISCOVERY"],
          source_class: l.source_site ?? "gemini_discovery",
          auction_house: null,
          drivetrain: null,
          fuel: null,
          transmission: null,
          days_listed: null,
          is_dealer_grade: null,
          // Extra fields for persistence
          _listing_id: listingId,
          _stock_number: l.stock_number ?? null,
          _seller_type: l.seller_type ?? null,
          _source_site: l.source_site ?? null,
        } as AdapterResult & Record<string, unknown>;
      });

    console.log(`Gemini scan: ${results.length} listings discovered`);

    return new Response(
      JSON.stringify({ status: "complete", results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("valo-gemini-scan error:", err);
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
