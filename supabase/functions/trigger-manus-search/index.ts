import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Generates a deterministic cache key from search filters.
 */
function buildCacheKey(make: string, model: string, badge: string, yearMin?: number, yearMax?: number, maxKm?: number, priceMax?: number): string {
  return [
    make.toUpperCase(),
    model.toUpperCase(),
    badge.toUpperCase(),
    yearMin ?? "",
    yearMax ?? "",
    maxKm ?? "",
    priceMax ?? "",
  ].join("|");
}

const MAX_DEALER_SEARCHES = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
  if (!MANUS_API_KEY) {
    return new Response(JSON.stringify({ error: "MANUS_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const body = await req.json();

  const huntId: string | null = body.hunt_id || null;
  const filters: { make?: string; model?: string; badge?: string; year_min?: number; year_max?: number; max_km?: number; price_max?: number } | null = body.filters || null;

  let make = "", model = "", badge = "", yearLine = "", kmLine = "", priceLine = "";
  let yearMin: number | undefined, yearMax: number | undefined, maxKm: number | undefined, priceMax: number | undefined;

  if (huntId) {
    const { data: hunt, error: huntError } = await supabase
      .from("sale_hunts")
      .select("*")
      .eq("id", huntId)
      .single();
    if (huntError || !hunt) {
      return new Response(JSON.stringify({ error: "Hunt not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    make = hunt.make || "";
    model = hunt.model || "";
    badge = hunt.required_badge || "";
    yearLine = hunt.year ? `Year: ${hunt.year}` : "";
    kmLine = hunt.km ? `Maximum kilometres: ${hunt.km}` : "";
    yearMin = hunt.year ?? undefined;
    maxKm = hunt.km ?? undefined;
  } else if (filters?.make) {
    make = filters.make;
    model = filters.model || "";
    badge = filters.badge || "";
    yearMin = filters.year_min ?? undefined;
    yearMax = filters.year_max ?? undefined;
    maxKm = filters.max_km ?? undefined;
    priceMax = filters.price_max ?? undefined;
    if (yearMin && yearMax) {
      yearLine = `Year range: ${yearMin}–${yearMax}`;
    } else if (yearMin) {
      yearLine = `Year from: ${yearMin}`;
    }
    kmLine = maxKm ? `Maximum kilometres: ${maxKm}` : "";
    priceLine = priceMax ? `Maximum price: $${priceMax}` : "";
  } else {
    return new Response(JSON.stringify({ error: "hunt_id or filters.make required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // --- OPTIMIZATION 1: Check 3-hour cache ---
  const cacheKey = buildCacheKey(make, model, badge, yearMin, yearMax, maxKm, priceMax);
  const { data: cached } = await supabase
    .from("search_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .eq("source", "manus")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (cached) {
    // Increment hit count
    await supabase.from("search_cache").update({ hits: (cached.hits || 0) + 1 }).eq("id", cached.id);
    console.log(`[MANUS] Cache hit for ${cacheKey} — returning ${(cached.results as any[])?.length || 0} cached results`);
    return new Response(
      JSON.stringify({
        session_id: cached.id,
        message: "Cached results returned",
        cached: true,
        tasks_created: 0,
        results: cached.results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const sessionId = crypto.randomUUID();

  // --- OPTIMIZATION 2: Brand routing ---
  // Filter dealer sources by brand. Empty brands[] = multi-brand (always included).
  const makeUpper = make.toUpperCase();

  // Get ALL enabled sources with manus/generic_scrape adapter
  const { data: allSources } = await supabase
    .from("dealer_outbound_sources")
    .select("*")
    .in("adapter_type", ["manus", "generic_scrape"])
    .eq("enabled", true)
    .order("priority", { ascending: false });

  const sources = (allSources || []).filter((s: any) => {
    // Empty brands = multi-brand dealer/auction → always include
    if (!s.brands || s.brands.length === 0) return true;
    // Only include if this dealer sells the requested brand
    return s.brands.some((b: string) => b.toUpperCase() === makeUpper);
  });

  // --- OPTIMIZATION 3: Hard cap at MAX_DEALER_SEARCHES ---
  const cappedSources = sources.slice(0, MAX_DEALER_SEARCHES);

  console.log(`[MANUS] Brand routing: ${make} → ${sources.length} matching sources, capped to ${cappedSources.length}`);

  if (cappedSources.length === 0) {
    // Store empty cache to avoid re-searching
    await supabase.from("search_cache").upsert({
      cache_key: cacheKey,
      make, model, badge,
      year_min: yearMin, year_max: yearMax,
      max_km: maxKm, price_max: priceMax,
      results: [],
      source: "manus",
    }, { onConflict: "cache_key" });

    return new Response(JSON.stringify({
      session_id: sessionId,
      message: "No matching dealer sources for this brand",
      tasks_created: 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const tasksCreated: string[] = [];

  for (const source of cappedSources) {
    const inventoryUrl = source.url
      || (source.inventory_path
          ? `https://${source.dealer_domain}${source.inventory_path}`
          : `https://${source.dealer_domain}`);

    if (!inventoryUrl || inventoryUrl === 'https://undefined') continue;

    const strictBadgeInstruction = badge
      ? `IMPORTANT: Only return vehicles that are specifically the "${badge}" variant/badge/trim. Do NOT return other variants like BASE, Active, Elite, or any other trim that is not "${badge}". If no exact match exists, return an empty array.`
      : "";

    const prompt = [
      `Search the website ${inventoryUrl} for used cars matching:`,
      `Make: ${make}`,
      model ? `Model: ${model}` : "",
      badge ? `Badge/Variant: ${badge}` : "",
      yearLine,
      kmLine,
      priceLine,
      strictBadgeInstruction,
      "",
      "For each matching vehicle found, extract and return a JSON array with these fields:",
      "- price (integer, AUD, exclude govt charges if possible)",
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
    ].filter(Boolean).join("\n");

    try {
      const res = await fetch("https://api.manus.im/v1/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "API_KEY": MANUS_API_KEY,
          "accept": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        console.error(`[MANUS] Failed to create task for ${source.dealer_domain}: ${res.status} ${await res.text()}`);
        continue;
      }

      const task = await res.json();
      const taskId = task?.id || task?.task_id;

      if (taskId) {
        await supabase.from("manus_search_tasks").insert({
          hunt_id: huntId,
          manus_task_id: taskId,
          source_url: inventoryUrl,
          status: "pending",
          search_session_id: sessionId,
          search_filters: { make, model, badge, ...(filters || {}) },
        });
        tasksCreated.push(taskId);
        console.log(`[MANUS] Created task ${taskId} for ${source.dealer_domain}`);
      }
    } catch (err) {
      console.error(`[MANUS] Error creating task for ${source.dealer_domain}:`, err);
    }
  }

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      message: `Manus tasks triggered (${cappedSources.length} sources, brand-filtered)`,
      tasks_created: tasksCreated.length,
      task_ids: tasksCreated,
      sources_searched: cappedSources.length,
      sources_matched: sources.length,
      sources_total: (allSources || []).length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
