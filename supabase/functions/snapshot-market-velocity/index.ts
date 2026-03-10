import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * snapshot-market-velocity
 *
 * Daily cron job that:
 * 1. Snapshots active listing counts by make/model/variant/region
 * 2. Computes demand velocity scores from consecutive snapshots
 *
 * Schedule: once daily (e.g., 06:00 UTC)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split("T")[0];

    // Step 1: Snapshot active listing counts from market_listings
    console.log("Step 1: Taking market snapshot...");
    const { data: snapshotResult, error: snapshotError } = await supabase.rpc(
      "take_market_snapshot"
    );
    if (snapshotError) throw new Error(`Snapshot failed: ${snapshotError.message}`);
    console.log("Snapshot result:", snapshotResult);

    // Step 2: Compute velocity from today vs yesterday
    console.log("Step 2: Computing demand velocity...");
    const { data: velocityResult, error: velocityError } = await supabase.rpc(
      "compute_demand_velocity",
      { p_date: today }
    );
    if (velocityError) throw new Error(`Velocity computation failed: ${velocityError.message}`);
    console.log("Velocity rows processed:", velocityResult);

    // Step 3: Heartbeat
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "snapshot-market-velocity",
          last_seen_at: new Date().toISOString(),
          last_ok: true,
          note: `snapshot done, ${velocityResult ?? 0} velocity rows computed`,
        },
        { onConflict: "cron_name" }
      );

    return new Response(
      JSON.stringify({
        success: true,
        snapshot: snapshotResult,
        velocity_rows: velocityResult,
        date: today,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Snapshot error:", error);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "snapshot-market-velocity",
            last_seen_at: new Date().toISOString(),
            last_ok: false,
            note: (error instanceof Error ? error.message : String(error)).slice(0, 200),
          },
          { onConflict: "cron_name" }
        );
    } catch (_) { /* best effort */ }

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
