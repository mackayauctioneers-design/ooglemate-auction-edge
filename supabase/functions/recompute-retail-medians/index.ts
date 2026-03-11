
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
    console.log("[recompute-retail-medians] Starting real comparable median recomputation...");

    // Fetch all active retail listings that have asking_price
    const { data: listings, error: fetchErr } = await supabase
      .from("retail_listings")
      .select("id, make, model, year, km, asking_price")
      .in("lifecycle_status", ["ACTIVE", "NEW"])
      .gt("asking_price", 0)
      .not("make", "is", null)
      .not("model", "is", null)
      .not("year", "is", null)
      .order("asking_price", { ascending: true })
      .limit(1000);

    if (fetchErr) throw fetchErr;
    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No listings to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[recompute-retail-medians] Processing ${listings.length} listings...`);

    let updated = 0;
    let skipped = 0;
    const batchSize = 50;

    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);

      const updates = await Promise.all(
        batch.map(async (l: any) => {
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

          if (rpcErr || !result || result.length === 0) {
            return null;
          }

          const r = result[0];

          // Skip if insufficient comps
          if (r.confidence === "INSUFFICIENT" || !r.median_price || r.comp_count < 3) {
            return null;
          }

          const medianPrice = Math.round(r.median_price);
          const priceDiff = l.asking_price - medianPrice;
          const priceDiffPct = parseFloat(((priceDiff / medianPrice) * 100).toFixed(2));

          return {
            id: l.id,
            market_price: medianPrice,
            price_difference: priceDiff,
            price_difference_percent: priceDiffPct,
            market_price_source: "comparable_median",
            comp_count: r.comp_count,
            market_confidence: r.confidence,
          };
        }),
      );

      const validUpdates = updates.filter(Boolean);
      skipped += batch.length - validUpdates.length;

      // Batch upsert
      for (const u of validUpdates) {
        const { error: upErr } = await supabase
          .from("retail_listings")
          .update({
            market_price: u!.market_price,
            price_difference: u!.price_difference,
            price_difference_percent: u!.price_difference_percent,
            market_price_source: u!.market_price_source,
            comp_count: u!.comp_count,
            market_confidence: u!.market_confidence,
          })
          .eq("id", u!.id);

        if (upErr) {
          console.error(`[recompute-retail-medians] Update error for ${u!.id}:`, upErr);
        } else {
          updated++;
        }
      }

      console.log(`[recompute-retail-medians] Batch ${Math.floor(i / batchSize) + 1}: ${validUpdates.length} updated, ${batch.length - validUpdates.length} skipped`);
    }

    console.log(`[recompute-retail-medians] Done. Updated: ${updated}, Skipped: ${skipped}`);

    // Audit log
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
