import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES STUB INGEST - Lane 1: High-volume stub anchor creation
 * 
 * Fetches list pages from Pickles NSW, extracts minimal stub data,
 * and upserts to stub_anchors table. Runs hourly.
 * 
 * Endpoint: https://www.pickles.com.au/used/search/cars/state/nsw
 * Pagination: ?limit=120&page=N
 * 
 * FIX #6: Pagination stops when page yields no NEW stock_ids (not HTML heuristics)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

interface StubAnchor {
  source_stock_id: string | null;
  detail_url: string;
  year: number | null;
  make: string | null;
  model: string | null;
  km: number | null;
  location: string | null;
  raw_text: string | null;
}

interface RunMetrics {
  pages_fetched: number;
  stubs_found: number;
  stubs_created: number;
  stubs_updated: number;
  exceptions_queued: number;
  new_stock_ids_per_page: Record<number, number>;
  errors: { page: number; error: string }[];
}

function buildSearchUrl(page: number, limit = 120, region = "nsw"): string {
  const base = `https://www.pickles.com.au/used/search/cars/state/${region}`;
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  });
  return `${base}?${params.toString()}`;
}

// Extract stock ID - MUST be present, no UUID fallback
function extractStockId(url: string): string | null {
  // Pattern 1: UUID format at end: /used/details/cars/{slug}/{uuid}
  const uuidMatch = url.match(/\/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})$/i);
  if (uuidMatch) return uuidMatch[1].toUpperCase();
  
  // Pattern 2: Numeric ID at end: /used/details/cars/{slug}/{id}
  const numMatch = url.match(/\/(\d{6,})$/);
  if (numMatch) return numMatch[1];
  
  // Pattern 3: /used/item/cars/{slug}-{id}
  const itemMatch = url.match(/\/used\/item\/cars\/[^\/]+-(\d+)/);
  if (itemMatch) return itemMatch[1];
  
  return null;
}

function parseStubFromCard(cardHtml: string, detailUrl: string): StubAnchor {
  // Extract year/make/model from URL slug: /used/details/cars/2017-toyota-rav4/{id}
  const urlSlugMatch = detailUrl.match(/\/used\/details\/cars\/(\d{4})-([a-z0-9-]+)\/([A-Z0-9-]+)/i);
  
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  
  if (urlSlugMatch) {
    year = parseInt(urlSlugMatch[1]);
    const slugParts = urlSlugMatch[2].split('-');
    
    if (slugParts.length >= 1) {
      make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
    }
    if (slugParts.length >= 2) {
      model = slugParts.slice(1).map(p => 
        p.charAt(0).toUpperCase() + p.slice(1)
      ).join(' ');
    }
  }
  
  // Fallback year from HTML
  if (!year) {
    const yearMatch = cardHtml.match(/\b(19|20)\d{2}\b/);
    year = yearMatch ? parseInt(yearMatch[0]) : null;
  }
  
  // Extract KM
  const kmMatch = cardHtml.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*km/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, '')) : null;
  
  // Extract location
  const locationMatch = cardHtml.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i);
  const location = locationMatch ? locationMatch[0] : null;
  
  // Stock ID must come from URL end segment
  const stockId = extractStockId(detailUrl);
  
  return {
    source_stock_id: stockId,
    detail_url: detailUrl.startsWith('http') ? detailUrl : `https://www.pickles.com.au${detailUrl}`,
    year,
    make,
    model,
    km,
    location,
    raw_text: cardHtml.substring(0, 500),
  };
}

function extractListingsFromHtml(html: string): StubAnchor[] {
  const stubs: StubAnchor[] = [];
  const seen = new Set<string>();
  
  const linkRegex = /href="(\/used\/details\/cars\/[^"]+)"/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    
    const pos = match.index;
    const cardContext = html.substring(Math.max(0, pos - 300), Math.min(html.length, pos + 500));
    
    const stub = parseStubFromCard(cardContext, url);
    stubs.push(stub);
  }
  
  const itemRegex = /href="(\/used\/item\/cars\/[^"]+)"/gi;
  while ((match = itemRegex.exec(html)) !== null) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    
    const pos = match.index;
    const cardContext = html.substring(Math.max(0, pos - 300), Math.min(html.length, pos + 500));
    
    const stub = parseStubFromCard(cardContext, url);
    stubs.push(stub);
  }
  
  return stubs;
}

async function fetchPage(url: string, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
      });
      
      if (!response.ok) {
        console.warn(`[STUB] Page fetch failed: ${response.status} for ${url}`);
        if (response.status === 403 || response.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      
      return await response.text();
    } catch (e) {
      console.error(`[STUB] Fetch error attempt ${attempt + 1}:`, e);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return null;
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
      region = "nsw",
      max_pages = 10,
      limit = 120,
      start_page = 1,
      dry_run = false,
    } = body;

    console.log(`[STUB] Starting Pickles stub ingest: region=${region}, pages=${start_page}-${start_page + max_pages - 1}`);

    let runId: string | null = null;
    if (!dry_run) {
      const { data: run } = await supabase
        .from("stub_ingest_runs")
        .insert({ source: "pickles", region, status: "running" })
        .select("id")
        .single();
      runId = run?.id;
    }

    const metrics: RunMetrics = {
      pages_fetched: 0,
      stubs_found: 0,
      stubs_created: 0,
      stubs_updated: 0,
      exceptions_queued: 0,
      new_stock_ids_per_page: {},
      errors: [],
    };

    // Track all seen stock IDs across pages
    const allSeenStockIds = new Set<string>();
    let currentPage = start_page;
    let consecutiveZeroNewPages = 0;

    while (currentPage < start_page + max_pages) {
      const url = buildSearchUrl(currentPage, limit, region);
      console.log(`[STUB] Fetching page ${currentPage}: ${url}`);

      const html = await fetchPage(url);
      
      if (!html) {
        metrics.errors.push({ page: currentPage, error: "Failed to fetch page" });
        currentPage++;
        continue;
      }

      metrics.pages_fetched++;

      const stubs = extractListingsFromHtml(html);
      console.log(`[STUB] Page ${currentPage}: found ${stubs.length} listings`);
      metrics.stubs_found += stubs.length;

      if (stubs.length === 0) {
        // No listings at all - end of results
        console.log(`[STUB] Page ${currentPage}: empty page, stopping`);
        break;
      }

      // FIX #6: Count NEW stock IDs only (not seen before)
      let newStockIds = 0;
      const validStubs: StubAnchor[] = [];
      
      for (const stub of stubs) {
        if (stub.source_stock_id && !allSeenStockIds.has(stub.source_stock_id)) {
          allSeenStockIds.add(stub.source_stock_id);
          newStockIds++;
          validStubs.push(stub);
        } else if (stub.source_stock_id) {
          // Duplicate within run - skip but count as seen
          validStubs.push(stub);
        }
        // Stubs without stock_id will be handled by RPC as exceptions
      }
      
      metrics.new_stock_ids_per_page[currentPage] = newStockIds;
      console.log(`[STUB] Page ${currentPage}: ${newStockIds} NEW stock IDs`);

      if (!dry_run && validStubs.length > 0) {
        const { data: result, error } = await supabase.rpc("upsert_stub_anchor_batch", {
          p_source: "pickles",
          p_stubs: validStubs,
        });

        if (error) {
          console.error(`[STUB] Batch upsert error:`, error);
          metrics.errors.push({ page: currentPage, error: error.message });
        } else if (result && result.length > 0) {
          metrics.stubs_created += result[0].created_count || 0;
          metrics.stubs_updated += result[0].updated_count || 0;
          metrics.exceptions_queued += result[0].exception_count || 0;
        }
      }

      // FIX #6: Stop when page yields no new stock_ids
      if (newStockIds === 0) {
        consecutiveZeroNewPages++;
        if (consecutiveZeroNewPages >= 2) {
          console.log(`[STUB] ${consecutiveZeroNewPages} consecutive pages with 0 new IDs, stopping`);
          break;
        }
      } else {
        consecutiveZeroNewPages = 0;
      }

      currentPage++;
      await new Promise(r => setTimeout(r, 500));
    }

    if (runId) {
      await supabase
        .from("stub_ingest_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "completed",
          pages_fetched: metrics.pages_fetched,
          stubs_found: metrics.stubs_found,
          stubs_created: metrics.stubs_created,
          stubs_updated: metrics.stubs_updated,
          exceptions_queued: metrics.exceptions_queued,
          errors: metrics.errors,
          metadata: { new_stock_ids_per_page: metrics.new_stock_ids_per_page },
          last_error: metrics.errors.length > 0 ? metrics.errors[metrics.errors.length - 1].error : null,
        })
        .eq("id", runId);
    }

    const duration = Date.now() - startTime;
    console.log(`[STUB] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        duration_ms: duration,
        metrics,
        dry_run,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[STUB] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
