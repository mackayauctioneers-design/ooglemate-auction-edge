import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Retail Heat Pipeline
 * 
 * Runs the SA2 heat system:
 * 1. Mark disappeared listings (not seen for 7 days)
 * 2. Build daily heat rollup
 * 
 * Schedule: Daily at 3:00am AEST (17:00 UTC previous day)
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const results = {
      disappeared_marked: 0,
      heat_rows_updated: 0,
      errors: [] as string[],
    };

    console.log("[retail-heat-pipeline] Starting pipeline...");

    // Step 1: Mark disappeared listings
    try {
      const { data: disappearedCount, error: disappearedError } = await supabase.rpc(
        "fn_mark_retail_disappeared",
        { p_grace_days: 7 }
      );

      if (disappearedError) {
        results.errors.push(`Disappearance marking failed: ${disappearedError.message}`);
        console.error("[retail-heat-pipeline] Disappearance error:", disappearedError);
      } else {
        results.disappeared_marked = disappearedCount || 0;
        console.log(`[retail-heat-pipeline] Marked ${results.disappeared_marked} listings as disappeared`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Disappearance step exception: ${msg}`);
    }

    // Step 2: Build daily heat rollup
    try {
      const { data: heatCount, error: heatError } = await supabase.rpc(
        "fn_build_retail_geo_heat_sa2_daily",
        { p_date: new Date().toISOString().split("T")[0] }
      );

      if (heatError) {
        results.errors.push(`Heat rollup failed: ${heatError.message}`);
        console.error("[retail-heat-pipeline] Heat rollup error:", heatError);
      } else {
        results.heat_rows_updated = heatCount || 0;
        console.log(`[retail-heat-pipeline] Updated ${results.heat_rows_updated} heat rows`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Heat rollup step exception: ${msg}`);
    }

    // FIX: Wrap audit logging in try/catch so it cannot fail the job
    try {
      await supabase.from("cron_audit_log").insert({
        cron_name: "retail-heat-pipeline",
        success: results.errors.length === 0,
        result: results,
        run_date: new Date().toISOString().split("T")[0],
      });
    } catch (_) {
      console.warn("[retail-heat-pipeline] Failed to write audit log (non-fatal)");
    }

    try {
      await supabase.from("cron_heartbeat").upsert({
        cron_name: "retail-heat-pipeline",
        last_seen_at: new Date().toISOString(),
        last_ok: results.errors.length === 0,
        note: `disappeared=${results.disappeared_marked} heat_rows=${results.heat_rows_updated}`,
      }, { onConflict: "cron_name" });
    } catch (_) {
      console.warn("[retail-heat-pipeline] Failed to write heartbeat (non-fatal)");
    }

    console.log("[retail-heat-pipeline] Pipeline complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[retail-heat-pipeline] Pipeline error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
