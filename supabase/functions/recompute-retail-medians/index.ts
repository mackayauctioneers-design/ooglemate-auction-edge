
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Accept optional limit param (default 200 to stay within timeout)
    let limit = 200;
    try {
      const body = await req.json();
      if (body?.limit) limit = Math.min(body.limit, 500);
    } catch { /* no body is fine */ }

    console.log(`[recompute-retail-medians] Starting (limit=${limit})...`);

    // Prioritise listings that still have badge_estimate or no market price
    const { data: listings, error: fetchErr } = await supabase
      .from("retail_listings")
      .select("id, make, model, year, km, asking_price")
      .in("lifecycle_status", ["ACTIVE", "NEW"])
      .gt("asking_price", 0)
      .not("make", "is", null)
      .not("model", "is", null)
      .not("year", "is", null)
      .or("market_price_source.eq.badge_estimate,market_price_source.is.null")
      .order("asking_price", { ascending: true })
      .limit(limit);

    if (fetchErr) throw fetchErr;
    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No listings to recompute" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[recompute-retail-medians] Processing ${listings.length} listings...`);

    let updated = 0;
    let skipped = 0;

    // Process sequentially to avoid overloading DB
    for (const l of listings as any[]) {
      const { data: result, error: rpcErr } = await supabase.rpc(
        "compute_comparable_median",
        {
          p_listing_id: l.id,
          p_make: l.make,
          p_model: l.model,
          p_year: l.year,
          p_km: l.km || null,
          p_asking_price: l.asking_price,
        },
      );

      if (rpcErr || !result || result.length === 0 || result[0].confidence === "INSUFFICIENT" || !result[0].median_price || result[0].comp_count < 3) {
        skipped++;
        continue;
      }

      const r = result[0];
      const medianPrice = Math.round(r.median_price);
      const priceDiff = l.asking_price - medianPrice;
      const priceDiffPct = parseFloat(((priceDiff / medianPrice) * 100).toFixed(2));

      const { error: upErr } = await supabase
        .from("retail_listings")
        .update({
          market_price: medianPrice,
          price_difference: priceDiff,
          price_difference_percent: priceDiffPct,
          market_price_source: "comparable_median",
          comp_count: r.comp_count,
          market_confidence: r.confidence,
        })
        .eq("id", l.id);

      if (upErr) {
        console.error(`[recompute-retail-medians] Update error for ${l.id}:`, upErr);
        skipped++;
      } else {
        updated++;
      }
    }

    console.log(`[recompute-retail-medians] Done. Updated: ${updated}, Skipped: ${skipped}`);

    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("cron_audit_log").upsert({
      cron_name: "recompute-retail-medians",
      run_date: today,
      success: true,
      result: { updated, skipped, total: listings.length },
    }, { onConflict: "cron_name,run_date" });

    return new Response(
      JSON.stringify({ success: true, updated, skipped, total: listings.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[recompute-retail-medians] Error:", e);

    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("cron_audit_log").upsert({
      cron_name: "recompute-retail-medians",
      run_date: today,
      success: false,
      error: e?.message ?? String(e),
    }, { onConflict: "cron_name,run_date" });

    return new Response(
      JSON.stringify({ success: false, error: e?.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
