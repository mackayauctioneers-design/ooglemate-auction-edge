import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * SCORE OPERATOR OPPORTUNITIES — Unified Multi-Account Scoring Engine
 * 
 * Scans ALL eligible listings (vehicle_listings + shadow promoted) and scores
 * each against ALL accounts' sales history in vehicle_sales_truth.
 * 
 * Outputs: operator_opportunities with best_account, alt_matches, tier.
 * 
 * Intake rules (loosened):
 *   under_buy >= $1,500  → BUY candidate (tier = CODE_RED if margin >= $6k, HIGH if >= $4k)
 *   under_buy >= -$500   → WATCH candidate
 *   under_buy < -$500    → discard
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
  const ladder = TRIM_LADDER[platformClass];
  if (!ladder) return false;
  const listingRank = ladder[listingTrim];
  const saleRank = ladder[saleTrim];
  if (listingRank == null || saleRank == null) return false;
  // Allow exact or one-step upgrade only
  return listingRank === saleRank + 1;
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

    // Group sales by account_id
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

    // Account name lookup
    const accountNames: Record<string, string> = {};
    for (const a of accounts) accountNames[a.id] = a.display_name;

    // ── 3. Load candidate listings ──
    // From vehicle_listings (production) + promoted shadow
    const { data: listings } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, source, make, model, year, km, asking_price, drivetrain, variant_raw, variant_family, platform_class, first_seen_at, listing_url, location, state, lifecycle_state")
      .in("lifecycle_state", ["NEW", "ACTIVE", "WATCHING"])
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .limit(1000);

    // Also check shadow with price
    const { data: shadowListings } = await sb
      .from("vehicle_listings_shadow")
      .select("id, listing_id, lot_id, make, model, year, km, asking_price, drivetrain, raw_payload, first_seen_at, location, state, status")
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .is("promoted_at", null)
      .limit(1000);

    // Normalize both into a common shape
    interface CandidateListing {
      listing_id: string;
      source: string;
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
    }

    const candidates: CandidateListing[] = [];
    const seenIds = new Set<string>();

    // Production listings
    for (const l of (listings || [])) {
      const lid = l.listing_id;
      if (!lid || seenIds.has(lid)) continue;
      const make = (l.make || "").toUpperCase().trim();
      const model = (l.model || "").toUpperCase().trim();
      if (!make || !model || !l.year) continue;
      if (!isProductionSource(l.source || "")) continue;
      seenIds.add(lid);
      candidates.push({
        listing_id: lid,
        source: l.source || "unknown",
        make, model,
        year: l.year,
        km: l.km,
        asking_price: Number(l.asking_price),
        platform_class: l.platform_class || derivePlatform(make, model),
        trim_class: l.variant_family || extractBadge(l.variant_raw) || "UNKNOWN",
        drivetrain_bucket: drivetrainBucket(l.drivetrain),
        source_url: l.listing_url || "",
        first_seen_at: l.first_seen_at || new Date().toISOString(),
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
      candidates.push({
        listing_id: lid,
        source: "caroogle_shadow",
        make, model,
        year: s.year,
        km: s.km,
        asking_price: Number(s.asking_price),
        platform_class: derivePlatform(make, model),
        trim_class: extractBadge(trimSource) || "UNKNOWN",
        drivetrain_bucket: drivetrainBucket(s.drivetrain || raw.driveType),
        source_url: `https://www.pickles.com.au/lot/${s.lot_id}`,
        first_seen_at: s.first_seen_at || new Date().toISOString(),
      });
    }

    console.log(`[SCORE] ${candidates.length} candidate listings to score`);

    // ── 4. Score each listing against ALL accounts ──
    let scored = 0;
    let discarded = 0;
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

      // Score against each account
      for (const [acctId, acctSales] of Object.entries(salesByAccount)) {
        // Find best matching sale for this account
        const matches = acctSales.filter((s: any) => {
          if (s.platform_class !== listing.platform_class) return false;
          if (!s.trim_class || s.trim_class === "UNKNOWN") return false;
          if (!trimAllowed(listing.platform_class, listing.trim_class, s.trim_class)) return false;
          if (Math.abs(s.year - listing.year) > 2) return false;
          if (s.km && listing.km && Math.abs(s.km - listing.km) > 15000) return false;
          if (listing.drivetrain_bucket !== "UNKNOWN" && s.drivetrain_bucket && s.drivetrain_bucket !== "UNKNOWN" && listing.drivetrain_bucket !== s.drivetrain_bucket) return false;
          return true;
        });

        if (matches.length === 0) continue;

        // Best match by weighted score (KM proximity 40%, profit 60%)
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

        // Loosened intake: discard only if under_buy < -$500
        if (underBuy < -500) continue;

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

      // Sort by expected_margin DESC → best account first
      accountMatches.sort((a, b) => b.expected_margin - a.expected_margin);

      const best = accountMatches[0];
      const altMatches = accountMatches.slice(1);

      // Determine tier
      let tier: string;
      if (best.under_buy >= 1500 && best.expected_margin >= 6000) tier = "CODE_RED";
      else if (best.under_buy >= 1500 && best.expected_margin >= 4000) tier = "HIGH";
      else if (best.under_buy >= 1500) tier = "BUY";
      else tier = "WATCH";

      // Freshness
      const daysSinceFirst = Math.floor((Date.now() - new Date(listing.first_seen_at).getTime()) / 86400000);
      const freshness = daysSinceFirst <= 1 ? "today" : daysSinceFirst <= 7 ? "this_week" : "older";

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
        days_listed: daysSinceFirst,
        freshness,
        updated_at: new Date().toISOString(),
      });
      scored++;
    }

    console.log(`[SCORE] Scored: ${scored}, Discarded: ${discarded}`);

    // ── 5. Batch upsert ──
    if (upsertBatch.length > 0) {
      // Upsert in chunks of 50
      for (let i = 0; i < upsertBatch.length; i += 50) {
        const chunk = upsertBatch.slice(i, i + 50);
        const { error } = await sb.from("operator_opportunities").upsert(chunk, { onConflict: "listing_id" });
        if (error) console.error(`[SCORE] Upsert chunk error:`, error.message);
      }
    }

    // ── 6. Expire old entries that are no longer in candidates ──
    // Mark stale opportunities as expired (older than 7 days without update)
    await sb.from("operator_opportunities")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .lt("updated_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .in("status", ["new", "reviewed"]);

    // ── 7. Audit log ──
    const runtimeMs = Date.now() - startTime;
    await sb.from("cron_audit_log").insert({
      cron_name: "score-operator-opportunities",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: { candidates: candidates.length, scored, discarded, upserted: upsertBatch.length, runtime_ms: runtimeMs },
    });
    await sb.from("cron_heartbeat").upsert({
      cron_name: "score-operator-opportunities",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `candidates=${candidates.length} scored=${scored} discarded=${discarded}`,
    }, { onConflict: "cron_name" });

    return respond({ success: true, candidates: candidates.length, scored, discarded, runtime_ms: runtimeMs });

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
