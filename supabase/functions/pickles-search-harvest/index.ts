import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES SEARCH HARVESTER - Phase 1 of two-phase pipeline
 * 
 * Input: Search URL (optional, defaults to Cars & Motorcycles)
 * Output: pickles_detail_queue (URLs only)
 * 
 * Stores ONLY:
 * - detail_url (must match /used/details/cars/.../\d+)
 * - source_listing_id (the numeric stock ID)
 * - search_url (which search found this)
 * - page_no
 * - first_seen_at, last_seen_at
 * 
 * DOES NOT extract price/km/variant - that's the detail micro-crawler's job
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Regex: /used/details/cars/{slug}/{stockId} where stockId is digits
const PICKLES_DETAIL_PATTERN = /\/used\/details\/cars\/[^\/]+\/(\d+)/;

interface HarvestedUrl {
  detail_url: string;
  source_listing_id: string;
}

// Extract all detail page URLs from search results HTML/markdown
function extractDetailUrls(content: string): HarvestedUrl[] {
  const urls: HarvestedUrl[] = [];
  const seen = new Set<string>();
  
  // Pattern: full URL or relative path to detail page
  const patterns = [
    /https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s"'<>]+\/(\d+)/gi,
    /\/used\/details\/cars\/[^\s"'<>]+\/(\d+)/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const fullMatch = match[0];
      const stockId = match[1];
      
      if (!stockId || seen.has(stockId)) continue;
      seen.add(stockId);
      
      // Normalize to full URL
      const detailUrl = fullMatch.startsWith("http") 
        ? fullMatch 
        : `https://www.pickles.com.au${fullMatch}`;
      
      // Validate it matches detail pattern
      if (PICKLES_DETAIL_PATTERN.test(detailUrl)) {
        urls.push({
          detail_url: detailUrl,
          source_listing_id: stockId,
        });
      }
    }
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

    // Build search URL
    let baseSearchUrl = search_url;
    if (!baseSearchUrl) {
      if (make && model) {
        // Specific make/model search
        const normMake = make.toLowerCase().trim().replace(/\s+/g, "-");
        const normModel = model.toLowerCase().trim().replace(/\s+/g, "-");
        baseSearchUrl = `https://www.pickles.com.au/used/search/cars/${normMake}/${normModel}`;
      } else {
        // Default: all cars with auction buy methods
        baseSearchUrl = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
      }
    }

    // Add filters
    const filters: string[] = [];
    filters.push("limit=120");
    filters.push("sort=productLocation/suburb+desc");
    
    // Buy method filter: Pickles Online OR Pickles Live (auction opportunities)
    filters.push("filter=and[0][or][0][buyMethod]=Pickles Online&and[0][or][1][buyMethod]=Pickles Live");
    
    if (year_min) {
      filters.push(`year-min=${year_min}`);
    }

    const filterStr = filters.join("&");
    
    // Create harvest run record
    const runId = crypto.randomUUID();
    await supabase.from("pickles_harvest_runs").insert({
      id: runId,
      search_url: baseSearchUrl,
      status: "running",
    });

    console.log(`[HARVEST] Starting run ${runId}`);
    console.log(`[HARVEST] Base URL: ${baseSearchUrl}`);
    console.log(`[HARVEST] Filters: ${filterStr}`);

    if (debug) {
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          run_id: runId,
          base_url: baseSearchUrl,
          filters: filterStr,
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
      const pageUrl = `${baseSearchUrl}?${filterStr}&page=${page}`;
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
            waitFor: 5000, // Wait for Vue.js to render
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

        const pageUrls = extractDetailUrls(content);
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

    // Dedupe URLs
    const uniqueUrls = new Map<string, HarvestedUrl>();
    for (const url of allUrls) {
      if (!uniqueUrls.has(url.source_listing_id)) {
        uniqueUrls.set(url.source_listing_id, url);
      }
    }

    console.log(`[HARVEST] Total unique URLs: ${uniqueUrls.size}`);

    // Upsert to pickles_detail_queue
    let urlsNew = 0;
    let urlsExisting = 0;

    for (const [stockId, urlData] of uniqueUrls) {
      const { data: existing } = await supabase
        .from("pickles_detail_queue")
        .select("id")
        .eq("source", "pickles")
        .eq("source_listing_id", stockId)
        .maybeSingle();

      if (existing) {
        // Update last_seen_at
        await supabase
          .from("pickles_detail_queue")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", existing.id);
        urlsExisting++;
      } else {
        // Insert new
        const { error: insertErr } = await supabase
          .from("pickles_detail_queue")
          .insert({
            source: "pickles",
            detail_url: urlData.detail_url,
            source_listing_id: stockId,
            search_url: baseSearchUrl,
            page_no: null, // Could track this if needed
            run_id: runId,
            crawl_status: "pending",
          });

        if (insertErr) {
          console.error(`[HARVEST] Insert error for ${stockId}:`, insertErr.message);
          errors.push(`Insert ${stockId}: ${insertErr.message}`);
        } else {
          urlsNew++;
        }
      }
    }

    const duration = Date.now() - startTime;

    // Update run record
    await supabase.from("pickles_harvest_runs").update({
      pages_crawled: pagesCrawled,
      urls_harvested: uniqueUrls.size,
      urls_new: urlsNew,
      urls_existing: urlsExisting,
      errors: errors.length > 0 ? errors : null,
      duration_ms: duration,
      status: "completed",
    }).eq("id", runId);

    console.log(`[HARVEST] Completed: ${uniqueUrls.size} URLs (${urlsNew} new, ${urlsExisting} existing)`);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        search_url: baseSearchUrl,
        pages_crawled: pagesCrawled,
        urls_harvested: uniqueUrls.size,
        urls_new: urlsNew,
        urls_existing: urlsExisting,
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
