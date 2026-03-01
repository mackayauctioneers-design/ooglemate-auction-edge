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

interface NormalisedResult {
  title: string;
  price: number | null;
  price_type: string | null;
  km: number | null;
  year: number | null;
  location: string | null;
  dealer_name: string | null;
  url: string;
  badge: string | null;
  source: string;
  colour: string | null;
  stock_no: string | null;
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
    ? `IMPORTANT: Only return vehicles that are specifically the "${badge}" variant/badge/trim. Do NOT return other variants like BASE, Active, Elite, or any other trim that is not "${badge}". If no exact match exists, return an empty array.\n${badge} is NOT the same as ${badge}L or ${badge}R. Only return vehicles where the badge is exactly "${badge}", not a variant that starts with or contains "${badge}" as a prefix.`
    : "";

  const webhookUrl = Deno.env.get("MANUS_WEBHOOK_URL");

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

  const taskBody: Record<string, unknown> = { prompt };
  if (webhookUrl) {
    taskBody.webhook_url = webhookUrl;
  }

  try {
    const res = await fetch("https://api.manus.im/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", API_KEY: apiKey, accept: "application/json" },
      body: JSON.stringify(taskBody),
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

const MAX_BRAND_DEALER_SEARCHES = 3;
const DRIVE_SUFFICIENT_THRESHOLD = 5;

/* ── Tier-1 source: Auction DB (local Supabase query) ── */

async function queryAuctionDB(
  supabase: ReturnType<typeof createClient>,
  make: string, model: string, badge: string,
  yearMin?: number, yearMax?: number, maxKm?: number, priceMax?: number,
): Promise<NormalisedResult[]> {
  let query = supabase
    .from("vehicle_listings")
    .select("id, listing_id, make, model, variant_raw, year, km, asking_price, location, listing_url, auction_house, source, source_class, status")
    .ilike("make", make)
    .not("status", "in", '("STALE","DEAD")')
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(60);

  if (model) query = query.ilike("model", model);
  if (yearMin) query = query.gte("year", yearMin);
  if (yearMax) query = query.lte("year", yearMax);
  if (maxKm) query = query.lte("km", maxKm);
  if (priceMax) query = query.lte("asking_price", priceMax);

  const { data, error } = await query;
  if (error) {
    console.warn("[PIPELINE] Auction DB error:", error.message);
    return [];
  }

  let rows = data || [];

  // Exact badge token matching (not substring) — "GX" must NOT match "GXL"
  if (badge) {
    const badgeUpper = badge.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
    rows = rows.filter((r: any) => {
      const v = r.variant_raw || "";
      const vNorm = v.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
      return vNorm === badgeUpper || badgeRegex.test(v);
    });
    console.log(`[PIPELINE] Auction badge exact filter "${badge}": ${(data || []).length} → ${rows.length}`);
  }

  return rows.map((r: any) => ({
    title: `${r.year || ""} ${r.make || ""} ${r.model || ""} ${r.variant_raw || ""}`.trim(),
    price: r.asking_price,
    price_type: "excl_govt" as string,
    km: r.km,
    year: r.year,
    location: r.location,
    dealer_name: r.auction_house || r.source || null,
    url: r.listing_url || "",
    badge: r.variant_raw || null,
    source: "auction_db",
    colour: null,
    stock_no: r.listing_id || null,
  }));
}

/* ── Tier-1 source: Drive.com.au GraphQL ── */

async function queryDrive(
  make: string, model: string,
  yearMin?: number, yearMax?: number, maxKm?: number, priceMax?: number,
): Promise<{ results: NormalisedResult[]; totalCount: number }> {
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

  try {
    const res = await fetch("https://drive-carsforsale-prod.graphcdn.app/", {
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

    if (!res.ok) {
      console.warn(`[PIPELINE] Drive API error: ${res.status}`);
      await res.text();
      return { results: [], totalCount: 0 };
    }

    const driveData = await res.json();
    const totalCount = driveData?.data?.listings?.pageInfo?.itemCount ?? 0;
    const rawResults = driveData?.data?.listings?.results || [];

    const results: NormalisedResult[] = rawResults.map((r: any) => {
      const dealerSuburb = r.Dealer?.suburb || r.Region?.name || "";
      const dealerState = r.Dealer?.state || r.Region?.state || "";
      const loc = [dealerSuburb, dealerState].filter(Boolean).join(" ");
      // priceIgc = inclusive govt charges (drive-away), priceEgc = excl govt charges
      const price = r.priceEgc || r.priceIgc || null;
      const priceType = r.priceEgc ? "excl_govt" : (r.priceIgc ? "drive_away" : "unknown");

      return {
        title: `${r.year || ""} ${r.makeDescription || ""} ${r.familyDescription || ""} ${r.description || ""}`.trim(),
        price,
        price_type: priceType,
        km: r.odometer || null,
        year: r.year || null,
        location: loc,
        dealer_name: null, // Drive doesn't expose dealer name in listing results
        url: `https://www.drive.com.au/cars-for-sale/${(r.makeDescription || make).toLowerCase().replace(/\s+/g, "-")}/${(r.familyDescription || model).toLowerCase().replace(/\s+/g, "-")}/${r.id}/`,
        badge: r.description || null,
        source: "drive",
        colour: null,
        stock_no: r.id ? String(r.id) : null,
      };
    });

    return { results, totalCount };
  } catch (err) {
    console.warn("[PIPELINE] Drive aggregator error:", err);
    return { results: [], totalCount: 0 };
  }
}

/* ── Tier-1 source: Toyota Used Cars (local DB — ingested by caroogle-toyota-cron) ── */

async function queryToyotaDB(
  supabase: ReturnType<typeof createClient>,
  make: string, model: string, badge: string,
  yearMin?: number, yearMax?: number, maxKm?: number, priceMax?: number,
): Promise<NormalisedResult[]> {
  // Only relevant for Toyota-brand searches
  if (make.toUpperCase() !== "TOYOTA") return [];

  let query = supabase
    .from("vehicle_listings")
    .select("id, listing_id, make, model, variant_raw, year, km, asking_price, location, listing_url, source")
    .eq("source", "toyota")
    .not("status", "in", '("STALE","DEAD")')
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(30);

  if (model) query = query.ilike("model", model);
  if (yearMin) query = query.gte("year", yearMin);
  if (yearMax) query = query.lte("year", yearMax);
  if (maxKm) query = query.lte("km", maxKm);
  if (priceMax) query = query.lte("asking_price", priceMax);

  const { data, error } = await query;
  if (error) {
    console.warn("[PIPELINE] Toyota DB error:", error.message);
    return [];
  }

  let rows = data || [];

  // Exact badge token matching for Toyota — "GX" must NOT match "GXL"
  if (badge) {
    const badgeUpper = badge.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
    rows = rows.filter((r: any) => {
      const v = r.variant_raw || "";
      const vNorm = v.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
      return vNorm === badgeUpper || badgeRegex.test(v);
    });
    console.log(`[PIPELINE] Toyota badge exact filter "${badge}": ${(data || []).length} → ${rows.length}`);
  }

  return rows.map((r: any) => ({
    title: `${r.year || ""} ${r.make || ""} ${r.model || ""} ${r.variant_raw || ""}`.trim(),
    price: r.asking_price,
    price_type: "drive_away" as string,
    km: r.km,
    year: r.year,
    location: r.location,
    dealer_name: "Toyota Certified Used Vehicles",
    url: r.listing_url || "https://www.toyota.com.au/used-vehicles",
    badge: r.variant_raw || null,
    source: "toyota_db",
    colour: null,
    stock_no: r.listing_id || null,
  }));
}

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

  /* ══════════════════════════════════════════════════
   * STEP 2: Tier-1 instant sources (parallel, zero cost)
   * ══════════════════════════════════════════════════ */
  const [auctionResults, driveResponse, toyotaResults] = await Promise.all([
    queryAuctionDB(supabase, make, model, badge, yearMin, yearMax, maxKm, priceMax),
    queryDrive(make, model, yearMin, yearMax, maxKm, priceMax),
    queryToyotaDB(supabase, make, model, badge, yearMin, yearMax, maxKm, priceMax),
  ]);

  let driveResults = driveResponse.results;
  const driveResultCount = driveResponse.totalCount;

  // Post-filter Drive results for exact badge token match
  if (badge && driveResults.length > 0) {
    const badgeUpper = badge.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
    const beforeCount = driveResults.length;
    driveResults = driveResults.filter((r) => {
      const b = r.badge || r.title || "";
      const bNorm = b.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
      return bNorm === badgeUpper || badgeRegex.test(b);
    });
    console.log(`[PIPELINE] Drive badge exact filter "${badge}": ${beforeCount} → ${driveResults.length}`);
  }

  const tier1Results = [...auctionResults, ...driveResults, ...toyotaResults];
  const tier1Count = tier1Results.length;

  console.log(`[PIPELINE] Tier-1: Auction(${auctionResults.length}) + Drive(${driveResultCount}) + Toyota(${toyotaResults.length}) = ${tier1Count} instant results`);

  /* ══════════════════════════════════════════════════
   * STEP 3: Tier-2 Manus sources (conditional dispatch)
   * If tier-1 Drive >= 5 → skip Manus entirely
   * If tier-1 Drive < 5  → dispatch CarsGuide + mega-dealers
   * ══════════════════════════════════════════════════ */
  let carsguideTaskId: string | null = null;
  let megaTaskIds: string[] = [];
  let brandTaskIds: string[] = [];

  if (tier1Count < DRIVE_SUFFICIENT_THRESHOLD) {
    console.log(`[PIPELINE] Post-filter Tier-1 total ${tier1Count} (<${DRIVE_SUFFICIENT_THRESHOLD}) — dispatching Tier-2 Manus tasks`);

    // CarsGuide
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

    // Mega-dealers (EasyAuto123, Tony White, etc.)
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

    megaTaskIds = (await Promise.all(megaTaskPromises)).filter(Boolean) as string[];
    console.log(`[PIPELINE] Mega-dealer tasks: ${megaTaskIds.length}`);

    /* ── STEP 4: Brand-routed fallback (only if ALL tier-1 returned 0) ── */
    if (tier1Count === 0) {
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
      console.log(`[PIPELINE] Brand fallback tasks: ${brandTaskIds.length}`);
    }
  } else {
    console.log(`[PIPELINE] Post-filter Tier-1 total ${tier1Count} (≥${DRIVE_SUFFICIENT_THRESHOLD}) — skipping all Manus tasks`);
  }

  const allTaskIds = [carsguideTaskId, ...megaTaskIds, ...brandTaskIds].filter(Boolean) as string[];

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      message: `Tier-1: Auction(${auctionResults.length})+Drive(${driveResultCount})+Toyota(${toyotaResults.length}) | Tier-2: ${allTaskIds.length} Manus tasks`,
      pipeline: {
        auction_results: auctionResults.length,
        drive_results: driveResultCount,
        toyota_results: toyotaResults.length,
        tier1_total: tier1Count,
        carsguide_task: carsguideTaskId,
        mega_dealer_tasks: megaTaskIds.length,
        brand_fallback_tasks: brandTaskIds.length,
      },
      // Tier-1 instant results returned inline for immediate display
      instant_results: tier1Results,
      tasks_created: allTaskIds.length,
      task_ids: allTaskIds,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
