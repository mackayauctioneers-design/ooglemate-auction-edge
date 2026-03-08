import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan: Trigger Apify Carsales actor and queue for polling.
 *
 * Follows the same enqueue-only pattern as autotrader-ingest:
 * 1. Start Apify actor run (waitForFinish=0)
 * 2. Store run metadata in apify_runs_queue with source='carsales'
 * 3. autotrader-fetch (or a future carsales-fetch) picks it up
 *
 * Input body:
 *   startUrls  — array of { url } objects (filtered Carsales search URLs)
 *   limit      — max items (default 200)
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const actorId = Deno.env.get("APIFY_ACTOR_ID_CARSALES");

    if (!apifyToken) throw new Error("APIFY_TOKEN not configured");
    if (!actorId) throw new Error("APIFY_ACTOR_ID_CARSALES not configured");

    const body = await req.json().catch(() => ({}));
    const {
      startUrls = [],
      limit = 200,
    } = body;

    if (!startUrls.length) {
      throw new Error("startUrls is required — provide at least one filtered Carsales search URL");
    }

    // Build actor input
    const actorInput: Record<string, unknown> = {
      startUrls: startUrls.map((u: string | { url: string }) =>
        typeof u === "string" ? { url: u } : u
      ),
      maxItems: Math.min(limit, 100), // Hard cap: was 500, now 100 to control costs
    };

    console.log(`Carsales scan: ${startUrls.length} URLs, limit=${limit}`);

    // Start Apify run (non-blocking)
    // Apify API requires username~actor-name format (tilde separator)
    const safeActorId = actorId.replace(/\//g, "~");
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

    // Queue for polling by fetch cron
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
      console.error("Failed to queue run:", queueError.message);
      throw new Error(`Failed to queue run: ${queueError.message}`);
    }

    console.log(`Queued carsales run ${runId} → queue ID ${queuedRun.id}`);

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
    console.error("Carsales scan error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
