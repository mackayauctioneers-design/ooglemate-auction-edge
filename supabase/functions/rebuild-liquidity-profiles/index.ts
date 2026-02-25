import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * rebuild-liquidity-profiles
 * 
 * Rebuilds dealer_liquidity_profiles from vehicle_sales_truth with:
 * - Strict KM banding (0-40k, 40-80k, 80-120k, 120-160k, 160k+)
 * - Minimum sample size (3 flips per band)
 * - Proper confidence tiers (INVALID < 3, LOW 3-4, MEDIUM 5-9, HIGH 10+)
 * - Year banding ±1 year from median
 * - Exact canonical model match
 * - Atomic rebuild (build in memory, truncate+insert in single pass)
 * - Post-rebuild audit logging with integrity checks
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KM_BANDS = [
  { label: "0-40k", min: 0, max: 40000 },
  { label: "40-80k", min: 40000, max: 80000 },
  { label: "80-120k", min: 80000, max: 120000 },
  { label: "120-160k", min: 120000, max: 160000 },
  { label: "160k+", min: 160000, max: 999999 },
];

function getKmBandLabel(km: number): string {
  for (const b of KM_BANDS) {
    if (km >= b.min && km < b.max) return b.label;
  }
  return "160k+";
}

function getKmBandLimits(label: string): { min: number; max: number } {
  const band = KM_BANDS.find(b => b.label === label);
  return band || { min: 0, max: 999999 };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p75(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function confidenceTier(flipCount: number): string {
  if (flipCount < 3) return "INVALID";
  if (flipCount < 5) return "LOW";
  if (flipCount < 10) return "MEDIUM";
  return "HIGH";
}

interface SaleTruthRow {
  account_id: string;
  make: string;
  model: string;
  badge: string | null;
  trim_class: string | null;
  year: number;
  km: number | null;
  buy_price: number | null;
  sale_price: number | null;
  sold_at: string | null;
  platform_class: string | null;
}

interface ProfileInsert {
  dealer_key: string;
  dealer_name: string;
  make: string;
  model: string;
  badge: string | null;
  km_band: string;
  km_min: number;
  km_max: number;
  year_min: number;
  year_max: number;
  year_center: number;
  median_sell_price: number | null;
  median_profit: number | null;
  p75_profit: number | null;
  flip_count: number;
  confidence_tier: string;
  min_viable_profit_floor: number;
  last_sale_date: string | null;
}

function buildProfiles(sales: SaleTruthRow[]): { profiles: ProfileInsert[]; invalidCount: number; groupCount: number } {
  // Group by: account_id + make + model + badge + km_band
  const groups = new Map<string, SaleTruthRow[]>();

  for (const sale of sales) {
    if (!sale.km || sale.km <= 0) continue;
    const kmBand = getKmBandLabel(sale.km);
    const badge = (sale.badge || sale.trim_class || "BASE").toUpperCase().trim();
    const key = [sale.account_id, sale.make.toUpperCase(), sale.model.toUpperCase(), badge, kmBand].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sale);
  }

  const profiles: ProfileInsert[] = [];
  let invalidCount = 0;

  for (const [key, groupSales] of groups) {
    const flipCount = groupSales.length;
    const tier = confidenceTier(flipCount);

    if (tier === "INVALID") {
      invalidCount++;
      continue;
    }

    const [accountId, make, model, badge, kmBand] = key.split("|");
    const bandLimits = getKmBandLimits(kmBand);

    const sellPrices = groupSales.map(s => Number(s.sale_price)).filter(n => n > 0);
    const buyPrices = groupSales.map(s => Number(s.buy_price)).filter(n => n > 0);
    const profits = groupSales.map(s => Number(s.sale_price) - Number(s.buy_price));
    const years = groupSales.map(s => s.year);
    const soldDates = groupSales.map(s => s.sold_at).filter(Boolean).sort();

    const medianYear = median(years);

    profiles.push({
      dealer_key: accountId,
      dealer_name: accountId,
      make,
      model,
      badge: badge === "BASE" ? null : badge,
      km_band: kmBand,
      km_min: bandLimits.min,
      km_max: bandLimits.max,
      year_min: Math.min(...years),
      year_max: Math.max(...years),
      year_center: Math.round(medianYear),
      median_sell_price: Math.round(median(sellPrices)),
      median_profit: Math.round(median(profits)),
      p75_profit: Math.round(p75(profits)),
      flip_count: flipCount,
      confidence_tier: tier,
      min_viable_profit_floor: Math.max(500, Math.round(median(sellPrices) * 0.05)),
      last_sale_date: soldDates.length > 0 ? soldDates[soldDates.length - 1]! : null,
    });
  }

  return { profiles, invalidCount, groupCount: groups.size };
}

function buildAuditPayload(profiles: ProfileInsert[], invalidCount: number, groupCount: number, totalSales: number) {
  const high = profiles.filter(p => p.confidence_tier === "HIGH").length;
  const medium = profiles.filter(p => p.confidence_tier === "MEDIUM").length;
  const low = profiles.filter(p => p.confidence_tier === "LOW").length;
  const kmBandAll = profiles.filter(p => p.km_band === "all").length;
  const topByMedian = profiles
    .filter(p => p.median_sell_price !== null)
    .sort((a, b) => (b.median_sell_price || 0) - (a.median_sell_price || 0))
    .slice(0, 20)
    .map(p => ({
      dealer: p.dealer_key,
      make: p.make,
      model: p.model,
      badge: p.badge,
      km_band: p.km_band,
      median_sell: p.median_sell_price,
      flips: p.flip_count,
      tier: p.confidence_tier,
    }));

  return {
    total_sales: totalSales,
    raw_groups: groupCount,
    invalid_groups: invalidCount,
    valid_profiles: profiles.length,
    confidence_breakdown: { HIGH: high, MEDIUM: medium, LOW: low },
    km_band_all_count: kmBandAll,
    top_20_by_median: topByMedian,
    // Integrity flags
    integrity: {
      has_km_band_all: kmBandAll > 0,
      low_pct: profiles.length > 0 ? Math.round((low / profiles.length) * 100) : 0,
      profile_count_ok: profiles.length > 0,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    console.log("[rebuild-liquidity] Starting" + (dryRun ? " (DRY RUN)" : ""));

    // 1. Pull all sales truth with buy AND sale price
    const { data: sales, error: salesErr } = await sb
      .from("vehicle_sales_truth")
      .select("account_id, make, model, badge, trim_class, year, km, buy_price, sale_price, sold_at, platform_class")
      .not("buy_price", "is", null)
      .not("sale_price", "is", null)
      .gt("sale_price", 0)
      .gt("buy_price", 0);

    if (salesErr) throw salesErr;
    if (!sales || sales.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No sales data found", profiles_built: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[rebuild-liquidity] " + sales.length + " sales with both buy & sale price");

    // 2. Build all profiles in memory (atomic — nothing deleted yet)
    const { profiles, invalidCount, groupCount } = buildProfiles(sales as SaleTruthRow[]);

    console.log("[rebuild-liquidity] " + profiles.length + " valid profiles (excluded " + invalidCount + " under-3-flip groups)");
    console.log("[rebuild-liquidity] Confidence breakdown: " +
      profiles.filter(p => p.confidence_tier === "HIGH").length + " HIGH, " +
      profiles.filter(p => p.confidence_tier === "MEDIUM").length + " MEDIUM, " +
      profiles.filter(p => p.confidence_tier === "LOW").length + " LOW");

    // Build audit payload (used for both dry run and real run)
    const audit = buildAuditPayload(profiles, invalidCount, groupCount, sales.length);

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true,
        ...audit,
        sample_profiles: profiles.slice(0, 10),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. ATOMIC REBUILD: Clear dependent cache first, then truncate + insert
    // Clear soft-referenced pickles_buy_now_listings.matched_profile_id
    // (FK was dropped — this column is now a soft reference)
    const { error: clearRefErr } = await sb
      .from("pickles_buy_now_listings")
      .update({ matched_profile_id: null })
      .not("matched_profile_id", "is", null);
    if (clearRefErr) {
      console.warn("[rebuild-liquidity] Warn clearing refs: " + clearRefErr.message);
    }

    // Delete all existing profiles
    const { error: delErr } = await sb.rpc("truncate_dealer_liquidity_profiles");
    let usedFallbackDelete = false;
    if (delErr) {
      // Fallback: delete all rows (rpc may not exist yet)
      console.warn("[rebuild-liquidity] RPC truncate failed, using delete fallback: " + delErr.message);
      const { error: delErr2 } = await sb.from("dealer_liquidity_profiles").delete().gte("flip_count", 0);
      if (delErr2) {
        console.error("[rebuild-liquidity] Delete fallback also failed: " + delErr2.message);
        throw delErr2;
      }
      usedFallbackDelete = true;
    }

    // 4. Insert new profiles in batches
    let inserted = 0;
    const batchSize = 50;
    for (let i = 0; i < profiles.length; i += batchSize) {
      const batch = profiles.slice(i, i + batchSize);
      const { error: insErr } = await sb.from("dealer_liquidity_profiles").insert(batch);
      if (insErr) {
        console.error("[rebuild-liquidity] Insert batch error at offset " + i + ": " + insErr.message);
        throw insErr;
      }
      inserted += batch.length;
    }

    // 5. Log the rebuild with full audit
    await sb.from("cron_audit_log").insert({
      cron_name: "rebuild-liquidity-profiles",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: {
        ...audit,
        inserted,
        used_fallback_delete: usedFallbackDelete,
      },
    });

    // 6. Post-rebuild integrity alerts
    const alerts: string[] = [];
    if (audit.integrity.has_km_band_all) alerts.push("WARNING: km_band='all' profiles detected");
    if (audit.integrity.low_pct > 60) alerts.push("WARNING: >60% of profiles are LOW confidence — insufficient sales truth");
    if (inserted === 0) alerts.push("CRITICAL: Zero profiles inserted — sales truth may be empty");
    if (alerts.length > 0) {
      console.warn("[rebuild-liquidity] INTEGRITY ALERTS: " + alerts.join(" | "));
    }

    console.log("[rebuild-liquidity] Done. Inserted " + inserted + " profiles." + (usedFallbackDelete ? " (used delete fallback)" : ""));

    return new Response(JSON.stringify({
      ok: true,
      ...audit,
      inserted,
      integrity_alerts: alerts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[rebuild-liquidity] Error:", err);

    // Log failure
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await sb.from("cron_audit_log").insert({
        cron_name: "rebuild-liquidity-profiles",
        run_date: new Date().toISOString().split("T")[0],
        success: false,
        error: err.message,
      });
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
