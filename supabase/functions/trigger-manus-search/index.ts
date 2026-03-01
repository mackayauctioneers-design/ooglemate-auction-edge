import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── helpers ─────────────────────────────────────── */

function buildCacheKey(
  make: string, model: string, badge: string,
  yearMin?: number, yearMax?: number, maxKm?: number, priceMax?: number,
): string {
  return [make, model, badge, yearMin ?? "", yearMax ?? "", maxKm ?? "", priceMax ?? ""]
    .map((v) => String(v).toUpperCase())
    .join("|");
}

/** Create a Manus task and record it. Returns the task ID or null. */
async function dispatchManusTask(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  inventoryUrl: string,
  filters: Record<string, unknown>,
  sessionId: string,
  huntId: string | null,
): Promise<string | null> {
  const { make, model, badge, yearLine, kmLine, priceLine } = filters as any;

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
      headers: { "Content-Type": "application/json", API_KEY: apiKey, accept: "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      console.error(`[MANUS] Task failed for ${inventoryUrl}: ${res.status} ${await res.text()}`);
      return null;
    }

    const task = await res.json();
    const taskId = task?.id || task?.task_id;
    if (!taskId) return null;

    await supabase.from("manus_search_tasks").insert({
      hunt_id: huntId,
      manus_task_id: taskId,
      source_url: inventoryUrl,
      status: "pending",
      search_session_id: sessionId,
      search_filters: filters,
    });

    console.log(`[MANUS] Created task ${taskId} for ${inventoryUrl}`);
    return taskId;
  } catch (err) {
    console.error(`[MANUS] Error for ${inventoryUrl}:`, err);
    return null;
  }
}

/* ── constants ───────────────────────────────────── */

const MAX_BRAND_DEALER_SEARCHES = 3; // brand-routed fallback cap

/* ── main handler ────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
  if (!MANUS_API_KEY) {
    return new Response(JSON.stringify({ error: "MANUS_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const huntId: string | null = body.hunt_id || null;
  const filters: Record<string, any> | null = body.filters || null;

  /* ── Parse filters ─────────────────────────────── */
  let make = "", model = "", badge = "";
  let yearLine = "", kmLine = "", priceLine = "";
  let yearMin: number | undefined, yearMax: number | undefined;
  let maxKm: number | undefined, priceMax: number | undefined;

  if (huntId) {
    const { data: hunt, error: huntError } = await supabase
      .from("sale_hunts").select("*").eq("id", huntId).single();
    if (huntError || !hunt) {
      return new Response(JSON.stringify({ error: "Hunt not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    if (yearMin && yearMax) yearLine = `Year range: ${yearMin}–${yearMax}`;
    else if (yearMin) yearLine = `Year from: ${yearMin}`;
    kmLine = maxKm ? `Maximum kilometres: ${maxKm}` : "";
    priceLine = priceMax ? `Maximum price: $${priceMax}` : "";
  } else {
    return new Response(JSON.stringify({ error: "hunt_id or filters.make required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  /* ── STEP 1: Cache check (3-hour TTL) ──────────── */
  const cacheKey = buildCacheKey(make, model, badge, yearMin, yearMax, maxKm, priceMax);
  const { data: cached } = await supabase
    .from("search_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .eq("source", "manus")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (cached) {
    await supabase.from("search_cache").update({ hits: (cached.hits || 0) + 1 }).eq("id", cached.id);
    console.log(`[PIPELINE] Cache hit for ${cacheKey}`);
    return new Response(JSON.stringify({
      session_id: cached.id,
      message: "Cached results returned",
      cached: true,
      tasks_created: 0,
      results: cached.results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const sessionId = crypto.randomUUID();
  const taskFilterPayload = { make, model, badge, yearLine, kmLine, priceLine, year_min: yearMin, year_max: yearMax, max_km: maxKm, price_max: priceMax };

  /* ── STEP 2: Drive.com.au GraphQL aggregator ───── */
  let driveResultCount = 0;
  try {
    const makeLower = make.toLowerCase();
    const modelLower = model ? model.toLowerCase() : "";

    const driveWhere: Record<string, any> = {
      stockType: { in: ["used"] },
      makeDescription: { eq: make },
    };
    if (model) driveWhere.familyDescription = { eq: model };
    if (yearMin) driveWhere.year = { gte: yearMin };
    if (yearMax) driveWhere.year = { ...driveWhere.year, lte: yearMax };
    if (maxKm) driveWhere.odometer = { lte: maxKm };
    if (priceMax) driveWhere.priceIgc = { lte: priceMax };

    const driveQuery = `query DEALER_LISTINGS($where: WhereOptionsDealerListing = {}, $pageNo: Int! = 0, $sort: SortInput = {order: [["recommended","DESC"]]}) {
      listings: DealerListings(where: $where, paginate: {page: $pageNo, pageSize: 30}, sort: $sort) {
        pageInfo { hasNextPage itemCount }
        results { id year makeDescription familyDescription description odometer priceIgc priceEgc Region { state name } Dealer { suburb state postcode } }
      }
    }`;

    const driveRes = await fetch("https://drive-carsforsale-prod.graphcdn.app/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.drive.com.au",
        referer: "https://www.drive.com.au/cars-for-sale/search/used/",
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify({
        operationName: "DEALER_LISTINGS",
        variables: { where: driveWhere, pageNo: 0, sort: { order: [["createdAt", "DESC"]] } },
        query: driveQuery,
      }),
    });

    if (driveRes.ok) {
      const driveData = await driveRes.json();
      driveResultCount = driveData?.data?.listings?.pageInfo?.itemCount ?? 0;
      console.log(`[PIPELINE] Drive.com.au returned ${driveResultCount} results`);
    } else {
      console.warn(`[PIPELINE] Drive API error: ${driveRes.status}`);
      await driveRes.text(); // consume body
    }
  } catch (err) {
    console.warn("[PIPELINE] Drive aggregator error:", err);
  }

  /* ── ALWAYS dispatch CarsGuide + mega-dealers (no short-circuit) ── */
  console.log(`[PIPELINE] Drive returned ${driveResultCount} results — dispatching all sources in parallel`);

  /* ── STEP 3: CarsGuide aggregator (via Manus) ─── */
  let carsguideTaskId: string | null = null;
  try {
    const cgParams = new URLSearchParams();
    if (yearMin) cgParams.set("year_from", String(yearMin));
    if (yearMax) cgParams.set("year_to", String(yearMax));
    if (maxKm) cgParams.set("odometer_max", String(maxKm));
    if (priceMax) cgParams.set("price_to", String(priceMax));

    const makeLower = make.toLowerCase().replace(/\s+/g, "-");
    const modelLower = model ? model.toLowerCase().replace(/\s+/g, "-") : "";
    const cgUrl = modelLower
      ? `https://www.carsguide.com.au/buy-a-car/${makeLower}/${modelLower}/?${cgParams.toString()}`
      : `https://www.carsguide.com.au/buy-a-car/${makeLower}/?${cgParams.toString()}`;

    carsguideTaskId = await dispatchManusTask(supabase, MANUS_API_KEY, cgUrl, { ...taskFilterPayload, source: "carsguide" }, sessionId, huntId);
    console.log(`[PIPELINE] CarsGuide task: ${carsguideTaskId || "failed"}`);
  } catch (err) {
    console.warn("[PIPELINE] CarsGuide dispatch error:", err);
  }

  /* ── STEPS 4 & 5: Mega-dealer sources (in parallel) ── */
  const { data: megaSources } = await supabase
    .from("dealer_outbound_sources")
    .select("*")
    .eq("dealer_type", "mega_dealer")
    .eq("enabled", true)
    .order("priority", { ascending: true });

  const megaTaskPromises = (megaSources || []).map((s: any) => {
    const url = s.url || `https://${s.dealer_domain}${s.inventory_path || ""}`;
    if (!url || url === "https://undefined") return Promise.resolve(null);
    return dispatchManusTask(supabase, MANUS_API_KEY, url, { ...taskFilterPayload, dealer_slug: s.dealer_slug }, sessionId, huntId);
  });

  const megaTaskIds = (await Promise.all(megaTaskPromises)).filter(Boolean) as string[];
  console.log(`[PIPELINE] Mega-dealer tasks: ${megaTaskIds.length}`);

  /* ── STEP 6: Brand-routed dealer sites (fallback — only if Drive returned 0) ── */
  let brandTaskIds: string[] = [];

  if (driveResultCount === 0) {
    const makeUpper = make.toUpperCase();
    const { data: allSources } = await supabase
      .from("dealer_outbound_sources")
      .select("*")
      .in("adapter_type", ["manus", "generic_scrape"])
      .eq("enabled", true)
      .neq("dealer_type", "mega_dealer")
      .order("priority", { ascending: true });

    const brandFiltered = (allSources || []).filter((s: any) => {
      if (!s.brands || s.brands.length === 0) return true;
      return s.brands.some((b: string) => b.toUpperCase() === makeUpper);
    });

    const capped = brandFiltered.slice(0, MAX_BRAND_DEALER_SEARCHES);
    console.log(`[PIPELINE] Brand fallback: ${brandFiltered.length} matched, capped to ${capped.length}`);

    const brandPromises = capped.map((s: any) => {
      const url = s.url || `https://${s.dealer_domain}${s.inventory_path || ""}`;
      if (!url || url === "https://undefined") return Promise.resolve(null);
      return dispatchManusTask(supabase, MANUS_API_KEY, url, { ...taskFilterPayload, dealer_slug: s.dealer_slug }, sessionId, huntId);
    });

    brandTaskIds = (await Promise.all(brandPromises)).filter(Boolean) as string[];
  } else {
    console.log(`[PIPELINE] Brand fallback skipped — Drive returned ${driveResultCount} results`);
  }

  const allTaskIds = [carsguideTaskId, ...megaTaskIds, ...brandTaskIds].filter(Boolean) as string[];

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      message: `Pipeline: Drive(${driveResultCount}) → CarsGuide → ${megaTaskIds.length} mega-dealers → ${brandTaskIds.length} brand-routed`,
      pipeline: {
        drive_results: driveResultCount,
        carsguide_task: carsguideTaskId,
        mega_dealer_tasks: megaTaskIds.length,
        brand_fallback_tasks: brandTaskIds.length,
      },
      tasks_created: allTaskIds.length,
      task_ids: allTaskIds,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
