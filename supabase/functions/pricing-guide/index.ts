import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PRICING GUIDE — Lindy-callable endpoint
 * 
 * Given make/model/year/km, returns:
 * - target_buy_price: what you should pay (median historical buy - 10% safety)
 * - historical_buy_range: P25-P75 of what you've paid before
 * - historical_sell_range: P25-P75 of what you've sold for
 * - retail_median: current Carsales market median (your exit price)
 * - sample_size: how many historical trades back this up
 * - best_anchor: the single closest historical trade for forensic context
 * 
 * POST { make, model, year, km, trim?, account_id? }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return Math.round(s[lo] + (s[hi] - s[lo]) * (idx - lo));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const make = (body.make || "").toUpperCase().trim();
    const model = (body.model || "").toUpperCase().trim();
    const year = Number(body.year);
    const km = Number(body.km) || null;
    const trim = (body.trim || "").toUpperCase().trim() || null;
    const accountId = body.account_id || null;

    if (!make || !model || !year) {
      return new Response(
        JSON.stringify({ error: "make, model, and year are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 1. Query Sales Truth for comparable historical trades ──
    let q = sb
      .from("vehicle_sales_truth")
      .select("id, account_id, buy_price, sale_price, year, km, sold_at, trim_class, badge, drivetrain_bucket")
      .ilike("make", make)
      .ilike("model", model)
      .gte("year", year - 1)
      .lte("year", year + 1)
      .not("buy_price", "is", null)
      .not("sale_price", "is", null)
      .order("sold_at", { ascending: false })
      .limit(100);

    if (accountId) {
      q = q.eq("account_id", accountId);
    }

    const { data: sales, error: salesErr } = await q;
    if (salesErr) throw new Error(`Sales query failed: ${salesErr.message}`);

    // Filter by KM proximity if provided (±20%)
    let comps = (sales || []).filter((s: any) => {
      const profit = Number(s.sale_price) - Number(s.buy_price);
      if (profit <= 0) return false; // only profitable trades
      if (trim && s.trim_class && s.trim_class !== "UNKNOWN" && s.trim_class !== trim) return false;
      if (km && s.km) {
        const kmDiff = Math.abs(s.km - km);
        if (kmDiff > km * 0.2) return false;
      }
      return true;
    });

    // If too few, widen to ±2 years and relax km
    if (comps.length < 3) {
      const { data: wideSales } = await sb
        .from("vehicle_sales_truth")
        .select("id, account_id, buy_price, sale_price, year, km, sold_at, trim_class, badge, drivetrain_bucket")
        .ilike("make", make)
        .ilike("model", model)
        .gte("year", year - 2)
        .lte("year", year + 2)
        .not("buy_price", "is", null)
        .not("sale_price", "is", null)
        .order("sold_at", { ascending: false })
        .limit(100);

      comps = (wideSales || []).filter((s: any) => {
        const profit = Number(s.sale_price) - Number(s.buy_price);
        return profit > 0;
      });
    }

    // ── 2. Calculate pricing intelligence ──
    const buyPrices = comps.map((s: any) => Number(s.buy_price));
    const sellPrices = comps.map((s: any) => Number(s.sale_price));
    const profits = comps.map((s: any) => Number(s.sale_price) - Number(s.buy_price));

    const medianBuy = median(buyPrices);
    const targetBuyPrice = Math.round(medianBuy * 0.9); // 10% below median buy
    const maxBidCeiling = Math.round(medianBuy * 0.95); // 5% below — absolute max

    // Find best anchor (closest match by year+km)
    let bestAnchor: any = null;
    if (comps.length > 0) {
      const scored = comps.map((s: any) => ({
        ...s,
        _score: Math.abs(s.year - year) * 10000 + (km && s.km ? Math.abs(s.km - km) : 0),
      }));
      scored.sort((a: any, b: any) => a._score - b._score);
      const a = scored[0];
      bestAnchor = {
        id: a.id,
        buy_price: Number(a.buy_price),
        sale_price: Number(a.sale_price),
        profit: Number(a.sale_price) - Number(a.buy_price),
        year: a.year,
        km: a.km,
        sold_at: a.sold_at,
        trim_class: a.trim_class,
      };
    }

    // ── 3. Get retail median (what similar cars sell for on Carsales now) ──
    let retailMedian: number | null = null;
    let retailSample = 0;
    try {
      const { data: medianData } = await sb.rpc("compute_retail_median", {
        p_make: make,
        p_model: model,
        p_badge: trim,
        p_year: year,
        p_km: km || 50000,
        p_fuel: null,
        p_drivetrain: null,
      });
      if (medianData && medianData.median_price) {
        retailMedian = medianData.median_price;
        retailSample = medianData.sample_size || 0;
      }
    } catch (e) {
      console.warn("[PRICING-GUIDE] Retail median RPC failed:", e);
    }

    // If RPC failed, fallback to direct query
    if (!retailMedian) {
      const { data: retailFallback } = await sb
        .from("retail_listings")
        .select("asking_price")
        .ilike("make", make)
        .ilike("model", model)
        .gte("year", year - 1)
        .lte("year", year + 1)
        .is("delisted_at", null)
        .not("asking_price", "is", null)
        .gt("asking_price", 0)
        .order("asking_price", { ascending: true })
        .limit(50);

      if (retailFallback && retailFallback.length >= 3) {
        const prices = retailFallback.map((r: any) => Number(r.asking_price));
        retailMedian = median(prices);
        retailSample = prices.length;
      }
    }

    // ── 4. Build response ──
    const confidence = comps.length >= 10 ? "HIGH" : comps.length >= 5 ? "MEDIUM" : comps.length >= 2 ? "LOW" : "INSUFFICIENT";

    const result: any = {
      vehicle: { make, model, year, km, trim },
      sample_size: comps.length,
      confidence,
      target_buy_price: comps.length >= 2 ? targetBuyPrice : null,
      max_bid_ceiling: comps.length >= 2 ? maxBidCeiling : null,
      historical_buy: comps.length >= 2 ? {
        median: medianBuy,
        p25: percentile(buyPrices, 25),
        p75: percentile(buyPrices, 75),
      } : null,
      historical_sell: comps.length >= 2 ? {
        median: median(sellPrices),
        p25: percentile(sellPrices, 25),
        p75: percentile(sellPrices, 75),
      } : null,
      historical_profit: comps.length >= 2 ? {
        median: median(profits),
        p25: percentile(profits, 25),
        p75: percentile(profits, 75),
      } : null,
      retail_median: retailMedian,
      retail_sample: retailSample,
      best_anchor: bestAnchor,
      guidance: comps.length >= 2
        ? `Target buy: $${targetBuyPrice?.toLocaleString()}. You've historically bought similar at $${medianBuy.toLocaleString()} and sold for $${median(sellPrices).toLocaleString()} (median profit $${median(profits).toLocaleString()}).${retailMedian ? ` Current retail median: $${retailMedian.toLocaleString()}.` : ""}`
        : "Insufficient sales history for this spec. Consider widening your search or checking a different trim.",
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[PRICING-GUIDE] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
