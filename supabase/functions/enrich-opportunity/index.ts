import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { matched_opportunity_id } = await req.json();
    if (!matched_opportunity_id) {
      return new Response(
        JSON.stringify({ error: "matched_opportunity_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get the matched opportunity
    const { data: opp, error: oppErr } = await supabase
      .from("matched_opportunities_v1")
      .select("*")
      .eq("id", matched_opportunity_id)
      .single();

    if (oppErr || !opp) {
      return new Response(
        JSON.stringify({ error: "Opportunity not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get dealer liquidity profile for this segment
    const { data: liquidity } = await supabase
      .from("dealer_liquidity_profiles")
      .select("*")
      .eq("dealer_key", opp.account_id)
      .ilike("make", opp.make || "")
      .ilike("model", opp.model || "")
      .limit(1)
      .maybeSingle();

    // 3. Get market comps from vehicle_listings (same make/model, ±1 year)
    let marketMedian: number | null = null;
    let marketLow: number | null = null;
    let marketHigh: number | null = null;
    const comps: any[] = [];

    if (opp.make && opp.model) {
      const yearMin = (opp.year || 2020) - 1;
      const yearMax = (opp.year || 2020) + 1;

      const { data: listings } = await supabase
        .from("vehicle_listings")
        .select("make, model, year, km, asking_price, source, location")
        .ilike("make", opp.make)
        .ilike("model", opp.model)
        .gte("year", yearMin)
        .lte("year", yearMax)
        .not("asking_price", "is", null)
        .gt("asking_price", 0)
        .order("last_seen_at", { ascending: false })
        .limit(50);

      if (listings && listings.length > 0) {
        const prices = listings
          .map((l: any) => l.asking_price as number)
          .sort((a: number, b: number) => a - b);

        // Trim P5-P95 outliers
        const trimStart = Math.floor(prices.length * 0.05);
        const trimEnd = Math.ceil(prices.length * 0.95);
        const trimmed = prices.slice(trimStart, trimEnd);

        if (trimmed.length > 0) {
          marketMedian = trimmed[Math.floor(trimmed.length / 2)];
          marketLow = trimmed[Math.floor(trimmed.length * 0.25)];
          marketHigh = trimmed[Math.floor(trimmed.length * 0.75)];
        }

        // Pick 2-3 comps for display
        for (const l of listings.slice(0, 3)) {
          comps.push({
            year: l.year,
            km: l.km,
            price: l.asking_price,
            source: l.source,
            location: l.location,
          });
        }
      }
    }

    // 4. Compute enrichment values
    const ajhMedianSell = liquidity?.median_sell_price
      ? Number(liquidity.median_sell_price)
      : (opp.median_sell_price ? Number(opp.median_sell_price) : null);
    const ajhMedianGross = liquidity?.median_profit
      ? Number(liquidity.median_profit)
      : null;
    const ajhMedianDays = liquidity
      ? Math.round(
          (liquidity.recency_days || 30)
        )
      : null;
    const ajhSalesCount = liquidity?.flip_count || opp.sales_count || 0;

    // Auction guide = asking_price on the opportunity
    const auctionGuide = opp.asking_price ? Number(opp.asking_price) : null;
    // Estimated fees ~7% for auction
    const feesEstimate = auctionGuide ? Math.round(auctionGuide * 0.07) : null;
    const estimatedLanded = auctionGuide && feesEstimate
      ? auctionGuide + feesEstimate
      : null;

    // Projected gross
    const projectedGross =
      ajhMedianSell && estimatedLanded
        ? Math.round(ajhMedianSell - estimatedLanded)
        : null;

    // Relative positions
    const priceVsMarketPct =
      auctionGuide && marketMedian
        ? Math.round(((auctionGuide / marketMedian - 1) * 100) * 10) / 10
        : null;

    const grossVsAjhMedianPct =
      projectedGross && ajhMedianGross
        ? Math.round(((projectedGross / ajhMedianGross - 1) * 100) * 10) / 10
        : null;

    // Liquidity band
    let liquidityBand = "normal";
    if (ajhMedianDays !== null) {
      if (ajhMedianDays < 21) liquidityBand = "fast";
      else if (ajhMedianDays > 45) liquidityBand = "slow";
    }

    // Profit band
    let profitBand = "red";
    if (projectedGross !== null) {
      if (projectedGross >= 2000 && (grossVsAjhMedianPct === null || grossVsAjhMedianPct >= -10)) {
        profitBand = "green";
      } else if (projectedGross >= 1200) {
        profitBand = "orange";
      }
    }

    // Summary text
    let summaryText = "";
    if (ajhSalesCount > 0 && ajhMedianGross !== null) {
      const daysStr = ajhMedianDays ? ` in ${ajhMedianDays} days` : "";
      summaryText = `You've sold ${ajhSalesCount} of these, median gross $${Math.round(ajhMedianGross).toLocaleString()}${daysStr}.`;

      if (marketMedian && auctionGuide) {
        summaryText += ` Market sits around $${Math.round(marketMedian).toLocaleString()}; this at $${Math.round(auctionGuide).toLocaleString()}.`;
      }

      if (projectedGross !== null) {
        summaryText += ` Projected gross ~$${Math.round(projectedGross).toLocaleString()} if you sell at your usual price.`;
        if (profitBand === "green") summaryText += " Clear green for you.";
        else if (profitBand === "orange") summaryText += " Decent but tight.";
        else summaryText += " That's below your normal.";
      }
    } else {
      summaryText = "Limited history for this segment. Review comps before bidding.";
    }

    // 5. Upsert enrichment
    const enrichmentRow = {
      matched_opportunity_id,
      account_id: opp.account_id,
      updated_at: new Date().toISOString(),
      market_median_price: marketMedian,
      market_price_low: marketLow,
      market_price_high: marketHigh,
      ajh_median_sell_price: ajhMedianSell,
      ajh_median_gross: ajhMedianGross,
      ajh_median_days_in_stock: ajhMedianDays,
      ajh_sales_count: ajhSalesCount,
      auction_guide_price: auctionGuide,
      estimated_landed_cost: estimatedLanded,
      estimated_recon_cost: null,
      projected_gross: projectedGross,
      price_vs_market_pct: priceVsMarketPct,
      gross_vs_ajh_median_pct: grossVsAjhMedianPct,
      liquidity_band: liquidityBand,
      profit_band: profitBand,
      summary_text: summaryText,
      comps_sample: comps.length > 0 ? comps : null,
    };

    const { data: result, error: upsertErr } = await supabase
      .from("opportunity_enrichments")
      .upsert(enrichmentRow, { onConflict: "matched_opportunity_id" })
      .select()
      .single();

    if (upsertErr) {
      return new Response(
        JSON.stringify({ error: upsertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, enrichment: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
