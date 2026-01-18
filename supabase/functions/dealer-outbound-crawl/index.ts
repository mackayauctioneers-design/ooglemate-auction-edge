import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Dealer Outbound Crawl - Tier 3 Discovery
 * 
 * Crawls dealer websites for inventory listings matching active hunts.
 * Uses Firecrawl map/scrape with allowlist filtering.
 */

// DETAIL-ONLY patterns for valid listing URLs
// These must include an individual vehicle identifier (stock code, ID, etc.)
const LISTING_URL_PATTERNS = [
  // Detail pages with explicit ID/stock patterns
  /^https?:\/\/[^\/]+\/(?:stock|inventory|vehicles?|details?|used-vehicles?|car|listing)\/[a-z0-9_-]{4,}(?:\/|\?|$)/i,
  // Toyota-style detail pages with stock codes
  /^https?:\/\/[^\/]+\/vehicle-inventory\/details\/[a-z0-9_-]+/i,
  // Pages with numeric stock IDs in path
  /^https?:\/\/[^\/]+\/.*[-_](\d{5,}|[A-Z]{2,4}\d{3,})(?:\/|\?|$)/i,
];

// AGGRESSIVE exclusion patterns - reject search/category/grid pages
const EXCLUDE_PATTERNS = [
  /\/search\b/i,
  /\/results\b/i,
  /\/filter\b/i,
  /\/compare\b/i,
  /\/blog\b/i,
  /\/news\b/i,
  /\/about\b/i,
  /\/contact\b/i,
  /\/login\b/i,
  /\/signup\b/i,
  /\/register\b/i,
  /\/account\b/i,
  /\/cart\b/i,
  /\/checkout\b/i,
  /\/service\b/i,
  /\/parts\b/i,
  /\/finance\b/i,
  /\/special/i,
  /\/new-?cars?\b/i,
  /\/demo\b/i,
  /page=\d/i,
  /[\?&]sort=/i,
  /[\?&]order=/i,
  /[\?&]make=/i,
  /[\?&]model=/i,
  /[\?&]year=/i,
  // NEW: Reject category/grid pages without individual IDs
  /\/used-?cars?\/?$/i,        // Bare /used-cars/ is a grid
  /\/pre-owned\/?$/i,          // Bare /pre-owned/ is a grid
  /\/inventory\/?$/i,          // Bare /inventory/ is a grid  
  /\/vehicles?\/?$/i,          // Bare /vehicles/ is a grid
  /\/all-?stock\/?$/i,
  /\/browse\/?/i,
];

interface DealerCandidate {
  url: string;
  title: string;
  snippet: string;
  canonicalId: string;
  year?: number | null;
  km?: number | null;
  price?: number | null;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Remove tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 
     'fbclid', 'gclid', 'msclkid', '_ga', 'ref'].forEach(p => u.searchParams.delete(p));
    // Normalize path
    let path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  }
}

function isValidListingUrl(url: string): boolean {
  // First check exclusions
  if (EXCLUDE_PATTERNS.some(p => p.test(url))) {
    return false;
  }
  // Then check allowlist - must have a detail identifier
  const hasDetailId = /\/[a-z0-9_-]{6,}(?:\/|\?|$)/i.test(url) || 
                      /[-_](\d{5,}|[A-Z]{2,4}\d{3,})/i.test(url);
  if (!hasDetailId) {
    return false;
  }
  return LISTING_URL_PATTERNS.some(p => p.test(url));
}

function extractStockId(url: string): string | null {
  // Pattern: /stock/ABC123, /inventory/12345, /vehicles/XYZ-789, /details/STOCK123
  const patterns = [
    /\/(?:stock|inventory|vehicles?|details?|listings?)\/([A-Za-z0-9_-]{3,20})(?:\/|\?|$)/i,
    /[-_]([A-Z]{2,4}\d{3,8})(?:\/|\?|$)/i,  // Pattern like -ABC12345
    /\/(\d{5,10})(?:\/|\?|$)/,  // Numeric IDs
  ];
  
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function parseYear(text: string): number | null {
  const m = text.match(/\b(20[1-2]\d)\b/);
  return m ? parseInt(m[1]) : null;
}

function parseKm(text: string): number | null {
  const patterns = [
    /(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometres?)/i,
    /(?:km|kms|odometer)[:\s]*(\d{1,3}(?:,\d{3})*|\d+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseInt(m[1].replace(/,/g, ''));
      if (val > 100 && val < 1000000) return val;
    }
  }
  return null;
}

function parsePrice(text: string): number | null {
  const patterns = [
    /\$\s*(\d{1,3}(?:,\d{3})*|\d+)/,
    /(\d{1,3}(?:,\d{3})+)\s*(?:drive\s*away|driveaway|price)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseInt(m[1].replace(/,/g, ''));
      if (val > 5000 && val < 500000) return val;
    }
  }
  return null;
}

function extractDealerSlug(domain: string): string {
  // Convert domain to slug: pattersoncheneytoyota.com.au -> patterson-cheney
  return domain
    .replace(/\.com\.au$|\.com$|\.net\.au$/, '')
    .replace(/toyota|motors?|autos?|group|dealer/gi, '')
    .replace(/\./g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json().catch(() => ({}));
    
    const { hunt_id, dealer_id, test_mode } = body;

    // If hunt_id provided, process for that hunt
    // If dealer_id provided, process just that dealer for all active hunts
    // If neither, process all enabled hunts with dealer_outbound_enabled

    console.log("Dealer outbound crawl starting:", { hunt_id, dealer_id, test_mode });

    // Get dealers to crawl
    let dealerQuery = supabase
      .from('dealer_outbound_sources')
      .select('*')
      .eq('enabled', true)
      .order('priority', { ascending: false })
      .order('last_crawl_at', { ascending: true, nullsFirst: true });

    if (dealer_id) {
      dealerQuery = dealerQuery.eq('id', dealer_id);
    }

    if (test_mode) {
      dealerQuery = dealerQuery.limit(5);
    } else {
      dealerQuery = dealerQuery.limit(20);
    }

    const { data: dealers, error: dealersErr } = await dealerQuery;

    if (dealersErr) throw dealersErr;
    if (!dealers?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No dealers to crawl" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get active hunts with dealer_outbound_enabled
    let huntsQuery = supabase
      .from('sale_hunts')
      .select('id, make, model, year, criteria_version')
      .eq('status', 'active')
      .eq('dealer_outbound_enabled', true);

    if (hunt_id) {
      huntsQuery = supabase
        .from('sale_hunts')
        .select('id, make, model, year, criteria_version')
        .eq('id', hunt_id);
    }

    const { data: hunts, error: huntsErr } = await huntsQuery;

    if (huntsErr) throw huntsErr;
    if (!hunts?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No hunts with dealer_outbound enabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${dealers.length} dealers for ${hunts.length} hunts`);

    const results: {
      dealer: string;
      urls_found: number;
      candidates_matched: number;
      errors: string[];
    }[] = [];

    // Process each dealer
    for (const dealer of dealers) {
      const dealerResult = {
        dealer: dealer.dealer_name,
        urls_found: 0,
        candidates_matched: 0,
        errors: [] as string[],
      };

      try {
        const baseUrl = `https://${dealer.dealer_domain}${dealer.inventory_path}`;
        console.log(`Crawling dealer: ${dealer.dealer_name} at ${baseUrl}`);

        // Step 1: Map the site to find all URLs
        const mapResponse = await fetch('https://api.firecrawl.dev/v1/map', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: baseUrl,
            limit: 100,
            includeSubdomains: false,
          }),
        });

        if (!mapResponse.ok) {
          const errText = await mapResponse.text();
          dealerResult.errors.push(`Map failed: ${mapResponse.status} - ${errText}`);
          
          // Mark failure
          await supabase
            .from('dealer_outbound_sources')
            .update({
              last_crawl_at: new Date().toISOString(),
              last_crawl_error: `Map failed: ${mapResponse.status}`,
              consecutive_failures: dealer.consecutive_failures + 1,
            })
            .eq('id', dealer.id);
            
          results.push(dealerResult);
          continue;
        }

        const mapData = await mapResponse.json();
        const allUrls: string[] = mapData.links || mapData.data?.links || [];
        
        console.log(`Map found ${allUrls.length} URLs for ${dealer.dealer_name}`);
        dealerResult.urls_found = allUrls.length;

        // Filter to valid listing URLs
        const validUrls = allUrls.filter(isValidListingUrl);
        console.log(`Filtered to ${validUrls.length} valid listing URLs`);

        if (validUrls.length === 0) {
          dealerResult.errors.push("No valid listing URLs found after filtering");
          
          await supabase
            .from('dealer_outbound_sources')
            .update({
              last_crawl_at: new Date().toISOString(),
              last_crawl_count: 0,
              last_crawl_error: "No valid listing URLs found",
            })
            .eq('id', dealer.id);
            
          results.push(dealerResult);
          continue;
        }

        // Step 2: Batch scrape the valid URLs (limit to 20 to control costs)
        const urlsToScrape = validUrls.slice(0, 20);
        const candidates: DealerCandidate[] = [];

        for (const url of urlsToScrape) {
          try {
            const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url,
                formats: ['markdown'],
                onlyMainContent: true,
                waitFor: 3000,  // Wait for JS to load
              }),
            });

            if (!scrapeResponse.ok) {
              console.warn(`Scrape failed for ${url}: ${scrapeResponse.status}`);
              continue;
            }

            const scrapeData = await scrapeResponse.json();
            const content = scrapeData.data?.markdown || scrapeData.markdown || '';
            const title = scrapeData.data?.metadata?.title || scrapeData.metadata?.title || '';
            
            if (!content && !title) continue;

            const normalizedUrl = normalizeUrl(url);
            const stockId = extractStockId(normalizedUrl);
            const dealerSlug = dealer.dealer_slug || extractDealerSlug(dealer.dealer_domain);
            
            // Build canonical ID
            const canonicalId = stockId 
              ? `${dealerSlug}:${stockId}`
              : `${dealerSlug}:${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedUrl))
                  .then(h => Array.from(new Uint8Array(h)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join(''))}`;

            candidates.push({
              url: normalizedUrl,
              title,
              snippet: content.slice(0, 500),
              canonicalId,
              year: parseYear(title + ' ' + content),
              km: parseKm(content),
              price: parsePrice(content),
            });

          } catch (scrapeErr) {
            console.warn(`Error scraping ${url}:`, scrapeErr);
          }
        }

        console.log(`Extracted ${candidates.length} candidates from ${dealer.dealer_name}`);

        // Step 3: Match candidates against hunts and insert
        for (const hunt of hunts) {
          const matchingCandidates = candidates.filter(c => {
            // Basic make/model match in title
            const text = (c.title + ' ' + c.snippet).toLowerCase();
            const makeMatch = text.includes(hunt.make.toLowerCase());
            const modelMatch = text.includes(hunt.model.toLowerCase());
            
            // Year check if available (hunt.year is target year, allow +/- 2 years)
            const yearOk = !c.year || !hunt.year || 
              (c.year >= (hunt.year - 2) && c.year <= (hunt.year + 2));

            return makeMatch && modelMatch && yearOk;
          });

          console.log(`Hunt ${hunt.id}: ${matchingCandidates.length} matches from ${dealer.dealer_name}`);

          for (const candidate of matchingCandidates) {
            try {
              const { error: upsertErr } = await supabase
                .from('hunt_external_candidates')
                .upsert({
                  hunt_id: hunt.id,
                  criteria_version: hunt.criteria_version,
                  source_url: candidate.url,
                  source_name: dealer.dealer_slug || dealer.dealer_domain.split('.')[0],
                  canonical_id: candidate.canonicalId,
                  dedup_key: candidate.canonicalId,
                  title: candidate.title,
                  raw_snippet: candidate.snippet,
                  year: candidate.year,
                  make: hunt.make,
                  model: hunt.model,
                  km: candidate.km,
                  asking_price: candidate.price,
                  source_tier: 3,
                  listing_intent: 'listing',  // Forced for allowlist matches
                  intent_reason: 'DEALER_OUTBOUND_ALLOWLIST',
                  is_stale: false,
                  discovered_at: new Date().toISOString(),
                }, {
                  onConflict: 'hunt_id,criteria_version,canonical_id',
                  ignoreDuplicates: false,
                });

              if (upsertErr) {
                console.warn(`Upsert error for ${candidate.canonicalId}:`, upsertErr.message);
              } else {
                dealerResult.candidates_matched++;
              }
            } catch (insertErr) {
              console.warn(`Insert error:`, insertErr);
            }
          }
        }

        // Update dealer status
        await supabase
          .from('dealer_outbound_sources')
          .update({
            last_crawl_at: new Date().toISOString(),
            last_crawl_count: candidates.length,
            last_crawl_error: null,
            consecutive_failures: 0,
          })
          .eq('id', dealer.id);

      } catch (dealerErr) {
        const errMsg = dealerErr instanceof Error ? dealerErr.message : String(dealerErr);
        dealerResult.errors.push(errMsg);
        console.error(`Error processing dealer ${dealer.dealer_name}:`, errMsg);

        await supabase
          .from('dealer_outbound_sources')
          .update({
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: errMsg,
            consecutive_failures: dealer.consecutive_failures + 1,
          })
          .eq('id', dealer.id);
      }

      results.push(dealerResult);
    }

    // Trigger unified rebuild for affected hunts
    const huntsToRebuild = hunt_id ? [hunt_id] : hunts.map(h => h.id);
    for (const hid of huntsToRebuild) {
      try {
        await supabase.rpc('rpc_build_unified_candidates', { p_hunt_id: hid });
      } catch (rebuildErr) {
        console.warn(`Failed to rebuild unified for hunt ${hid}:`, rebuildErr);
      }
    }

    const totalCandidates = results.reduce((sum, r) => sum + r.candidates_matched, 0);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: Date.now() - startTime,
        dealers_processed: results.length,
        total_candidates: totalCandidates,
        hunts_rebuilt: huntsToRebuild.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Dealer outbound crawl error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
