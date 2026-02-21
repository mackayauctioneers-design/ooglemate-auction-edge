import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * CROSSSAFE WORKER — Claims and executes queued jobs
 * 
 * Uses FOR UPDATE SKIP LOCKED to safely claim jobs.
 * Delegates to existing edge functions by type.
 * Writes step-level audit logs.
 * 
 * Schedule: every 5 minutes
 * Can also be invoked manually.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_JOBS_PER_RUN = 5;
const JOB_TIMEOUT_MS = 55_000; // 55s hard timeout (edge fn limit ~60s)
const WORKER_ID = `crosssafe-worker-${crypto.randomUUID().slice(0, 8)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: any[] = [];
  let jobsProcessed = 0;

  try {
    for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
      // Check wall-clock — don't start a new job if we're running low
      if (Date.now() - startTime > JOB_TIMEOUT_MS) break;

      // ── CLAIM a job using advisory lock pattern ──
      const { data: claimed, error: claimErr } = await sb.rpc(
        "crosssafe_claim_job" as any,
        { p_worker_id: WORKER_ID } as any,
      );

      if (claimErr || !claimed || (Array.isArray(claimed) && claimed.length === 0)) {
        console.log(`[WORKER] No more jobs to claim`);
        break;
      }

      const job = Array.isArray(claimed) ? claimed[0] : claimed;
      console.log(`[WORKER] Claimed job ${job.id} type=${job.type} source=${job.source}`);

      // ── AUDIT: started ──
      await writeAudit(sb, job.id, "claimed", { worker: WORKER_ID, attempt: job.attempts + 1 });

      try {
        const result = await executeJob(sb, job);
        
        // ── Mark succeeded ──
        await sb
          .from("crosssafe_jobs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
            result,
          })
          .eq("id", job.id);

        await writeAudit(sb, job.id, "succeeded", result);
        results.push({ job_id: job.id, type: job.type, status: "succeeded", result });
        jobsProcessed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newAttempts = (job.attempts || 0) + 1;
        const shouldPark = newAttempts >= (job.max_attempts || 3);

        await sb
          .from("crosssafe_jobs")
          .update({
            status: shouldPark ? "parked" : "queued",
            attempts: newAttempts,
            error: errorMsg,
            locked_at: null,
            locked_by: null,
            finished_at: shouldPark ? new Date().toISOString() : null,
          })
          .eq("id", job.id);

        await writeAudit(sb, job.id, shouldPark ? "parked" : "retryable_error", {
          error: errorMsg,
          attempt: newAttempts,
        });

        results.push({ job_id: job.id, type: job.type, status: shouldPark ? "parked" : "retry", error: errorMsg });
        jobsProcessed++;
      }
    }

    // ── Heartbeat ──
    await sb.from("cron_heartbeat").upsert({
      cron_name: "crosssafe-worker",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `processed=${jobsProcessed} elapsed=${Date.now() - startTime}ms`,
    }, { onConflict: "cron_name" });

    return new Response(
      JSON.stringify({ success: true, jobs_processed: jobsProcessed, results, elapsed_ms: Date.now() - startTime }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[WORKER] Fatal:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ─── JOB EXECUTOR ────────────────────────────────────────────────────────────

async function executeJob(sb: any, job: any): Promise<any> {
  const { type, source, payload } = job;

  switch (type) {
    case "source_refresh":
      return await handleSourceRefresh(sb, source, payload);
    case "url_ingest":
      return await handleUrlIngest(sb, source, payload);
    case "lifecycle_sweep":
      return await handleLifecycleSweep(sb);
    case "score_batch":
      return await handleScoreBatch(sb, payload);
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

// ─── SOURCE REFRESH ──────────────────────────────────────────────────────────
// Calls the existing ingest function via HTTP to avoid code duplication

async function handleSourceRefresh(sb: any, source: string, payload: any): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Map source to existing edge function
  const functionMap: Record<string, string> = {
    pickles: "pickles-ingest-cron",
    grays: "grays-stub-ingest",
    manheim: "manheim-stub-ingest",
    slattery: "slattery-stub-ingest-webhook",
  };

  const fnName = functionMap[source];
  if (!fnName) throw new Error(`No ingest function for source: ${source}`);

  console.log(`[WORKER] Invoking ${fnName} for source_refresh`);

  const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });

  const body = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(`${fnName} returned ${resp.status}: ${JSON.stringify(body)}`);
  }

  // After source refresh, enqueue a score_batch job
  await sb.from("crosssafe_jobs").insert({
    type: "score_batch",
    source,
    payload: { triggered_by: "source_refresh" },
    priority: -1, // Lower priority than refresh jobs
  });

  return { function: fnName, status: resp.status, ...body };
}

// ─── URL INGEST ──────────────────────────────────────────────────────────────
// Direct URL ingest — fetches a single URL and processes it

async function handleUrlIngest(sb: any, source: string, payload: any): Promise<any> {
  const url = payload?.url;
  if (!url) throw new Error("url_ingest requires payload.url");

  console.log(`[WORKER] URL ingest: ${url}`);

  // Determine source from URL
  let detectedSource = source;
  if (url.includes("pickles.com.au")) detectedSource = "pickles";
  else if (url.includes("grays.com")) detectedSource = "grays";
  else if (url.includes("manheim.com")) detectedSource = "manheim";
  else if (url.includes("slattery")) detectedSource = "slattery";

  // Queue into pickles_detail_queue for the detail crawler to pick up
  const sourceListingId = extractSourceId(url, detectedSource);

  const { error } = await sb.from("pickles_detail_queue").upsert({
    source: detectedSource,
    detail_url: url,
    source_listing_id: sourceListingId || `manual:${Date.now()}`,
    crawl_status: "pending",
    crawl_attempts: 0,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "source,source_listing_id" });

  if (error) throw new Error(`Queue insert failed: ${error.message}`);

  return { url, source: detectedSource, source_listing_id: sourceListingId, queued: true };
}

function extractSourceId(url: string, source: string): string | null {
  if (source === "pickles") {
    const m = url.match(/\/(\d+)(?:\?|$)/);
    return m ? m[1] : null;
  }
  if (source === "grays") {
    const m = url.match(/\/lot\/([0-9-]+)\//);
    return m ? m[1] : null;
  }
  if (source === "manheim") {
    const m = url.match(/\/home\/(\d+)\//);
    return m ? m[1] : null;
  }
  return null;
}

// ─── LIFECYCLE SWEEP ─────────────────────────────────────────────────────────

async function handleLifecycleSweep(sb: any): Promise<any> {
  const now = new Date().toISOString();
  const stale7d = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const dead14d = new Date(Date.now() - 14 * 24 * 3600000).toISOString();

  // Mark stale (7 days unseen)
  const { data: staleData } = await sb
    .from("vehicle_listings")
    .update({ lifecycle_state: "STALE", updated_at: now })
    .eq("lifecycle_state", "NEW")
    .lt("last_seen_at", stale7d)
    .select("id");

  const staleCount = staleData?.length || 0;

  // Mark dead (14 days unseen)
  const { data: deadData } = await sb
    .from("vehicle_listings")
    .update({ lifecycle_state: "DEAD", updated_at: now, status: "inactive" })
    .in("lifecycle_state", ["NEW", "STALE"])
    .lt("last_seen_at", dead14d)
    .select("id");

  const deadCount = deadData?.length || 0;

  // Revive if seen again
  const { data: revived } = await sb
    .from("vehicle_listings")
    .update({ lifecycle_state: "NEW", updated_at: now })
    .in("lifecycle_state", ["STALE", "DEAD"])
    .gte("last_seen_at", stale7d)
    .select("id");

  const revivedCount = revived?.length || 0;

  console.log(`[LIFECYCLE] stale=${staleCount} dead=${deadCount} revived=${revivedCount}`);

  return { stale_marked: staleCount, dead_marked: deadCount, revived: revivedCount };
}

// ─── SCORE BATCH ─────────────────────────────────────────────────────────────
// Triggers the replication engine for scoring

async function handleScoreBatch(sb: any, payload: any): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  console.log(`[WORKER] Triggering pickles-replication-cron for scoring`);

  const resp = await fetch(`${supabaseUrl}/functions/v1/pickles-replication-cron`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Replication returned ${resp.status}`);
  return body;
}

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────

async function writeAudit(sb: any, jobId: string, step: string, meta: any) {
  await sb.from("crosssafe_audit_log").insert({
    job_id: jobId,
    step,
    meta,
  });
}
