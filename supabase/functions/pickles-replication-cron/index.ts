import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES REPLICATION CRON v2 — Standalone Fingerprint Replication
 * 
 * Reads priced Pickles listings updated in the last 2 hours,
 * matches each against vehicle_sales_truth using strict filters,
 * upserts opportunities, and sends Slack alerts for HIGH/CODE RED.
 * 
 * Schedule: Every 30 minutes
 * Completely decoupled from pickles-ingest-cron.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE = "pickles";
const LOOKBACK_HOURS = 24;

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

// ─── MAIN REPLICATION ────────────────────────────────────────────────────────

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

    const lookbackThreshold = new Date(Date.now() - LOOKBACK_HOURS * 3600000).toISOString();

    // Get recent priced Pickles listings (incremental: only unprocessed)
    const { data: listings } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, make, model, variant_raw, variant_family, drivetrain, year, km, asking_price, listing_url, location, last_seen_at, replicated_at")
      .eq("source", SOURCE)
      .in("status", ["listed", "catalogue"])
      .not("asking_price", "is", null)
      .gt("asking_price", 0)
      .is("replicated_at", null);

    if (!listings || listings.length === 0) {
      console.log("[REPLICATION] No recent priced Pickles listings");
      const runtimeMs = Date.now() - startTime;
      await sb.from("cron_audit_log").insert({
        cron_name: "pickles-replication-cron",
        run_date: new Date().toISOString().split("T")[0],
        success: true,
        result: { listings_checked: 0, matched: 0, opportunities_created: 0, runtime_ms: runtimeMs },
      });
      await sb.from("cron_heartbeat").upsert({
        cron_name: "pickles-replication-cron",
        last_seen_at: new Date().toISOString(),
        last_ok: true,
        note: "0 listings to check",
      }, { onConflict: "cron_name" });
      return new Response(JSON.stringify({ success: true, listings_checked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[REPLICATION] Checking ${listings.length} recent priced listings`);

    // Load all profitable sales with pre-computed columns
    const { data: allSales } = await sb
      .from("vehicle_sales_truth")
      .select("id, make, model, year, km, buy_price, sale_price, sold_at, trim_class, platform_class, drivetrain_bucket")
      .not("buy_price", "is", null)
      .not("sale_price", "is", null);

    if (!allSales || allSales.length === 0) {
      console.log("[REPLICATION] No sales data");
      return new Response(JSON.stringify({ success: true, listings_checked: listings.length, matched: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profitableSales = allSales.filter((s: any) => (s.sale_price - Number(s.buy_price)) > 0);
    const knownTrim = profitableSales.filter((s: any) => s.trim_class && s.trim_class !== "UNKNOWN").length;
    console.log(`[REPLICATION] ${profitableSales.length} profitable sales (${knownTrim} with known trim)`);

    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");

    let matched = 0;
    let opportunitiesCreated = 0;
    let slackAlerts = 0;
    const errors: string[] = [];

    // Collect all listing IDs for batch replicated_at stamp
    const processedIds: string[] = [];

    for (const listing of listings) {
      processedIds.push(listing.id);

      const listingMake = (listing.make || "").toUpperCase();
      const listingModel = (listing.model || "").toUpperCase();
      const listingYear = listing.year;
      const listingKm = listing.km;
      const listingPrice = listing.asking_price;
      const listingBadgeText = listing.variant_raw || listing.variant_family || "";
      const listingTrim = extractBadge(listingBadgeText) || "UNKNOWN";
      const listingDrive = drivetrainBucket(listing.drivetrain);
      const listingPlatform = derivePlatform(listing.make, listing.model);

      if (!listingYear || !listingKm || !listingPrice) continue;
      if (listingTrim === "UNKNOWN") continue;

      // STRICT FILTERS
      const candidates = profitableSales.filter((s: any) => {
        if (s.platform_class !== listingPlatform) return false;
        if (!s.trim_class || s.trim_class === "UNKNOWN") return false;
        const trimResult = trimAllowed(s.platform_class, listingTrim, s.trim_class);
        if (!trimResult) return false;
        if (Math.abs(s.year - listingYear) > 2) return false;
        if (s.km && listingKm && Math.abs(s.km - listingKm) > 15000) return false;
        if (listingDrive !== "UNKNOWN" && s.drivetrain_bucket && s.drivetrain_bucket !== "UNKNOWN" && listingDrive !== s.drivetrain_bucket) return false;
        return true;
      });

      if (candidates.length === 0) continue;

      // Weighted sort: KM proximity 40%, profit strength 60%
      const maxProfit = Math.max(...candidates.map((c: any) => c.sale_price - Number(c.buy_price)));
      candidates.sort((a: any, b: any) => {
        const kmScoreA = a.km && listingKm ? 1 - Math.abs(a.km - listingKm) / 15000 : 0.5;
        const kmScoreB = b.km && listingKm ? 1 - Math.abs(b.km - listingKm) / 15000 : 0.5;
        const profitA = (a.sale_price - Number(a.buy_price)) / (maxProfit || 1);
        const profitB = (b.sale_price - Number(b.buy_price)) / (maxProfit || 1);
        const scoreA = kmScoreA * 0.4 + profitA * 0.6;
        const scoreB = kmScoreB * 0.4 + profitB * 0.6;
        return scoreB - scoreA;
      });

      const best = candidates[0];
      const historicalBuy = Number(best.buy_price);
      const historicalSale = best.sale_price;
      const expectedMargin = historicalSale - listingPrice;

      matched++;

      if (listingPrice >= historicalSale) continue;
      if (expectedMargin < 1500) continue;

      let confidenceTier: string;
      let priorityLevel: number;
      if (expectedMargin >= 6000) { confidenceTier = "HIGH"; priorityLevel = 1; }
      else if (expectedMargin >= 4000) { confidenceTier = "HIGH"; priorityLevel = 2; }
      else { confidenceTier = "MEDIUM"; priorityLevel = 3; }

      const kmDiff = best.km && listingKm ? Math.abs(best.km - listingKm) : null;
      const stockId = listing.listing_id;
      const notes = JSON.stringify({
        matched_sale_id: best.id,
        historical_buy_price: historicalBuy,
        historical_sell_price: historicalSale,
        historical_profit: historicalSale - historicalBuy,
        km_difference: kmDiff,
        expected_margin: expectedMargin,
        trim_class: listingTrim,
        drivetrain: listingDrive,
        sold_at: best.sold_at,
      });

      const oppData = {
        source_type: "replication",
        listing_url: listing.listing_url || "",
        stock_id: stockId,
        year: listingYear,
        make: listingMake,
        model: listingModel,
        variant: listing.variant_raw,
        kms: listingKm,
        location: listing.location,
        buy_price: listingPrice,
        dealer_median_price: historicalBuy,
        retail_median_price: historicalSale,
        median_profit: expectedMargin,
        deviation: expectedMargin,
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
        .eq("stock_id", stockId)
        .eq("source_type", "replication")
        .maybeSingle();

      let error;
      if (existingOpp) {
        ({ error } = await sb.from("opportunities").update(oppData).eq("id", existingOpp.id));
      } else {
        ({ error } = await sb.from("opportunities").insert(oppData));
      }

      if (error) {
        errors.push(`Opportunity ${stockId}: ${error.message}`);
      } else {
        opportunitiesCreated++;
        console.log(`[REPLICATION] ${confidenceTier}: ${listingYear} ${listingMake} ${listingModel} ${listingTrim} — Ask $${listingPrice} vs Sold $${historicalSale} — Margin +$${expectedMargin}`);
      }

      // Slack alert for HIGH+ signals
      if (!error && expectedMargin >= 4000 && slackWebhook) {
        try {
          await fetch(slackWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🔴 PICKLES FINGERPRINT MATCH\n${listingYear} ${listingMake} ${listingModel} ${listingTrim}\nAsk: $${listingPrice.toLocaleString()}\nLast Sold: $${historicalSale.toLocaleString()}\nLast Buy: $${historicalBuy.toLocaleString()}\nExpected Margin: +$${expectedMargin.toLocaleString()}\n${listing.listing_url || ""}`,
            }),
          });
          slackAlerts++;
        } catch (e) {
          console.error("[REPLICATION] Slack alert failed:", e);
        }
      }
    }

    // Batch-stamp all processed listings as replicated
    if (processedIds.length > 0) {
      const now = new Date().toISOString();
      // Process in chunks of 100 to avoid query size limits
      for (let i = 0; i < processedIds.length; i += 100) {
        const chunk = processedIds.slice(i, i + 100);
        await sb.from("vehicle_listings").update({ replicated_at: now }).in("id", chunk);
      }
    }

    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_checked: listings.length,
      matched,
      opportunities_created: opportunitiesCreated,
      slack_alerts: slackAlerts,
      runtime_ms: runtimeMs,
      errors: errors.slice(0, 10),
    };

    console.log(`[REPLICATION] Complete in ${runtimeMs}ms:`, result);

    await sb.from("cron_audit_log").insert({
      cron_name: "pickles-replication-cron",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result,
    });

    await sb.from("cron_heartbeat").upsert({
      cron_name: "pickles-replication-cron",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `checked=${listings.length} matched=${matched} opps=${opportunitiesCreated} slack=${slackAlerts}`,
    }, { onConflict: "cron_name" });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[REPLICATION] Fatal error:", errorMsg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("cron_audit_log").insert({
        cron_name: "pickles-replication-cron",
        run_date: new Date().toISOString().split("T")[0],
        success: false,
        error: errorMsg,
        result: { runtime_ms: Date.now() - startTime },
      });
      await sb.from("cron_heartbeat").upsert({
        cron_name: "pickles-replication-cron",
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
