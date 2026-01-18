import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Pickles Outward Crawl - Deterministic auction discovery
 * 
 * Uses Firecrawl CRAWL (not search) to deterministically find all Pickles
 * listing detail pages for a given make/model.
 * 
 * Strategy:
 * 1. Build start URL: https://www.pickles.com.au/used/search/cars/{make}/{model}
 * 2. Crawl with includePaths: ["/used/details/"]
 * 3. Only accept URLs matching detail pattern (ends in digits)
 * 4. Insert into hunt_external_candidates with proper canonical_id
 * 5. Call rpc_build_unified_candidates to update UI
 * 
 * Fallback: If crawl returns <10 results, manually paginate the search page
 */

// Regex: /used/details/.../{stockId} where stockId is digits
const PICKLES_DETAIL_PATTERN = /\/used\/details\/.*\/(\d+)$/;

interface PicklesCandidate {
  url: string;
  stockId: string;
  title: string;
  snippet: string;
  year: number | null;
  make: string;
  model: string;
  price: number | null;
  km: number | null;
  location: string | null;
}

// Extract stock ID from Pickles detail URL
function extractStockId(url: string): string | null {
  const match = url.match(PICKLES_DETAIL_PATTERN);
  return match ? match[1] : null;
}

// Parse year from text
function parseYear(text: string): number | null {
  const match = text.match(/\b(19[89]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

// Parse price from text
function parsePrice(text: string): number | null {
  const match = text.match(/\$\s*([\d,]+)/);
  if (match) {
    const price = parseInt(match[1].replace(/,/g, ''), 10);
    return price >= 1000 && price <= 500000 ? price : null;
  }
  return null;
}

// Parse km from text
function parseKm(text: string): number | null {
  const match = text.match(/([\d,]+)\s*(?:km|kms|kilometres)/i);
  if (match) {
    const km = parseInt(match[1].replace(/,/g, ''), 10);
    return km >= 0 && km <= 999999 ? km : null;
  }
  return null;
}

// Parse location/state from text
function parseLocation(text: string): string | null {
  const stateMatch = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  return stateMatch ? stateMatch[1].toUpperCase() : null;
}

// Build the Pickles search URL for a make/model
function buildPicklesSearchUrl(make: string, model: string): string {
  // Normalize: lowercase, replace spaces with dashes
  const normMake = make.toLowerCase().trim().replace(/\s+/g, '-');
  const normModel = model.toLowerCase().trim().replace(/\s+/g, '-');
  return `https://www.pickles.com.au/used/search/cars/${normMake}/${normModel}`;
}

// Extract all detail page URLs from a search results page (for pagination fallback)
function extractDetailUrlsFromPage(content: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https:\/\/www\.pickles\.com\.au\/used\/details\/[^\s"'<>]+\/\d+/gi;
  const matches = content.matchAll(urlPattern);
  
  for (const match of matches) {
    const url = match[0];
    if (PICKLES_DETAIL_PATTERN.test(url) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  
  return urls;
}

// Parse candidates from crawl data
function parseCrawlData(crawlData: any[], make: string, model: string): PicklesCandidate[] {
  const candidates: PicklesCandidate[] = [];
  const seen = new Set<string>();

  for (const page of crawlData) {
    const url = page.url || page.sourceURL || '';
    const stockId = extractStockId(url);
    
    if (!stockId || seen.has(stockId)) continue;
    seen.add(stockId);
    
    const markdown = page.markdown || '';
    const metadata = page.metadata || {};
    const title = metadata.title || '';
    const description = metadata.description || '';
    const fullText = `${title} ${description} ${markdown}`;
    
    candidates.push({
      url,
      stockId,
      title: title || `${make} ${model} (Stock: ${stockId})`,
      snippet: description || fullText.slice(0, 300),
      year: parseYear(fullText),
      make,
      model,
      price: parsePrice(fullText),
      km: parseKm(fullText),
      location: parseLocation(fullText),
    });
  }
  
  return candidates;
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
    const { hunt_id, debug = false } = await req.json();

    if (!hunt_id) {
      return new Response(
        JSON.stringify({ success: false, error: "hunt_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load hunt
    const { data: hunt, error: huntErr } = await supabase
      .from('sale_hunts')
      .select('*')
      .eq('id', hunt_id)
      .single();

    if (huntErr || !hunt) {
      return new Response(
        JSON.stringify({ success: false, error: "Hunt not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const make = hunt.make || '';
    const model = hunt.model || '';
    const criteriaVersion = hunt.criteria_version || 1;
    
    console.log(`[PICKLES-CRAWL] Starting for ${make} ${model} (hunt: ${hunt_id}, version: ${criteriaVersion})`);

    const startUrl = buildPicklesSearchUrl(make, model);
    console.log(`[PICKLES-CRAWL] Start URL: ${startUrl}`);

    // ===========================================
    // STEP 1: Try Firecrawl crawl first
    // ===========================================
    let candidates: PicklesCandidate[] = [];
    let crawlSuccess = false;
    let crawlJobId: string | null = null;

    const crawlPayload = {
      url: startUrl,
      limit: 150,
      maxDepth: 2,
      allowBackwardLinks: false,
      allowExternalLinks: false,
      includePaths: ["/used/details/"],
      excludePaths: ["/blog/", "/news/", "/review", "/guide", "/spec", "/used/search/", "/login", "/register"],
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 1500,
      },
    };

    console.log(`[PICKLES-CRAWL] Firecrawl payload:`, JSON.stringify(crawlPayload, null, 2));

    if (debug) {
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          hunt_id,
          make,
          model,
          start_url: startUrl,
          crawl_payload: crawlPayload,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Start crawl job
    const crawlRes = await fetch("https://api.firecrawl.dev/v1/crawl", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(crawlPayload),
    });

    if (crawlRes.ok) {
      const crawlJob = await crawlRes.json();
      crawlJobId = crawlJob.id;
      console.log(`[PICKLES-CRAWL] Crawl job started: ${crawlJobId}`);

      // Poll for completion (max 60s)
      const pollStart = Date.now();
      const maxPollTime = 60000;
      
      while (Date.now() - pollStart < maxPollTime) {
        await new Promise(r => setTimeout(r, 3000));
        
        const statusRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlJobId}`, {
          headers: { "Authorization": `Bearer ${firecrawlKey}` },
        });
        
        if (!statusRes.ok) {
          console.error(`[PICKLES-CRAWL] Status check failed: ${statusRes.status}`);
          break;
        }
        
        const statusData = await statusRes.json();
        console.log(`[PICKLES-CRAWL] Status: ${statusData.status}, completed: ${statusData.completed}/${statusData.total}`);
        
        if (statusData.status === 'completed') {
          const crawledPages = statusData.data || [];
          candidates = parseCrawlData(crawledPages, make, model);
          crawlSuccess = true;
          console.log(`[PICKLES-CRAWL] Crawl completed: ${candidates.length} candidates found`);
          break;
        }
        
        if (statusData.status === 'failed') {
          console.error(`[PICKLES-CRAWL] Crawl job failed`);
          break;
        }
      }
    } else {
      console.error(`[PICKLES-CRAWL] Crawl request failed: ${crawlRes.status}`);
    }

    // ===========================================
    // STEP 2: Fallback - Manual pagination if crawl got <10 results
    // ===========================================
    if (candidates.length < 10) {
      console.log(`[PICKLES-CRAWL] Crawl returned ${candidates.length} results, trying manual pagination fallback`);
      
      const existingStockIds = new Set(candidates.map(c => c.stockId));
      const maxPages = 8;
      
      for (let page = 1; page <= maxPages; page++) {
        const pageUrl = page === 1 ? startUrl : `${startUrl}?page=${page}`;
        
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
              waitFor: 2000,
            }),
          });

          if (!scrapeRes.ok) {
            console.log(`[PICKLES-CRAWL] Page ${page} scrape failed: ${scrapeRes.status}`);
            break;
          }

          const scrapeData = await scrapeRes.json();
          const content = (scrapeData.data?.html || '') + '\n' + (scrapeData.data?.markdown || '');
          
          const detailUrls = extractDetailUrlsFromPage(content);
          console.log(`[PICKLES-CRAWL] Page ${page}: found ${detailUrls.length} detail URLs`);
          
          if (detailUrls.length === 0) {
            console.log(`[PICKLES-CRAWL] No more results on page ${page}, stopping pagination`);
            break;
          }
          
          for (const url of detailUrls) {
            const stockId = extractStockId(url);
            if (stockId && !existingStockIds.has(stockId)) {
              existingStockIds.add(stockId);
              candidates.push({
                url,
                stockId,
                title: `${make} ${model} (Stock: ${stockId})`,
                snippet: '',
                year: null,
                make,
                model,
                price: null,
                km: null,
                location: null,
              });
            }
          }
          
          // Rate limit
          await new Promise(r => setTimeout(r, 1000));
          
        } catch (err) {
          console.error(`[PICKLES-CRAWL] Page ${page} error:`, err);
          break;
        }
      }
      
      console.log(`[PICKLES-CRAWL] After pagination: ${candidates.length} total candidates`);
    }

    // ===========================================
    // STEP 3: Upsert candidates into hunt_external_candidates
    // ===========================================
    let inserted = 0;
    let errors = 0;

    for (const candidate of candidates) {
      try {
        const canonicalId = `pickles:${candidate.stockId}`;
        
        // Get listing intent from SQL function
        const { data: intentData } = await supabase.rpc('fn_classify_listing_intent', {
          p_url: candidate.url,
          p_title: candidate.title,
          p_snippet: candidate.snippet,
        });
        const intentObj = intentData || { intent: 'listing', reason: 'PICKLES_CRAWL' };
        
        const { error: upsertErr } = await supabase
          .from('hunt_external_candidates')
          .upsert({
            hunt_id,
            criteria_version: criteriaVersion,
            source_url: candidate.url,
            source_name: 'pickles',
            canonical_id: canonicalId,
            dedup_key: canonicalId,
            title: candidate.title,
            raw_snippet: candidate.snippet,
            year: candidate.year,
            make: candidate.make,
            model: candidate.model,
            km: candidate.km,
            asking_price: candidate.price,
            location: candidate.location,
            confidence: 'high',
            decision: 'DISCOVERED',
            is_listing: true,
            listing_kind: 'auction_lot',
            page_type: 'listing',
            reject_reason: null,
            is_stale: false,
            listing_intent: intentObj.intent,
            listing_intent_reason: intentObj.reason,
            source_tier: 1, // Auction = tier 1
          }, { onConflict: 'hunt_id,criteria_version,canonical_id' });

        if (upsertErr) {
          console.error(`[PICKLES-CRAWL] Upsert error for ${canonicalId}:`, upsertErr);
          errors++;
        } else {
          inserted++;
        }
      } catch (err) {
        console.error(`[PICKLES-CRAWL] Error processing candidate:`, err);
        errors++;
      }
    }

    console.log(`[PICKLES-CRAWL] Upserted ${inserted} candidates (${errors} errors)`);

    // ===========================================
    // STEP 4: Rebuild unified candidates so UI updates
    // ===========================================
    const { data: buildResult, error: buildErr } = await supabase.rpc('rpc_build_unified_candidates', {
      p_hunt_id: hunt_id,
    });

    if (buildErr) {
      console.error(`[PICKLES-CRAWL] Failed to rebuild unified candidates:`, buildErr);
    } else {
      console.log(`[PICKLES-CRAWL] Unified candidates rebuilt:`, buildResult);
    }

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        hunt_id,
        make,
        model,
        start_url: startUrl,
        crawl_job_id: crawlJobId,
        crawl_success: crawlSuccess,
        candidates_found: candidates.length,
        candidates_inserted: inserted,
        errors,
        unified_build_result: buildResult,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[PICKLES-CRAWL] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
