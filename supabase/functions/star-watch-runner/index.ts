/**
 * star-watch-runner — Cron-driven dispatcher.
 *
 * Claims a batch of queued star_watch_jobs and POSTs each to Arby's HTTP API.
 * Arby scrapes the lot and calls back to /star-watch-result with the data.
 *
 * This replaces the deprecated worker-star-watch-browser path (which was
 * failing on Pickles timeouts and Autotrader 403s). Arby's headless browser
 * already handles those sites for the mandate pipeline — same engine, same
 * dispatch pattern as run-mandate.
 *
 * Env:
 *   ARBY_STAR_WATCH_URL  — Arby endpoint for star-watch jobs
 *                          (falls back to ARBY_DISPATCH_URL)
 *   ARBY_DISPATCH_KEY    — Bearer Arby validates inbound
 *   ARBY_INGEST_KEY      — Bearer Arby uses on the callback to /star-watch-result
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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ARBY_URL =
    Deno.env.get("ARBY_STAR_WATCH_URL") ||
    Deno.env.get("ARBY_DISPATCH_URL") ||
    Deno.env.get("ARBY_RUN_MANDATE_URL");
  const ARBY_KEY = Deno.env.get("ARBY_DISPATCH_KEY");
  const INGEST_KEY = Deno.env.get("ARBY_INGEST_KEY");

  if (!ARBY_URL || !ARBY_KEY || !INGEST_KEY) {
    console.error("[star-watch-runner] Missing Arby config");
    return json({ ok: false, error: "ARBY_STAR_WATCH_URL / ARBY_DISPATCH_KEY / ARBY_INGEST_KEY not configured" }, 500);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

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

  const callbackUrl = `${SUPABASE_URL}/functions/v1/star-watch-result`;
  let dispatched = 0;
  let failed = 0;

  for (const job of jobs) {
    if (Date.now() - t0 > TIME_BUDGET_MS - 5000) break;

    const payload = {
      job_id: job.job_id,
      intent: "star_watch",
      source: job.source || null,
      listing_id: job.listing_id || null,
      listing_url: job.listing_url,
      callback_url: callbackUrl,
      callback_auth: `Bearer ${INGEST_KEY}`,
    };

    try {
      const resp = await fetch(ARBY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ARBY_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errTxt = (await resp.text()).slice(0, 500);
        console.warn(`[star-watch-runner] Arby dispatch ${resp.status} for ${job.id}: ${errTxt}`);
        await sb.from("star_watch_jobs").update({
          status: "queued",
          locked_at: null,
          locked_by: null,
          last_error: `arby_dispatch_${resp.status}: ${errTxt}`.slice(0, 500),
        }).eq("id", job.id);
        failed++;
      } else {
        // Drain body to avoid leaks
        await resp.text();
        dispatched++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[star-watch-runner] dispatch ex for ${job.id}: ${msg}`);
      await sb.from("star_watch_jobs").update({
        status: "queued",
        locked_at: null,
        locked_by: null,
        last_error: `arby_dispatch_ex: ${msg}`.slice(0, 500),
      }).eq("id", job.id);
      failed++;
    }
  }

  return json({ ok: true, claimed: jobs.length, dispatched, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
