import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-cleanup v2.0 — Stuck run killer + Apify abort + orphan detection
 *
 * Runs every 15 minutes via pg_cron. Three responsibilities:
 * 1. STUCK RUNS: Kill queue rows stuck >30min, abort their Apify runs
 * 2. ORPHAN DETECTION: Fix queue rows where Apify finished but status not updated
 * 3. STATS LOGGING: Log 24h queue health summary
 */

const STUCK_THRESHOLD_MINUTES = 30;

function jsonResp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);
  const now = new Date();
  const cutoff = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const actions: string[] = [];

  try {
    // 1. Find and kill stuck runs
    const { data: stuckRuns, error: stuckErr } = await supabase
      .from("apify_runs_queue")
      .select("id, run_id, status, created_at, started_at, updated_at, items_fetched, input")
      .eq("source", "carsales")
      .in("status", ["running", "fetching", "queued"])
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true });

    if (stuckErr) {
      console.error("[cleanup] Failed to query stuck runs:", stuckErr);
      return jsonResp(500, { error: "Failed to query stuck runs" });
    }

    const stuckCount = stuckRuns?.length || 0;
    console.log(`[cleanup] Found ${stuckCount} stuck carsales run(s)`);

    for (const run of stuckRuns || []) {
      const ageMinutes = Math.round(
        (now.getTime() - new Date(run.created_at!).getTime()) / 60000
      );
      const label = (run.input as any)?.label || (run.input as any)?.segment_id || "unknown";

      // Abort the Apify run to stop credit burn
      if (run.run_id && APIFY_TOKEN) {
        try {
          const abortResp = await fetch(
            `https://api.apify.com/v2/actor-runs/${run.run_id}/abort?token=${APIFY_TOKEN}`,
            { method: "POST" }
          );
          const abortText = await abortResp.text();
          actions.push(abortResp.ok
            ? `Aborted Apify run ${run.run_id} (${label}, ${ageMinutes}min old)`
            : `Abort attempt for ${run.run_id}: HTTP ${abortResp.status}`);
        } catch (err) {
          actions.push(`Abort failed for ${run.run_id}: ${err}`);
        }
      }

      // Update queue row
      const { error: updateErr } = await supabase
        .from("apify_runs_queue")
        .update({
          status: "error",
          last_error: `Auto-cleanup: stuck ${ageMinutes}min (was ${run.status}). Run aborted.`,
          completed_at: now.toISOString(),
        })
        .eq("id", run.id);

      if (!updateErr) {
        actions.push(`Marked ${run.id} as error (${label}, was ${run.status} for ${ageMinutes}min)`);
      }
    }

    // 2. Orphan detection — check recent "running" rows against Apify
    if (APIFY_TOKEN) {
      const { data: activeRuns } = await supabase
        .from("apify_runs_queue")
        .select("id, run_id, status, created_at, input")
        .eq("source", "carsales")
        .in("status", ["running", "fetching"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true });

      for (const run of activeRuns || []) {
        if (!run.run_id) continue;
        try {
          const checkResp = await fetch(
            `https://api.apify.com/v2/actor-runs/${run.run_id}?token=${APIFY_TOKEN}`
          );
          if (checkResp.ok) {
            const runData = await checkResp.json();
            const apifyStatus = runData.data?.status;

            if (
              apifyStatus &&
              ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus) &&
              ["running", "fetching"].includes(run.status)
            ) {
              const newStatus = apifyStatus === "SUCCEEDED" ? "running" : "error";
              await supabase
                .from("apify_runs_queue")
                .update({
                  status: newStatus,
                  last_error: apifyStatus !== "SUCCEEDED"
                    ? `Orphan fix: Apify status was ${apifyStatus}`
                    : undefined,
                  updated_at: now.toISOString(),
                })
                .eq("id", run.id);

              const label = (run.input as any)?.label || "unknown";
              actions.push(`Orphan fix: ${run.id} (${label}) — Apify=${apifyStatus}, queue=${run.status}→${newStatus}`);
            }
          } else {
            await checkResp.text(); // consume body
          }
        } catch {
          // Non-critical
        }
      }
    }

    // 3. Queue health stats (last 24h)
    const { data: stats } = await supabase
      .from("apify_runs_queue")
      .select("status")
      .eq("source", "carsales")
      .gte("created_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    const statusCounts: Record<string, number> = {};
    for (const row of stats || []) {
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    }

    console.log(`[cleanup] Last 24h queue health:`, JSON.stringify(statusCounts));

    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "carsales-cleanup",
        last_seen_at: now.toISOString(),
        last_ok: true,
        note: `stuck_killed=${stuckCount} | actions=${actions.length} | 24h: ${JSON.stringify(statusCounts)}`,
      },
      { onConflict: "cron_name" }
    );

    return jsonResp(200, {
      ok: true,
      stuck_found: stuckCount,
      actions,
      queue_health_24h: statusCounts,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error("[cleanup] Fatal error:", err);
    return jsonResp(500, { ok: false, error: String(err) });
  }
});
