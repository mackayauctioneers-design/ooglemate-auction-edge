import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * easyauto-scrape — Apify actor launcher for EasyAuto123 (AP Eagers)
 *
 * Launches the configured Apify actor against easyauto123.com.au,
 * queues the run in apify_runs_queue for the universal fetch worker
 * (autotrader-fetch) to pick up and ingest.
 *
 * Schedule: every 3 hours
 */

const EASYAUTO_CONFIG = {
  timeoutSecs: 3600,
  memoryMbytes: 1024,
  maxItems: 200,
  source: "easyauto",
  startUrl: "https://www.easyauto123.com.au/used-cars",
};

async function hasActiveRun(supabase: any): Promise<{ locked: boolean; runId?: string }> {
  const { data, error } = await supabase
    .from("apify_runs_queue")
    .select("id, run_id, created_at")
    .eq("source", EASYAUTO_CONFIG.source)
    .in("status", ["queued", "running", "fetching"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[EASYAUTO] Lock check failed:", error.message);
    return { locked: true, runId: "unknown" };
  }

  if (data && data.length > 0) {
    return { locked: true, runId: data[0].run_id || data[0].id };
  }

  return { locked: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Note: EasyAuto does NOT honour global CRAWL_MODE — it has its own lifecycle

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const actorId = Deno.env.get("APIFY_ACTOR_ID_EASYAUTO");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!apifyToken) {
      return respond(200, { ok: false, status: "config_missing", detail: "APIFY_TOKEN" });
    }
    if (!actorId) {
      return respond(200, { ok: false, status: "config_missing", detail: "APIFY_ACTOR_ID_EASYAUTO" });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse optional overrides from body
    const body = await req.json().catch(() => ({}));
    const maxPages = body.maxPages || 10;
    const limit = body.limit || EASYAUTO_CONFIG.maxItems;

    // Concurrency lock
    const lockCheck = await hasActiveRun(supabase);
    if (lockCheck.locked) {
      console.log(`[EASYAUTO] Skipped: another run active (${lockCheck.runId})`);
      return respond(200, { ok: true, status: "skipped_already_running", active_run: lockCheck.runId });
    }

    // Build actor input — push-based actor (POSTs items to ingest endpoint)
    const ingestUrl = `${supabaseUrl}/functions/v1/easyauto-ingest`;
    const ingestKey = Deno.env.get("EASYAUTO_INGEST_KEY") || "";
    if (!ingestKey) {
      return respond(200, { ok: false, status: "config_missing", detail: "EASYAUTO_INGEST_KEY" });
    }

    const actorInput: Record<string, unknown> = {
      searchUrl: EASYAUTO_CONFIG.startUrl,
      maxPages,
      INGEST_URL: ingestUrl,
      INGEST_KEY: ingestKey,
    };

    const safeActorId = actorId.replace(/\//g, "~");
    const apifyUrl = `https://api.apify.com/v2/acts/${safeActorId}/runs?token=${apifyToken}&waitForFinish=0&timeout=${EASYAUTO_CONFIG.timeoutSecs}&memory=${EASYAUTO_CONFIG.memoryMbytes}`;

    console.log(`[EASYAUTO] LAUNCHING: actor=${safeActorId} maxPages=${maxPages} limit=${limit}`);

    const runResponse = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
    });

    if (!runResponse.ok) {
      const err = await runResponse.text();
      console.error(`[EASYAUTO] Apify launch FAILED: ${runResponse.status} — ${err}`);
      return respond(200, { ok: false, status: "launch_failed", error: `Apify ${runResponse.status}: ${err.slice(0, 200)}` });
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!runId) {
      return respond(200, { ok: false, status: "launch_failed", error: "No run ID returned" });
    }

    console.log(`[EASYAUTO] Apify run started: ${runId}, dataset: ${datasetId}`);

    // Queue for universal fetch worker
    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: EASYAUTO_CONFIG.source,
        run_id: runId,
        dataset_id: datasetId,
        input: { maxPages, INGEST_URL: ingestUrl },
        status: "queued",
      })
      .select()
      .single();

    if (queueError) {
      console.error("[EASYAUTO] Queue insert failed:", queueError.message);
      return respond(200, { ok: false, status: "launch_failed", error: queueError.message, apify_run_id: runId });
    }

    // Heartbeat
    await supabase.from("cron_heartbeat").upsert({
      cron_name: "easyauto-scrape",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `launched run=${runId}`,
    }, { onConflict: "cron_name" });

    return respond(200, {
      ok: true,
      status: "launched",
      queue_id: queuedRun.id,
      apify_run_id: runId,
      dataset_id: datasetId,
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[EASYAUTO] Error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase.from("cron_heartbeat").upsert({
        cron_name: "easyauto-scrape",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: errorMsg.slice(0, 200),
      }, { onConflict: "cron_name" });
    } catch (_) { /* best effort */ }

    return respond(500, { ok: false, status: "error", error: errorMsg });
  }
});
