/**
 * browse-queue-sweeper
 *
 * Handles stale dispatched rows in outward_browse_queue:
 * - Rows dispatched > 5 minutes ago with < 3 attempts → reset to pending
 * - Rows with >= 3 attempts → hard-fail
 *
 * Designed to run on a cron (every 2–5 minutes).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STALE_MINUTES = 5;
const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();

  // 1. Find stale dispatched rows that can be retried
  const { data: retryable } = await sb
    .from("outward_browse_queue")
    .select("id")
    .eq("status", "dispatched")
    .lt("dispatched_at", cutoff)
    .lt("attempt_count", MAX_ATTEMPTS);

  let retried = 0;
  if (retryable?.length) {
    const ids = retryable.map((r) => r.id);
    await sb
      .from("outward_browse_queue")
      .update({ status: "pending", dispatched_at: null })
      .in("id", ids);
    retried = ids.length;
  }

  // 2. Hard-fail rows that exhausted attempts
  const { data: exhausted } = await sb
    .from("outward_browse_queue")
    .update({
      status: "failed",
      last_error: "sweeper: max attempts exceeded",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "dispatched")
    .gte("attempt_count", MAX_ATTEMPTS)
    .lt("dispatched_at", cutoff)
    .select("id");

  const hardFailed = exhausted?.length ?? 0;

  console.log(
    `[browse-queue-sweeper] retried=${retried} hard_failed=${hardFailed}`,
  );

  return new Response(
    JSON.stringify({ retried, hard_failed: hardFailed }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
