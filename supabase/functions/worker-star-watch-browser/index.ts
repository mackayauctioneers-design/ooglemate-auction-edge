/**
 * worker-star-watch-browser — Internal browser/fetch worker that replaces Lindy.
 * Fetches the original listing URL, parses status + structured fields,
 * delegates to the shared ingest helper, and writes terminal state to
 * star_watch_jobs.
 *
 * POST { id: string (star_watch_jobs.id), job_id: string }
 *
 * Silent-error policy: never throws to dealer UI. All failures land in
 * star_watch_jobs.last_error + outward_jobs.error_message.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseListingHtml } from "../_shared/star-watch/parsers.ts";
import { ingestStarWatchResult } from "../_shared/star-watch/ingest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FETCH_TIMEOUT_MS = 25_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let id: string | undefined;
  let job_id: string | undefined;
  try {
    const body = await req.json();
    id = body.id;
    job_id = body.job_id;
    if (!id || !job_id) return json({ error: "id and job_id required" }, 400);
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const { data: job, error: jErr } = await sb
    .from("star_watch_jobs")
    .select("id, job_id, listing_id, listing_url")
    .eq("id", id)
    .maybeSingle();
  if (jErr || !job) {
    return json({ error: "job not found", detail: jErr?.message }, 404);
  }

  // ── Fetch the listing ────────────────────────────────────────────────────
  let status = 0;
  let html = "";
  let fetchErr: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(job.listing_url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
    });
    clearTimeout(timer);
    status = resp.status;
    html = await resp.text();
  } catch (e) {
    fetchErr = (e as Error).message;
  }

  // ── Parse ────────────────────────────────────────────────────────────────
  let parsed;
  let terminalStatus: "complete" | "failed" | "blocked" | "removed";
  if (fetchErr) {
    parsed = null;
    terminalStatus = "failed";
  } else {
    parsed = parseListingHtml(job.listing_url, status, html);
    terminalStatus =
      parsed.status === "removed" ? "removed" :
      parsed.status === "blocked" ? "blocked" :
      "complete";
  }

  // ── Update queue row ─────────────────────────────────────────────────────
  await sb.from("star_watch_jobs").update({
    status: terminalStatus,
    finished_at: new Date().toISOString(),
    last_error: fetchErr,
    debug_artifact: parsed?.debug || null,
  }).eq("id", job.id);

  // ── Ingest into shared downstream pipeline ───────────────────────────────
  try {
    await ingestStarWatchResult({
      job_id: job.job_id,
      source_key: "star_watch",
      account_id: null,
      job_status: terminalStatus,
      error: fetchErr,
      listings: parsed && terminalStatus === "complete" ? [{
        listing_url: job.listing_url,
        title: parsed.title,
        price_aud: parsed.price_aud,
        odometer_km: parsed.odometer_km,
        year: parsed.year,
        state: parsed.state,
        source_id: parsed.source_id,
        seller_name: parsed.seller_name,
      }] : [],
    });
  } catch (e) {
    console.error("[worker-star-watch-browser] ingest threw (silent):", (e as Error).message);
  }

  return json({ ok: true, terminal: terminalStatus, status, source: parsed?.source });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
