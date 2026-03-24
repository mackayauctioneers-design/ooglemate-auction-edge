import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Detect source from URL
function detectSource(url: string): string {
  if (url.includes("carsales.com.au")) return "carsales";
  if (url.includes("autotrader.com.au")) return "autotrader";
  if (url.includes("gumtree.com.au")) return "gumtree";
  if (url.includes("drive.com.au")) return "drive";
  if (url.includes("carsguide.com.au")) return "carsguide";
  if (url.includes("pickles.com.au")) return "pickles";
  if (url.includes("manheim.com.au")) return "manheim";
  if (url.includes("grays.com")) return "grays";
  return "dealer";
}

// Extract a listing ID from URL
function extractListingId(url: string, source: string): string {
  try {
    const u = new URL(url);
    // Carsales: /cars/details/.../{ID}/
    if (source === "carsales") {
      const match = u.pathname.match(/(OAG-AD-\d+|SSE-AD-\d+)/);
      if (match) return match[1];
    }
    // Autotrader: /car/.../{ID}
    if (source === "autotrader") {
      const match = u.pathname.match(/\/(\d{5,})/);
      if (match) return `AT-${match[1]}`;
    }
    // Fallback: hash of URL
    return `MANUAL-${btoa(u.pathname).slice(0, 20)}`;
  } catch {
    return `MANUAL-${Date.now()}`;
  }
}

// AI extraction prompt
const EXTRACTION_PROMPT = `Extract the following vehicle listing details from this webpage content. Return ONLY valid JSON with these fields:
{
  "make": "string or null",
  "model": "string or null", 
  "variant": "string or null",
  "year": "number or null",
  "km": "number or null (odometer in kilometres)",
  "price": "number or null (asking price in AUD, no cents)",
  "location": "string or null (state abbreviation like NSW, VIC, QLD)",
  "seller_type": "Dealer or Private or Unknown",
  "engine_type": "string or null",
  "fuel_type": "string or null",
  "transmission": "string or null"
}
Be precise. Extract numbers without formatting. Return null if not found.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, submitted_by } = await req.json();

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate URL format
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith("http")) cleanUrl = `https://${cleanUrl}`;
    try { new URL(cleanUrl); } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const source = detectSource(cleanUrl);
    const listingId = extractListingId(cleanUrl, source);

    // Init Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for duplicates
    const { data: existing } = await supabase
      .from("cheap_car_queue")
      .select("id, status")
      .eq("listing_id", listingId)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `This listing already exists in the queue (status: ${existing.status})`,
          existing_id: existing.id,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Scrape with Firecrawl
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[JOSH SCRAPE] Scraping: ${cleanUrl}`);
    const scrapeController = new AbortController();
    const scrapeTimeout = setTimeout(() => scrapeController.abort(), 20000);
    let scrapeRes: Response;
    try {
      scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: cleanUrl,
          formats: ["markdown"],
          onlyMainContent: true,
          waitFor: 5000,
          timeout: 15000,
        }),
        signal: scrapeController.signal,
      });
    } catch (e) {
      clearTimeout(scrapeTimeout);
      console.error("[JOSH SCRAPE] Firecrawl timeout/abort:", e);
      return new Response(
        JSON.stringify({ success: false, error: "Scrape timed out — try again or use a different URL" }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    clearTimeout(scrapeTimeout);

    if (!scrapeRes.ok) {
      const errText = await scrapeRes.text();
      console.error("[JOSH SCRAPE] Firecrawl error:", errText);
      return new Response(
        JSON.stringify({ success: false, error: `Scrape failed: ${scrapeRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const scrapeData = await scrapeRes.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";

    if (!markdown || markdown.length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: "Could not extract content from page" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use Lovable AI gateway to extract structured data
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    let extracted: Record<string, unknown> = {};

    if (LOVABLE_API_KEY) {
      try {
        const aiController = new AbortController();
        const aiTimeout = setTimeout(() => aiController.abort(), 12000);
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              { role: "system", content: EXTRACTION_PROMPT },
              { role: "user", content: `Webpage content:\n${markdown.slice(0, 4000)}` },
            ],
            temperature: 0.1,
          }),
          signal: aiController.signal,
        });
        clearTimeout(aiTimeout);

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const text = aiData?.choices?.[0]?.message?.content || "";
          console.log("[JOSH SCRAPE] AI extraction response:", text.slice(0, 500));
          // Extract JSON from response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            extracted = JSON.parse(jsonMatch[0]);
          }
        } else {
          const errText = await aiRes.text();
          console.error("[JOSH SCRAPE] AI gateway error:", aiRes.status, errText);
        }
      } catch (e) {
        console.error("[JOSH SCRAPE] AI extraction failed:", e);
      }
    } else {
      console.error("[JOSH SCRAPE] LOVABLE_API_KEY not configured");
    }

    // Compute market comparison against Carsales baseline
    let marketPrice: number | null = null;
    let discountPct: number | null = null;
    const price = extracted.price as number | null;
    const make = extracted.make as string | null;
    const model = extracted.model as string | null;
    const year = extracted.year as number | null;
    const km = extracted.km as number | null;

    if (price && make && model && year) {
      // Query Carsales median from retail_listings or cheap_car_queue
      const { data: comps } = await supabase
        .from("cheap_car_queue")
        .select("market_price")
        .eq("source", "carsales")
        .ilike("make", make)
        .ilike("model", model)
        .gte("year", year - 1)
        .lte("year", year + 1)
        .not("market_price", "is", null)
        .limit(20);

      if (comps && comps.length >= 3) {
        const prices = comps.map((c) => c.market_price as number).sort((a, b) => a - b);
        const mid = Math.floor(prices.length / 2);
        marketPrice = prices.length % 2 === 0
          ? Math.round((prices[mid - 1] + prices[mid]) / 2)
          : prices[mid];
        discountPct = parseFloat((((price - marketPrice) / marketPrice) * 100).toFixed(2));
      }
    }

    // Compute deal score
    const { data: scoreResult } = await supabase.rpc("compute_deal_score", {
      p_discount_pct: discountPct,
      p_source: source,
      p_detected_at: new Date().toISOString(),
      p_source_type: "manual",
    });

    // Insert into queue
    const insertData = {
      listing_id: listingId,
      source,
      source_type: "manual",
      submitted_by: submitted_by || "josh",
      make: (extracted.make as string) || null,
      model: (extracted.model as string) || null,
      variant: (extracted.variant as string) || null,
      year: (extracted.year as number) || null,
      km: (extracted.km as number) || null,
      price: (extracted.price as number) || null,
      market_price: marketPrice,
      discount_pct: discountPct,
      location: (extracted.location as string) || null,
      seller_type: (extracted.seller_type as string) || "Unknown",
      listing_url: cleanUrl,
      engine_type: (extracted.engine_type as string) || null,
      fuel_type: (extracted.fuel_type as string) || null,
      transmission: (extracted.transmission as string) || null,
      deal_score: scoreResult ?? null,
      status: "NEW",
      josh_verified: false,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("cheap_car_queue")
      .insert(insertData)
      .select("id")
      .single();

    if (insertError) {
      console.error("[JOSH SCRAPE] Insert failed:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[JOSH SCRAPE] Inserted manual listing: ${listingId} → ${inserted.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        id: inserted.id,
        extracted: {
          make: extracted.make,
          model: extracted.model,
          year: extracted.year,
          price: extracted.price,
          market_price: marketPrice,
          discount_pct: discountPct,
          deal_score: scoreResult,
          source,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[JOSH SCRAPE] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
