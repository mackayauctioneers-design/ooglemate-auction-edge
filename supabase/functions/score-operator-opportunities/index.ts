import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * SCORE OPERATOR OPPORTUNITIES — Unified Multi-Account Scoring Engine v2.1
 * 
 * Scans ALL eligible listings from 3 sources:
 *   1. vehicle_listings (auction/wholesale)
 *   2. vehicle_listings_shadow (caroogle promoted)
 *   3. retail_listings (autotrader + drive)
 * 
 * Scores each against ALL accounts' sales history in vehicle_sales_truth.
 * 
 * Tiering:
 *   AUCTION/WHOLESALE:
 *     CODE_RED: under_buy >= $1,500 AND expected_margin >= $6k
 *     HIGH:     under_buy >= $1,500 AND expected_margin >= $4k
 *     BUY:      under_buy >= $1,500
 *     WATCH:    under_buy >= -$500
 *
 *   RETAIL (autotrader, drive):
 *     RETAIL_BUY:    ask <= historical_buy - $1,500 (unicorn)
 *     RETAIL_TARGET: ask <= historical_buy + $3,000 (negotiable band)
 *     WATCH:         ask > historical_buy + $3,000 but margin still positive
 *
 *   Negotiation signals boost retail score:
 *     +days_listed > 21, +price_drops >= 1
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── DERIVE PLATFORM ─────────────────────────────────────────────────────────

function derivePlatform(make: string, model: string): string {
  const m = (make || "").toUpperCase().trim();
  const mo = (model || "").toUpperCase().trim();
  if (m === "TOYOTA") {
    if (mo.includes("PRADO")) return "PRADO";
    if (mo.includes("LANDCRUISER")) return "LANDCRUISER";
  }
  if (m === "MITSUBISHI" && mo === "OUTLANDER") return "OUTLANDER";
  return `${m}:${mo}`;
}

// ─── EXTRACT BADGE ───────────────────────────────────────────────────────────

function extractBadge(text: string | null): string {
  if (!text) return "";
  const d = text.toUpperCase();
  const badges = [
    "EXCEED TOURER", "EXCEED", "X-TERRAIN", "XTERRAIN", "PRO-4X", "PRO4X",
    "GLX-R", "GLX+", "GLX PLUS", "SR5", "ROGUE", "RUGGED X", "RUGGED-X", "RUGGED",
    "RAPTOR", "WILDTRAK", "KAKADU", "SAHARA", "ASPIRE", "TITANIUM", "PLATINUM",
    "GXL", "VX", "GX", "XLT", "XLS", "LS-U", "LSU", "LS-M", "LSM", "LS-T", "LST",
    "ST-X", "STX", "ST-L", "STL", "GLS", "GR", "N-TREK", "COMMUTER", "SLWB", "LWB",
    "WORKMATE", "AMBIENTE", "TREND",
    "ASCENT SPORT", "ASCENT", "MAXX SPORT", "MAXX",
    "AKARI", "GT-LINE", "SPORT", "TOURING",
  ];
  const shortBadges = ["SR", "XL", "LS", "ES", "SL", "ST", "TI", "LT", "LTZ", "Z71", "SS", "SSV", "SV6", "SX", "XT", "RX"];
  for (const b of badges) { if (d.includes(b)) return b; }
  for (const b of shortBadges) { if (new RegExp(`\\b${b}\\b`).test(d)) return b; }
  return "";
}

// ─── PRODUCTION SOURCE FILTER ────────────────────────────────────────────────

const PRODUCTION_SOURCES = [
  "pickles", "grays", "manheim", "caroogle_shadow",
  "autotrader", "carsales", "easyauto", "slattery",
  "toyota_used", "nsw_regional", "vma", "bidsonline",
];

function isProductionSource(src: string): boolean {
  if (!src) return false;
  const s = src.toLowerCase();
  if (s.includes("test") || s.includes("sandbox") || s.includes("fixture")) return false;
  return PRODUCTION_SOURCES.includes(s) || s.startsWith("dealer_site:");
}

// ─── RETAIL SOURCE CHECK ─────────────────────────────────────────────────────

const RETAIL_SOURCES = ["autotrader", "drive", "easyauto", "toyota_used", "carsales"];

function isRetailSource(src: string): boolean {
  if (!src) return false;
  return RETAIL_SOURCES.includes(src.toLowerCase());
}

// ─── DRIVETRAIN ──────────────────────────────────────────────────────────────

function drivetrainBucket(val: string | null): string {
  if (!val) return "UNKNOWN";
  const v = val.toUpperCase();
  if (/4X4|4WD|AWD/.test(v)) return "4WD";
  if (/2WD|2X4|FWD|RWD|4X2/.test(v)) return "2WD";
  return "UNKNOWN";
}

// ─── TRIM LADDER ─────────────────────────────────────────────────────────────

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
  // BASE is a fallback — if the sale trim is BASE (unknown), allow any listing trim
  if (saleTrim === "BASE") return true;
  // If listing trim is BASE but sale has a real trim, allow (we just don't know listing badge)
  if (listingTrim === "BASE") return true;
  const ladder = TRIM_LADDER[platformClass];
  if (!ladder) return false;
  const listingRank = ladder[listingTrim];
  const saleRank = ladder[saleTrim];
  if (listingRank == null || saleRank == null) return false;
  return listingRank === saleRank + 1;
}

// ─── CANDIDATE INTERFACE ─────────────────────────────────────────────────────

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
  // Retail-specific for median lookup
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

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Load ALL accounts ──
    const { data: accounts } = await sb.from("accounts").select("id, display_name, slug");
    if (!accounts || accounts.length === 0) throw new Error("No accounts found");
    console.log(`[SCORE] ${accounts.length} accounts loaded`);

    // ── 2. Load ALL profitable sales grouped by account ──
    const { data: allSales } = await sb
      .from("vehicle_sales_truth")
      .select("id, account_id, make, model, year, km, buy_price, sale_price, sold_at, trim_class, platform_class, drivetrain_bucket")
      .not("buy_price", "is", null)
      .not("sale_price", "is", null);

    if (!allSales || allSales.length === 0) {
      console.log("[SCORE] No sales data");
      return respond({ success: true, scored: 0, reason: "no_sales_data" });
    }

    const salesByAccount: Record<string, any[]> = {};
    for (const s of allSales) {
      const profit = s.sale_price - Number(s.buy_price);
      if (profit <= 0) continue;
      const acctId = s.account_id;
      if (!acctId) continue;
      if (!salesByAccount[acctId]) salesByAccount[acctId] = [];
      salesByAccount[acctId].push(s);
    }
    console.log(`[SCORE] Sales loaded for ${Object.keys(salesByAccount).length} accounts`);

    const accountNames: Record<string, string> = {};
    for (const a of accounts) accountNames[a.id] = a.display_name;

    // ── 3. Load candidate listings from ALL 3 sources ──

    // 3a. vehicle_listings (auction/wholesale) — WITH price
    const { data: listings } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, source, make, model, year, km, asking_price, drivetrain, variant_raw, variant_family, platform_class, first_seen_at, listing_url, location, state, lifecycle_state, pass_count, auction_house")
      .in("lifecycle_state", ["NEW", "ACTIVE", "WATCHING"])
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .limit(1000);

    // 3a2. vehicle_listings — WITHOUT price (auction watch candidates)
    const AUCTION_SOURCES = ["pickles", "grays", "manheim", "slattery", "f3", "auto_auctions", "vma", "bidsonline"];
    const { data: pricelessListings } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, source, make, model, year, km, drivetrain, variant_raw, variant_family, platform_class, first_seen_at, listing_url, location, state, lifecycle_state, pass_count, auction_house, auction_datetime")
      .in("lifecycle_state", ["NEW", "ACTIVE", "WATCHING"])
      .in("source", AUCTION_SOURCES)
      .or("asking_price.is.null,asking_price.eq.0")
      .limit(1000);

    // 3b. Shadow (caroogle)
    const { data: shadowListings } = await sb
      .from("vehicle_listings_shadow")
      .select("id, listing_id, lot_id, make, model, year, km, asking_price, drivetrain, raw_payload, first_seen_at, location, state, status")
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .is("promoted_at", null)
      .limit(1000);

    // 3c. Retail listings (autotrader + drive)
    const { data: retailListings } = await sb
      .from("retail_listings")
      .select("id, source, source_listing_id, listing_url, make, model, year, km, asking_price, drivetrain, variant_raw, variant_family, badge, fuel_type, body_type, first_seen_at, last_seen_at, price_change_count, delisted_at")
      .is("delisted_at", null)
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .limit(2000);

    console.log(`[SCORE] Priceless auction candidates: ${pricelessListings?.length ?? 0}`);

    // ── Build unified candidate list ──
    const candidates: CandidateListing[] = [];
    const seenIds = new Set<string>();

    // Production listings (priced)
    for (const l of (listings || [])) {
      const lid = l.listing_id;
      if (!lid || seenIds.has(lid)) continue;
      const make = (l.make || "").toUpperCase().trim();
      const model = (l.model || "").toUpperCase().trim();
      if (!make || !model || !l.year) continue;
      if (!isProductionSource(l.source || "")) continue;
      seenIds.add(lid);
      const daysSince = Math.floor((Date.now() - new Date(l.first_seen_at || Date.now()).getTime()) / 86400000);
      candidates.push({
        listing_id: lid,
        source: l.source || "unknown",
        source_type: "auction",
        make, model,
        year: l.year,
        km: l.km,
        asking_price: Number(l.asking_price),
        platform_class: l.platform_class || derivePlatform(make, model),
        trim_class: l.variant_family || extractBadge(l.variant_raw) || "UNKNOWN",
        drivetrain_bucket: drivetrainBucket(l.drivetrain),
        source_url: l.listing_url || "",
        first_seen_at: l.first_seen_at || new Date().toISOString(),
        days_listed: daysSince,
        price_drops: 0,
        pass_count: l.pass_count || 0,
        badge: null,
        fuel_type: null,
        body_type: null,
      });
    }

    // Shadow listings
    for (const s of (shadowListings || [])) {
      const lid = s.listing_id || `caroogle:${s.lot_id}`;
      if (seenIds.has(lid)) continue;
      const make = (s.make || "").toUpperCase().trim();
      const model = (s.model || "").toUpperCase().trim();
      if (!make || !model || !s.year) continue;
      seenIds.add(lid);
      const raw = s.raw_payload || {};
      const trimSource = [raw.title, raw.variant, raw.grade, raw.sellerNotes, raw.description, raw.model, raw.badgeDescription].filter(Boolean).join(" ");
      const daysSince = Math.floor((Date.now() - new Date(s.first_seen_at || Date.now()).getTime()) / 86400000);
      candidates.push({
        listing_id: lid,
        source: "caroogle_shadow",
        source_type: "shadow",
        make, model,
        year: s.year,
        km: s.km,
        asking_price: Number(s.asking_price),
        platform_class: derivePlatform(make, model),
        trim_class: extractBadge(trimSource) || "UNKNOWN",
        drivetrain_bucket: drivetrainBucket(s.drivetrain || raw.driveType),
        source_url: `https://www.pickles.com.au/used/details/cars/vehicle/${s.lot_id}`,
        first_seen_at: s.first_seen_at || new Date().toISOString(),
        days_listed: daysSince,
        price_drops: 0,
        pass_count: 0,
        badge: null,
        fuel_type: null,
        body_type: null,
      });
    }

    // Retail listings (autotrader + drive)
    for (const r of (retailListings || [])) {
      const lid = `retail:${r.source}:${r.source_listing_id}`;
      if (seenIds.has(lid)) continue;
      const make = (r.make || "").toUpperCase().trim();
      const model = (r.model || "").toUpperCase().trim();
      if (!make || !model || !r.year) continue;
      seenIds.add(lid);
      const daysSince = Math.floor((Date.now() - new Date(r.first_seen_at || Date.now()).getTime()) / 86400000);
      candidates.push({
        listing_id: lid,
        source: r.source || "retail",
        source_type: "retail",
        make, model,
        year: r.year,
        km: r.km,
        asking_price: Number(r.asking_price),
        platform_class: derivePlatform(make, model),
        trim_class: r.badge || r.variant_family || extractBadge(r.variant_raw) || "UNKNOWN",
        drivetrain_bucket: drivetrainBucket(r.drivetrain),
        source_url: r.listing_url || "",
        first_seen_at: r.first_seen_at || new Date().toISOString(),
        days_listed: daysSince,
        price_drops: r.price_change_count || 0,
        pass_count: 0,
        badge: r.badge || r.variant_family || extractBadge(r.variant_raw) || null,
        fuel_type: r.fuel_type || null,
        body_type: r.body_type || null,
      });
    }

    const retailCount = candidates.filter(c => c.source_type === "retail").length;
    console.log(`[SCORE] ${candidates.length} total candidates (${retailCount} retail) to score`);

    // ── 4. Score each listing against ALL accounts ──
    let scored = 0;
    let discarded = 0;
    let retailScored = 0;
    const upsertBatch: any[] = [];

    for (const listing of candidates) {
      if (listing.trim_class === "UNKNOWN") { discarded++; continue; }

      interface AccountMatch {
        account_id: string;
        account_name: string;
        expected_margin: number;
        under_buy: number;
        anchor_sale_id: string;
        anchor_sale_buy_price: number;
        anchor_sale_sell_price: number;
        anchor_sale_profit: number;
        anchor_sale_sold_at: string | null;
        anchor_sale_km: number | null;
        anchor_sale_trim_class: string;
      }

      const accountMatches: AccountMatch[] = [];
      const isRetail = listing.source_type === "retail";

      // Score against each account
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
        const underBuy = Number(best.buy_price) - listing.asking_price;
        const expectedMargin = best.sale_price - listing.asking_price;

        // Intake thresholds differ by source type
        if (isRetail) {
          // Retail: allow up to $3k above historical buy (negotiable band)
          // under_buy of -$3000 means ask = hist_buy + $3000
          if (underBuy < -3000) continue;
        } else {
          // Auction: existing rule — discard if under_buy < -$500
          if (underBuy < -500) continue;
        }

        accountMatches.push({
          account_id: acctId,
          account_name: accountNames[acctId] || "Unknown",
          expected_margin: expectedMargin,
          under_buy: underBuy,
          anchor_sale_id: best.id,
          anchor_sale_buy_price: Number(best.buy_price),
          anchor_sale_sell_price: best.sale_price,
          anchor_sale_profit: best.sale_price - Number(best.buy_price),
          anchor_sale_sold_at: best.sold_at || null,
          anchor_sale_km: best.km || null,
          anchor_sale_trim_class: best.trim_class || "UNKNOWN",
        });
      }

      if (accountMatches.length === 0) { discarded++; continue; }

      // Sort by expected_margin DESC
      accountMatches.sort((a, b) => b.expected_margin - a.expected_margin);

      const best = accountMatches[0];
      const altMatches = accountMatches.slice(1);

      // ── Determine tier ──
      let tier: string;

      if (isRetail) {
        // Retail tiering: based on $3k negotiable band
        if (best.under_buy >= 1500) {
          // Ask is $1.5k+ BELOW historical buy — unicorn retail buy
          tier = "RETAIL_BUY";
        } else if (best.under_buy >= -3000) {
          // Ask is within $3k above historical buy — negotiable target
          tier = "RETAIL_TARGET";
        } else {
          tier = "WATCH";
        }
      } else {
        // Auction/wholesale tiering (unchanged)
        if (best.under_buy >= 1500 && best.expected_margin >= 6000) tier = "CODE_RED";
        else if (best.under_buy >= 1500 && best.expected_margin >= 4000) tier = "HIGH";
        else if (best.under_buy >= 1500) tier = "BUY";
        else tier = "WATCH";
      }

      // ── Motivation signal: 3rd run or week+ in stock = strong buy ──
      let motivationSignal: string | null = null;
      if (!isRetail) {
        if (listing.pass_count >= 2) {
          // 3rd run (passed in twice before = now on 3rd attempt)
          motivationSignal = "3RD_RUN";
        } else if (listing.days_listed >= 7) {
          // Week+ in stock — motivated seller
          motivationSignal = "WEEK_PLUS_STOCK";
        }

        // Boost tier if motivation signal present and currently WATCH
        if (motivationSignal && tier === "WATCH" && best.under_buy >= -500) {
          tier = "BUY";
        }
      }

      // Freshness
      const freshness = listing.days_listed <= 1 ? "today" : listing.days_listed <= 7 ? "this_week" : "older";

      // ── Compute retail median for retail listings ──
      let retailMedian: number | null = null;
      let retailMedianConfidence: string | null = null;
      let retailMedianSample: number | null = null;
      let retailMedianP25: number | null = null;
      let retailMedianP75: number | null = null;
      let retailVsAskPct: number | null = null;

      if (isRetail && listing.badge && listing.km) {
        try {
          const { data: medianData } = await sb.rpc("compute_retail_median", {
            p_make: listing.make,
            p_model: listing.model,
            p_badge: listing.badge,
            p_year: listing.year,
            p_km: listing.km,
            p_fuel_type: listing.fuel_type || null,
            p_drivetrain: listing.drivetrain_bucket === "UNKNOWN" ? null : listing.drivetrain_bucket,
          });
          const m = medianData?.[0] || medianData;
          if (m && m.median_price && m.confidence !== "NONE" && m.confidence !== "INSUFFICIENT") {
            retailMedian = m.median_price;
            retailMedianConfidence = m.confidence;
            retailMedianSample = m.sample_size;
            retailMedianP25 = m.p25_price;
            retailMedianP75 = m.p75_price;
            retailVsAskPct = Math.round(((listing.asking_price - m.median_price) / m.median_price) * 100);
          } else if (m && m.confidence === "INSUFFICIENT" && m.comps_before_trim >= 3) {
            // Try wide fallback (±2yr, ±30% KM)
            const { data: wideData } = await sb.rpc("compute_retail_median_wide", {
              p_make: listing.make,
              p_model: listing.model,
              p_badge: listing.badge,
              p_year: listing.year,
              p_km: listing.km,
              p_fuel_type: listing.fuel_type || null,
              p_drivetrain: listing.drivetrain_bucket === "UNKNOWN" ? null : listing.drivetrain_bucket,
            });
            const w = wideData?.[0] || wideData;
            if (w && w.median_price && w.confidence !== "NONE" && w.confidence !== "INSUFFICIENT") {
              retailMedian = w.median_price;
              retailMedianConfidence = `${w.confidence}_WIDE`;
              retailMedianSample = w.sample_size;
              retailMedianP25 = w.p25_price;
              retailMedianP75 = w.p75_price;
              retailVsAskPct = Math.round(((listing.asking_price - w.median_price) / w.median_price) * 100);
            }
          }
        } catch (e) {
          console.error(`[SCORE] Retail median error for ${listing.listing_id}:`, e);
        }
      }

      upsertBatch.push({
        listing_id: listing.listing_id,
        listing_source: listing.source,
        source_url: listing.source_url,
        make: listing.make,
        model: listing.model,
        variant: listing.trim_class,
        platform_class: listing.platform_class,
        trim_class: listing.trim_class,
        drivetrain_bucket: listing.drivetrain_bucket,
        year: listing.year,
        km: listing.km,
        asking_price: listing.asking_price,
        best_account_id: best.account_id,
        best_account_name: best.account_name,
        best_expected_margin: best.expected_margin,
        best_under_buy: best.under_buy,
        anchor_sale_id: best.anchor_sale_id,
        anchor_sale_buy_price: best.anchor_sale_buy_price,
        anchor_sale_sell_price: best.anchor_sale_sell_price,
        anchor_sale_profit: best.anchor_sale_profit,
        anchor_sale_sold_at: best.anchor_sale_sold_at,
        anchor_sale_km: best.anchor_sale_km,
        anchor_sale_trim_class: best.anchor_sale_trim_class,
        alt_matches: altMatches,
        tier,
        days_listed: listing.days_listed,
        freshness,
        pass_count: listing.pass_count,
        motivation_signal: motivationSignal,
        retail_median: retailMedian,
        retail_median_confidence: retailMedianConfidence,
        retail_median_sample: retailMedianSample,
        retail_median_p25: retailMedianP25,
        retail_median_p75: retailMedianP75,
        retail_vs_ask_pct: retailVsAskPct,
        updated_at: new Date().toISOString(),
      });
      scored++;
      if (isRetail) retailScored++;
    }

    // ── 4b. AUCTION WATCH — score priceless auction listings ──
    const pricelessCandidates: PricelessCandidate[] = [];
    for (const l of (pricelessListings || [])) {
      const lid = l.listing_id;
      if (!lid || seenIds.has(lid)) continue;
      const make = (l.make || "").toUpperCase().trim();
      const model = (l.model || "").toUpperCase().trim();
      if (!make || !model || !l.year) continue;
      seenIds.add(lid);
      pricelessCandidates.push({
        listing_id: lid,
        source: l.source || "unknown",
        make, model,
        year: l.year,
        km: l.km,
        platform_class: l.platform_class || derivePlatform(make, model),
        trim_class: l.variant_family || extractBadge(l.variant_raw) || "UNKNOWN",
        drivetrain_bucket: drivetrainBucket(l.drivetrain),
        source_url: l.listing_url || "",
        first_seen_at: l.first_seen_at || new Date().toISOString(),
        auction_house: l.auction_house || l.source || null,
        auction_datetime: l.auction_datetime || null,
      });
    }

    let auctionWatchCount = 0;
    const AUCTION_RISK_BUFFER_PCT = 0.10; // 10% below historical buy

    for (const listing of pricelessCandidates) {
      if (listing.trim_class === "UNKNOWN") continue;

      // Find best matching sale across all accounts
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

        // Pick the best anchor sale (highest margin, closest km)
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
          bestMatch = {
            account_id: acctId,
            account_name: accountNames[acctId] || "Unknown",
            anchor: best,
            target_price: targetPrice,
          };
        }
      }

      if (!bestMatch) continue;

      const daysSince = Math.floor((Date.now() - new Date(listing.first_seen_at).getTime()) / 86400000);
      const freshness = daysSince <= 1 ? "today" : daysSince <= 7 ? "this_week" : "older";

      upsertBatch.push({
        listing_id: listing.listing_id,
        listing_source: listing.source,
        source_url: listing.source_url,
        make: listing.make,
        model: listing.model,
        variant: listing.trim_class,
        platform_class: listing.platform_class,
        trim_class: listing.trim_class,
        drivetrain_bucket: listing.drivetrain_bucket,
        year: listing.year,
        km: listing.km,
        asking_price: null, // no price yet
        best_account_id: bestMatch.account_id,
        best_account_name: bestMatch.account_name,
        best_expected_margin: bestMargin,
        best_under_buy: 0, // unknown until price revealed
        anchor_sale_id: bestMatch.anchor.id,
        anchor_sale_buy_price: Number(bestMatch.anchor.buy_price),
        anchor_sale_sell_price: bestMatch.anchor.sale_price,
        anchor_sale_profit: bestMatch.anchor.sale_price - Number(bestMatch.anchor.buy_price),
        anchor_sale_sold_at: bestMatch.anchor.sold_at || null,
        anchor_sale_km: bestMatch.anchor.km || null,
        anchor_sale_trim_class: bestMatch.anchor.trim_class || "UNKNOWN",
        alt_matches: [],
        tier: "AUCTION_WATCH",
        days_listed: daysSince,
        freshness,
        pass_count: 0,
        motivation_signal: null,
        auction_house: listing.auction_house,
        auction_datetime: listing.auction_datetime,
        auction_status: "UPCOMING",
        auction_target_price: bestMatch.target_price,
        updated_at: new Date().toISOString(),
      });
      auctionWatchCount++;
    }

    console.log(`[SCORE] Auction Watch: ${auctionWatchCount} from ${pricelessCandidates.length} priceless candidates`);
    console.log(`[SCORE] Scored: ${scored} (${retailScored} retail), Discarded: ${discarded}`);

    // ── 5. Batch upsert (skip ignored listings so they never reappear) ──
    if (upsertBatch.length > 0) {
      // Get listing_ids that are currently ignored — these must never be overwritten
      const batchListingIds = upsertBatch.map((r: any) => r.listing_id).filter(Boolean);
      const ignoredSet = new Set<string>();
      for (let i = 0; i < batchListingIds.length; i += 200) {
        const slice = batchListingIds.slice(i, i + 200);
        const { data: ignored } = await sb.from("operator_opportunities")
          .select("listing_id")
          .in("listing_id", slice)
          .eq("status", "ignored");
        (ignored || []).forEach((r: any) => ignoredSet.add(r.listing_id));
      }
      const filteredBatch = upsertBatch.filter((r: any) => !ignoredSet.has(r.listing_id));
      console.log(`[SCORE] Skipped ${upsertBatch.length - filteredBatch.length} ignored listings`);

      for (let i = 0; i < filteredBatch.length; i += 50) {
        const chunk = filteredBatch.slice(i, i + 50);
        const { error } = await sb.from("operator_opportunities").upsert(chunk, { onConflict: "listing_id" });
        if (error) console.error(`[SCORE] Upsert chunk error:`, error.message);
      }
    }

    // ── 6. Expire stale (never touch ignored or starred) ──
    await sb.from("operator_opportunities")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .lt("updated_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .in("status", ["new", "reviewed"])
      .eq("is_starred", false);

    // ── 7. Audit log ──
    const runtimeMs = Date.now() - startTime;
    await sb.from("cron_audit_log").insert({
      cron_name: "score-operator-opportunities",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: { candidates: candidates.length, scored, retail_scored: retailScored, auction_watch: auctionWatchCount, discarded, upserted: upsertBatch.length, runtime_ms: runtimeMs },
    });
    await sb.from("cron_heartbeat").upsert({
      cron_name: "score-operator-opportunities",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `candidates=${candidates.length} scored=${scored} retail=${retailScored} discarded=${discarded}`,
    }, { onConflict: "cron_name" });

    return respond({ success: true, candidates: candidates.length, scored, retail_scored: retailScored, discarded, runtime_ms: runtimeMs });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SCORE] Fatal:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
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
