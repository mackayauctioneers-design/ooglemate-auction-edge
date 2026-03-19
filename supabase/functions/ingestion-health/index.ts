import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * ingestion-health — System dashboard endpoint
 *
 * Returns complete health status: heartbeats, stuck runs, 24h stats by source.
 */

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  try {
    // 1. All heartbeats
    const { data: heartbeats } = await supabase
      .from("cron_heartbeat")
      .select("*")
      .order("last_seen_at", { ascending: false });

    // 2. Last 24h runs
    const { data: recentRuns } = await supabase
      .from("apify_runs_queue")
      .select("source, status, items_fetched, items_upserted, created_at")
      .gte("created_at", twentyFourHoursAgo);

    // 3. Stuck runs
    const { data: stuckRuns } = await supabase
      .from("apify_runs_queue")
      .select("id, run_id, source, status, created_at, input")
      .in("status", ["queued", "running", "fetching"])
      .lt("created_at", thirtyMinAgo);

    // Aggregate stats by source
    const sourceStats: Record<string, { total: number; done: number; error: number; items: number }> = {};
    for (const run of recentRuns || []) {
      const s = run.source;
      if (!sourceStats[s]) sourceStats[s] = { total: 0, done: 0, error: 0, items: 0 };
      sourceStats[s].total++;
      if (run.status === "done") sourceStats[s].done++;
      if (run.status === "error") sourceStats[s].error++;
      sourceStats[s].items += run.items_upserted || 0;
    }

    const stuckCount = stuckRuns?.length || 0;
    const health = stuckCount > 0
      ? "red"
      : (heartbeats || []).some((h: any) => !h.last_ok)
        ? "yellow"
        : "green";

    return jsonResp(200, {
      health,
      timestamp: now.toISOString(),
      stuck_runs: stuckCount,
      stuck_details: (stuckRuns || []).map((r: any) => ({
        id: r.id,
        run_id: r.run_id,
        source: r.source,
        status: r.status,
        created_at: r.created_at,
        label: r.input?.label || r.input?.segment_id || "unknown",
      })),
      last_24h: sourceStats,
      heartbeats: (heartbeats || []).map((h: any) => ({
        name: h.cron_name,
        last_seen: h.last_seen_at,
        ok: h.last_ok,
        note: h.note,
      })),
    });
  } catch (err) {
    console.error("[ingestion-health] Error:", err);
    return jsonResp(500, { error: String(err) });
  }
});
