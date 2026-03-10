
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * gumtree-scan: Trigger Apify Gumtree actor and queue for polling.
 *
 * Same enqueue-only pattern as carsales-scan / autotrader-ingest.
 *
 * Input body:
 *   startUrls  — array of { url } objects (filtered Gumtree search URLs)
 *   limit      — max items (default 200)
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
    const actorId = Deno.env.get("APIFY_ACTOR_ID_GUMTREE");

    if (!apifyToken) throw new Error("APIFY_TOKEN not configured");
    if (!actorId) throw new Error("APIFY_ACTOR_ID_GUMTREE not configured");

    const body = await req.json().catch(() => ({}));
    const { startUrls = [], limit = 200 } = body;

    if (!startUrls.length) {
      throw new Error("startUrls is required — provide at least one filtered Gumtree search URL");
    }

    const actorInput: Record<string, unknown> = {
      startUrls: startUrls.map((u: string | { url: string }) =>
        typeof u === "string" ? { url: u } : u
      ),
      maxItems: Math.min(limit, 500),
    };

    console.log(`Gumtree scan: ${startUrls.length} URLs, limit=${limit}`);

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

    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "gumtree",
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

    console.log(`Queued gumtree run ${runId} → queue ID ${queuedRun.id}`);

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
    console.error("Gumtree scan error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
