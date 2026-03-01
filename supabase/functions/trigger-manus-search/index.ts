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

/* ── Market floor assessment ─────────────────────── */

interface FloorAssessment {
  confirmed: boolean;
  reasons: string[];
  pricedCount: number;
  spread_pct: number | null;
  outlier: boolean;
}

const STATE_STAMP_DUTY_RATES: Record<string, { threshold: number; low_rate: number; high_rate: number; base?: number }> = {
  "VIC": { threshold: 76950, low_rate: 0.084, high_rate: 0.104 },
  "NSW": { threshold: 45000, low_rate: 0.03, high_rate: 0.05, base: 1350 },
  "QLD": { threshold: 100000, low_rate: 0.035, high_rate: 0.045, base: 3500 },
  "WA": { threshold: 50000, low_rate: 0.028, high_rate: 0.065, base: 1400 },
  "SA": { threshold: 3000, low_rate: 0.02, high_rate: 0.04, base: 60 },
  "TAS": { threshold: 40000, low_rate: 0.03, high_rate: 0.04, base: 1200 },
  "ACT": { threshold: 45000, low_rate: 0.03, high_rate: 0.05, base: 1350 }, // Simplified, similar to NSW
  "NT": { threshold: 0, low_rate: 0.03, high_rate: 0.03 }, // Flat rate
};

function calculateExclGovtPrice(price: number, state: string | null): number {
  // Parse state abbreviation from a location string like "Suburb, STATE" or just "STATE"
  const stateStr = (state || "").split(",").pop()?.trim().toUpperCase() || "NSW";
  const stateAbbr = stateStr.substring(0, 3);
  const rules = STATE_STAMP_DUTY_RATES[stateAbbr] || STATE_STAMP_DUTY_RATES["NSW"]; // Default to NSW

  let stampDuty = 0;
  if (rules.threshold === 0) {
    stampDuty = price * rules.low_rate;
  } else if (price <= rules.threshold) {
    stampDuty = price * rules.low_rate;
  } else {
    stampDuty = (rules.base || 0) + (price - rules.threshold) * rules.high_rate;
  }

  const registrationFee = 800; // Average estimate for CTP, rego, etc.
  return price - stampDuty - registrationFee;
}

function assessMarketFloor(results: NormalisedResult[], yearMin?: number, yearMax?: number): FloorAssessment {
  // 1. First, normalize all prices to an excl. govt. basis and sort.
  const priced = results
    .map((r) => {
      const newResult = { ...r }; // Avoid mutating original results
      if (newResult.price_type === "drive_away" && newResult.price) {
        newResult.price = calculateExclGovtPrice(newResult.price, newResult.location);
        newResult.price_type = 'excl_govt'; // Mark as normalized
      }
      return newResult;
    })
    .filter((r) => r.price != null && r.price > 0)
    .sort((a, b) => a.price! - b.price!);

  const reasons: string[] = [];
  const currentYear = new Date().getFullYear();
  const isUsedCarSearch = (yearMin && yearMin < currentYear) || (yearMax && yearMax < currentYear);

  // 2. Apply the hard rule for Drive.com.au on used car searches.
  const hasOnlyDriveResults = priced.length > 0 && priced.every((r) => r.source === "drive");
  if (isUsedCarSearch && hasOnlyDriveResults) {
    reasons.push("USED_CAR_DRIVE_ONLY");
    // Don't return early, let the other rules also apply if needed, but this is a guaranteed trigger.
  }

  // 3. Apply the three stable floor triggers.
  // Trigger 1: Not enough matches.
  if (priced.length < 3) {
    reasons.push(`LOW_VOLUME(${priced.length})`);
  }

  let spreadPct: number | null = null;
  let outlierPct: number | null = null;

  // Trigger 2: Spread between 1st and 3rd is > 8%.
  if (priced.length >= 3) {
    const cheapest = priced[0].price!;
    const third = priced[2].price!;
    if (third > 0) {
      spreadPct = ((third - cheapest) / third) * 100;
      if (spreadPct > 8) {
        reasons.push(`HIGH_SPREAD_TO_3RD(${spreadPct.toFixed(1)}%)`);
      }
    }
  }

  // Trigger 3: Outlier cheapest is > 12% below 2nd.
  if (priced.length >= 2) {
    const cheapest = priced[0].price!;
    const second = priced[1].price!;
    if (second > 0) {
      outlierPct = ((second - cheapest) / second) * 100;
      if (outlierPct > 12) {
        reasons.push(`OUTLIER_CHEAPEST(${outlierPct.toFixed(1)}%)`);
      }
    }
  }

  const confirmed = reasons.length === 0;
  console.log(`[FLOOR_FINAL] priced=${priced.length} spreadTo3rd=${spreadPct?.toFixed(1)}% outlier=${outlierPct?.toFixed(1)}% confirmed=${confirmed} reasons=[${reasons.join(",")}]`);

  return { confirmed, reasons, pricedCount: priced.length, spread_pct: spreadPct, outlier: outlierPct ? outlierPct > 12 : false };
}

/* ── Manus execution contract prompt builder ─────── */

function buildManusPrompt(
  inventoryUrl: string,
  filters: Record<string, any>,
): string {
  const { make, model, badge, yearLine, kmLine, priceLine, tier1_min_price, tier1_max_price, year_min, year_max } = filters;
  const currentYear = new Date().getFullYear();
  const isUsedCarSearch = (year_min && year_min < currentYear) || (year_max && year_max < currentYear);

  const priceRangeLine = tier1_min_price && tier1_max_price
    ? `Price Range Hint: Focus on listings between $${Math.floor(tier1_min_price * 0.8)} and $${Math.ceil(tier1_max_price * 1.2)}.`
    : "";

  const badgeContract = badge
    ? [
        `BADGE VALIDATION: The badge/variant/trim text MUST contain the exact word "${badge}".`,
        `For example, if the listing says "SR5 Premium", and you are looking for "SR5", that is a valid match.`,
        `If the listing says "SR", that is NOT a valid match for "SR5".`,
        `If zero exact badge matches exist, return an empty array [].`,
      ].join("\n")
    : "";

  return [
    `## EXECUTION CONTRACT — BOUNDED SOURCING AGENT`,
    ``,
    `You are a deterministic vehicle sourcing agent. Follow these rules strictly:`,
    ``,
    `### HARD LIMITS`,
    `- Runtime: STOP after 120 seconds regardless of progress.`,
    `- Pages: Navigate at most 30 listing pages. Do NOT follow pagination beyond page 30.`,
    `- Matches: STOP as soon as you have collected 3 or more credible matches.`,
    `- Scope: Search ONLY the provided URL. Do NOT discover or navigate to other websites.`,
    `- No wandering: Do NOT click into individual listing detail pages unless required to extract a missing field.`,
    ``,
    `### SEARCH TARGET`,
    `Website: ${inventoryUrl}`,
    `Make: ${make}`,
    model ? `Model: ${model}` : "",
    badge ? `Badge/Variant: ${badge}` : "",
    yearLine || "",
    kmLine || "",
    priceLine || "",
    priceRangeLine,
    isUsedCarSearch ? `VEHICLE AGE: This is a used vehicle search. Prioritize listings described as 'Used'. Ignore listings marked as 'New' or 'Demo'.` : "",
    ``,
    badgeContract,
    ``,
    `### SORT ORDER`,
    `Sort results by price ascending (cheapest first). If the website supports price sorting, use it.`,
    ``,
    `### OUTPUT FORMAT`,
    `Return ONLY a JSON array sorted by price ASC. No commentary, no markdown fences.`,
    `Each object must have these fields:`,
    `- price (integer, AUD, exclude govt charges if possible)`,
    `- price_type (string: 'drive_away' | 'excl_govt' | 'unknown')`,
    `- km (integer)`,
    `- year (integer)`,
    `- badge (string, exact variant/trim as shown on listing)`,
    `- colour (string)`,
    `- location (string, suburb and state)`,
    `- dealer_name (string)`,
    `- direct_url (string, full URL to the individual listing page)`,
    `- stock_no (string, if visible)`,
    ``,
    `If no matching vehicles found, return [].`,
  ].filter(Boolean).join("\n");
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
  const prompt = buildManusPrompt(inventoryUrl, filters);
  const webhookUrl = Deno.env.get("MANUS_WEBHOOK_URL");

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
const MAX_TOTAL_MANUS_TASKS = 5;

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

  if (badge) {
    const badgeNorm = badge.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
    const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
    rows = rows.filter((r: any) => {
      const v = r.variant_raw || "";
      const vNorm = v.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
      return vNorm === badgeNorm || vNorm.includes(badgeNorm) || badgeRegex.test(v);
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
      const price = r.priceEgc || r.priceIgc || null;
      const priceType = r.priceEgc ? "excl_govt" : (r.priceIgc ? "drive_away" : "unknown");

      return {
        title: `${r.year || ""} ${r.makeDescription || ""} ${r.familyDescription || ""} ${r.description || ""}`.trim(),
        price,
        price_type: priceType,
        km: r.odometer || null,
        year: r.year || null,
        location: loc,
        dealer_name: null,
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

/* ── Tier-1 source: Toyota Used Cars (local DB) ── */

async function queryToyotaDB(
  supabase: ReturnType<typeof createClient>,
  make: string, model: string, badge: string,
  yearMin?: number, yearMax?: number, maxKm?: number, priceMax?: number,
): Promise<NormalisedResult[]> {
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

  if (badge) {
    const badgeNorm = badge.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
    const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
    rows = rows.filter((r: any) => {
      const v = r.variant_raw || "";
      const vNorm = v.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
      return vNorm === badgeNorm || vNorm.includes(badgeNorm) || badgeRegex.test(v);
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
   * LAYER 0: Tier-1 instant sources (parallel, zero cost)
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
    const badgeNorm = badge.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
    const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
    const beforeCount = driveResults.length;
    driveResults = driveResults.filter((r) => {
      const b = r.badge || r.title || "";
      const bNorm = b.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
      return bNorm === badgeNorm || bNorm.includes(badgeNorm) || badgeRegex.test(b);
    });
    console.log(`[PIPELINE] Drive badge exact filter "${badge}": ${beforeCount} → ${driveResults.length}`);
  }

  // Normalize all Layer 0 prices to excl_govt basis BEFORE sorting or any downstream use.
  // This ensures the UI, the floor assessment, and the Manus price hint all use the same price basis.
  const tier1Raw = [...auctionResults, ...driveResults, ...toyotaResults];
  const tier1Results: NormalisedResult[] = tier1Raw.map((r) => {
    if (r.price_type === "drive_away" && r.price) {
      return {
        ...r,
        price: calculateExclGovtPrice(r.price, r.location),
        price_type: "excl_govt",
      };
    }
    return r;
  }).sort((a, b) => (a.price || 999999) - (b.price || 999999));
  const tier1Count = tier1Results.length;

  console.log(`[PIPELINE] Layer-0: Auction(${auctionResults.length}) + Drive(${driveResultCount}) + Toyota(${toyotaResults.length}) = ${tier1Count} instant results`);

  /* ══════════════════════════════════════════════════
   * MARKET FLOOR ASSESSMENT
   * Replace simple count threshold with statistical check
   * ══════════════════════════════════════════════════ */
  const floor = assessMarketFloor(tier1Results, yearMin, yearMax);

  const tier1Prices = tier1Results.map(r => r.price).filter(Boolean) as number[];
  const minPrice = tier1Prices.length > 0 ? Math.min(...tier1Prices) : undefined;
  const maxPrice = tier1Prices.length > 0 ? Math.max(...tier1Prices) : undefined;

  let carsguideTaskId: string | null = null;
  let carsalesTaskId: string | null = null;
  let megaTaskIds: string[] = [];
  let brandTaskIds: string[] = [];
  let totalManusDispatched = 0;

  if (!floor.confirmed) {
    console.log(`[PIPELINE] Market floor UNCONFIRMED [${floor.reasons.join(", ")}] — dispatching Layer-1 Manus tasks`);

    /* ══════════════════════════════════════════════════
     * LAYER 1: Marketplace aggregators (CarsGuide + Carsales)
     * ══════════════════════════════════════════════════ */

    // CarsGuide
    if (totalManusDispatched < MAX_TOTAL_MANUS_TASKS) {
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
        if (carsguideTaskId) totalManusDispatched++;
        console.log(`[PIPELINE] CarsGuide task: ${carsguideTaskId || "failed"}`);
      } catch (err) {
        console.warn("[PIPELINE] CarsGuide dispatch error:", err);
      }
    }

    // Carsales.com.au
    if (totalManusDispatched < MAX_TOTAL_MANUS_TASKS) {
      try {
        const csParams = new URLSearchParams();
        csParams.set("q", `(And.Service.carsales._.Type.Used._.${make ? `Make.${encodeURIComponent(make)}.` : ""}${model ? `Family.${encodeURIComponent(model)}.` : ""})`);
        if (yearMin) csParams.set("year_from", String(yearMin));
        if (yearMax) csParams.set("year_to", String(yearMax));
        if (maxKm) csParams.set("odometer_max", String(maxKm));
        if (priceMax) csParams.set("price_max", String(priceMax));

        const csUrl = `https://www.carsales.com.au/cars/?${csParams.toString()}`;

        carsalesTaskId = await dispatchManusTask(supabase, MANUS_API_KEY, csUrl, { ...taskFilterPayload, source: "carsales", tier1_min_price: minPrice, tier1_max_price: maxPrice }, sessionId, huntId);
        if (carsalesTaskId) totalManusDispatched++;
        console.log(`[PIPELINE] Carsales task: ${carsalesTaskId || "failed"}`);
      } catch (err) {
        console.warn("[PIPELINE] Carsales dispatch error:", err);
      }
    }

    /* ══════════════════════════════════════════════════
     * LAYER 2: Brand-scoped mega-dealer sweep
     * Only when Layer 0 returned zero results.
     * Query dealer_outbound_sources filtered by brand,
     * take top 3 brand-matching mega-dealers only.
     * ══════════════════════════════════════════════════ */
    if (tier1Count === 0 && totalManusDispatched < MAX_TOTAL_MANUS_TASKS) {
      const makeUpper = make.toUpperCase();
      const remaining = MAX_TOTAL_MANUS_TASKS - totalManusDispatched;

      const { data: brandMegaSources } = await supabase
        .from("dealer_outbound_sources")
        .select("*")
        .eq("enabled", true)
        .order("priority", { ascending: true });

      // Filter to brand-matching sources (mega_dealer type preferred, then others)
      const brandMatched = (brandMegaSources || []).filter((s: any) => {
        if (!s.brands || s.brands.length === 0) return false; // must explicitly list the brand
        return s.brands.some((b: string) => b.toUpperCase() === makeUpper);
      });

      // Prefer mega_dealers first, then others
      const sorted = brandMatched.sort((a: any, b: any) => {
        if (a.dealer_type === "mega_dealer" && b.dealer_type !== "mega_dealer") return -1;
        if (a.dealer_type !== "mega_dealer" && b.dealer_type === "mega_dealer") return 1;
        return 0;
      });

      const capped = sorted.slice(0, Math.min(MAX_BRAND_DEALER_SEARCHES, remaining));
      console.log(`[PIPELINE] Layer-2 brand sweep: ${brandMatched.length} brand-matched, dispatching ${capped.length} (remaining budget: ${remaining})`);

      const brandPromises = capped.map((s: any) => {
        const url = s.url || `https://${s.dealer_domain}${s.inventory_path || ""}`;
        if (!url || url === "https://undefined") return Promise.resolve(null);
        return dispatchManusTask(supabase, MANUS_API_KEY, url, { ...taskFilterPayload, dealer_slug: s.dealer_slug }, sessionId, huntId);
      });

      brandTaskIds = (await Promise.all(brandPromises)).filter(Boolean) as string[];
      totalManusDispatched += brandTaskIds.length;
      console.log(`[PIPELINE] Layer-2 brand tasks: ${brandTaskIds.length}`);
    }
  } else {
    console.log(`[PIPELINE] Market floor CONFIRMED (${floor.pricedCount} priced, spread=${floor.spread_pct?.toFixed(1) ?? "N/A"}%) — skipping all Manus tasks`);
  }

  const allTaskIds = [carsguideTaskId, carsalesTaskId, ...megaTaskIds, ...brandTaskIds].filter(Boolean) as string[];

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      message: `Layer-0: Auction(${auctionResults.length})+Drive(${driveResultCount})+Toyota(${toyotaResults.length}) | Floor: ${floor.confirmed ? "CONFIRMED" : "UNCONFIRMED"} | Manus: ${allTaskIds.length} tasks`,
      pipeline: {
        auction_results: auctionResults.length,
        drive_results: driveResultCount,
        toyota_results: toyotaResults.length,
        tier1_total: tier1Count,
        floor_assessment: {
          confirmed: floor.confirmed,
          reasons: floor.reasons,
          priced_count: floor.pricedCount,
          spread_pct: floor.spread_pct,
          outlier: floor.outlier,
        },
        carsguide_task: carsguideTaskId,
        carsales_task: carsalesTaskId,
        mega_dealer_tasks: megaTaskIds.length,
        brand_sweep_tasks: brandTaskIds.length,
        total_manus_tasks: allTaskIds.length,
      },
      instant_results: tier1Results,
      tasks_created: allTaskIds.length,
      task_ids: allTaskIds,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
