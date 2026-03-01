import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * CarsGuide search aggregator.
 * Queries the CarsGuide car-search page and scrapes structured results.
 * CarsGuide + AutoTrader AU share backend inventory, so one query covers both.
 *
 * Accepts: { make, model, badge?, year_min?, year_max?, max_km?, price_max? }
 * Returns: { results: NormalisedListing[], count: number }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
  if (!MANUS_API_KEY) {
    return new Response(
      JSON.stringify({ error: "MANUS_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const {
      make,
      model,
      badge,
      year_min,
      year_max,
      max_km,
      price_max,
    } = body;

    if (!make) {
      return new Response(
        JSON.stringify({ error: "make is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build CarsGuide search URL with query params
    const makeLower = make.toLowerCase().replace(/\s+/g, "-");
    const modelLower = model ? model.toLowerCase().replace(/\s+/g, "-") : "";

    const params = new URLSearchParams();
    if (year_min) params.set("year_from", String(year_min));
    if (year_max) params.set("year_to", String(year_max));
    if (max_km) params.set("odometer_max", String(max_km));
    if (price_max) params.set("price_to", String(price_max));

    const searchUrl = modelLower
      ? `https://www.carsguide.com.au/buy-a-car/${makeLower}/${modelLower}/?${params.toString()}`
      : `https://www.carsguide.com.au/buy-a-car/${makeLower}/?${params.toString()}`;

    console.log(`[CARSGUIDE] Searching: ${searchUrl}`);

    const strictBadgeInstruction = badge
      ? `IMPORTANT: Only return vehicles that are specifically the "${badge}" variant/badge/trim. Do NOT return other variants. If no exact match exists, return an empty array.`
      : "";

    const prompt = [
      `Search the CarsGuide website at ${searchUrl} for used cars matching:`,
      `Make: ${make}`,
      model ? `Model: ${model}` : "",
      badge ? `Badge/Variant: ${badge}` : "",
      year_min ? `Year from: ${year_min}` : "",
      year_max ? `Year to: ${year_max}` : "",
      max_km ? `Maximum kilometres: ${max_km}` : "",
      price_max ? `Maximum price: $${price_max}` : "",
      strictBadgeInstruction,
      "",
      "For each matching vehicle found on the page, extract and return a JSON array with these fields:",
      "- price (integer, AUD)",
      "- price_type (string: 'drive_away' or 'excl_govt' or 'unknown')",
      "- km (integer)",
      "- year (integer)",
      "- badge (string, the exact variant/trim name as shown on the listing)",
      "- colour (string)",
      "- location (string, suburb and state)",
      "- dealer_name (string)",
      "- direct_url (string, full URL to the individual listing page)",
      "- stock_no (string, if visible)",
      "",
      "Return ONLY a JSON array. No commentary. If no matching vehicles are found, return an empty array [].",
    ]
      .filter(Boolean)
      .join("\n");

    // Fire a Manus task to scrape CarsGuide
    const res = await fetch("https://api.manus.im/v1/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        API_KEY: MANUS_API_KEY,
        accept: "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[CARSGUIDE] Manus task failed: ${res.status} ${errText}`);
      return new Response(
        JSON.stringify({ error: `Manus API error: ${res.status}`, results: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const task = await res.json();
    const taskId = task?.id || task?.task_id;

    // Store task for webhook pickup
    if (taskId) {
      await supabase.from("manus_search_tasks").insert({
        manus_task_id: taskId,
        source_url: searchUrl,
        status: "pending",
        search_session_id: crypto.randomUUID(),
        search_filters: { make, model, badge, year_min, year_max, max_km, price_max, source: "carsguide" },
      });
    }

    console.log(`[CARSGUIDE] Manus task created: ${taskId}`);

    return new Response(
      JSON.stringify({
        task_id: taskId,
        search_url: searchUrl,
        message: "CarsGuide search dispatched via Manus",
        source: "carsguide",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[CARSGUIDE] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
