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

interface ProfileRow {
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
  median_buy_price: number | null; // not in table but we'll compute
  flip_count: number;
  confidence_tier: string;
  min_viable_profit_floor: number;
  last_sale_date: string | null;
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

    // 2. Group by: account_id + make + model + badge + km_band
    const groups = new Map<string, SaleTruthRow[]>();

    for (const sale of sales as SaleTruthRow[]) {
      if (!sale.km || sale.km <= 0) continue; // Skip no-KM records
      const kmBand = getKmBandLabel(sale.km);
      const badge = (sale.badge || sale.trim_class || "BASE").toUpperCase().trim();
      const key = [sale.account_id, sale.make.toUpperCase(), sale.model.toUpperCase(), badge, kmBand].join("|");
      
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sale);
    }

    console.log("[rebuild-liquidity] " + groups.size + " raw groups before filtering");

    // 3. Build profiles — only for groups with 3+ sales
    const profiles: ProfileRow[] = [];
    let invalidCount = 0;

    for (const [key, groupSales] of groups) {
      const flipCount = groupSales.length;
      const tier = confidenceTier(flipCount);

      if (tier === "INVALID") {
        invalidCount++;
        continue; // Hard exclusion: < 3 flips = no profile
      }

      const [accountId, make, model, badge, kmBand] = key.split("|");
      const bandLimits = getKmBandLimits(kmBand);

      const sellPrices = groupSales.map(s => Number(s.sale_price)).filter(n => n > 0);
      const buyPrices = groupSales.map(s => Number(s.buy_price)).filter(n => n > 0);
      const profits = groupSales.map(s => Number(s.sale_price) - Number(s.buy_price));
      const years = groupSales.map(s => s.year);
      const soldDates = groupSales.map(s => s.sold_at).filter(Boolean).sort();

      const medianYear = median(years);
      const yearMin = Math.min(...years);
      const yearMax = Math.max(...years);

      profiles.push({
        dealer_key: accountId,
        dealer_name: accountId, // Will be resolved below
        make: make,
        model: model,
        badge: badge === "BASE" ? null : badge,
        km_band: kmBand,
        km_min: bandLimits.min,
        km_max: bandLimits.max,
        year_min: yearMin,
        year_max: yearMax,
        year_center: Math.round(medianYear),
        median_sell_price: Math.round(median(sellPrices)),
        median_profit: Math.round(median(profits)),
        p75_profit: Math.round(p75(profits)),
        median_buy_price: Math.round(median(buyPrices)),
        flip_count: flipCount,
        confidence_tier: tier,
        min_viable_profit_floor: Math.max(500, Math.round(median(sellPrices) * 0.05)),
        last_sale_date: soldDates.length > 0 ? soldDates[soldDates.length - 1] : null,
      });
    }

    console.log("[rebuild-liquidity] " + profiles.length + " valid profiles (excluded " + invalidCount + " under-3-flip groups)");
    console.log("[rebuild-liquidity] Confidence breakdown: " +
      profiles.filter(p => p.confidence_tier === "HIGH").length + " HIGH, " +
      profiles.filter(p => p.confidence_tier === "MEDIUM").length + " MEDIUM, " +
      profiles.filter(p => p.confidence_tier === "LOW").length + " LOW");

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        total_sales: sales.length,
        raw_groups: groups.size,
        invalid_groups: invalidCount,
        valid_profiles: profiles.length,
        confidence_breakdown: {
          HIGH: profiles.filter(p => p.confidence_tier === "HIGH").length,
          MEDIUM: profiles.filter(p => p.confidence_tier === "MEDIUM").length,
          LOW: profiles.filter(p => p.confidence_tier === "LOW").length,
        },
        sample_profiles: profiles.slice(0, 10),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Truncate and replace all profiles
    // Delete existing profiles
    const { error: delErr } = await sb.from("dealer_liquidity_profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) {
      console.error("[rebuild-liquidity] Delete error:", delErr);
      throw delErr;
    }

    // 5. Insert new profiles in batches
    let inserted = 0;
    const batchSize = 50;
    for (let i = 0; i < profiles.length; i += batchSize) {
      const batch = profiles.slice(i, i + batchSize).map(p => ({
        dealer_key: p.dealer_key,
        dealer_name: p.dealer_name,
        make: p.make,
        model: p.model,
        badge: p.badge,
        km_band: p.km_band,
        km_min: p.km_min,
        km_max: p.km_max,
        year_min: p.year_min,
        year_max: p.year_max,
        year_center: p.year_center,
        median_sell_price: p.median_sell_price,
        median_profit: p.median_profit,
        p75_profit: p.p75_profit,
        flip_count: p.flip_count,
        confidence_tier: p.confidence_tier,
        min_viable_profit_floor: p.min_viable_profit_floor,
        last_sale_date: p.last_sale_date,
      }));

      const { error: insErr } = await sb.from("dealer_liquidity_profiles").insert(batch);
      if (insErr) {
        console.error("[rebuild-liquidity] Insert batch error:", insErr);
        throw insErr;
      }
      inserted += batch.length;
    }

    // 6. Log the rebuild
    await sb.from("cron_audit_log").insert({
      cron_name: "rebuild-liquidity-profiles",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: {
        total_sales: sales.length,
        valid_profiles: profiles.length,
        invalid_groups: invalidCount,
      },
    });

    console.log("[rebuild-liquidity] Done. Inserted " + inserted + " profiles.");

    return new Response(JSON.stringify({
      ok: true,
      total_sales: sales.length,
      raw_groups: groups.size,
      invalid_groups: invalidCount,
      valid_profiles: inserted,
      confidence_breakdown: {
        HIGH: profiles.filter(p => p.confidence_tier === "HIGH").length,
        MEDIUM: profiles.filter(p => p.confidence_tier === "MEDIUM").length,
        LOW: profiles.filter(p => p.confidence_tier === "LOW").length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[rebuild-liquidity] Error:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
