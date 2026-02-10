import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GuideRequest {
  guide_id: string;
  // If identity was edited by user, override fields come here
  overrides?: {
    make?: string;
    model?: string;
    variant?: string;
    year?: number;
    km?: number;
    price?: number;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { guide_id, overrides }: GuideRequest = await req.json();

    if (!guide_id) {
      return new Response(
        JSON.stringify({ error: "guide_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the guide record
    const { data: guide, error: guideErr } = await supabase
      .from("scan_guides")
      .select("*")
      .eq("id", guide_id)
      .single();

    if (guideErr || !guide) {
      return new Response(
        JSON.stringify({ error: "Guide not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Apply overrides if user edited
    const make = overrides?.make || guide.extracted_make;
    const model = overrides?.model || guide.extracted_model;
    const variant = overrides?.variant || guide.extracted_variant;
    const year = overrides?.year || guide.extracted_year;
    const km = overrides?.km || guide.extracted_km;
    const price = overrides?.price || guide.extracted_price;
    const accountId = guide.account_id;

    if (!make || !model) {
      await supabase.from("scan_guides").update({
        status: "failed",
        error: "Could not identify make/model from image",
        confidence: "low",
      }).eq("id", guide_id);

      return new Response(
        JSON.stringify({ error: "Make and model are required for guide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("scan_guides").update({ status: "guiding" }).eq("id", guide_id);

    console.log(`[screenshot-guide] Generating guide for ${make} ${model} (${year || "?"}) account=${accountId}`);

    // ──────────────────────────────────────────────────
    // A) SALES TRUTH — dealer's own history
    // ──────────────────────────────────────────────────
    let salesQuery = supabase
      .from("vehicle_sales_truth")
      .select("sale_price, buy_price, days_to_clear, km, year, variant, profit_pct")
      .eq("account_id", accountId)
      .ilike("make", make)
      .ilike("model", model);

    // Year band: ±2 years
    if (year) {
      salesQuery = salesQuery.gte("year", year - 2).lte("year", year + 2);
    }

    const { data: salesRows, error: salesErr } = await salesQuery.limit(200);

    if (salesErr) console.error("[screenshot-guide] Sales query error:", salesErr);

    const salesData = salesRows || [];
    const salesCount = salesData.length;

    // Calculate medians
    const salePrices = salesData.filter(s => s.sale_price).map(s => s.sale_price).sort((a, b) => a - b);
    const clearanceDays = salesData.filter(s => s.days_to_clear != null).map(s => s.days_to_clear!).sort((a, b) => a - b);
    const margins = salesData.filter(s => s.sale_price && s.buy_price).map(s => s.sale_price! - (Number(s.buy_price) || 0)).sort((a, b) => a - b);
    const marginPcts = salesData.filter(s => s.profit_pct != null).map(s => Number(s.profit_pct)).sort((a, b) => a - b);

    const median = (arr: number[]) => {
      if (arr.length === 0) return null;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    };

    const salesTruth = {
      count_sold: salesCount,
      median_sale_price: median(salePrices),
      median_days_to_clear: median(clearanceDays),
      median_margin: median(margins),
      median_margin_pct: marginPcts.length > 0 ? Number(median(marginPcts)?.toFixed(1)) : null,
      has_outcome_data: margins.length > 0,
      year_band: year ? `${year - 2}–${year + 2}` : null,
    };

    // Sales depth confidence
    const salesDepthConfidence = salesCount >= 5 ? "high" : salesCount >= 2 ? "medium" : "low";

    // ──────────────────────────────────────────────────
    // B) LIVE SUPPLY CONTEXT — indexed inventory
    // ──────────────────────────────────────────────────
    let supplyQuery = supabase
      .from("listing_details_norm")
      .select("price, km, year, variant, domain, url_canonical")
      .ilike("make", make)
      .ilike("model", model)
      .not("price", "is", null);

    if (year) {
      supplyQuery = supplyQuery.gte("year", year - 2).lte("year", year + 2);
    }

    // KM band: ±20k if known
    if (km) {
      supplyQuery = supplyQuery.gte("km", Math.max(0, km - 20000)).lte("km", km + 20000);
    }

    const { data: supplyRows, error: supplyErr } = await supplyQuery
      .order("price", { ascending: true })
      .limit(100);

    if (supplyErr) console.error("[screenshot-guide] Supply query error:", supplyErr);

    const comps = supplyRows || [];
    const cheapest = comps.length > 0 ? comps[0] : null;

    // Rank this listing among comps
    let rank: number | null = null;
    if (price && comps.length > 0) {
      rank = comps.filter(c => c.price! < price).length + 1;
    }

    // Position label
    let positionLabel = "Unknown";
    if (price && comps.length > 0) {
      const pctile = (rank! - 1) / comps.length;
      if (pctile <= 0.1) positionLabel = "Cheapest";
      else if (pctile <= 0.25) positionLabel = "Among cheapest";
      else if (pctile <= 0.6) positionLabel = "Mid-pack";
      else positionLabel = "Above pack";
    }

    const supplyContext = {
      comps_found: comps.length,
      cheapest_price: cheapest?.price || null,
      cheapest_km: cheapest?.km || null,
      rank_among_comps: rank,
      total_comps: comps.length,
      position_label: positionLabel,
    };

    const supplyCoverageConfidence = comps.length >= 10 ? "high" : comps.length >= 3 ? "medium" : "low";

    // ──────────────────────────────────────────────────
    // C) CARBITRAGE GUIDE — non-prescriptive summary
    // ──────────────────────────────────────────────────
    const identityConfidence = (make && model && year && (variant || km)) ? "high" : (make && model) ? "medium" : "low";

    // Overall confidence = minimum of the three
    const confMap = { high: 3, medium: 2, low: 1 };
    const confArr = [identityConfidence, salesDepthConfidence, supplyCoverageConfidence];
    const minConf = Math.min(...confArr.map(c => confMap[c as keyof typeof confMap]));
    const overallConfidence = minConf >= 3 ? "high" : minConf >= 2 ? "medium" : "low";

    const guideSummary = {
      position_label: positionLabel,
      identity_label: `${make} ${model}${variant ? ` ${variant}` : ""}${year ? ` (${year})` : ""}`,
      sales_narrative: salesCount > 0
        ? `You've sold ${salesCount} similar vehicle${salesCount > 1 ? "s" : ""}. ${
            salesTruth.median_sale_price ? `Median sale price: $${salesTruth.median_sale_price.toLocaleString()}.` : ""
          } ${
            salesTruth.median_days_to_clear != null ? `Median days to clear: ${salesTruth.median_days_to_clear}.` : ""
          } ${
            salesTruth.median_margin != null ? `Median margin: $${salesTruth.median_margin.toLocaleString()}.` : ""
          }`
        : "You have not sold this vehicle type before.",
      supply_narrative: comps.length > 0
        ? `Cheapest currently seen: $${cheapest!.price!.toLocaleString()} (${cheapest!.km ? `${cheapest!.km.toLocaleString()} km` : "km unknown"}). ${
            price ? `This listing ranks #${rank} of ${comps.length} comparable.` : ""
          }`
        : "No comparable listings currently indexed.",
      guide_narrative: price
        ? `Based on your sales truth + current supply, this listing sits: ${positionLabel}.`
        : "Price not detected — position cannot be determined.",
      data_scope_footer: "Guide based on your sales history and currently indexed listings. Coverage improves as more sources are indexed.",
    };

    // Update guide record
    await supabase.from("scan_guides").update({
      extracted_make: make,
      extracted_model: model,
      extracted_variant: variant,
      extracted_year: year,
      extracted_km: km,
      extracted_price: price,
      sales_truth_summary: salesTruth,
      supply_context_summary: supplyContext,
      guide_summary: guideSummary,
      confidence: overallConfidence,
      identity_confidence: identityConfidence,
      sales_depth_confidence: salesDepthConfidence,
      supply_coverage_confidence: supplyCoverageConfidence,
      identity_confirmed: true,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", guide_id);

    console.log(`[screenshot-guide] Completed guide ${guide_id}: ${positionLabel} (${overallConfidence})`);

    return new Response(
      JSON.stringify({
        success: true,
        guide_id,
        salesTruth,
        supplyContext,
        guideSummary,
        confidence: overallConfidence,
        identityConfidence,
        salesDepthConfidence,
        supplyCoverageConfidence,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[screenshot-guide] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
