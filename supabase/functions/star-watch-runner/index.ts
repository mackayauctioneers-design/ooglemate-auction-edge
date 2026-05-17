/**
 * star-watch-runner — Cron-driven dispatcher.
 * Claims a batch of queued star_watch_jobs and fires off worker-star-watch-browser
 * for each (fire-and-forget; the worker writes terminal state).
 *
 * Time budget: 110s total, max 8 jobs per tick.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;
const BATCH_SIZE = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const { data: claimed, error } = await sb.rpc("claim_next_star_watch_jobs", {
    _limit: BATCH_SIZE,
    _locked_by: "star-watch-runner",
  });

  if (error) {
    console.error("[star-watch-runner] claim error:", error.message);
    return json({ ok: false, error: error.message }, 500);
  }

  const jobs = (claimed as any[]) || [];
  if (jobs.length === 0) return json({ ok: true, claimed: 0 });

  let dispatched = 0;
  for (const job of jobs) {
    if (Date.now() - t0 > TIME_BUDGET_MS - 5000) break;
    try {
      // fire-and-forget; worker is responsible for terminal status
      fetch(`${supabaseUrl}/functions/v1/worker-star-watch-browser`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ id: job.id, job_id: job.job_id }),
      }).catch((e) => console.warn("[star-watch-runner] dispatch err:", e?.message));
      dispatched++;
    } catch (e) {
      console.warn("[star-watch-runner] dispatch ex:", (e as Error).message);
    }
  }

  return json({ ok: true, claimed: jobs.length, dispatched });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
