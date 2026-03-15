import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan v2.0 — Hardened Carsales Apify launcher
 *
 * SAFETY FEATURES:
 * 1. CRAWL_MODE kill switch
 * 2. URL validation — must be fully filtered carsales.com.au search URL
 * 3. Concurrency lock via apify_runs_queue — only one carsales run at a time
 * 4. Fail-fast on bad config
 * 5. Safe Apify defaults (timeout 20000s, memory 1024MB)
 * 6. No retries — fail and wait for next cycle
 * 7. Structured status responses
 */

// ─── CENTRALISED CARSALES CONFIG ──────────────────────────────────────────────
const CARSALES_CONFIG = {
  timeoutSecs: 20000,   // ~5.5h — memo23 recommended for DataDome resilience
  memoryMbytes: 1024,
  maxItems: 80,         // Small batches that finish fast — prevents actor timeout
  build: "0.0.91",      // Pinned stable build per memo23 — avoids broken "latest"
  maxConcurrency: 1,    // memo23: run 1 browser at a time to avoid DataDome blocks
  source: "carsales",
};

// ─── URL VALIDATION ───────────────────────────────────────────────────────────

function validateCarsalesUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || typeof url !== "string") {
    return { valid: false, reason: "URL is empty or not a string" };
  }

  const trimmed = url.trim();

  if (!trimmed.startsWith("https://www.carsales.com.au/")) {
    return { valid: false, reason: `Not a carsales.com.au URL: ${trimmed.slice(0, 80)}` };
  }

  // Must be a search page, not a landing page
  if (!trimmed.includes("/cars/") && !trimmed.includes("/cars?")) {
    return { valid: false, reason: `Not a Carsales search URL: ${trimmed.slice(0, 80)}` };
  }

  // Must contain filter query parameter
  if (!trimmed.includes("q=") && !trimmed.includes("q=%28")) {
    return { valid: false, reason: `Missing query filters (q=...) — URL appears unfiltered: ${trimmed.slice(0, 100)}` };
  }

  // Reject bare /cars/ with no query string
  try {
    const parsed = new URL(trimmed);
    const q = parsed.searchParams.get("q");
    if (!q || q.length < 10) {
      return { valid: false, reason: `Query filter too short or empty (q=${q}) — likely not filtered` };
    }
  } catch {
    return { valid: false, reason: `Malformed URL: ${trimmed.slice(0, 80)}` };
  }

  return { valid: true };
}

// ─── CONCURRENCY LOCK CHECK ───────────────────────────────────────────────────

async function hasActiveCarsalesRun(supabase: any): Promise<{ locked: boolean; runId?: string }> {
  const { data, error } = await supabase
    .from("apify_runs_queue")
    .select("id, run_id, created_at")
    .eq("source", "carsales")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[CARSALES] Lock check failed:", error.message);
    // Fail safe — assume locked if we can't check
    return { locked: true, runId: "unknown (check failed)" };
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
    // ── 1. CRAWL_MODE kill switch ──
    const crawlMode = Deno.env.get("CRAWL_MODE") || "normal";
    if (crawlMode === "disabled") {
      console.log("[CARSALES] Carsales crawl skipped: CRAWL_MODE=disabled");
      return respond(200, { ok: true, status: "skipped_disabled" });
    }

    // ── 2. Validate config ──
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const actorId = Deno.env.get("APIFY_ACTOR_ID_CARSALES");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!apifyToken) {
      console.error("[CARSALES] FAIL FAST: APIFY_TOKEN not configured");
      return respond(200, { ok: false, status: "config_missing", detail: "APIFY_TOKEN" });
    }
    if (!actorId) {
      console.error("[CARSALES] FAIL FAST: APIFY_ACTOR_ID_CARSALES not configured");
      return respond(200, { ok: false, status: "config_missing", detail: "APIFY_ACTOR_ID_CARSALES" });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 3. Parse and validate input ──
    const body = await req.json().catch(() => ({}));
    const { startUrls = [], limit = CARSALES_CONFIG.maxItems } = body;

    if (!startUrls.length) {
      console.error("[CARSALES] FAIL FAST: No startUrls provided");
      return respond(200, { ok: false, status: "skipped_invalid_url", detail: "startUrls is empty" });
    }

    // Validate EVERY URL
    for (const entry of startUrls) {
      const rawUrl = typeof entry === "string" ? entry : entry?.url;
      const validation = validateCarsalesUrl(rawUrl);
      if (!validation.valid) {
        console.error(`[CARSALES] URL REJECTED: ${validation.reason}`);
        return respond(200, {
          ok: false,
          status: "skipped_invalid_url",
          detail: validation.reason,
          rejected_url: rawUrl?.slice(0, 120),
        });
      }
    }

    // ── 4. Concurrency lock — only one carsales run at a time ──
    const lockCheck = await hasActiveCarsalesRun(supabase);
    if (lockCheck.locked) {
      console.log(`[CARSALES] Carsales crawl skipped: another run already active (${lockCheck.runId})`);
      return respond(200, {
        ok: true,
        status: "skipped_already_running",
        active_run: lockCheck.runId,
      });
    }

    // ── 5. Build actor input with safe defaults ──
    const actorInput: Record<string, unknown> = {
      startUrls: startUrls.map((u: string | { url: string }) =>
        typeof u === "string" ? { url: u } : u
      ),
      maxItems: Math.min(limit, CARSALES_CONFIG.maxItems),
      maxConcurrency: CARSALES_CONFIG.maxConcurrency,
    };

    const safeActorId = actorId.replace(/\//g, "~");
    const apifyUrl = `https://api.apify.com/v2/acts/${safeActorId}/runs?token=${apifyToken}&waitForFinish=0&timeout=${CARSALES_CONFIG.timeoutSecs}&memory=${CARSALES_CONFIG.memoryMbytes}&build=${CARSALES_CONFIG.build}`;

    console.log(`[CARSALES] LAUNCHING: actor=${safeActorId} urls=${startUrls.length} limit=${Math.min(limit, CARSALES_CONFIG.maxItems)} timeout=${CARSALES_CONFIG.timeoutSecs}s memory=${CARSALES_CONFIG.memoryMbytes}MB`);
    console.log(`[CARSALES] Filtered URL: ${typeof startUrls[0] === "string" ? startUrls[0] : startUrls[0]?.url}`);

    // ── 6. Start Apify run ──
    const runResponse = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
    });

    if (!runResponse.ok) {
      const err = await runResponse.text();
      console.error(`[CARSALES] Apify launch FAILED: ${runResponse.status} — ${err}`);
      return respond(200, {
        ok: false,
        status: "launch_failed",
        error: `Apify ${runResponse.status}: ${err.slice(0, 200)}`,
      });
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!runId) {
      console.error("[CARSALES] No run ID returned from Apify");
      return respond(200, { ok: false, status: "launch_failed", error: "No run ID returned" });
    }

    console.log(`[CARSALES] Apify run started: ${runId}, dataset: ${datasetId}`);

    // ── 7. Queue for polling ──
    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "carsales",
        run_id: runId,
        dataset_id: datasetId,
        input: { startUrls, limit },
        status: "queued",
      })
      .select()
      .single();

    if (queueError) {
      console.error("[CARSALES] Failed to queue run:", queueError.message);
      return respond(200, {
        ok: false,
        status: "launch_failed",
        error: `Queue insert failed: ${queueError.message}`,
        apify_run_id: runId,
      });
    }

    console.log(`[CARSALES] Queued: run=${runId} queue_id=${queuedRun.id}`);

    return respond(200, {
      ok: true,
      status: "launched",
      queue_id: queuedRun.id,
      apify_run_id: runId,
      dataset_id: datasetId,
      actorId: safeActorId,
      filteredUrl: typeof startUrls[0] === "string" ? startUrls[0] : startUrls[0]?.url,
      urls_submitted: startUrls.length,
      timeout_secs: CARSALES_CONFIG.timeoutSecs,
      memory_mb: CARSALES_CONFIG.memoryMbytes,
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CARSALES] Unhandled error:", errorMsg);
    return respond(500, { ok: false, status: "launch_failed", error: errorMsg });
  }
});
