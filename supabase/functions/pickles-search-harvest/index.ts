import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES SEARCH HARVESTER - Phase 1 (Apify-powered)
 * 
 * Uses Apify's web-scraper actor to render the Vue.js SPA and extract detail URLs.
 * Results are queued to apify_runs_queue for processing by pickles-detail-crawler.
 * 
 * Flow:
 * 1. Build LOB search URL for make/model
 * 2. Trigger Apify web-scraper with custom page function
 * 3. Queue run to apify_runs_queue with source='pickles-harvest'
 * 4. pickles-detail-crawler picks up completed runs and extracts URLs
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Apify web-scraper page function to extract Pickles detail URLs
const PAGE_FUNCTION = `
async function pageFunction(context) {
  const { request, log, $ } = context;
  
  log.info('Processing: ' + request.url);
  
  // Wait for Vue to hydrate the content
  await context.waitFor(5000);
  
  // Extract all detail URLs
  const detailUrls = [];
  const seen = new Set();
  
  // Pattern 1: /used/details/cars/{slug}/{stockId}
  $('a[href*="/used/details/cars/"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\\/used\\/details\\/cars\\/[^\\/]+\\/(\\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      detailUrls.push({
        url: 'https://www.pickles.com.au' + (href.startsWith('/') ? href : '/' + href),
        stockId: match[1]
      });
    }
  });
  
  // Pattern 2: /used/item/cars/{slug}-{stockId}
  $('a[href*="/used/item/cars/"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\\/used\\/item\\/cars\\/[^-]+-?(\\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      detailUrls.push({
        url: 'https://www.pickles.com.au' + (href.startsWith('/') ? href : '/' + href),
        stockId: match[1]
      });
    }
  });
  
  // Pattern 3: Look for stock IDs in data attributes
  $('[data-stock-id], [data-item-id], [data-listing-id]').each((i, el) => {
    const stockId = $(el).attr('data-stock-id') || $(el).attr('data-item-id') || $(el).attr('data-listing-id');
    if (stockId && !seen.has(stockId)) {
      seen.add(stockId);
      detailUrls.push({
        url: 'https://www.pickles.com.au/used/details/cars/vehicle/' + stockId,
        stockId: stockId
      });
    }
  });
  
  log.info('Found ' + detailUrls.length + ' detail URLs');
  
  return {
    url: request.url,
    detailUrls: detailUrls,
    totalFound: detailUrls.length,
    timestamp: new Date().toISOString()
  };
}
`;

// Build LOB search URL
function buildLobSearchUrl(make?: string, model?: string, page = 1, yearMin?: number): string {
  const base = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
  
  let path = base;
  if (make) {
    const normMake = make.toLowerCase().trim().replace(/\s+/g, "-");
    path += `/${normMake}`;
    if (model) {
      const normModel = model.toLowerCase().trim().replace(/\s+/g, "-");
      path += `/${normModel}`;
    }
  }
  
  const params = new URLSearchParams();
  params.set("contentkey", "all-cars");
  params.set("limit", "120");
  params.set("page", String(page));
  params.set("sort", "endDate asc");
  params.set("buyMethod", "Pickles Online,Pickles Live");
  
  if (yearMin) {
    params.set("year-min", String(yearMin));
  }
  
  return `${path}?${params.toString()}`;
}

// Generate start URLs for multiple pages
function generateStartUrls(make?: string, model?: string, maxPages = 5, yearMin?: number): string[] {
  const urls: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    urls.push(buildLobSearchUrl(make, model, page, yearMin));
  }
  return urls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apifyToken = Deno.env.get("APIFY_TOKEN");
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      make,
      model,
      max_pages = 5,
      year_min,
      debug = false,
    } = body;

    if (!apifyToken) {
      return new Response(
        JSON.stringify({ success: false, error: "APIFY_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate start URLs
    const startUrls = generateStartUrls(make, model, max_pages, year_min);
    const baseSearchUrl = buildLobSearchUrl(make, model, 1, year_min);
    
    console.log(`[HARVEST] Starting Pickles harvest for ${make || 'all'} ${model || ''}`);
    console.log(`[HARVEST] Start URLs: ${startUrls.length} pages`);

    if (debug) {
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          start_urls: startUrls,
          page_function_preview: PAGE_FUNCTION.substring(0, 500),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create harvest run record
    const runId = crypto.randomUUID();
    await supabase.from("pickles_harvest_runs").insert({
      id: runId,
      search_url: baseSearchUrl,
      status: "running",
    });

    // Trigger Apify web-scraper actor
    // Using apify/web-scraper which supports Puppeteer/Playwright for SPAs
    const actorId = "apify/web-scraper";
    
    const apifyInput = {
      startUrls: startUrls.map(url => ({ url })),
      pageFunction: PAGE_FUNCTION,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxyCountry: "AU",
      },
      // Wait for Vue.js to render - must be array for web-scraper
      waitUntil: ["networkidle2"],
      // Don't follow links - we just want the search results
      maxCrawlingDepth: 0,
      // Timeout settings
      maxRequestRetries: 2,
      maxPagesPerCrawl: max_pages,
    };

    console.log(`[HARVEST] Triggering Apify actor: ${actorId}`);
    
    const actorResponse = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${apifyToken}&waitForFinish=0`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apifyInput),
      }
    );

    if (!actorResponse.ok) {
      const errText = await actorResponse.text();
      console.error(`[HARVEST] Apify error: ${errText}`);
      
      await supabase.from("pickles_harvest_runs").update({
        status: "failed",
        errors: [`Apify trigger failed: ${actorResponse.status}`],
        duration_ms: Date.now() - startTime,
      }).eq("id", runId);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Apify trigger failed: ${actorResponse.status}`,
          details: errText.substring(0, 500)
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actorData = await actorResponse.json();
    const apifyRunId = actorData.data?.id;
    const datasetId = actorData.data?.defaultDatasetId;

    console.log(`[HARVEST] Apify run started: ${apifyRunId}, dataset: ${datasetId}`);

    // Queue the run for processing
    await supabase.from("apify_runs_queue").insert({
      source: "pickles-harvest",
      run_id: apifyRunId,
      dataset_id: datasetId,
      input: { 
        make, 
        model, 
        max_pages, 
        year_min,
        harvest_run_id: runId,
        start_urls: startUrls,
      },
      status: "queued",
    });

    // Update harvest run with Apify info
    await supabase.from("pickles_harvest_runs").update({
      status: "queued",
      duration_ms: Date.now() - startTime,
    }).eq("id", runId);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        apify_run_id: apifyRunId,
        dataset_id: datasetId,
        search_url: baseSearchUrl,
        pages_queued: startUrls.length,
        message: "Apify scraper triggered. Use pickles-detail-crawler to fetch results when complete.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[HARVEST] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
