import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * fb-marketplace-scan: Trigger Apify Facebook Marketplace actor and queue for polling.
 *
 * Same enqueue pattern as carsales-scan:
 * 1. Start Apify actor run (waitForFinish=0)
 * 2. Store run metadata in apify_runs_queue with source='fb-marketplace'
 * 3. Universal fetch worker picks it up
 *
 * Input body:
 *   startUrls  — array of { url } objects (FB Marketplace search URLs)
 *   limit      — max items (default 150, hard cap 250 to prevent OOM)
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
    const actorId = Deno.env.get("APIFY_ACTOR_ID_FB_MARKETPLACE");

    if (!apifyToken) throw new Error("APIFY_TOKEN not configured");
    if (!actorId) throw new Error("APIFY_ACTOR_ID_FB_MARKETPLACE not configured");

    const body = await req.json().catch(() => ({}));
    const {
      startUrls = [],
      limit = 150,
    } = body;

    if (!startUrls.length) {
      throw new Error("startUrls is required — provide at least one FB Marketplace search URL");
    }

    const actorInput: Record<string, unknown> = {
      startUrls: startUrls.map((u: string | { url: string }) =>
        typeof u === "string" ? { url: u } : u
      ),
      maxItems: Math.min(limit, 250),
      includeSeller: false,       // Skip seller detail pages to save memory
      monitoringMode: true,       // Dedup across runs
      minDelay: 5,
      maxDelay: 10,
      maxConcurrency: 5,          // Lower concurrency = less memory
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
      },
    };

    console.log(`FB Marketplace scan: ${startUrls.length} URLs, limit=${Math.min(limit, 250)}`);

    const safeActorId = actorId.replace(/\//g, "~");
    console.log(`[FB-MKTPLACE] Using actor: ${safeActorId}`);
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${safeActorId}/runs?token=${apifyToken}&waitForFinish=0`,
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

    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "fb-marketplace",
        run_id: runId,
        dataset_id: datasetId,
        input: { startUrls, limit },
        status: "queued",
      })
      .select()
      .single();

    if (queueError) {
      console.error("Failed to queue run:", queueError.message);
      throw new Error(`Failed to queue run: ${queueError.message}`);
    }

    console.log(`Queued fb-marketplace run ${runId} → queue ID ${queuedRun.id}`);

    return new Response(JSON.stringify({
      success: true,
      queued: true,
      queue_id: queuedRun.id,
      apify_run_id: runId,
      dataset_id: datasetId,
      urls_submitted: startUrls.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("FB Marketplace scan error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
