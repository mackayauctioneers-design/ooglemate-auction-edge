import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-cost-guard — The money protector
 *
 * Runs every 5 minutes via pg_cron. Checks ALL running Apify carsales-cheerio
 * runs and aborts any that exceed $5 cost or 25 minutes runtime.
 *
 * This is the most critical safety net — it catches anything that slips past
 * the maxItems cap and timeout in carsales-scan.
 */

const MAX_COST_USD = 5;
const MAX_RUNTIME_MINUTES = 25;
const ACTOR_ID = "memo23~carsales-cheerio";

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
  const aborted: string[] = [];

  try {
    if (!APIFY_TOKEN) {
      return jsonResp(200, { ok: false, error: "APIFY_TOKEN not configured" });
    }

    // Get all running carsales-cheerio runs from Apify
    const resp = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?status=RUNNING&limit=20&token=${APIFY_TOKEN}`
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return jsonResp(502, { error: `Apify API error: ${resp.status}`, detail: errText });
    }

    const data = await resp.json();
    const runs = data?.data?.items || [];

    for (const run of runs) {
      const cost = run.usageTotalUsd || 0;
      const startedAt = new Date(run.startedAt);
      const runtimeMin = (now.getTime() - startedAt.getTime()) / 60000;

      let reason = "";
      if (cost > MAX_COST_USD) {
        reason = `Cost guard: $${cost.toFixed(2)} exceeds $${MAX_COST_USD} limit`;
      } else if (runtimeMin > MAX_RUNTIME_MINUTES) {
        reason = `Time guard: ${Math.round(runtimeMin)}min exceeds ${MAX_RUNTIME_MINUTES}min limit`;
      }

      if (reason) {
        // Abort the run
        try {
          const abortResp = await fetch(
            `https://api.apify.com/v2/actor-runs/${run.id}/abort?token=${APIFY_TOKEN}`,
            { method: "POST" }
          );
          await abortResp.text(); // consume body
        } catch {
          // best effort
        }

        aborted.push(`${run.id}: ${reason} (was $${cost.toFixed(2)}, ${Math.round(runtimeMin)}min)`);

        // Also update queue row if it exists
        await supabase
          .from("apify_runs_queue")
          .update({
            status: "error",
            last_error: reason,
            updated_at: now.toISOString(),
          })
          .eq("run_id", run.id);
      }
    }

    // Update heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "carsales-cost-guard",
        last_seen_at: now.toISOString(),
        last_ok: true,
        note: aborted.length > 0
          ? `ABORTED ${aborted.length}: ${aborted.join("; ").substring(0, 200)}`
          : `Checked ${runs.length} running, all OK`,
      },
      { onConflict: "cron_name" }
    );

    return jsonResp(200, {
      ok: true,
      running_checked: runs.length,
      aborted: aborted.length,
      details: aborted,
    });
  } catch (err) {
    console.error("[cost-guard] Fatal:", err);
    return jsonResp(500, { ok: false, error: String(err) });
  }
});
