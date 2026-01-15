import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Debug function to fetch raw Apify dataset content
 * Call with ?dataset_id=XXX or ?run_id=XXX
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const datasetId = url.searchParams.get("dataset_id");
    const runId = url.searchParams.get("run_id");
    
    const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN");
    if (!APIFY_TOKEN) {
      return new Response(
        JSON.stringify({ error: "APIFY_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let targetDatasetId = datasetId;

    // If run_id provided, fetch the run to get dataset_id
    if (runId && !targetDatasetId) {
      const runUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`;
      console.log("Fetching run info:", runUrl.replace(APIFY_TOKEN, "***"));
      
      const runRes = await fetch(runUrl);
      if (!runRes.ok) {
        const errText = await runRes.text();
        return new Response(
          JSON.stringify({ error: "Failed to fetch run info", status: runRes.status, details: errText }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const runData = await runRes.json();
      targetDatasetId = runData.data?.defaultDatasetId;
      
      if (!targetDatasetId) {
        return new Response(
          JSON.stringify({ error: "No dataset found for run", runData: runData.data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!targetDatasetId) {
      return new Response(
        JSON.stringify({ error: "Provide ?dataset_id=XXX or ?run_id=XXX" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the dataset items
    const datasetUrl = `https://api.apify.com/v2/datasets/${targetDatasetId}/items?token=${APIFY_TOKEN}&limit=10`;
    console.log("Fetching dataset:", datasetUrl.replace(APIFY_TOKEN, "***"));
    
    const datasetRes = await fetch(datasetUrl);
    if (!datasetRes.ok) {
      const errText = await datasetRes.text();
      return new Response(
        JSON.stringify({ error: "Failed to fetch dataset", status: datasetRes.status, details: errText }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const items = await datasetRes.json();
    
    return new Response(
      JSON.stringify({
        dataset_id: targetDatasetId,
        run_id: runId,
        item_count: Array.isArray(items) ? items.length : 1,
        items: items,
        sample_keys: Array.isArray(items) && items.length > 0 ? Object.keys(items[0]) : [],
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
