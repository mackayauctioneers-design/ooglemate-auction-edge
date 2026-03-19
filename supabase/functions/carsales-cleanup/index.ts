import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-cleanup v1.0 — Stuck run killer
 *
 * Runs every 15 minutes. Finds carsales runs in apify_runs_queue that have been
 * in "queued" or "running" status for over 90 minutes and marks them as "failed".
 *
 * This prevents the concurrency lock in carsales-scan from permanently blocking
 * new launches when an Apify run hangs or silently fails.
 */

const STUCK_THRESHOLD_MINUTES = 90;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    // Find stuck carsales runs
    const { data: stuckRuns, error: fetchError } = await supabase
      .from("apify_runs_queue")
      .select("id, run_id, status, created_at, source")
      .eq("source", "carsales")
      .in("status", ["queued", "running"])
      .lt("created_at", cutoff);

    if (fetchError) {
      console.error("[CLEANUP] Failed to query stuck runs:", fetchError.message);
      return respond(500, { ok: false, error: fetchError.message });
    }

    if (!stuckRuns || stuckRuns.length === 0) {
      console.log("[CLEANUP] No stuck runs found");
      return respond(200, { ok: true, cleaned: 0 });
    }

    console.log(`[CLEANUP] Found ${stuckRuns.length} stuck carsales runs older than ${STUCK_THRESHOLD_MINUTES}min`);

    const cleanedIds: string[] = [];

    for (const run of stuckRuns) {
      const { error: updateError } = await supabase
        .from("apify_runs_queue")
        .update({
          status: "error",
          last_error: `Auto-killed: stuck in ${run.status} for >${STUCK_THRESHOLD_MINUTES}min (created ${run.created_at})`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id);

      if (updateError) {
        console.error(`[CLEANUP] Failed to update run ${run.id}:`, updateError.message);
      } else {
        console.log(`[CLEANUP] Killed stuck run ${run.run_id} (was ${run.status} since ${run.created_at})`);
        cleanedIds.push(run.run_id || run.id);
      }
    }

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-cleanup",
          last_seen_at: new Date().toISOString(),
          last_ok: true,
          note: `Cleaned ${cleanedIds.length} stuck runs`,
        },
        { onConflict: "cron_name" }
      );

    return respond(200, { ok: true, cleaned: cleanedIds.length, killed_runs: cleanedIds });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CLEANUP] Fatal error:", errorMsg);
    return respond(500, { ok: false, error: errorMsg });
  }
});
