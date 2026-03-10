import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * slattery-scan: Trigger Apify Slattery actor and queue for polling.
 *
 * Same enqueue-only pattern as carsales-scan / gumtree-scan.
 * The actor (affectionate_yepsen/slatteryv6) handles its own crawl logic;
 * we just start it and track the run.
 *
 * Input body:
 *   mode       — 'stub' or 'detail' (default 'stub')
 *   maxPages   — max pages to crawl in stub mode (default 10)
 *   batchSize  — items per POST batch (default 50)
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const actorId = Deno.env.get("APIFY_ACTOR_ID_SLATTERY");
    const ingestKey = Deno.env.get("VMA_INGEST_KEY") ?? "";

    if (!apifyToken) throw new Error("APIFY_TOKEN not configured");
    if (!actorId) throw new Error("APIFY_ACTOR_ID_SLATTERY not configured");

    const body = await req.json().catch(() => ({}));
    const {
      mode = "stub",
      maxPages = 10,
      batchSize = 50,
    } = body;

    // Build actor input matching the Slattery actor's INPUT_SCHEMA
    const actorInput: Record<string, unknown> = {
      mode,
      maxPages,
      batchSize,
      ingestKey,
      proxyGroup: "AUTO",
      proxyCountry: "AU",
      dryRun: false,
    };

    console.log(`Slattery scan: mode=${mode}, maxPages=${maxPages}`);

    // Start Apify run (non-blocking)
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}&waitForFinish=0`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actorInput),
      }
    );

    if (!runResponse.ok) {
      const err = await runResponse.text();
      throw new Error(`Apify run start failed: ${runResponse.status} - ${err}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!runId) throw new Error("No run ID returned from Apify");

    console.log(`Apify run started: ${runId}, dataset: ${datasetId}`);

    // Queue for polling
    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "slattery",
        run_id: runId,
        dataset_id: datasetId,
        input: { mode, maxPages, batchSize },
        status: "queued",
      })
      .select()
      .single();

    if (queueError) {
      console.error("Failed to queue run:", queueError.message);
      throw new Error(`Failed to queue run: ${queueError.message}`);
    }

    console.log(`Queued slattery run ${runId} → queue ID ${queuedRun.id}`);

    return new Response(JSON.stringify({
      success: true,
      queued: true,
      queue_id: queuedRun.id,
      apify_run_id: runId,
      dataset_id: datasetId,
      mode,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Slattery scan error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
