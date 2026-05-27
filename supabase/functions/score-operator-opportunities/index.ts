import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { derivePlatform, extractBadge as sharedExtractBadge } from "../_shared/taxonomy/derivePlatform.ts";

/**
 * SCORE OPERATOR OPPORTUNITIES — v2 (Delta + Caps + Rank-before-Insert)
 *
 * Key changes from v1:
 *   1. Delta fetch via scorer_cursors (only new/updated listings since last run)
 *   2. Hard caps per run (MAX_LISTINGS, MAX_CREATED, MAX_AUCTION_WATCH)
 *   3. Rank-before-insert: score in memory, sort, insert only best
 *   4. Median cache: one RPC per (make,model,badge,year,km_band) key
 *   5. Guarded upsert via DB function (terminal states never revived)
 *   6. Predictable runtime: no unbounded loops
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── CONFIG ───────────────────────────────────────────────────────────────────
const JOB_NAME = "operator_scorer_v2";
const MAX_LISTINGS_PER_RUN = 3000;
const MAX_OPPORTUNITIES_CREATED = 300;
const MAX_AUCTION_WATCH_CREATED = 150;
const SAFETY_BUFFER_MINUTES = 10;
const TOP_K_PER_FINGERPRINT = 3; // max opps per platform_class+trim per run

// ── GLOBAL VEHICLE FILTER ────────────────────────────────────────────────────
// Platform rule: only 2020+ model year vehicles with ≤120,000 km are eligible
// for fingerprints, anchor sales, and live listing matches.
const MIN_YEAR = 2020;
const MAX_KM = 120000;
function passesVehicleFilter(year: number | null | undefined, km: number | null | undefined): boolean {
  if (!year || year < MIN_YEAR) return false;
  if (km != null && km > MAX_KM) return false;
  return true;
}

// ── HELPERS (unchanged logic) ────────────────────────────────────────────────

// derivePlatform and extractBadge are now imported from _shared/taxonomy/derivePlatform.ts
// This eliminates identity duplication. See canonical module for rules.
function extractBadge(text: string | null): string {
  return sharedExtractBadge(text);
}

// Sanitize source URLs: reject search/list pages, keep only detail/lot pages
function sanitizeSourceUrl(url: string, listingId: string): string {
  if (!url) return "";
  // Reject search page URLs
  if (/\/search\?q=|\/search\/-\/|\/list\/keyword/i.test(url)) {
    // Try to build a correct Pickles detail URL from listing_id
    const picklesMatch = listingId.match(/^pickles:(\d+)$/);
    if (picklesMatch) {
      return `https://www.pickles.com.au/cars/search?q=${picklesMatch[1]}`;
    }
    return ""; // Can't repair — return empty
  }
  return url;
}

const PRODUCTION_SOURCES = [
  "pickles","grays","manheim","caroogle_shadow",
  "autotrader","carsales","easyauto","slattery",
  "toyota","toyota_used","nsw_regional","vma","bidsonline",
  "gumtree",
];

function isProductionSource(src: string): boolean {
  if (!src) return false;
  const s = src.toLowerCase();
  if (s.includes("test") || s.includes("sandbox") || s.includes("fixture")) return false;
  return PRODUCTION_SOURCES.includes(s) || s.startsWith("dealer_site:");
}

const RETAIL_SOURCES = ["autotrader","drive","easyauto","toyota","toyota_used","carsales","gumtree"];
function isRetailSource(src: string): boolean {
  if (!src) return false;
  return RETAIL_SOURCES.includes(src.toLowerCase());
}

function drivetrainBucket(val: string | null): string {
  if (!val) return "UNKNOWN";
  const v = val.toUpperCase();
  if (/4X4|4WD|AWD/.test(v)) return "4WD";
  if (/2WD|2X4|FWD|RWD|4X2/.test(v)) return "2WD";
  return "UNKNOWN";
}

const TRIM_LADDER: Record<string, Record<string, number>> = {
  "LANDCRUISER": { WORKMATE: 1, GX: 2, GXL: 3, VX: 4, SAHARA: 5 },
  "PRADO": { GX: 1, GXL: 2, VX: 3, KAKADU: 4 },
  "TOYOTA:HILUX": { WORKMATE: 1, SR: 2, SR5: 3, ROGUE: 4, RUGGED: 5 },
  "TOYOTA:HIACE": { LWB: 1, SLWB: 2, COMMUTER: 3 },
  "FORD:RANGER": { XL: 1, XLS: 2, XLT: 3, WILDTRAK: 4, RAPTOR: 5 },
  "FORD:EVEREST": { AMBIENTE: 1, TREND: 2, TITANIUM: 3 },
  "ISUZU:D-MAX": { SX: 1, "LS-M": 2, "LS-U": 3, "X-TERRAIN": 4 },
  "ISUZU:DMAX": { SX: 1, "LS-M": 2, "LS-U": 3, "X-TERRAIN": 4 },
  "ISUZU:MU-X": { "LS-M": 1, "LS-U": 2, "LS-T": 3 },
  "ISUZU:MUX": { "LS-M": 1, "LS-U": 2, "LS-T": 3 },
  "MITSUBISHI:TRITON": { GLX: 1, "GLX+": 2, "GLX-R": 3, GLS: 4 },
  "OUTLANDER": { ES: 1, LS: 2, ASPIRE: 3, EXCEED: 4, EXCEED_TOURER: 5 },
  "NISSAN:NAVARA": { RX: 1, SL: 2, ST: 3, "ST-L": 4, "ST-X": 5, "PRO-4X": 6 },
  "NISSAN:PATROL": { TI: 1, "TI-L": 2 },
  "HOLDEN:COLORADO": { LS: 1, LT: 2, LTZ: 3, Z71: 4 },
};

function trimAllowed(platformClass: string, listingTrim: string, saleTrim: string): boolean {
  if (saleTrim === listingTrim) return true;
  // BASE is an explicit low-confidence fallback for legacy sales/uploads where
  // the badge could not be extracted. Keep laddered hero platforms strict, but
  // let non-ladder platforms match at make/model level so usable dealer truth is
  // not silently discarded.
  const ladder = TRIM_LADDER[platformClass];
  if (!ladder) return saleTrim === "BASE" || listingTrim === "BASE";
  const listingRank = ladder[listingTrim];
  const saleRank = ladder[saleTrim];
  if (listingRank == null || saleRank == null) return false;
  return listingRank === saleRank + 1;
}

// ── LISTING AGE SCORING ──────────────────────────────────────────────────────

function scoreListingAge(daysListed: number, priceDrops: number): { score: number; reason: string } {
  // Safety: listings > 90 days without recent price drops are stale, not negotiable
  if (daysListed > 90 && priceDrops === 0) {
    return { score: 0, reason: `Age ${daysListed}d >90d with no price drop (+0)` };
  }

  let score = 0;
  if (daysListed <= 3) score = 0;
  else if (daysListed <= 10) score = 3;
  else if (daysListed <= 20) score = 6;
  else if (daysListed <= 30) score = 8;
  else score = 10;

  // Price drop bonus: +2 if listing is 10+ days old AND had a recent price drop
  if (daysListed > 10 && priceDrops > 0) {
    score = Math.min(score + 2, 10);
  }

  const reason = `Age ${daysListed}d → +${score}${priceDrops > 0 && daysListed > 10 ? ` (incl price-drop bonus, ${priceDrops} drops)` : ''}`;
  return { score, reason };
}

// ── INTERFACES ───────────────────────────────────────────────────────────────

interface CandidateListing {
  listing_id: string;
  source: string;
  source_type: "auction" | "retail" | "shadow";
  make: string;
  model: string;
  year: number;
  km: number | null;
  asking_price: number;
  platform_class: string;
  trim_class: string;
  drivetrain_bucket: string;
  source_url: string;
  first_seen_at: string;
  days_listed: number;
  price_drops: number;
  pass_count: number;
  badge: string | null;
  fuel_type: string | null;
  body_type: string | null;
}

interface PricelessCandidate {
  listing_id: string;
  source: string;
  make: string;
  model: string;
  year: number;
  km: number | null;
  platform_class: string;
  trim_class: string;
  drivetrain_bucket: string;
  source_url: string;
  first_seen_at: string;
  auction_house: string | null;
  auction_datetime: string | null;
}

interface AccountMatch {
  account_id: string;
  account_name: string;
  expected_margin: number;
  weighted_margin: number;
  applied_weight: number;
  under_buy: number;
  anchor_sale_id: string;
  anchor_sale_buy_price: number;
  anchor_sale_sell_price: number;
  anchor_sale_profit: number;
  anchor_sale_sold_at: string | null;
  anchor_sale_km: number | null;
  anchor_sale_trim_class: string;
  margin_flag: string | null;
}

// Per-dealer make/model weights from dealer_intelligence_profiles
type WeightsMap = Record<string, { MAKE: Record<string, number>; MAKE_MODEL: Record<string, number> }>;

function resolveWeight(weights: WeightsMap, accountId: string, make: string, model: string): number {
  const w = weights[accountId];
  if (!w) return 1.0;
  const mk = (make || "").toUpperCase().trim();
  const md = (model || "").toUpperCase().trim();
  const v = w.MAKE_MODEL?.[`${mk}|${md}`] ?? w.MAKE?.[mk] ?? 1.0;
  if (typeof v !== "number" || !isFinite(v)) return 1.0;
  return Math.max(0, Math.min(2, v));
}

interface ScoredCandidate {
  row: any; // the upsert row
  score: number;
  tier: string;
  fingerprint_key: string;
  is_auction_watch: boolean;
}

// ── CURSOR ───────────────────────────────────────────────────────────────────

async function getCursor(sb: any): Promise<string> {
  const { data, error } = await sb
    .from("scorer_cursors")
    .select("last_seen_cutoff")
    .eq("job_name", JOB_NAME)
    .single();
  if (error || !data?.last_seen_cutoff) {
    // Fallback: 48h ago
    return new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  }
  return data.last_seen_cutoff;
}

async function setCursor(sb: any, ok: boolean, note: any): Promise<void> {
  const newCutoff = new Date(Date.now() - SAFETY_BUFFER_MINUTES * 60 * 1000).toISOString();
  await sb.from("scorer_cursors").upsert(
    {
      job_name: JOB_NAME,
      last_seen_cutoff: newCutoff,
      last_run_at: new Date().toISOString(),
      last_ok: ok,
      note,
    },
    { onConflict: "job_name" },
  );
}

// ── PAGINATED DELTA FETCH ────────────────────────────────────────────────────

async function fetchDelta(
  sb: any,
  table: string,
  selectCols: string,
  cutoff: string,
  extraFilters: (q: any) => any,
  maxRows: number,
): Promise<any[]> {
  const all: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (offset < maxRows) {
    let q = sb
      .from(table)
      .select(selectCols)
      .gt("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    q = extraFilters(q);
    const { data, error } = await q;
    if (error) { console.error(`[FETCH] ${table} error:`, error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── SCORE ONE LISTING AGAINST ALL ACCOUNTS ───────────────────────────────────

function scoreListingAgainstAccounts(
  listing: CandidateListing,
  salesByAccount: Record<string, any[]>,
  accountNames: Record<string, string>,
  weights: WeightsMap,
): { best: AccountMatch; alts: AccountMatch[]; tier: string; listing_age_score?: number; listing_age_reason?: string } | null {
  const accountMatches: AccountMatch[] = [];
  const isRetail = listing.source_type === "retail";

  for (const [acctId, acctSales] of Object.entries(salesByAccount)) {
    const matches = acctSales.filter((s: any) => {
      if (s.platform_class !== listing.platform_class) return false;
      if (!s.trim_class || s.trim_class === "UNKNOWN") return false;
      if (!trimAllowed(listing.platform_class, listing.trim_class, s.trim_class)) return false;
      if (Math.abs(s.year - listing.year) > 1) return false;
      if (s.km && listing.km) {
        const kmDelta = Math.abs(s.km - listing.km);
        const kmThreshold = Math.max(listing.km, s.km) * 0.2;
        if (kmDelta > kmThreshold) return false;
      }
      if (listing.drivetrain_bucket !== "UNKNOWN" && s.drivetrain_bucket && s.drivetrain_bucket !== "UNKNOWN" && listing.drivetrain_bucket !== s.drivetrain_bucket) return false;
      return true;
    });

    if (matches.length === 0) continue;

    const maxProfit = Math.max(...matches.map((c: any) => c.sale_price - Number(c.buy_price)));
    matches.sort((a: any, b: any) => {
      const kmA = a.km && listing.km ? 1 - Math.abs(a.km - listing.km) / (listing.km * 0.2 || 15000) : 0.5;
      const kmB = b.km && listing.km ? 1 - Math.abs(b.km - listing.km) / (listing.km * 0.2 || 15000) : 0.5;
      const pA = (a.sale_price - Number(a.buy_price)) / (maxProfit || 1);
      const pB = (b.sale_price - Number(b.buy_price)) / (maxProfit || 1);
      return (kmB * 0.7 + pB * 0.3) - (kmA * 0.7 + pA * 0.3);
    });

    const best = matches[0];
    const underBuy = Number(best.buy_price) - listing.asking_price;
    const anchorProfit = best.sale_price - Number(best.buy_price);
    const expectedMargin = anchorProfit;
    const appliedWeight = resolveWeight(weights, acctId, listing.make, listing.model);
    const weightedMargin = expectedMargin * appliedWeight;
    const marginFlag = expectedMargin > 15000 ? "high_variance" : null;

    if (isRetail) {
      if (underBuy < -3000) continue;
    } else {
      if (underBuy < -500) continue;
    }

    accountMatches.push({
      account_id: acctId,
      account_name: accountNames[acctId] || "Unknown",
      expected_margin: expectedMargin,
      weighted_margin: weightedMargin,
      applied_weight: appliedWeight,
      under_buy: underBuy,
      anchor_sale_id: best.id,
      anchor_sale_buy_price: Number(best.buy_price),
      anchor_sale_sell_price: best.sale_price,
      anchor_sale_profit: anchorProfit,
      anchor_sale_sold_at: best.sold_at || null,
      anchor_sale_km: best.km || null,
      anchor_sale_trim_class: best.trim_class || "UNKNOWN",
      margin_flag: marginFlag,
    });
  }

  if (accountMatches.length === 0) return null;

  // Rank by weighted margin so dealer preferences influence "best account"
  accountMatches.sort((a, b) => b.weighted_margin - a.weighted_margin);
  const best = accountMatches[0];
  const alts = accountMatches.slice(1);

  // Tiering uses weighted margin (winners get tier boosts, avoid-list gets demoted)
  let tier: string;
  if (isRetail) {
    if (best.under_buy >= 1500) tier = "RETAIL_BUY";
    else if (best.under_buy >= -3000) tier = "RETAIL_TARGET";
    else tier = "WATCH";
  } else {
    if (best.under_buy >= 1500 && best.weighted_margin >= 6000) tier = "CODE_RED";
    else if (best.under_buy >= 1500 && best.weighted_margin >= 4000) tier = "HIGH";
    else if (best.under_buy >= 1500) tier = "BUY";
    else tier = "WATCH";
  }

  if (!isRetail) {
    let motivationSignal: string | null = null;
    if (listing.pass_count >= 2) motivationSignal = "3RD_RUN";
    else if (listing.days_listed >= 7) motivationSignal = "WEEK_PLUS_STOCK";
    if (motivationSignal && tier === "WATCH" && best.under_buy >= -500) tier = "BUY";
  }

  const ageResult = scoreListingAge(listing.days_listed, listing.price_drops);

  return { best, alts, tier, listing_age_score: ageResult.score, listing_age_reason: ageResult.reason };
}

// ── TIER SCORE (for ranking) ─────────────────────────────────────────────────

function tierScore(tier: string): number {
  switch (tier) {
    case "CODE_RED": return 100;
    case "HIGH": return 80;
    case "BUY": return 60;
    case "RETAIL_BUY": return 70;
    case "RETAIL_TARGET": return 50;
    case "AUCTION_WATCH": return 40;
    case "WATCH": return 30;
    default: return 0;
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const results = {
    fetched_priced: 0,
    fetched_priceless: 0,
    fetched_shadow: 0,
    fetched_retail: 0,
    scored: 0,
    discarded: 0,
    created: 0,
    skipped_terminal: 0,
    skipped_cap: 0,
    auction_watch_created: 0,
    runtime_ms: 0,
  };

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const focusAccountId = typeof body?.focus_account_id === "string" && body.focus_account_id.trim()
      ? body.focus_account_id.trim()
      : null;

    // ── 1. Get cursor ──
    // Focused operator runs are explicit dealer rebuilds, so they must not be
    // trapped behind the global delta cursor. Use a wider scan window and do
    // not advance the shared cursor at the end.
    const cutoff = focusAccountId
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : await getCursor(sb);
    console.log(`[SCORE-V2] Delta cutoff: ${cutoff}${focusAccountId ? ` focus_account=${focusAccountId}` : ""}`);

    // ── 2. Load accounts + sales (these are small, load fully) ──
    let accountsQuery = sb.from("accounts").select("id, display_name, slug");
    if (focusAccountId) accountsQuery = accountsQuery.eq("id", focusAccountId);
    const { data: accounts } = await accountsQuery;
    if (!accounts || accounts.length === 0) throw new Error("No accounts found");

    let salesQuery = sb
      .from("vehicle_sales_truth")
      .select("id, account_id, make, model, year, km, buy_price, sale_price, sold_at, trim_class, variant, platform_class, drivetrain_bucket, drive_type")
      .not("buy_price", "is", null)
      .not("sale_price", "is", null);
    if (focusAccountId) salesQuery = salesQuery.eq("account_id", focusAccountId);
    const { data: allSales } = await salesQuery;

    if (!allSales || allSales.length === 0) {
      await setCursor(sb, true, { reason: "no_sales_data" });
      return respond({ success: true, scored: 0, reason: "no_sales_data" });
    }

    const salesByAccount: Record<string, any[]> = {};
    for (const rawSale of allSales) {
      const profit = rawSale.sale_price - Number(rawSale.buy_price);
      if (profit <= 0) continue;
      if (!rawSale.account_id) continue;

      const derivedPlatform = derivePlatform(
        (rawSale.make || "").toUpperCase().trim(),
        (rawSale.model || "").toUpperCase().trim(),
      );

      const normalizedSale = {
        ...rawSale,
        platform_class:
          rawSale.platform_class && rawSale.platform_class.includes(":")
            ? rawSale.platform_class
            : derivedPlatform || rawSale.platform_class,
        trim_class: rawSale.trim_class || extractBadge(rawSale.variant) || "BASE",
        drivetrain_bucket:
          rawSale.drivetrain_bucket && rawSale.drivetrain_bucket !== "UNKNOWN"
            ? rawSale.drivetrain_bucket
            : drivetrainBucket(rawSale.drive_type),
      };

      if (!normalizedSale.platform_class || normalizedSale.platform_class === "UNKNOWN") continue;
      if (!normalizedSale.trim_class || normalizedSale.trim_class === "UNKNOWN") continue;
      if (!normalizedSale.year) continue;
      if (!passesVehicleFilter(normalizedSale.year, normalizedSale.km)) continue;

      if (!salesByAccount[normalizedSale.account_id]) salesByAccount[normalizedSale.account_id] = [];
      salesByAccount[normalizedSale.account_id].push(normalizedSale);
    }

    const accountNames: Record<string, string> = {};
    for (const a of accounts) accountNames[a.id] = a.display_name;

    console.log(`[SCORE-V2] ${Object.keys(salesByAccount).length} accounts with sales`);

    // ── 2b. Load per-dealer intelligence weights ──
    const weightsByAccount: WeightsMap = {};
    try {
      const { data: intelRows } = await sb
        .from("dealer_intelligence_profiles")
        .select("account_id, weights");
      for (const r of intelRows || []) {
        const w = r.weights || {};
        weightsByAccount[r.account_id] = {
          MAKE: w.MAKE || {},
          MAKE_MODEL: w.MAKE_MODEL || {},
        };
      }
      console.log(`[SCORE-V2] Loaded weights for ${Object.keys(weightsByAccount).length} dealers`);
    } catch (e) {
      console.warn(`[SCORE-V2] Weights load failed (continuing neutral):`, (e as Error).message);
    }


    // ── 3. Delta fetch from all sources ──
    const AUCTION_SOURCES = ["pickles","grays","manheim","slattery","f3","auto_auctions","vma","bidsonline"];

    // 3a. Priced retail/dealer listings (delta — cursor-gated)
    const listings = await fetchDelta(
      sb, "vehicle_listings",
      "id, listing_id, source, make, model, year, km, asking_price, drivetrain, variant_raw, variant_family, platform_class, first_seen_at, listing_url, location, state, lifecycle_state, pass_count, auction_house, last_seen_at",
      cutoff,
      (q: any) => q.in("lifecycle_state", ["NEW","ACTIVE","WATCHING","RETURNED"]).not("asking_price", "is", null).gt("asking_price", 0).neq("lemon_flag", true).not("auction_status", "in", '("sold","withdrawn","invalid")'),
      MAX_LISTINGS_PER_RUN,
    );
    results.fetched_priced = listings.length;

    // 3a-bis. Priced auction listings (full scan — auction sources don't update last_seen_at frequently)
    // Use 48h last_seen window AND 7-day first_seen freshness to avoid surfacing sold/lemon lots
    const auctionCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const auctionFreshCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const auctionPricedListings = await fetchDelta(
      sb, "vehicle_listings",
      "id, listing_id, source, make, model, year, km, asking_price, drivetrain, variant_raw, variant_family, platform_class, first_seen_at, listing_url, location, state, lifecycle_state, pass_count, auction_house, last_seen_at",
      auctionCutoff,
      (q: any) => q.in("lifecycle_state", ["NEW","ACTIVE","WATCHING","RETURNED"]).in("source", AUCTION_SOURCES).not("asking_price", "is", null).gt("asking_price", 0).gt("first_seen_at", auctionFreshCutoff).neq("lemon_flag", true).not("auction_status", "in", '("sold","withdrawn","invalid")'),
      MAX_LISTINGS_PER_RUN,
    );
    results.fetched_auction_priced = auctionPricedListings.length;
    // Merge auction priced into main listings (deduped later by seenIds)
    listings.push(...auctionPricedListings);

    // 3b. Priceless auction (full scan — same reason, with first_seen freshness guard)
    const pricelessListings = await fetchDelta(
      sb, "vehicle_listings",
      "id, listing_id, source, make, model, year, km, drivetrain, variant_raw, variant_family, platform_class, first_seen_at, listing_url, location, state, lifecycle_state, pass_count, auction_house, auction_datetime, last_seen_at",
      auctionCutoff,
      (q: any) => q.in("lifecycle_state", ["NEW","ACTIVE","WATCHING","RETURNED"]).in("source", AUCTION_SOURCES).or("asking_price.is.null,asking_price.eq.0").gt("first_seen_at", auctionFreshCutoff).neq("lemon_flag", true).not("auction_status", "in", '("sold","withdrawn","invalid")'),
      MAX_LISTINGS_PER_RUN,
    );
    results.fetched_priceless = pricelessListings.length;

    // 3c. Shadow (delta)
    const shadowListings = await fetchDelta(
      sb, "vehicle_listings_shadow",
      "id, listing_id, lot_id, make, model, year, km, asking_price, drivetrain, raw_payload, first_seen_at, location, state, status, last_seen_at",
      cutoff,
      (q: any) => q.not("asking_price", "is", null).gt("asking_price", 0).is("promoted_at", null),
      MAX_LISTINGS_PER_RUN,
    );
    results.fetched_shadow = shadowListings.length;

    // 3d. Retail (delta)
    const retailListings = await fetchDelta(
      sb, "retail_listings",
      "id, source, source_listing_id, listing_url, make, model, year, km, asking_price, drivetrain, variant_raw, variant_family, badge, fuel_type, body_type, first_seen_at, last_seen_at, price_change_count, delisted_at",
      cutoff,
      (q: any) => q.is("delisted_at", null).not("asking_price", "is", null).gt("asking_price", 0),
      MAX_LISTINGS_PER_RUN,
    );
    results.fetched_retail = retailListings.length;

    console.log(`[SCORE-V2] Fetched: priced=${results.fetched_priced} auction_priced=${results.fetched_auction_priced || 0} priceless=${results.fetched_priceless} shadow=${results.fetched_shadow} retail=${results.fetched_retail}`);

    // ── 4. Build unified candidate list (deduped) ──
    const candidates: CandidateListing[] = [];
    const pricelessCandidates: PricelessCandidate[] = [];
    const seenIds = new Set<string>();

    // Priced vehicle_listings
    for (const l of listings) {
      const lid = l.listing_id;
      if (!lid || seenIds.has(lid)) continue;
      const make = (l.make || "").toUpperCase().trim();
      const model = (l.model || "").toUpperCase().trim();
      if (!make || !model || !l.year) continue;
      if (!passesVehicleFilter(l.year, l.km)) continue;
      if (!isProductionSource(l.source || "")) continue;
      seenIds.add(lid);
      const daysSince = Math.floor((Date.now() - new Date(l.first_seen_at || Date.now()).getTime()) / 86400000);
      candidates.push({
        listing_id: lid, source: l.source || "unknown", source_type: "auction",
        make, model, year: l.year, km: l.km,
        asking_price: Number(l.asking_price),
        platform_class: l.platform_class || derivePlatform(make, model),
        trim_class: l.variant_family || extractBadge(l.variant_raw) || "BASE",
        drivetrain_bucket: drivetrainBucket(l.drivetrain),
        source_url: sanitizeSourceUrl(l.listing_url || "", lid),
        first_seen_at: l.first_seen_at || new Date().toISOString(),
        days_listed: daysSince, price_drops: 0, pass_count: l.pass_count || 0,
        badge: null, fuel_type: null, body_type: null,
      });
    }

    // Shadow
    for (const s of shadowListings) {
      const lid = s.listing_id || `caroogle:${s.lot_id}`;
      if (seenIds.has(lid)) continue;
      const make = (s.make || "").toUpperCase().trim();
      const model = (s.model || "").toUpperCase().trim();
      if (!make || !model || !s.year) continue;
      if (!passesVehicleFilter(s.year, s.km)) continue;
      seenIds.add(lid);
      const raw = s.raw_payload || {};
      const trimSource = [raw.title, raw.variant, raw.grade, raw.sellerNotes, raw.description, raw.model, raw.badgeDescription].filter(Boolean).join(" ");
      const daysSince = Math.floor((Date.now() - new Date(s.first_seen_at || Date.now()).getTime()) / 86400000);
      candidates.push({
        listing_id: lid, source: "caroogle_shadow", source_type: "shadow",
        make, model, year: s.year, km: s.km,
        asking_price: Number(s.asking_price),
        platform_class: derivePlatform(make, model),
        trim_class: extractBadge(trimSource) || "BASE",
        drivetrain_bucket: drivetrainBucket(s.drivetrain || raw.driveType),
        source_url: sanitizeSourceUrl((raw.listingUrl || s.listing_url || "").trim() || "", lid),
        first_seen_at: s.first_seen_at || new Date().toISOString(),
        days_listed: daysSince, price_drops: 0, pass_count: 0,
        badge: null, fuel_type: null, body_type: null,
      });
    }

    // Retail
    for (const r of retailListings) {
      const lid = `retail:${r.source}:${r.source_listing_id}`;
      if (seenIds.has(lid)) continue;
      const make = (r.make || "").toUpperCase().trim();
      const model = (r.model || "").toUpperCase().trim();
      if (!make || !model || !r.year) continue;
      if (!passesVehicleFilter(r.year, r.km)) continue;
      seenIds.add(lid);
      const daysSince = Math.floor((Date.now() - new Date(r.first_seen_at || Date.now()).getTime()) / 86400000);
      candidates.push({
        listing_id: lid, source: r.source || "retail", source_type: "retail",
        make, model, year: r.year, km: r.km,
        asking_price: Number(r.asking_price),
        platform_class: derivePlatform(make, model),
        trim_class: r.badge || r.variant_family || extractBadge(r.variant_raw) || "BASE",
        drivetrain_bucket: drivetrainBucket(r.drivetrain),
        source_url: sanitizeSourceUrl(r.listing_url || "", lid),
        first_seen_at: r.first_seen_at || new Date().toISOString(),
        days_listed: daysSince, price_drops: r.price_change_count || 0, pass_count: 0,
        badge: r.badge || r.variant_family || extractBadge(r.variant_raw) || null,
        fuel_type: r.fuel_type || null, body_type: r.body_type || null,
      });
    }

    // Priceless auction candidates
    for (const l of pricelessListings) {
      const lid = l.listing_id;
      if (!lid || seenIds.has(lid)) continue;
      const make = (l.make || "").toUpperCase().trim();
      const model = (l.model || "").toUpperCase().trim();
      if (!make || !model || !l.year) continue;
      if (!passesVehicleFilter(l.year, l.km)) continue;
      seenIds.add(lid);
      pricelessCandidates.push({
        listing_id: lid, source: l.source || "unknown",
        make, model, year: l.year, km: l.km,
        platform_class: l.platform_class || derivePlatform(make, model),
        trim_class: l.variant_family || extractBadge(l.variant_raw) || "BASE",
        drivetrain_bucket: drivetrainBucket(l.drivetrain),
        source_url: sanitizeSourceUrl(l.listing_url || "", lid),
        first_seen_at: l.first_seen_at || new Date().toISOString(),
        auction_house: l.auction_house || l.source || null,
        auction_datetime: l.auction_datetime || null,
      });
    }

    console.log(`[SCORE-V2] Candidates: ${candidates.length} priced, ${pricelessCandidates.length} priceless`);

    // ── 4b. Load fingerprint accuracy scores ──
    const fpAccuracyMap = new Map<string, number>();
    const { data: fpMetrics } = await sb
      .from("fingerprint_performance_metrics")
      .select("platform_class, fingerprint_accuracy_score")
      .not("platform_class", "is", null);
    for (const m of fpMetrics || []) {
      if (m.platform_class && m.fingerprint_accuracy_score != null) {
        fpAccuracyMap.set(m.platform_class, m.fingerprint_accuracy_score);
      }
    }
    console.log(`[SCORE-V2] Loaded ${fpAccuracyMap.size} fingerprint accuracy scores`);

    // ── 5. Score all priced candidates in memory ──
    const scoredCandidates: ScoredCandidate[] = [];
    const medianCache = new Map<string, any>();

    for (const listing of candidates) {
      if (listing.trim_class === "UNKNOWN") { results.discarded++; continue; }

      const match = scoreListingAgainstAccounts(listing, salesByAccount, accountNames, weightsByAccount);
      if (!match) { results.discarded++; continue; }
      results.scored++;

      const { best, alts, tier, listing_age_score, listing_age_reason } = match;
      const isRetail = listing.source_type === "retail";

      // Motivation signal
      let motivationSignal: string | null = null;
      if (!isRetail) {
        if (listing.pass_count >= 2) motivationSignal = "3RD_RUN";
        else if (listing.days_listed >= 7) motivationSignal = "WEEK_PLUS_STOCK";
      }

      const freshness = listing.days_listed <= 1 ? "today" : listing.days_listed <= 7 ? "this_week" : "older";

      // Retail median (cached)
      let retailMedian: number | null = null;
      let retailMedianConfidence: string | null = null;
      let retailMedianSample: number | null = null;
      let retailMedianP25: number | null = null;
      let retailMedianP75: number | null = null;
      let retailVsAskPct: number | null = null;

      if (isRetail && listing.badge && listing.km) {
        const cacheKey = `${listing.make}|${listing.model}|${listing.badge}|${Math.floor(listing.year / 2)}|${Math.floor(listing.km / 20000)}|${listing.fuel_type || ""}|${listing.drivetrain_bucket}`;
        let cached = medianCache.get(cacheKey);
        if (cached === undefined) {
          try {
            const { data: medianData } = await sb.rpc("compute_retail_median", {
              p_make: listing.make, p_model: listing.model, p_badge: listing.badge,
              p_year: listing.year, p_km: listing.km,
              p_fuel_type: listing.fuel_type || null,
              p_drivetrain: listing.drivetrain_bucket === "UNKNOWN" ? null : listing.drivetrain_bucket,
            });
            const m = medianData?.[0] || medianData;
            if (m && m.median_price && m.confidence !== "NONE" && m.confidence !== "INSUFFICIENT") {
              cached = m;
            } else if (m && m.confidence === "INSUFFICIENT" && m.comps_before_trim >= 3) {
              const { data: wideData } = await sb.rpc("compute_retail_median_wide", {
                p_make: listing.make, p_model: listing.model, p_badge: listing.badge,
                p_year: listing.year, p_km: listing.km,
                p_fuel_type: listing.fuel_type || null,
                p_drivetrain: listing.drivetrain_bucket === "UNKNOWN" ? null : listing.drivetrain_bucket,
              });
              const w = wideData?.[0] || wideData;
              if (w && w.median_price && w.confidence !== "NONE" && w.confidence !== "INSUFFICIENT") {
                cached = { ...w, confidence: `${w.confidence}_WIDE` };
              } else {
                cached = null;
              }
            } else {
              cached = null;
            }
          } catch (e) {
            console.error(`[SCORE-V2] Median RPC error:`, e);
            cached = null;
          }
          medianCache.set(cacheKey, cached);
        }

        if (cached) {
          retailMedian = cached.median_price;
          retailMedianConfidence = cached.confidence;
          retailMedianSample = cached.sample_size;
          retailMedianP25 = cached.p25_price;
          retailMedianP75 = cached.p75_price;
          retailVsAskPct = Math.round(((listing.asking_price - cached.median_price) / cached.median_price) * 100);
        }
      }

      const row = {
        listing_id: listing.listing_id,
        listing_source: listing.source,
        source_url: listing.source_url,
        make: listing.make, model: listing.model, variant: listing.trim_class,
        platform_class: listing.platform_class, trim_class: listing.trim_class,
        drivetrain_bucket: listing.drivetrain_bucket,
        year: listing.year, km: listing.km, asking_price: listing.asking_price,
        best_account_id: best.account_id, best_account_name: best.account_name,
        best_expected_margin: best.expected_margin, best_under_buy: best.under_buy,
        applied_weight: best.applied_weight, weighted_margin: best.weighted_margin,
        anchor_sale_id: best.anchor_sale_id,
        anchor_sale_buy_price: best.anchor_sale_buy_price,
        anchor_sale_sell_price: best.anchor_sale_sell_price,
        anchor_sale_profit: best.anchor_sale_profit,
        anchor_sale_sold_at: best.anchor_sale_sold_at,
        anchor_sale_km: best.anchor_sale_km,
        anchor_sale_trim_class: best.anchor_sale_trim_class,
        alt_matches: alts, tier, days_listed: listing.days_listed, freshness,
        margin_flag: best.margin_flag,
        pass_count: listing.pass_count, motivation_signal: motivationSignal,
        retail_median: retailMedian, retail_median_confidence: retailMedianConfidence,
        retail_median_sample: retailMedianSample,
        retail_median_p25: retailMedianP25, retail_median_p75: retailMedianP75,
        retail_vs_ask_pct: retailVsAskPct,
        status: "new",
      };

      // Fingerprint accuracy modifier: ≤30 → -3, 30-70 → 0, ≥70 → +3
      const fpAccuracy = fpAccuracyMap.get(listing.platform_class) ?? 50;
      const accuracyMod = fpAccuracy >= 70 ? 3 : fpAccuracy < 30 ? -3 : 0;
      const compositeScore = tierScore(tier) + Math.min(best.expected_margin / 100, 50) + (listing_age_score || 0) + accuracyMod;
      scoredCandidates.push({
        row,
        score: compositeScore,
        tier,
        fingerprint_key: `${listing.platform_class}|${listing.trim_class}`,
        is_auction_watch: false,
      });
    }

    // ── 6. Score priceless auction candidates ──
    const AUCTION_RISK_BUFFER_PCT = 0.10;

    for (const listing of pricelessCandidates) {
      if (listing.trim_class === "UNKNOWN") continue;

      let bestMatch: { account_id: string; account_name: string; anchor: any; target_price: number } | null = null;
      let bestMargin = -Infinity;

      for (const [acctId, acctSales] of Object.entries(salesByAccount)) {
        const matches = acctSales.filter((s: any) => {
          if (s.platform_class !== listing.platform_class) return false;
          if (!s.trim_class || s.trim_class === "UNKNOWN") return false;
          if (!trimAllowed(listing.platform_class, listing.trim_class, s.trim_class)) return false;
          if (Math.abs(s.year - listing.year) > 2) return false;
          if (s.km && listing.km && Math.abs(s.km - listing.km) > 40000) return false;
          if (listing.drivetrain_bucket !== "UNKNOWN" && s.drivetrain_bucket && s.drivetrain_bucket !== "UNKNOWN" && listing.drivetrain_bucket !== s.drivetrain_bucket) return false;
          return true;
        });
        if (matches.length === 0) continue;

        const maxProfit = Math.max(...matches.map((c: any) => c.sale_price - Number(c.buy_price)));
        matches.sort((a: any, b: any) => {
          const kmA = a.km && listing.km ? 1 - Math.abs(a.km - listing.km) / 15000 : 0.5;
          const kmB = b.km && listing.km ? 1 - Math.abs(b.km - listing.km) / 15000 : 0.5;
          const pA = (a.sale_price - Number(a.buy_price)) / (maxProfit || 1);
          const pB = (b.sale_price - Number(b.buy_price)) / (maxProfit || 1);
          return (kmB * 0.4 + pB * 0.6) - (kmA * 0.4 + pA * 0.6);
        });

        const best = matches[0];
        const targetPrice = Math.round(Number(best.buy_price) * (1 - AUCTION_RISK_BUFFER_PCT));
        const expectedMargin = best.sale_price - targetPrice;

        if (expectedMargin > bestMargin) {
          bestMargin = expectedMargin;
          bestMatch = { account_id: acctId, account_name: accountNames[acctId] || "Unknown", anchor: best, target_price: targetPrice };
        }
      }

      if (!bestMatch) continue;

      const daysSince = Math.floor((Date.now() - new Date(listing.first_seen_at).getTime()) / 86400000);
      const freshness = daysSince <= 1 ? "today" : daysSince <= 7 ? "this_week" : "older";

      // Build pricing guide from all matched sales for this account
      const acctSales = salesByAccount[bestMatch.account_id] || [];
      const relevantSales = acctSales.filter((s: any) => {
        if (s.platform_class !== listing.platform_class) return false;
        if (Math.abs(s.year - listing.year) > 2) return false;
        const profit = s.sale_price - Number(s.buy_price);
        return profit > 0;
      });
      const buyPrices = relevantSales.map((s: any) => Number(s.buy_price)).sort((a: number, b: number) => a - b);
      const sellPrices = relevantSales.map((s: any) => Number(s.sale_price)).sort((a: number, b: number) => a - b);
      const medianBuy = buyPrices.length > 0 ? buyPrices[Math.floor(buyPrices.length / 2)] : null;
      const medianSell = sellPrices.length > 0 ? sellPrices[Math.floor(sellPrices.length / 2)] : null;

      const pricingGuide = medianBuy ? {
        target_buy_price: bestMatch.target_price,
        max_bid_ceiling: Math.round(Number(bestMatch.anchor.buy_price) * 0.95),
        historical_buy_median: medianBuy,
        historical_sell_median: medianSell,
        historical_profit_median: medianSell && medianBuy ? medianSell - medianBuy : null,
        sample_size: relevantSales.length,
        confidence: relevantSales.length >= 10 ? "HIGH" : relevantSales.length >= 5 ? "MEDIUM" : "LOW",
        guidance: `Target: $${bestMatch.target_price.toLocaleString()}. Historical buy median: $${medianBuy.toLocaleString()}${medianSell ? `, sell: $${medianSell.toLocaleString()}` : ""} (${relevantSales.length} trades).`,
      } : null;

      const row = {
        listing_id: listing.listing_id,
        listing_source: listing.source,
        source_url: listing.source_url,
        make: listing.make, model: listing.model, variant: listing.trim_class,
        platform_class: listing.platform_class, trim_class: listing.trim_class,
        drivetrain_bucket: listing.drivetrain_bucket,
        year: listing.year, km: listing.km, asking_price: null,
        best_account_id: bestMatch.account_id, best_account_name: bestMatch.account_name,
        best_expected_margin: bestMargin, best_under_buy: 0,
        anchor_sale_id: bestMatch.anchor.id,
        anchor_sale_buy_price: Number(bestMatch.anchor.buy_price),
        anchor_sale_sell_price: bestMatch.anchor.sale_price,
        anchor_sale_profit: bestMatch.anchor.sale_price - Number(bestMatch.anchor.buy_price),
        anchor_sale_sold_at: bestMatch.anchor.sold_at || null,
        anchor_sale_km: bestMatch.anchor.km || null,
        anchor_sale_trim_class: bestMatch.anchor.trim_class || "UNKNOWN",
        alt_matches: [], tier: "AUCTION_WATCH",
        days_listed: daysSince, freshness, pass_count: 0, motivation_signal: null,
        auction_house: listing.auction_house, auction_datetime: listing.auction_datetime,
        auction_status: "UPCOMING", auction_target_price: bestMatch.target_price,
        pricing_guide: pricingGuide,
        status: "new",
      };

      const fpKey = `${listing.platform_class}|${listing.trim_class}|${listing.source}`;
      scoredCandidates.push({
        row,
        score: tierScore("AUCTION_WATCH") + Math.min(bestMargin / 100, 30),
        tier: "AUCTION_WATCH",
        fingerprint_key: fpKey,
        is_auction_watch: true,
      });
    }

    // ── 7. RANK BEFORE INSERT: sort by score desc, apply caps ──
    scoredCandidates.sort((a, b) => b.score - a.score);

    const fingerprintCounts = new Map<string, number>();
    let pricedInserted = 0;
    let auctionWatchInserted = 0;
    const toInsert: any[] = [];

    for (const sc of scoredCandidates) {
      // Global caps
      if (sc.is_auction_watch && auctionWatchInserted >= MAX_AUCTION_WATCH_CREATED) {
        results.skipped_cap++;
        continue;
      }
      if (!sc.is_auction_watch && pricedInserted >= MAX_OPPORTUNITIES_CREATED) {
        results.skipped_cap++;
        continue;
      }

      // Per-fingerprint cap (top K)
      const fpCount = fingerprintCounts.get(sc.fingerprint_key) || 0;
      const fpLimit = sc.is_auction_watch ? 2 : TOP_K_PER_FINGERPRINT;
      if (fpCount >= fpLimit) {
        results.skipped_cap++;
        continue;
      }

      fingerprintCounts.set(sc.fingerprint_key, fpCount + 1);
      toInsert.push(sc.row);

      if (sc.is_auction_watch) auctionWatchInserted++;
      else pricedInserted++;
    }

    console.log(`[SCORE-V2] Ranked: ${scoredCandidates.length} → inserting ${toInsert.length} (${pricedInserted} priced, ${auctionWatchInserted} auction watch, ${results.skipped_cap} capped)`);

    // Revive auction rows that were previously expired but are active again upstream.
    // The guarded upsert intentionally skips terminal rows, so we must flip these back to `new`
    // before calling it for live auction inventory.
    const auctionListingIdsToRevive = toInsert
      .filter((row: any) => AUCTION_SOURCES.includes(String(row.listing_source || "")))
      .map((row: any) => row.listing_id)
      .filter(Boolean);

    if (auctionListingIdsToRevive.length > 0) {
      const { error: reviveErr } = await sb
        .from("operator_opportunities")
        .update({ status: "new", updated_at: new Date().toISOString() })
        .in("listing_id", auctionListingIdsToRevive)
        .eq("status", "expired");

      if (reviveErr) {
        console.error("[SCORE-V2] Auction revive error:", reviveErr.message);
      }
    }

    // ── 8. Guarded upsert via DB function (terminal protection) ──
    for (let i = 0; i < toInsert.length; i += 25) {
      const chunk = toInsert.slice(i, i + 25);
      const promises = chunk.map((row: any) =>
        sb.rpc("upsert_operator_opportunity_guarded", { p_row: row })
          .then(({ data, error }: any) => {
            if (error) { console.error(`[SCORE-V2] Guarded upsert error:`, error.message); return "error"; }
            return data || "upserted";
          })
      );
      const outcomes = await Promise.all(promises);
      for (const o of outcomes) {
        if (o === "skipped_terminal") results.skipped_terminal++;
        else if (o !== "error") results.created++;
      }
    }

    results.auction_watch_created = auctionWatchInserted;

    // ── 9. AUTO-NOTIFY: push new high-tier opportunities to dealers ──
    const NOTIFY_TIERS = new Set(["CODE_RED", "HIGH", "BUY", "AUCTION_WATCH"]);
    const newlyCreated = toInsert.filter((row: any) => NOTIFY_TIERS.has(row.tier) && row.best_account_name);

    // Group by dealer name
    const dealerGroups = new Map<string, any[]>();
    for (const row of newlyCreated) {
      const name = row.best_account_name;
      if (!dealerGroups.has(name)) dealerGroups.set(name, []);
      dealerGroups.get(name)!.push(row);
    }

    let pushesSent = 0;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    for (const [dealerName, opps] of dealerGroups) {
      // Send one push per dealer with a summary
      const topOpp = opps[0];
      const vehicle = `${topOpp.year || ""} ${topOpp.make || ""} ${topOpp.model || ""}`.trim();
      const emoji = topOpp.auction_datetime ? "🔨" : "🎯";
      const countText = opps.length > 1 ? ` (+${opps.length - 1} more)` : "";

      try {
        const pushRes = await fetch(`${supabaseUrl}/functions/v1/push-send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            dealer_name: dealerName,
            title: `${emoji} ${opps.length} new match${opps.length > 1 ? "es" : ""}`,
            body: `${topOpp.tier}: ${vehicle}${countText} • ${topOpp.listing_source || ""}`,
            url: "/operator/trading-desk",
            alertId: `score-run-${new Date().toISOString()}`,
            force: false, // respect quiet hours
          }),
        });

        if (pushRes.ok) {
          const result = await pushRes.json();
          if (result.sent > 0) pushesSent++;
        }
      } catch (err) {
        console.warn(`[SCORE-V2] Push to ${dealerName} failed (non-blocking):`, err);
      }
    }

    results.pushes_sent = pushesSent;
    results.dealers_notified = dealerGroups.size;
    results.runtime_ms = Date.now() - startTime;

    console.log(`[SCORE-V2] Done: created=${results.created} skipped_terminal=${results.skipped_terminal} pushes=${pushesSent} runtime=${results.runtime_ms}ms`);

    // ── 10. Audit ──
    await sb.from("cron_audit_log").insert({
      cron_name: "score-operator-opportunities-v2",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: results,
    });
    await sb.from("cron_heartbeat").upsert({
      cron_name: "score-operator-opportunities",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: JSON.stringify(results),
    }, { onConflict: "cron_name" });

    // ── 11. Advance cursor ──
    if (focusAccountId) {
      (results as any).focus_account_id = focusAccountId;
    } else {
      await setCursor(sb, true, results);
    }

    return respond({ success: true, ...results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SCORE-V2] Fatal:", msg);
    results.runtime_ms = Date.now() - startTime;
    await setCursor(sb, false, { error: msg, ...results }).catch(() => {});
    return new Response(JSON.stringify({ success: false, error: msg, ...results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function respond(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
