
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * ultimate-car-scan: Trigger thescrapelab/ultimate-car-listings-scraper-50-sites
 * on Apify and queue the run for polling by the universal fetch worker.
 *
 * This actor covers 96+ car marketplaces including AU sources:
 *   autotraderau, carsguideau, driveau, picklesau, justcarsau, onlycarsau
 *
 * Input body:
 *   websites    — array of source keys (e.g. ["carsguideau","driveau"])
 *                 defaults to AU marketplace sources
 *   brandQuery  — brand filter string (e.g. "Toyota")
 *   modelQuery  — model filter string (e.g. "HiLux")
 *   yearMin     — min year filter
 *   yearMax     — max year filter
 *   minPrice    — min price filter
 *   maxPrice    — max price filter
 *   mileageMax  — max mileage in km
 *   pagesPerRun — pages per source (default 5)
 *   maxListings — max total listings (default 200)
 */

const DEFAULT_AU_WEBSITES = [
  "carsguideau",
  "driveau",
  "justcarsau",
  "onlycarsau",
];

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
    if (!apifyToken) throw new Error("APIFY_TOKEN not configured");

    // Actor ID: thescrapelab/ultimate-car-listings-scraper-50-sites
    const actorId = Deno.env.get("APIFY_ACTOR_ID_ULTIMATE_CAR") 
      || "thescrapelab~ultimate-car-listings-scraper-50-sites";

    const body = await req.json().catch(() => ({}));
    const {
      websites = DEFAULT_AU_WEBSITES,
      brandQuery,
      modelQuery,
      yearMin,
      yearMax,
      minPrice,
      maxPrice,
      mileageMax,
      pagesPerRun = 5,
      maxListings = 200,
    } = body;

    // Build actor input matching the actor's input schema
    const actorInput: Record<string, unknown> = {
      websites,
      pagesPerRun,
      maxListings: Math.min(maxListings, 500),
      sourceConcurrency: 2,
      minDelay: 0.3,
      maxDelay: 1.0,
    };

    if (brandQuery) actorInput.brandQuery = brandQuery;
    if (modelQuery) actorInput.modelQuery = modelQuery;
    if (yearMin) actorInput.yearMin = yearMin;
    if (yearMax) actorInput.yearMax = yearMax;
    if (minPrice) actorInput.minPrice = minPrice;
    if (maxPrice) actorInput.maxPrice = maxPrice;
    if (mileageMax) actorInput.mileageMax = mileageMax;

    console.log(`Ultimate car scan: ${websites.length} sites, brand=${brandQuery || "any"}, limit=${maxListings}`);

    // Start Apify run (non-blocking)
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

    // Queue for polling by universal fetch worker (autotrader-fetch)
    const { data: queuedRun, error: queueError } = await supabase
      .from("apify_runs_queue")
      .insert({
        source: "ultimate-car",
        run_id: runId,
        dataset_id: datasetId,
        input: { websites, brandQuery, modelQuery, maxListings },
        status: "queued",
      })
      .select()
      .single();

    if (queueError) {
      console.error("Failed to queue run:", queueError.message);
      throw new Error(`Failed to queue run: ${queueError.message}`);
    }

    console.log(`Queued ultimate-car run ${runId} → queue ID ${queuedRun.id}`);

    return new Response(JSON.stringify({
      success: true,
      queued: true,
      queue_id: queuedRun.id,
      apify_run_id: runId,
      dataset_id: datasetId,
      websites_submitted: websites.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Ultimate car scan error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
