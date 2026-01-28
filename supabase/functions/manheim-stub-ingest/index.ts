import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MANHEIM STUB INGEST - Lane 1: High-volume stub anchor creation
 * 
 * Production hardened (following Pickles pattern):
 * - Uses Manheim resultpartial endpoint with pagination
 * - source_listing_id is numeric-only from /home/{ID}/... URL pattern
 * - Uses normalized make_norm/model_norm columns
 * - No UUID fallbacks
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
  "Referer": "https://www.manheim.com.au/home/publicsearch",
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

/**
 * Build Manheim search URL with pagination
 * Uses resultpartial endpoint for HTML list cards
 */
function buildSearchUrl(
  page: number, 
  limit = 120, 
  orderBy = "BuildYearDescending"
): string {
  const params = new URLSearchParams({
    PageNumber: String(page),
    RecordsPerPage: String(limit),
    SelectedOrderBy: orderBy,
    searchType: "P", // Passenger vehicles
  });
  return `https://www.manheim.com.au/home/publicsearch/resultpartial?${params.toString()}`;
}

/**
 * Extract Manheim listing ID from URL
 * Pattern: /home/{numeric-id}/{slug}
 * e.g., /home/12345678/2022-toyota-hilux-sr5
 */
function extractListingId(url: string): string | null {
  // Primary pattern: /home/{numeric-id}/...
  const match = url.match(/\/home\/(\d+)\//);
  if (match) return match[1];
  
  // Alternative: /home/{numeric-id} at end
  const endMatch = url.match(/\/home\/(\d+)$/);
  if (endMatch) return endMatch[1];
  
  return null;
}

/**
 * Parse stub from card HTML context
 */
function parseStubFromCard(cardHtml: string, hrefUrl: string): StubAnchor {
  // Ensure absolute URL
  const detailUrl = hrefUrl.startsWith('http') 
    ? hrefUrl 
    : `https://www.manheim.com.au${hrefUrl}`;
  
  const listingId = extractListingId(detailUrl);
  
  // Try to extract from URL slug: /home/{id}/2022-toyota-hilux-sr5
  const slugMatch = detailUrl.match(/\/home\/\d+\/(\d{4})-([a-z0-9]+)-([a-z0-9-]+)/i);
  
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  
  if (slugMatch) {
    year = parseInt(slugMatch[1]);
    make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
    // Model is rest of slug, convert hyphen to space
    model = slugMatch[3].split('-').map(p => 
      p.charAt(0).toUpperCase() + p.slice(1)
    ).join(' ');
  }
  
  // Fallback: extract year from HTML
  if (!year) {
    const yearMatch = cardHtml.match(/\b(20[0-2][0-9]|19[89][0-9])\b/);
    year = yearMatch ? parseInt(yearMatch[0]) : null;
  }
  
  // Extract KM from HTML
  const kmPatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*km/i,
    /odometer[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    /(\d{1,3}(?:,\d{3})*)\s*kilometres?/i,
  ];
  let km: number | null = null;
  for (const pattern of kmPatterns) {
    const match = cardHtml.match(pattern);
    if (match) {
      km = parseInt(match[1].replace(/,/g, ''));
      break;
    }
  }
  
  // Extract location
  const locationPatterns = [
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i,
    /(?:location|yard|branch)[:\s]*([^,<]+)/i,
  ];
  let location: string | null = null;
  for (const pattern of locationPatterns) {
    const match = cardHtml.match(pattern);
    if (match) {
      location = match[1] || match[0];
      break;
    }
  }
  
  // Extract make/model from card text if not from URL
  if (!make || !model) {
    // Common makes to look for
    const makes = ['Toyota', 'Mazda', 'Ford', 'Holden', 'Nissan', 'Mitsubishi', 
      'Hyundai', 'Kia', 'Volkswagen', 'Honda', 'Subaru', 'Isuzu', 'Suzuki',
      'BMW', 'Mercedes', 'Audi', 'Lexus', 'Jeep', 'LDV', 'GWM', 'MG'];
    
    for (const m of makes) {
      const regex = new RegExp(`\\b${m}\\b`, 'i');
      if (regex.test(cardHtml)) {
        make = m;
        // Try to extract model after make
        const modelMatch = cardHtml.match(new RegExp(`${m}\\s+([A-Za-z0-9]+)`, 'i'));
        if (modelMatch) {
          model = modelMatch[1];
        }
        break;
      }
    }
  }
  
  return {
    source_stock_id: listingId,
    detail_url: detailUrl,
    year,
    make,
    model,
    km,
    location,
    raw_text: cardHtml.substring(0, 500),
  };
}

/**
 * Extract all listings from Manheim HTML partial
 */
function extractListingsFromHtml(html: string): StubAnchor[] {
  const stubs: StubAnchor[] = [];
  const seen = new Set<string>();
  
  // Pattern 1: href="/home/{id}/..." links
  const linkRegex = /href="(\/home\/\d+\/[^"]+)"/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const listingId = extractListingId(url);
    
    // Skip if already seen or no valid numeric ID
    if (!listingId || seen.has(listingId)) continue;
    seen.add(listingId);
    
    // Get surrounding card context
    const pos = match.index;
    const cardContext = html.substring(
      Math.max(0, pos - 400), 
      Math.min(html.length, pos + 600)
    );
    
    const stub = parseStubFromCard(cardContext, url);
    if (stub.source_stock_id) {
      stubs.push(stub);
    }
  }
  
  // Pattern 2: Full URLs https://www.manheim.com.au/home/{id}/...
  const fullUrlRegex = /href="(https:\/\/www\.manheim\.com\.au\/home\/\d+\/[^"]+)"/gi;
  while ((match = fullUrlRegex.exec(html)) !== null) {
    const url = match[1];
    const listingId = extractListingId(url);
    
    if (!listingId || seen.has(listingId)) continue;
    seen.add(listingId);
    
    const pos = match.index;
    const cardContext = html.substring(
      Math.max(0, pos - 400), 
      Math.min(html.length, pos + 600)
    );
    
    const stub = parseStubFromCard(cardContext, url);
    if (stub.source_stock_id) {
      stubs.push(stub);
    }
  }
  
  return stubs;
}

/**
 * Fetch page with retry logic
 */
async function fetchPage(url: string, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
      });
      
      if (!response.ok) {
        console.warn(`[MANHEIM-STUB] Page fetch failed: ${response.status} for ${url}`);
        if (response.status === 403 || response.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      
      return await response.text();
    } catch (e) {
      console.error(`[MANHEIM-STUB] Fetch error attempt ${attempt + 1}:`, e);
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
      max_pages = 10,
      limit = 120,
      start_page = 1,
      order_by = "BuildYearDescending",
      dry_run = false,
    } = body;

    console.log(`[MANHEIM-STUB] Starting stub ingest: pages=${start_page}-${start_page + max_pages - 1}, limit=${limit}`);

    let runId: string | null = null;
    if (!dry_run) {
      const { data: run } = await supabase
        .from("stub_ingest_runs")
        .insert({ 
          source: "manheim", 
          region: "national", 
          status: "running" 
        })
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
      const url = buildSearchUrl(currentPage, limit, order_by);
      console.log(`[MANHEIM-STUB] Fetching page ${currentPage}: ${url}`);

      const html = await fetchPage(url);
      
      if (!html) {
        metrics.errors.push({ page: currentPage, error: "Failed to fetch page" });
        currentPage++;
        continue;
      }

      metrics.pages_fetched++;

      const stubs = extractListingsFromHtml(html);
      console.log(`[MANHEIM-STUB] Page ${currentPage}: found ${stubs.length} listings`);
      metrics.stubs_found += stubs.length;

      if (stubs.length === 0) {
        console.log(`[MANHEIM-STUB] Page ${currentPage}: empty page, stopping`);
        break;
      }

      // Count NEW stock IDs only
      let newStockIds = 0;
      const validStubs: StubAnchor[] = [];
      
      for (const stub of stubs) {
        if (stub.source_stock_id && !allSeenStockIds.has(stub.source_stock_id)) {
          allSeenStockIds.add(stub.source_stock_id);
          newStockIds++;
          validStubs.push(stub);
        } else if (stub.source_stock_id) {
          validStubs.push(stub);
        }
      }
      
      metrics.new_stock_ids_per_page[currentPage] = newStockIds;
      console.log(`[MANHEIM-STUB] Page ${currentPage}: ${newStockIds} NEW stock IDs`);

      if (!dry_run && validStubs.length > 0) {
        const { data: result, error } = await supabase.rpc("upsert_stub_anchor_batch", {
          p_source: "manheim",
          p_stubs: validStubs,
        });

        if (error) {
          console.error(`[MANHEIM-STUB] Batch upsert error:`, error);
          metrics.errors.push({ page: currentPage, error: error.message });
        } else if (result && result.length > 0) {
          metrics.stubs_created += result[0].created_count || 0;
          metrics.stubs_updated += result[0].updated_count || 0;
          metrics.exceptions_queued += result[0].exception_count || 0;
        }
      }

      // Stop when page yields no new stock_ids
      if (newStockIds === 0) {
        consecutiveZeroNewPages++;
        if (consecutiveZeroNewPages >= 2) {
          console.log(`[MANHEIM-STUB] ${consecutiveZeroNewPages} consecutive pages with 0 new IDs, stopping`);
          break;
        }
      } else {
        consecutiveZeroNewPages = 0;
      }

      currentPage++;
      // Slightly longer delay for Manheim
      await new Promise(r => setTimeout(r, 750));
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
    console.log(`[MANHEIM-STUB] Completed in ${duration}ms:`, metrics);

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
    console.error("[MANHEIM-STUB] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
