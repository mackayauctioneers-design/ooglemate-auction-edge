const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    if (!apifyToken) throw new Error("APIFY_TOKEN not configured");

    const { runId } = await req.json();
    if (!runId) throw new Error("runId is required");

    // 1. Get run info
    const runResp = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
    );
    const runData = await runResp.json();

    if (!runResp.ok) {
      throw new Error(`Apify API error: ${runResp.status} - ${JSON.stringify(runData)}`);
    }

    const run = runData.data;
    const datasetId = run?.defaultDatasetId;

    // 2. Get dataset items (first 10 as sample)
    let sampleItems: unknown[] = [];
    let totalItemCount = 0;

    if (datasetId) {
      const dsInfoResp = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}?token=${apifyToken}`
      );
      const dsInfo = await dsInfoResp.json();
      totalItemCount = dsInfo.data?.itemCount ?? 0;

      if (totalItemCount > 0) {
        const itemsResp = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&limit=5&format=json`
        );
        sampleItems = await itemsResp.json();
      }
    }

    return new Response(JSON.stringify({
      run: {
        id: run.id,
        actId: run.actId,
        status: run.status,
        statusMessage: run.statusMessage,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        buildNumber: run.buildNumber,
        datasetId,
        stats: run.stats,
        options: run.options,
        usage: run.usage,
        usageTotalUsd: run.usageTotalUsd,
      },
      dataset: {
        totalItems: totalItemCount,
        sampleItems,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
