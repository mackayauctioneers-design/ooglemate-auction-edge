/**
 * ingestion-watchdog
 *
 * Runs every 10 minutes via pg_cron. Performs:
 * 1. Zombie lock detection — fail apify_runs_queue jobs running > 30 min
 * 2. Browse queue expiry — fail pending rows older than 2 hours
 * 3. Dealer URL queue hygiene — delete invalid/needs_review rows older than 30/14 days
 * 4. Source freshness check — flag sources with no data in 24 hours
 * 5. Outward job cleanup — fail dispatched jobs older than 1 hour
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Record<string, number> = {};

  // ── 1. Zombie Apify runs (running > 30 min) ──────────────────────────
  const apifyCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: zombieApify } = await sb
    .from("apify_runs_queue")
    .update({
      status: "failed",
      last_error: "watchdog: zombie — running > 30 min",
      completed_at: new Date().toISOString(),
    })
    .in("status", ["running", "active"])
    .lt("started_at", apifyCutoff)
    .select("id");
  results.zombie_apify = zombieApify?.length ?? 0;

  // ── 2. Stale pending browse queue (> 2 hours) ────────────────────────
  const browseCutoff = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const { data: staleBrowse } = await sb
    .from("outward_browse_queue")
    .update({
      status: "failed",
      last_error: "watchdog: expired pending > 2h",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .lt("created_at", browseCutoff)
    .select("id");
  results.expired_browse = staleBrowse?.length ?? 0;

  // ── 3. Stale dispatched browse queue (> 1 hour without completion) ───
  const dispatchCutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: staleDispatched } = await sb
    .from("outward_browse_queue")
    .update({
      status: "failed",
      last_error: "watchdog: dispatched but no result > 1h",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "dispatched")
    .lt("dispatched_at", dispatchCutoff)
    .select("id");
  results.expired_dispatched = staleDispatched?.length ?? 0;

  // ── 4. Dealer URL queue hygiene ──────────────────────────────────────
  const invalid30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const review14d = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  const queued48h = new Date(Date.now() - 48 * 60 * 60_000).toISOString();

  const { count: deletedInvalid } = await sb
    .from("dealer_url_queue")
    .delete({ count: "exact" })
    .eq("status", "invalid")
    .lt("created_at", invalid30d);
  results.deleted_invalid_urls = deletedInvalid ?? 0;

  const { count: deletedReview } = await sb
    .from("dealer_url_queue")
    .delete({ count: "exact" })
    .eq("status", "needs_review")
    .lt("created_at", review14d);
  results.deleted_review_urls = deletedReview ?? 0;

  const { data: expiredQueued } = await sb
    .from("dealer_url_queue")
    .update({ status: "failed", fail_reason: "watchdog: queued > 48h" })
    .eq("status", "queued")
    .lt("created_at", queued48h)
    .select("id");
  results.expired_queued_urls = expiredQueued?.length ?? 0;

  // ── 5. Outward jobs stuck in dispatched (> 1 hour) ───────────────────
  const { data: staleJobs } = await sb
    .from("outward_jobs")
    .update({
      status: "failed",
      error: "watchdog: dispatched > 1h without result",
    })
    .eq("status", "dispatched")
    .lt("dispatched_at", dispatchCutoff)
    .select("id");
  results.expired_outward_jobs = staleJobs?.length ?? 0;

  // ── 6. Locked apify_runs_queue rows with expired locks ───────────────
  const { data: expiredLocks } = await sb
    .from("apify_runs_queue")
    .update({
      status: "pending",
      lock_token: null,
      locked_until: null,
      last_error: "watchdog: lock expired",
    })
    .eq("status", "locked")
    .lt("locked_until", new Date().toISOString())
    .select("id");
  results.released_locks = expiredLocks?.length ?? 0;

  console.log("[ingestion-watchdog]", JSON.stringify(results));

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
