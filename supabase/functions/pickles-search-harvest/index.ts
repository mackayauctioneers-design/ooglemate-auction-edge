import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES SEARCH HARVESTER - Phase 1 (Hardened)
 * 
 * Improvements:
 * - Uses URLSearchParams for proper query encoding
 * - Batch upsert via RPC (eliminates per-item selects)
 * - HTML anchor parsing (not just regex)
 * - URL normalization (strips tracking params)
 * - Stable pagination sort
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Regex: /used/details/cars/{slug}/{stockId} where stockId is digits
const PICKLES_DETAIL_PATTERN = /\/used\/details\/cars\/[^\/\s"'<>?#]+\/(\d+)/;

// Tracking params to strip
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ref", "source"];

interface HarvestedUrl {
  detail_url: string;
  source_listing_id: string;
  page_no: number;
}

// Normalize URL: strip tracking params, ensure https
function normalizeDetailUrl(rawUrl: string): string | null {
  try {
    // Ensure absolute URL
    let url: URL;
    if (rawUrl.startsWith("/")) {
      url = new URL(rawUrl, "https://www.pickles.com.au");
    } else if (rawUrl.startsWith("http")) {
      url = new URL(rawUrl);
    } else {
      return null;
    }
    
    // Must be pickles.com.au
    if (!url.hostname.includes("pickles.com.au")) {
      return null;
    }
    
    // Strip tracking params
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }
    
    // Validate path matches detail pattern
    if (!PICKLES_DETAIL_PATTERN.test(url.pathname)) {
      return null;
    }
    
    // Return clean URL (no query string for detail pages)
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

// Extract stock ID from URL
function extractStockId(url: string): string | null {
  const match = url.match(PICKLES_DETAIL_PATTERN);
  return match ? match[1] : null;
}

// Extract detail URLs from HTML - prioritize <a href> parsing
function extractDetailUrls(content: string, pageNo: number): HarvestedUrl[] {
  const urls: HarvestedUrl[] = [];
  const seen = new Set<string>();
  
  // Strategy 1: Parse <a href="..."> links (most reliable)
  const hrefPattern = /href=["']([^"']*\/used\/details\/cars\/[^"'\s]+\/\d+)[^"']*/gi;
  let match;
  
  while ((match = hrefPattern.exec(content)) !== null) {
    const rawUrl = match[1];
    const normalizedUrl = normalizeDetailUrl(rawUrl);
    
    if (!normalizedUrl) continue;
    
    const stockId = extractStockId(normalizedUrl);
    if (!stockId || seen.has(stockId)) continue;
    
    seen.add(stockId);
    urls.push({
      detail_url: normalizedUrl,
      source_listing_id: stockId,
      page_no: pageNo,
    });
  }
  
  // Strategy 2: Fallback regex for non-anchor URLs (markdown, etc.)
  const fallbackPattern = /https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s"'<>?#]+\/(\d+)/gi;
  
  while ((match = fallbackPattern.exec(content)) !== null) {
    const rawUrl = match[0];
    const stockId = match[1];
    
    if (seen.has(stockId)) continue;
    
    const normalizedUrl = normalizeDetailUrl(rawUrl);
    if (!normalizedUrl) continue;
    
    seen.add(stockId);
    urls.push({
      detail_url: normalizedUrl,
      source_listing_id: stockId,
      page_no: pageNo,
    });
  }
  
  return urls;
}

// Build search URL with proper encoding
function buildSearchUrl(baseUrl: string, page: number, yearMin?: number): string {
  const url = new URL(baseUrl);
  const params = new URLSearchParams();
  
  // Stable pagination params
  params.set("contentkey", "all-cars");
  params.set("limit", "120");
  params.set("page", String(page));
  params.set("sort", "endDate asc"); // Stable sort: closing soon first
  
  // Buy method filter (auction opportunities only)
  // Pickles uses array notation: filter[buyMethod][]=Pickles Online
  // But their API also accepts: buyMethod=Pickles Online,Pickles Live
  params.set("buyMethod", "Pickles Online,Pickles Live");
  
  if (yearMin) {
    params.set("year-min", String(yearMin));
  }
  
  return `${url.origin}${url.pathname}?${params.toString()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      search_url,
      max_pages = 10,
      year_min,
      make,
      model,
      debug = false,
    } = body;

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build base search URL
    let baseSearchUrl = search_url;
    if (!baseSearchUrl) {
      if (make && model) {
        const normMake = make.toLowerCase().trim().replace(/\s+/g, "-");
        const normModel = model.toLowerCase().trim().replace(/\s+/g, "-");
        baseSearchUrl = `https://www.pickles.com.au/used/search/cars/${normMake}/${normModel}`;
      } else {
        baseSearchUrl = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
      }
    }

    // Create harvest run record
    const runId = crypto.randomUUID();
    await supabase.from("pickles_harvest_runs").insert({
      id: runId,
      search_url: baseSearchUrl,
      status: "running",
    });

    console.log(`[HARVEST] Starting run ${runId}`);
    console.log(`[HARVEST] Base URL: ${baseSearchUrl}`);

    if (debug) {
      const sampleUrl = buildSearchUrl(baseSearchUrl, 1, year_min);
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          run_id: runId,
          base_url: baseSearchUrl,
          sample_page_url: sampleUrl,
          max_pages,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Harvest pages
    const allUrls: HarvestedUrl[] = [];
    const errors: string[] = [];
    let pagesCrawled = 0;
    let consecutiveEmpty = 0;

    for (let page = 1; page <= max_pages && consecutiveEmpty < 2; page++) {
      const pageUrl = buildSearchUrl(baseSearchUrl, page, year_min);
      console.log(`[HARVEST] Page ${page}: ${pageUrl}`);

      try {
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: pageUrl,
            formats: ["html", "markdown"],
            onlyMainContent: false,
            waitFor: 5000,
          }),
        });

        if (!scrapeRes.ok) {
          const errText = await scrapeRes.text();
          console.error(`[HARVEST] Page ${page} scrape failed:`, errText);
          errors.push(`Page ${page}: Firecrawl ${scrapeRes.status}`);
          consecutiveEmpty++;
          continue;
        }

        const scrapeData = await scrapeRes.json();
        const html = scrapeData.data?.html || "";
        const markdown = scrapeData.data?.markdown || "";
        const content = `${html}\n${markdown}`;

        const pageUrls = extractDetailUrls(content, page);
        console.log(`[HARVEST] Page ${page}: ${pageUrls.length} detail URLs found`);

        if (pageUrls.length === 0) {
          consecutiveEmpty++;
        } else {
          consecutiveEmpty = 0;
          allUrls.push(...pageUrls);
        }

        pagesCrawled++;
        
        // Rate limit
        await new Promise(r => setTimeout(r, 1500));
        
      } catch (err) {
        console.error(`[HARVEST] Page ${page} error:`, err);
        errors.push(`Page ${page}: ${err instanceof Error ? err.message : String(err)}`);
        consecutiveEmpty++;
      }
    }

    // Dedupe by stock ID
    const uniqueUrls = new Map<string, HarvestedUrl>();
    for (const url of allUrls) {
      if (!uniqueUrls.has(url.source_listing_id)) {
        uniqueUrls.set(url.source_listing_id, url);
      }
    }

    console.log(`[HARVEST] Total unique URLs: ${uniqueUrls.size}`);

    // Batch upsert via RPC (eliminates per-item selects)
    const batchItems = Array.from(uniqueUrls.values()).map(u => ({
      detail_url: u.detail_url,
      source_listing_id: u.source_listing_id,
      search_url: baseSearchUrl,
      page_no: u.page_no,
    }));

    let urlsNew = 0;
    let urlsUpdated = 0;

    if (batchItems.length > 0) {
      const { data: upsertResult, error: upsertErr } = await supabase.rpc(
        "upsert_pickles_harvest_batch",
        {
          p_items: batchItems,
          p_run_id: runId,
        }
      );

      if (upsertErr) {
        console.error("[HARVEST] Batch upsert failed:", upsertErr.message);
        errors.push(`Batch upsert: ${upsertErr.message}`);
      } else {
        urlsNew = upsertResult?.inserted || 0;
        urlsUpdated = upsertResult?.updated || 0;
        console.log(`[HARVEST] Batch upsert: ${urlsNew} new, ${urlsUpdated} updated`);
      }
    }

    const duration = Date.now() - startTime;

    // Update run record
    await supabase.from("pickles_harvest_runs").update({
      pages_crawled: pagesCrawled,
      urls_harvested: uniqueUrls.size,
      urls_new: urlsNew,
      urls_existing: urlsUpdated,
      errors: errors.length > 0 ? errors : null,
      duration_ms: duration,
      status: "completed",
    }).eq("id", runId);

    console.log(`[HARVEST] Completed: ${uniqueUrls.size} URLs (${urlsNew} new, ${urlsUpdated} existing)`);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        search_url: baseSearchUrl,
        pages_crawled: pagesCrawled,
        urls_harvested: uniqueUrls.size,
        urls_new: urlsNew,
        urls_existing: urlsUpdated,
        errors: errors.length > 0 ? errors : undefined,
        duration_ms: duration,
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
