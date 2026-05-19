/**
 * worker-star-watch-browser — Dispatches starred listings to the Arby
 * external scraper (residential network) and lets it call back into
 * star-watch-result. We no longer fetch from the edge function IP —
 * Cloudflare blocks it on Autotrader/Carsales/Toyota.
 *
 * POST { id: string (star_watch_jobs.id), job_id: string }
 *
 * Required secrets:
 *   ARBY_DISPATCH_URL  e.g. http://76.13.213.71:3458
 *   ARBY_DISPATCH_KEY  bearer token Arby expects
 *   ARBY_INGEST_KEY    bearer token Arby uses when calling us back
 *
 * Silent-error policy: never throws to dealer UI. Failures land in
 * star_watch_jobs.last_error.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISPATCH_TIMEOUT_MS = 15_000;

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
    .select("id, job_id, listing_id, listing_url, source")
    .eq("id", id)
    .maybeSingle();
  if (jErr || !job) {
    return json({ error: "job not found", detail: jErr?.message }, 404);
  }

  const dispatchUrlBase = (Deno.env.get("ARBY_DISPATCH_URL") || "").replace(/\/+$/, "");
  const dispatchKey = Deno.env.get("ARBY_DISPATCH_KEY");
  const ingestKey = Deno.env.get("ARBY_INGEST_KEY");
  const supaUrl = Deno.env.get("SUPABASE_URL")!;

  if (!dispatchUrlBase || !dispatchKey) {
    const msg = "ARBY_DISPATCH_URL / ARBY_DISPATCH_KEY not configured";
    await sb.from("star_watch_jobs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      last_error: msg,
    }).eq("id", job.id);
    return json({ error: msg }, 500);
  }

  const callbackUrl = `${supaUrl}/functions/v1/star-watch-result`;
  const payload = {
    job_id: job.job_id,
    listing_id: job.listing_id,
    listing_url: job.listing_url,
    source: job.source || null,
    callback_url: callbackUrl,
    callback_auth: ingestKey || null,
  };

  // Mark running
  await sb.from("star_watch_jobs").update({
    status: "running",
    started_at: new Date().toISOString(),
    locked_at: new Date().toISOString(),
    locked_by: "arby-dispatcher",
  }).eq("id", job.id);

  // Fire dispatch to Arby
  let dispatchOk = false;
  let dispatchErr: string | null = null;
  let dispatchStatus = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    const resp = await fetch(`${dispatchUrlBase}/star-watch`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${dispatchKey}`,
      },
      body: JSON.stringify(payload),
    });
    clearTimeout(timer);
    dispatchStatus = resp.status;
    dispatchOk = resp.ok;
    if (!resp.ok) {
      dispatchErr = `Arby dispatch returned ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
    } else {
      // consume body
      await resp.text();
    }
  } catch (e) {
    dispatchErr = (e as Error).message;
  }

  if (!dispatchOk) {
    await sb.from("star_watch_jobs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      last_error: dispatchErr || `dispatch http ${dispatchStatus}`,
    }).eq("id", job.id);
    return json({ ok: false, error: dispatchErr, status: dispatchStatus }, 502);
  }

  // Leave status = running; star-watch-result will set terminal state on callback.
  return json({ ok: true, dispatched: true, job_id: job.job_id });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
