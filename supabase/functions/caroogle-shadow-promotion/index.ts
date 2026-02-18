import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * CAROOGLE SHADOW PROMOTION — Fingerprint-Gated Production Promotion
 * 
 * Reads shadow listings with price > 0 and promoted_at IS NULL.
 * Matches each against vehicle_sales_truth using STRICT fingerprint rules.
 * Only promotes listings that match a proven profitable sale.
 * 
 * Schedule: Every 30 minutes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── DERIVE PLATFORM (mirrors DB function derive_platform_class) ─────────────

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

// ─── EXTRACT BADGE FROM TEXT ─────────────────────────────────────────────────

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
  ];
  const shortBadges = ["SR", "XL", "LS", "ES", "SL", "ST", "TI", "LT", "LTZ", "Z71", "SS", "SSV", "SV6"];
  for (const b of badges) { if (d.includes(b)) return b; }
  for (const b of shortBadges) { if (new RegExp(`\\b${b}\\b`).test(d)) return b; }
  return "";
}

// ─── DRIVETRAIN BUCKET ───────────────────────────────────────────────────────

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
  "NISSAN:NAVARA": { SL: 1, ST: 2, "ST-L": 3, "ST-X": 4, "PRO-4X": 5 },
  "NISSAN:PATROL": { TI: 1, "TI-L": 2 },
  "HOLDEN:COLORADO": { LS: 1, LT: 2, LTZ: 3, Z71: 4 },
};

function trimAllowed(platformClass: string, listingTrim: string, saleTrim: string): "EXACT" | "UPGRADE" | false {
  if (saleTrim === listingTrim) return "EXACT";
  const ladder = TRIM_LADDER[platformClass];
  if (!ladder) return false;
  const listingRank = ladder[listingTrim];
  const saleRank = ladder[saleTrim];
  if (listingRank == null || saleRank == null) return false;
  if (listingRank === saleRank + 1) return "UPGRADE";
  return false;
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

    // ── 1. Get unpromoted shadow listings with price ──
    const { data: shadowListings, error: fetchErr } = await sb
      .from("vehicle_listings_shadow")
      .select("*")
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .is("promoted_at", null)
      .in("status", ["listed", "INPREP", "catalogue"])
      .limit(1000);

    if (fetchErr) throw new Error(`Shadow fetch error: ${fetchErr.message}`);

    if (!shadowListings || shadowListings.length === 0) {
      console.log("[PROMOTION] No eligible shadow listings");
      await logAudit(sb, startTime, { listings_checked: 0, promoted: 0, skipped_no_match: 0, skipped_low_margin: 0 });
      return new Response(JSON.stringify({ success: true, listings_checked: 0, promoted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[PROMOTION] Checking ${shadowListings.length} shadow listings`);

    // ── 2. Load all profitable sales ──
    const { data: allSales } = await sb
      .from("vehicle_sales_truth")
      .select("id, make, model, year, km, buy_price, sale_price, sold_at, trim_class, platform_class, drivetrain_bucket")
      .not("buy_price", "is", null)
      .not("sale_price", "is", null);

    if (!allSales || allSales.length === 0) {
      console.log("[PROMOTION] No sales data available");
      await logAudit(sb, startTime, { listings_checked: shadowListings.length, promoted: 0, skipped_no_match: shadowListings.length, skipped_low_margin: 0 });
      return new Response(JSON.stringify({ success: true, listings_checked: shadowListings.length, promoted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profitableSales = allSales.filter((s: any) => (s.sale_price - Number(s.buy_price)) > 0);
    console.log(`[PROMOTION] ${profitableSales.length} profitable sales loaded`);

    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");

    let promoted = 0;
    let skippedNoMatch = 0;
    let skippedLowMargin = 0;
    let skippedUnknownTrim = 0;
    let slackAlerts = 0;
    const errors: string[] = [];

    for (const shadow of shadowListings) {
      const make = (shadow.make || "").toUpperCase().trim();
      const model = (shadow.model || "").toUpperCase().trim();
      const year = shadow.year;
      const km = shadow.km;
      const price = Number(shadow.asking_price);

      if (!make || !model || !year || !price) { skippedNoMatch++; continue; }

      const platform = derivePlatform(make, model);

      // Derive trim from raw_payload title, sellerNotes, or variant fields
      const raw = shadow.raw_payload || {};
      const trimSource = [
        raw.title, raw.variant, raw.grade, raw.sellerNotes,
        raw.description, raw.model, raw.badgeDescription,
      ].filter(Boolean).join(" ");
      const listingTrim = extractBadge(trimSource) || "UNKNOWN";
      const listingDrive = drivetrainBucket(shadow.drivetrain || raw.driveType || raw.drivetrain);

      if (listingTrim === "UNKNOWN") { skippedUnknownTrim++; continue; }

      // ── 3. STRICT fingerprint match ──
      const candidates = profitableSales.filter((s: any) => {
        if (s.platform_class !== platform) return false;
        if (!s.trim_class || s.trim_class === "UNKNOWN") return false;
        const trimResult = trimAllowed(s.platform_class, listingTrim, s.trim_class);
        if (!trimResult) return false;
        if (Math.abs(s.year - year) > 2) return false;
        if (s.km && km && Math.abs(s.km - km) > 15000) return false;
        if (listingDrive !== "UNKNOWN" && s.drivetrain_bucket && s.drivetrain_bucket !== "UNKNOWN" && listingDrive !== s.drivetrain_bucket) return false;
        return true;
      });

      if (candidates.length === 0) { skippedNoMatch++; continue; }

      // Weighted sort: KM proximity 40%, profit strength 60%
      const maxProfit = Math.max(...candidates.map((c: any) => c.sale_price - Number(c.buy_price)));
      candidates.sort((a: any, b: any) => {
        const kmScoreA = a.km && km ? 1 - Math.abs(a.km - km) / 15000 : 0.5;
        const kmScoreB = b.km && km ? 1 - Math.abs(b.km - km) / 15000 : 0.5;
        const profitA = (a.sale_price - Number(a.buy_price)) / (maxProfit || 1);
        const profitB = (b.sale_price - Number(b.buy_price)) / (maxProfit || 1);
        return (kmScoreB * 0.4 + profitB * 0.6) - (kmScoreA * 0.4 + profitA * 0.6);
      });

      const best = candidates[0];
      const historicalBuy = Number(best.buy_price);
      const historicalSale = best.sale_price;
      const underBuy = historicalBuy - price;
      const expectedMargin = historicalSale - price;

      if (price >= historicalSale) { skippedLowMargin++; continue; }
      if (underBuy < 1500) { skippedLowMargin++; continue; }

      // ── 4. PROMOTE to vehicle_listings ──
      const listingId = shadow.listing_id || `caroogle:${shadow.lot_id}`;
      const { error: upsertErr } = await sb.from("vehicle_listings").upsert({
        listing_id: listingId,
        source: "caroogle_promoted",
        make,
        model,
        year,
        km,
        asking_price: price,
        location: shadow.location,
        state: shadow.state,
        drivetrain: shadow.drivetrain,
        status: "listed",
        lifecycle_state: "NEW",
        variant_raw: trimSource,
        variant_family: listingTrim,
        platform_class: platform,
        first_seen_at: shadow.first_seen_at || new Date().toISOString(),
        last_seen_at: shadow.last_seen_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "listing_id" });

      if (upsertErr) {
        errors.push(`Listing ${listingId}: ${upsertErr.message}`);
        continue;
      }

      // ── 5. Create opportunity ──
      let confidenceTier: string;
      let priorityLevel: number;
      if (expectedMargin >= 6000) { confidenceTier = "HIGH"; priorityLevel = 1; }
      else if (expectedMargin >= 4000) { confidenceTier = "HIGH"; priorityLevel = 2; }
      else { confidenceTier = "MEDIUM"; priorityLevel = 3; }

      const notes = JSON.stringify({
        matched_sale_id: best.id,
        historical_buy_price: historicalBuy,
        historical_sell_price: historicalSale,
        historical_profit: historicalSale - historicalBuy,
        under_buy: underBuy,
        expected_margin: expectedMargin,
        trim_class: listingTrim,
        drivetrain: listingDrive,
        sold_at: best.sold_at,
        promotion_source: "caroogle_shadow",
      });

      const oppData = {
        source_type: "auction_replication",
        listing_url: `https://www.pickles.com.au/lot/${shadow.lot_id}`,
        stock_id: listingId,
        year,
        make,
        model,
        variant: listingTrim,
        kms: km,
        location: shadow.location,
        buy_price: price,
        dealer_median_price: historicalBuy,
        retail_median_price: historicalSale,
        median_profit: expectedMargin,
        deviation: underBuy,
        confidence_score: expectedMargin,
        confidence_tier: confidenceTier,
        priority_level: priorityLevel,
        status: "new",
        notes,
        updated_at: new Date().toISOString(),
      };

      const { data: existingOpp } = await sb
        .from("opportunities")
        .select("id")
        .eq("stock_id", listingId)
        .eq("source_type", "auction_replication")
        .maybeSingle();

      if (existingOpp) {
        await sb.from("opportunities").update(oppData).eq("id", existingOpp.id);
      } else {
        await sb.from("opportunities").insert(oppData);
      }

      // ── 6. Stamp promoted_at on shadow row ──
      await sb.from("vehicle_listings_shadow")
        .update({ promoted_at: new Date().toISOString() })
        .eq("id", shadow.id);

      promoted++;
      console.log(`[PROMOTION] ✅ ${year} ${make} ${model} ${listingTrim} — Ask $${price} vs Sold $${historicalSale} — Margin +$${expectedMargin} Under-buy +$${underBuy}`);

      // ── 7. Slack for HIGH signals ──
      if (expectedMargin >= 4000 && slackWebhook) {
        try {
          await fetch(slackWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🟣 CAROOGLE PROMOTION\n${year} ${make} ${model} ${listingTrim}\nAsk: $${price.toLocaleString()}\nLast Sold: $${historicalSale.toLocaleString()}\nLast Buy: $${historicalBuy.toLocaleString()}\nExpected Margin: +$${expectedMargin.toLocaleString()}\nUnder-Buy: +$${underBuy.toLocaleString()}`,
            }),
          });
          slackAlerts++;
        } catch (e) {
          console.error("[PROMOTION] Slack failed:", e);
        }
      }
    }

    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_checked: shadowListings.length,
      promoted,
      skipped_no_match: skippedNoMatch,
      skipped_low_margin: skippedLowMargin,
      skipped_unknown_trim: skippedUnknownTrim,
      slack_alerts: slackAlerts,
      errors: errors.length,
      runtime_ms: runtimeMs,
    };

    console.log("[PROMOTION] Result:", JSON.stringify(result));
    await logAudit(sb, startTime, result);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[PROMOTION] Fatal:", errorMsg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("cron_audit_log").insert({
        cron_name: "caroogle-shadow-promotion",
        run_date: new Date().toISOString().split("T")[0],
        success: false,
        error: errorMsg,
        result: { runtime_ms: Date.now() - startTime },
      });
      await sb.from("cron_heartbeat").upsert({
        cron_name: "caroogle-shadow-promotion",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `FATAL: ${errorMsg.slice(0, 100)}`,
      }, { onConflict: "cron_name" });
    } catch (_) {}

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logAudit(sb: any, startTime: number, result: any) {
  const runtimeMs = Date.now() - startTime;
  await sb.from("cron_audit_log").insert({
    cron_name: "caroogle-shadow-promotion",
    run_date: new Date().toISOString().split("T")[0],
    success: true,
    result: { ...result, runtime_ms: runtimeMs },
  });
  await sb.from("cron_heartbeat").upsert({
    cron_name: "caroogle-shadow-promotion",
    last_seen_at: new Date().toISOString(),
    last_ok: true,
    note: `checked=${result.listings_checked} promoted=${result.promoted} skip_match=${result.skipped_no_match} skip_margin=${result.skipped_low_margin}`,
  }, { onConflict: "cron_name" });
}
