import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: Record<string, unknown> = {};

    // Step 1: Derive clearance events from stale listings
    console.log("Step 1: Deriving clearance events...");
    const { data: clearanceResult, error: clearanceError } = await supabase.rpc(
      "derive_clearance_events",
      { p_stale_hours: 36 }
    );
    if (clearanceError) throw new Error(`Clearance derivation failed: ${clearanceError.message}`);
    results.clearance = clearanceResult;
    console.log("Clearance result:", clearanceResult);

    // Step 2: Roll up daily geo/model metrics
    console.log("Step 2: Rolling up daily metrics...");
    const today = new Date().toISOString().split("T")[0];
    const { data: rollupResult, error: rollupError } = await supabase.rpc(
      "rollup_geo_model_metrics_daily",
      { p_day: today }
    );
    if (rollupError) throw new Error(`Rollup failed: ${rollupError.message}`);
    results.rollup = rollupResult;
    console.log("Rollup result:", rollupResult);

    // Step 3: Generate heat alerts
    console.log("Step 3: Generating heat alerts...");
    const { data: alertResult, error: alertError } = await supabase.rpc(
      "generate_geo_heat_alerts",
      { 
        p_asof: today,
        p_drop_threshold: 0.30,
        p_min_sample_7d: 15.0
      }
    );
    if (alertError) throw new Error(`Alert generation failed: ${alertError.message}`);
    results.alerts = alertResult;
    console.log("Alert result:", alertResult);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Pipeline error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
