import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES SEARCH HARVESTER - Phase 1 (Direct Fetch)
 * 
 * Key changes:
 * - Uses direct fetch() instead of Firecrawl (HTML is server-rendered)
 * - Uses correct LOB URL pattern: /used/search/lob/cars-motorcycles/cars/{make}/{model}
 * - Proper User-Agent and headers to avoid bot detection
 * - Batch upsert via RPC (eliminates per-item selects)
 * - URL normalization (strips tracking params)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Regex patterns for Pickles detail URLs
// Format 1: /used/details/cars/{slug}/{stockId}
const PICKLES_DETAIL_PATTERN = /\/used\/details\/cars\/[^\/\s"'<>?#]+\/(\d+)/;
// Format 2: /used/item/cars/{slug}-{stockId} (alternate format)
const PICKLES_ITEM_PATTERN = /\/used\/item\/cars\/[^\/\s"'<>?#]+-(\d+)/;
// Format 3: /cars/item/{stockId} or /item/{stockId}
const PICKLES_SHORT_ITEM = /\/(?:cars\/)?item\/(\d+)/;

// Tracking params to strip
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ref", "source"];

// Realistic browser headers
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9,en-US;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

interface HarvestedUrl {
  detail_url: string;
  source_listing_id: string;
  page_no: number;
}

// Normalize URL: strip tracking params, ensure https
function normalizeDetailUrl(rawUrl: string): { url: string; stockId: string } | null {
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
    
    // Try to extract stock ID from various patterns
    let stockId: string | null = null;
    
    // Try detail pattern first
    let match = url.pathname.match(PICKLES_DETAIL_PATTERN);
    if (match) {
      stockId = match[1];
    }
    
    // Try item pattern
    if (!stockId) {
      match = url.pathname.match(PICKLES_ITEM_PATTERN);
      if (match) stockId = match[1];
    }
    
    // Try short item pattern
    if (!stockId) {
      match = url.pathname.match(PICKLES_SHORT_ITEM);
      if (match) stockId = match[1];
    }
    
    if (!stockId) {
      return null;
    }
    
    // Return clean URL (no query string for detail pages)
    return { url: `${url.origin}${url.pathname}`, stockId };
  } catch {
    return null;
  }
}

// Extract detail URLs from HTML - prioritize <a href> parsing
function extractDetailUrls(content: string, pageNo: number): HarvestedUrl[] {
  const urls: HarvestedUrl[] = [];
  const seen = new Set<string>();
  
  // Strategy 1: Parse <a href="..."> links for /used/details/cars/
  const hrefPattern1 = /href=["']([^"']*\/used\/details\/cars\/[^"'\s]+\/\d+)[^"']*/gi;
  let match;
  
  while ((match = hrefPattern1.exec(content)) !== null) {
    const result = normalizeDetailUrl(match[1]);
    if (!result || seen.has(result.stockId)) continue;
    
    seen.add(result.stockId);
    urls.push({
      detail_url: result.url,
      source_listing_id: result.stockId,
      page_no: pageNo,
    });
  }
  
  // Strategy 2: Parse <a href="..."> links for /used/item/cars/
  const hrefPattern2 = /href=["']([^"']*\/used\/item\/cars\/[^"'\s]+-\d+)[^"']*/gi;
  
  while ((match = hrefPattern2.exec(content)) !== null) {
    const result = normalizeDetailUrl(match[1]);
    if (!result || seen.has(result.stockId)) continue;
    
    seen.add(result.stockId);
    urls.push({
      detail_url: result.url,
      source_listing_id: result.stockId,
      page_no: pageNo,
    });
  }
  
  // Strategy 3: Parse <a href="..."> for /cars/item/ or /item/
  const hrefPattern3 = /href=["']([^"']*\/(?:cars\/)?item\/\d+)[^"']*/gi;
  
  while ((match = hrefPattern3.exec(content)) !== null) {
    const result = normalizeDetailUrl(match[1]);
    if (!result || seen.has(result.stockId)) continue;
    
    seen.add(result.stockId);
    urls.push({
      detail_url: result.url,
      source_listing_id: result.stockId,
      page_no: pageNo,
    });
  }
  
  // Strategy 4: Look for stock IDs in JSON/data attributes (common in SPAs)
  // Pattern: "stockId": 12345 or data-stock-id="12345" or :stock-id="12345"
  const jsonStockPattern = /(?:"stockId"|"stock_id"|"itemId"|data-stock-id=|:stock-id=)["']?(\d{7,})/gi;
  
  while ((match = jsonStockPattern.exec(content)) !== null) {
    const stockId = match[1];
    if (seen.has(stockId)) continue;
    
    // Construct a detail URL from stock ID
    const detailUrl = `https://www.pickles.com.au/used/details/cars/vehicle/${stockId}`;
    seen.add(stockId);
    urls.push({
      detail_url: detailUrl,
      source_listing_id: stockId,
      page_no: pageNo,
    });
  }
  
  // Strategy 5: Fallback full URL regex for any pickles detail links in text
  const fallbackPattern = /https:\/\/www\.pickles\.com\.au\/used\/(?:details|item)\/cars\/[^\s"'<>?#]+[/-](\d+)/gi;
  
  while ((match = fallbackPattern.exec(content)) !== null) {
    const result = normalizeDetailUrl(match[0]);
    if (!result || seen.has(result.stockId)) continue;
    
    seen.add(result.stockId);
    urls.push({
      detail_url: result.url,
      source_listing_id: result.stockId,
      page_no: pageNo,
    });
  }
  
  return urls;
}

// Build search URL with proper LOB path pattern
// CRITICAL: Use /used/search/lob/cars-motorcycles/cars/{make}/{model} format
function buildSearchUrl(baseUrl: string, page: number, yearMin?: number): string {
  const url = new URL(baseUrl);
  
  // Preserve existing query params from baseUrl (if any)
  const params = new URLSearchParams(url.search);
  
  // Required params for proper results
  params.set("contentkey", "all-cars");
  params.set("limit", "120");
  params.set("page", String(page));
  params.set("sort", "endDate asc"); // Stable sort: closing soon first
  
  // Buy method filter (auction opportunities only)
  if (!params.has("buyMethod")) {
    params.set("buyMethod", "Pickles Online,Pickles Live");
  }
  
  if (yearMin && !params.has("year-min")) {
    params.set("year-min", String(yearMin));
  }
  
  // Return with preserved pathname (includes make/model from LOB path)
  return `${url.origin}${url.pathname}?${params.toString()}`;
}

// Build base LOB search URL for make/model
function buildLobSearchUrl(make?: string, model?: string): string {
  const base = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
  
  if (make && model) {
    const normMake = make.toLowerCase().trim().replace(/\s+/g, "-");
    const normModel = model.toLowerCase().trim().replace(/\s+/g, "-");
    return `${base}/${normMake}/${normModel}`;
  } else if (make) {
    const normMake = make.toLowerCase().trim().replace(/\s+/g, "-");
    return `${base}/${normMake}`;
  }
  
  return base;
}

// Fetch HTML directly (no headless browser needed - content is server-rendered)
async function fetchSearchPage(url: string): Promise<{ html: string; status: number; error?: string }> {
  try {
    console.log(`[FETCH] Requesting: ${url}`);
    
    const response = await fetch(url, {
      method: "GET",
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    
    const status = response.status;
    console.log(`[FETCH] Status: ${status}`);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { 
        html: "", 
        status, 
        error: `HTTP ${status}: ${errorText.substring(0, 200)}` 
      };
    }
    
    const html = await response.text();
    console.log(`[FETCH] HTML length: ${html.length}`);
    
    return { html, status };
  } catch (err) {
    console.error(`[FETCH] Error:`, err);
    return { 
      html: "", 
      status: 0, 
      error: err instanceof Error ? err.message : String(err) 
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
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

    // Build base search URL using LOB path pattern
    let baseSearchUrl = search_url;
    if (!baseSearchUrl) {
      baseSearchUrl = buildLobSearchUrl(make, model);
    }

    // Create harvest run record
    const runId = crypto.randomUUID();
    await supabase.from("pickles_harvest_runs").insert({
      id: runId,
      search_url: baseSearchUrl,
      status: "running",
    });

    console.log(`[HARVEST] Starting run ${runId}`);
    console.log(`[HARVEST] Base URL (LOB pattern): ${baseSearchUrl}`);

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
          note: "Using direct fetch with LOB URL pattern",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Harvest pages using direct fetch
    const allUrls: HarvestedUrl[] = [];
    const errors: string[] = [];
    let pagesCrawled = 0;
    let consecutiveEmpty = 0;

    for (let page = 1; page <= max_pages && consecutiveEmpty < 2; page++) {
      const pageUrl = buildSearchUrl(baseSearchUrl, page, year_min);
      console.log(`[HARVEST] Page ${page}: ${pageUrl}`);

      const { html, status, error } = await fetchSearchPage(pageUrl);
      
      if (error) {
        console.error(`[HARVEST] Page ${page} fetch error:`, error);
        errors.push(`Page ${page}: ${error}`);
        
        // Check for rate limiting / blocking
        if (status === 403 || status === 429 || status === 503) {
          console.warn(`[HARVEST] Possible blocking detected (${status}), backing off...`);
          await new Promise(r => setTimeout(r, 5000));
        }
        
        consecutiveEmpty++;
        continue;
      }
      
      // Debug: log content stats
      console.log(`[HARVEST] Page ${page} HTML length: ${html.length}`);
      
      // Debug: check for any pickles detail URLs in raw content
      const rawDetailMatches = (html.match(/\/used\/details\/cars\//g) || []).length;
      const rawItemMatches = (html.match(/\/used\/item\//g) || []).length;
      const stockIdMatches = (html.match(/stockId/gi) || []).length;
      console.log(`[HARVEST] Page ${page} patterns: details=${rawDetailMatches}, items=${rawItemMatches}, stockId=${stockIdMatches}`);
      
      // Debug: log a sample of the HTML around listing areas
      const listingAreaMatch = html.match(/<div[^>]*class="[^"]*(?:listing|card|result|vehicle)[^"]*"[^>]*>/i);
      if (listingAreaMatch) {
        const idx = html.indexOf(listingAreaMatch[0]);
        console.log(`[HARVEST] Page ${page} listing area sample:`, html.substring(idx, idx + 500).replace(/\n/g, ' '));
      }

      const pageUrls = extractDetailUrls(html, page);
      console.log(`[HARVEST] Page ${page}: ${pageUrls.length} detail URLs extracted`);

      if (pageUrls.length === 0) {
        // Check if we got a valid page but no results (end of pagination)
        const hasNoResults = html.includes("no results") || html.includes("No vehicles found") || html.includes("0 results");
        if (hasNoResults) {
          console.log(`[HARVEST] Page ${page}: No results found, ending pagination`);
          break;
        }
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        allUrls.push(...pageUrls);
      }

      pagesCrawled++;
      
      // Rate limit between requests (be polite)
      await new Promise(r => setTimeout(r, 1000));
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
