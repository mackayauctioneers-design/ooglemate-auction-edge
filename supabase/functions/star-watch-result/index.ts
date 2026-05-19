/**
 * star-watch-result — Callback endpoint that Arby (external scraper) posts to
 * after scraping a starred listing. Persists the result and finalises the
 * matching star_watch_jobs row.
 *
 * Auth: Bearer ARBY_INGEST_KEY (never service_role).
 *
 * POST {
 *   job_id: uuid,
 *   status: 'complete' | 'failed' | 'blocked' | 'removed',
 *   listing_url?: string,
 *   listing_id?: string,
 *   source?: string,
 *   http_status?: number,
 *   error?: string,
 *   data?: {
 *     title?, price_aud?, odometer_km?, year?, make?, model?, variant?,
 *     state?, seller_name?, auction_date?, current_status?, notes?, raw?
 *   }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_STATUS = new Set(["complete", "failed", "blocked", "removed"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth ──
  const ingestKey = Deno.env.get("ARBY_INGEST_KEY");
  if (!ingestKey) return json({ error: "server misconfigured" }, 500);

  const auth = req.headers.get("authorization") || "";
  const presented = auth.replace(/^Bearer\s+/i, "").trim();
  if (presented !== ingestKey) return json({ error: "unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const job_id = body?.job_id;
  const status = String(body?.status || "").toLowerCase();
  if (!job_id || !ALLOWED_STATUS.has(status)) {
    return json({ error: "job_id and valid status required" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: job } = await sb
    .from("star_watch_jobs")
    .select("id, job_id, listing_id, listing_url, source")
    .eq("job_id", job_id)
    .maybeSingle();

  const d = body?.data || {};
  const url = body?.listing_url || job?.listing_url || null;

  // Insert result row (append-only)
  if (url) {
    const { error: insErr } = await sb.from("star_watch_results").insert({
      job_id,
      listing_id: body?.listing_id || job?.listing_id || null,
      listing_url: url,
      source: body?.source || job?.source || null,
      http_status: body?.http_status ?? null,
      scrape_status: status,
      title: d.title ?? null,
      price_aud: d.price_aud ?? null,
      odometer_km: d.odometer_km ?? null,
      year: d.year ?? null,
      make: d.make ?? null,
      model: d.model ?? null,
      variant: d.variant ?? null,
      state: d.state ?? null,
      seller_name: d.seller_name ?? null,
      auction_date: d.auction_date ?? null,
      current_status: d.current_status ?? null,
      notes: d.notes ?? null,
      raw: d.raw ?? d,
      error: body?.error ?? null,
    });
    if (insErr) console.warn("[star-watch-result] insert:", insErr.message);
  }

  // Finalise job row if present
  if (job) {
    await sb.from("star_watch_jobs").update({
      status,
      finished_at: new Date().toISOString(),
      last_error: body?.error ?? null,
    }).eq("id", job.id);
  }

  // Mirror to outward_jobs audit
  await sb.from("outward_jobs").update({
    status: status === "complete" ? "complete" : "failed",
    error_message: body?.error ?? null,
  }).eq("id", job_id).then(({ error }) => {
    if (error) console.warn("[star-watch-result] outward_jobs:", error.message);
  });

  return json({ ok: true, job_id, status });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
