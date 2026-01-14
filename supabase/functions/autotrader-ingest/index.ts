import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * autotrader-ingest: ENQUEUE ONLY
 * 
 * This function kicks off an Apify run and immediately returns.
 * It does NOT wait for results - that's handled by autotrader-fetch.
 * 
 * Flow:
 * 1. Start Apify actor run with waitForFinish=0
 * 2. Store run_id + input in apify_runs_queue
 * 3. Return immediately
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
    const actorId = Deno.env.get("APIFY_ACTOR_ID_AUTOTRADER_AU") || "fayoussef/autotrader-au-scraper";
    
    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    const body = await req.json().catch(() => ({}));
    const { 
      search = null,
      state = null,
      year_min = 2016,
      limit = 100,
    } = body;

    // Build Apify actor input
    const actorInput: Record<string, unknown> = {
      maxItems: Math.min(limit, 200),
      yearMin: year_min,
    };
    
    if (search) actorInput.search = search;
    if (state) actorInput.state = state.toLowerCase();

    console.log(`Autotrader enqueue: search=${search}, state=${state}, year_min=${year_min}`);

    // Start Apify run with waitForFinish=0 (returns immediately)
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

    // Queue the run for processing by autotrader-fetch
    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "autotrader",
        run_id: runId,
        dataset_id: datasetId,
        input: { search, state, year_min, limit },
        status: "queued",
      })
      .select()
      .single();

    if (queueError) {
      console.error("Failed to queue Apify run:", queueError.message);
      throw new Error(`Failed to queue run: ${queueError.message}`);
    }

    console.log(`Queued run ${runId} with queue ID ${queuedRun.id}`);

    return new Response(JSON.stringify({ 
      success: true, 
      queued: true,
      queue_id: queuedRun.id,
      apify_run_id: runId,
      dataset_id: datasetId,
      input: { search, state, year_min, limit },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Autotrader ingest error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
