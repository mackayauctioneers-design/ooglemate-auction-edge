/**
 * carsales-scan — Drop-in replacement for the existing launcher
 * ==============================================================
 * Validates input, checks concurrency lock on apify_runs_queue,
 * starts the Apify actor, and inserts the queue row.
 *
 * CHANGES from original:
 *   1. Passes maxItems as QUERY PARAM on Apify /runs endpoint (not in body)
 *   2. Default maxItems = 1000 (capped, not unbounded)
 *   3. Timeout raised but bounded: 20 min max per run
 *   4. Accepts segment metadata (segment_id, priority) for tracking
 *   5. Concurrency lock checks for source='carsales' only (not all sources)
 *   6. Memory bumped to 2048MB for residential proxy reliability
 *
 * Called by: carsales-micro-cron (the new scheduler)
 * Downstream: autotrader-fetch picks up the queue row and processes results
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTOR_ID = "memo23~carsales-cheerio";
const DEFAULT_MAX_ITEMS = 1000;
const MAX_CONCURRENCY = 3;
const ACTOR_TIMEOUT_SECS = 1200;
const ACTOR_MEMORY_MB = 2048;

function jsonResp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!APIFY_TOKEN) {
      return jsonResp(200, { ok: false, status: "config_missing", detail: "APIFY_TOKEN" });
    }

    const body = await req.json();
    const { url, maxItems, segment_id, priority, label } = body;

    if (!url || typeof url !== "string") {
      return jsonResp(400, { error: "Missing or invalid 'url' field" });
    }

    if (!url.includes("carsales.com.au")) {
      return jsonResp(400, { error: "URL must be from carsales.com.au" });
    }

    const itemsCap = Math.min(maxItems || DEFAULT_MAX_ITEMS, 2000);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Concurrency check with auto-kill of stuck runs ──
    const { data: activeRuns, error: activeErr } = await supabase
      .from("apify_runs_queue")
      .select("id, created_at, status")
      .eq("source", "carsales")
      .in("status", ["queued", "running", "fetching"])
      .order("created_at", { ascending: false });

    if (activeErr) {
      console.error("Failed to check active runs:", activeErr);
      return jsonResp(500, { error: "Failed to check concurrency" });
    }

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const stuckRuns = (activeRuns || []).filter((r: any) => r.created_at < thirtyMinAgo);

    if (stuckRuns.length > 0) {
      console.log(`Found ${stuckRuns.length} stuck carsales run(s), marking as error`);
      for (const stuck of stuckRuns) {
        await supabase
          .from("apify_runs_queue")
          .update({
            status: "error",
            last_error: `Auto-killed: stuck for >30min (was ${stuck.status})`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", stuck.id);
      }
    }

    const liveRuns = (activeRuns || []).filter((r: any) => r.created_at >= thirtyMinAgo);

    if (liveRuns.length >= MAX_CONCURRENCY) {
      return jsonResp(429, {
        error: "Concurrency limit reached",
        active_runs: liveRuns.length,
        max: MAX_CONCURRENCY,
        segment_id: segment_id || null,
        label: label || null,
      });
    }

    // ── CRITICAL: maxItems as QUERY PARAMETER, not in actor body ──
    // The actor ignores maxItems in the input — it's enforced by the
    // Apify platform when passed as ?maxItems=N on the /runs endpoint.
    const actorInput = {
      startUrls: [{ url }],
      maxConcurrency: 1,
      minConcurrency: 1,
      maxRequestRetries: 10,
      moreResults: true,
      includeListingDetails: true,
      proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
      },
    };

    console.log(`Starting Apify run: ${label || "unknown"} | maxItems=${itemsCap} | url=${url.substring(0, 80)}...`);

    const apifyResp = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}&maxItems=${itemsCap}&timeout=${ACTOR_TIMEOUT_SECS}&memory=${ACTOR_MEMORY_MB}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actorInput),
      },
    );

    if (!apifyResp.ok) {
      const errText = await apifyResp.text();
      console.error(`Apify start failed: ${apifyResp.status} — ${errText}`);
      return jsonResp(502, { error: `Apify error: ${apifyResp.status}`, detail: errText });
    }

    const apifyData = await apifyResp.json();
    const run = apifyData.data;

    // ── Queue row with segment metadata ──
    const { error: insertErr } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "carsales",
        run_id: run.id,
        dataset_id: run.defaultDatasetId,
        input: {
          startUrls: [{ url }],
          maxItems: itemsCap,
          segment_id: segment_id || null,
          priority: priority || null,
          label: label || null,
        },
        status: "running",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertErr) {
      console.error("Failed to insert queue row:", insertErr);
    }

    console.log(`Run started: ${run.id} | dataset: ${run.defaultDatasetId} | segment: ${label || "none"}`);

    return jsonResp(200, {
      ok: true,
      run_id: run.id,
      dataset_id: run.defaultDatasetId,
      max_items: itemsCap,
      segment_id: segment_id || null,
      label: label || null,
    });
  } catch (err) {
    console.error("carsales-scan error:", err);
    return jsonResp(500, { error: String(err) });
  }
});
