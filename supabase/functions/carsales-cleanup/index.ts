import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-cleanup v1.1 — Stuck run killer
 *
 * Runs every 15 minutes. Finds carsales runs in apify_runs_queue that are stuck
 * in active statuses and marks them as error to release the Carsales lock.
 *
 * Thresholds:
 * - queued/running: 90 minutes
 * - fetching: 30 minutes
 */

const ACTIVE_STATUSES = ["queued", "running", "fetching"] as const;
const DEFAULT_STUCK_THRESHOLD_MINUTES = 90;
const FETCHING_STUCK_THRESHOLD_MINUTES = 30;

function getThresholdMinutes(status: string): number {
  return status === "fetching"
    ? FETCHING_STUCK_THRESHOLD_MINUTES
    : DEFAULT_STUCK_THRESHOLD_MINUTES;
}

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

    const queuedRunningCutoff = new Date(
      Date.now() - DEFAULT_STUCK_THRESHOLD_MINUTES * 60 * 1000,
    ).toISOString();
    const fetchingCutoff = new Date(
      Date.now() - FETCHING_STUCK_THRESHOLD_MINUTES * 60 * 1000,
    ).toISOString();

    const { data: activeRuns, error: fetchError } = await supabase
      .from("apify_runs_queue")
      .select("id, run_id, status, created_at, started_at, updated_at, items_fetched")
      .eq("source", "carsales")
      .in("status", [...ACTIVE_STATUSES]);

    if (fetchError) {
      console.error("[CLEANUP] Failed to query stuck runs:", fetchError.message);
      return respond(500, { ok: false, error: fetchError.message });
    }

    const stuckRuns = (activeRuns ?? []).filter((run) => {
      if (run.status === "fetching") {
        const fetchingStartedAt = run.started_at ?? run.created_at;
        return Boolean(fetchingStartedAt && fetchingStartedAt < fetchingCutoff);
      }

      return Boolean(run.created_at && run.created_at < queuedRunningCutoff);
    });

    if (stuckRuns.length === 0) {
      console.log("[CLEANUP] No stuck runs found");
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "carsales-cleanup",
            last_seen_at: new Date().toISOString(),
            last_ok: true,
            note: "No stuck runs found",
          },
          { onConflict: "cron_name" },
        );

      return respond(200, { ok: true, cleaned: 0, killed_runs: [] });
    }

    console.log(`[CLEANUP] Found ${stuckRuns.length} stuck carsales runs`);

    const cleanedIds: string[] = [];

    for (const run of stuckRuns) {
      const thresholdMinutes = getThresholdMinutes(run.status);
      const referenceTime = run.status === "fetching"
        ? (run.started_at ?? run.created_at)
        : run.created_at;
      const { error: updateError } = await supabase
        .from("apify_runs_queue")
        .update({
          status: "error",
          last_error: `Auto-killed: stuck in ${run.status} for >${thresholdMinutes}min (last activity ${referenceTime}, fetched ${run.items_fetched ?? 0} items)`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id);

      if (updateError) {
        console.error(`[CLEANUP] Failed to update run ${run.id}:`, updateError.message);
      } else {
        console.log(`[CLEANUP] Killed stuck run ${run.run_id} (was ${run.status}, last activity ${referenceTime})`);
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
        { onConflict: "cron_name" },
      );

    return respond(200, { ok: true, cleaned: cleanedIds.length, killed_runs: cleanedIds });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CLEANUP] Fatal error:", errorMsg);
    return respond(500, { ok: false, error: errorMsg });
  }
});
