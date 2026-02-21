import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MULTI_WORD_MODELS } from "../_shared/taxonomy/parseSlug.ts";

/**
 * GRAYS STUB INGEST - Lane 1: High-volume stub anchor creation
 * 
 * Production hardened (following Pickles/Manheim pattern):
 * - Crawls Grays motor-vehicles-motor-cycles search pages
 * - source_listing_id from URL pattern /lot/{lot-number}/...
 * - Uses normalized make_norm/model_norm columns
 * - Schedule: hourly
 * 
 * ⚠️ CLOUDFLARE BLOCKING NOTE:
 * Grays.com uses Cloudflare protection that blocks direct HTTP requests from edge functions.
 * This function will receive 403 errors when attempting to scrape search pages.
 * 
 * RECOMMENDED APPROACH:
 * Use an Apify actor with headless browser (Playwright/Puppeteer) similar to the VMA pattern.
 * The actor should:
 * 1. Navigate to search pages and extract listing URLs
 * 2. POST extracted stubs to the ingest-grays edge function (similar to ingest-vma pattern)
 * 
 * This edge function remains available for:
 * - Manual stub insertion via API
 * - Future direct API access if Grays exposes one
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
  "Referer": "https://www.grays.com/",
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
 * Build Grays search URL with pagination
 * Uses motor-vehicles category with page parameter
 */
function buildSearchUrl(page: number): string {
  const params = new URLSearchParams({
    page: String(page),
  });
  return `https://www.grays.com/search/automotive-trucks-and-marine/motor-vehiclesmotor-cycles?${params.toString()}`;
}

/**
 * Extract Grays lot ID from URL
 * Pattern: /lot/{lot-number}/{category}/{slug}
 * e.g., /lot/0001-10352288/motor-vehicles-motor-cycles/2015-toyota-hilux-...
 * The lot-number is the unique identifier
 */
function extractLotId(url: string): string | null {
  // Primary pattern: /lot/{lot-number}/...
  const match = url.match(/\/lot\/([0-9-]+)\//);
  if (match) {
    // Return full lot number (e.g., "0001-10352288")
    return match[1];
  }
  
  // Alternative: /lot/{lot-number} at end
  const endMatch = url.match(/\/lot\/([0-9-]+)$/);
  if (endMatch) return endMatch[1];
  
  return null;
}

/**
 * Parse stub from URL slug
 * Grays slugs contain: year-make-model-variant-info
 */
function parseStubFromUrl(hrefUrl: string, rawText: string = ""): StubAnchor {
  // Ensure absolute URL
  const detailUrl = hrefUrl.startsWith('http') 
    ? hrefUrl 
    : `https://www.grays.com${hrefUrl}`;
  
  const lotId = extractLotId(detailUrl);
  
  // Extract from URL slug: /lot/{id}/{category}/{year}-{make}-{model}-...
  // e.g., /lot/0001-10352288/motor-vehicles-motor-cycles/2015-toyota-hilux-4x4-sr-kun26r
  const slugMatch = detailUrl.match(/\/lot\/[^\/]+\/[^\/]+\/(\d{4})-([a-z]+)-([a-z0-9-]+)/i);
  
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  
  if (slugMatch) {
    year = parseInt(slugMatch[1]);
    make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1).toLowerCase();

    // Multi-word model detection — longest-match-first to prevent platform bleed
    // e.g. "landcruiser-prado" → "Landcruiser Prado", not "Landcruiser"
    const modelParts = slugMatch[3].split('-');
    // Uses shared canonical MULTI_WORD_MODELS from _shared/taxonomy/parseSlug.ts

    let modelWordCount = 1;
    const firstPart = modelParts[0].toLowerCase();
    if (MULTI_WORD_MODELS[firstPart] && modelParts.length > 1) {
      const nextPart = modelParts[1].toLowerCase();
      if (MULTI_WORD_MODELS[firstPart].includes(nextPart)) {
        modelWordCount = 2;
      }
    }

    model = modelParts.slice(0, modelWordCount)
      .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }
  
  // Try to extract location from raw text (NSW, VIC, QLD, etc.)
  const locationMatch = rawText.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  const location = locationMatch ? locationMatch[1].toUpperCase() : null;
  
  return {
    source_stock_id: lotId,
    detail_url: detailUrl,
    year,
    make,
    model,
    km: null, // Will be extracted in deep-fetch
    location,
    raw_text: rawText.substring(0, 500),
  };
}

/**
 * Extract all listings from Grays HTML page
 */
function extractListingsFromHtml(html: string): StubAnchor[] {
  const stubs: StubAnchor[] = [];
  const seen = new Set<string>();
  
  // Pattern: href="/lot/{lot-number}/{category}/{slug}"
  const linkRegex = /href="(\/lot\/[0-9-]+\/[^"]+)"/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const lotId = extractLotId(url);
    
    // Skip if already seen or no valid lot ID
    if (!lotId || seen.has(lotId)) continue;
    
    // Skip non-vehicle categories (transport, trucks, trailers, etc.)
    if (!url.includes('motor-vehicles') && !url.includes('cars')) continue;
    
    seen.add(lotId);
    
    // Get surrounding card context for raw_text
    const pos = match.index;
    const cardContext = html.substring(
      Math.max(0, pos - 400), 
      Math.min(html.length, pos + 600)
    );
    
    const stub = parseStubFromUrl(url, cardContext);
    if (stub.source_stock_id) {
      stubs.push(stub);
    }
  }
  
  // Also match full URLs
  const fullUrlRegex = /href="(https:\/\/www\.grays\.com\/lot\/[0-9-]+\/[^"]+)"/gi;
  while ((match = fullUrlRegex.exec(html)) !== null) {
    const url = match[1];
    const lotId = extractLotId(url);
    
    if (!lotId || seen.has(lotId)) continue;
    if (!url.includes('motor-vehicles') && !url.includes('cars')) continue;
    
    seen.add(lotId);
    
    const pos = match.index;
    const cardContext = html.substring(
      Math.max(0, pos - 400), 
      Math.min(html.length, pos + 600)
    );
    
    const stub = parseStubFromUrl(url, cardContext);
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
        console.warn(`[GRAYS-STUB] Page fetch failed: ${response.status} for ${url}`);
        if (response.status === 403 || response.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      
      return await response.text();
    } catch (e) {
      console.error(`[GRAYS-STUB] Fetch error attempt ${attempt + 1}:`, e);
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
      start_page = 1,
      dry_run = false,
    } = body;

    console.log(`[GRAYS-STUB] Starting stub ingest: pages=${start_page}-${start_page + max_pages - 1}`);

    let runId: string | null = null;
    if (!dry_run) {
      const { data: run } = await supabase
        .from("stub_ingest_runs")
        .insert({ 
          source: "grays", 
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

    // Track all seen lot IDs across pages
    const allSeenLotIds = new Set<string>();
    let currentPage = start_page;
    let consecutiveZeroNewPages = 0;

    while (currentPage < start_page + max_pages) {
      const url = buildSearchUrl(currentPage);
      console.log(`[GRAYS-STUB] Fetching page ${currentPage}: ${url}`);

      const html = await fetchPage(url);
      
      if (!html) {
        metrics.errors.push({ page: currentPage, error: "Failed to fetch page" });
        currentPage++;
        continue;
      }

      metrics.pages_fetched++;

      const stubs = extractListingsFromHtml(html);
      console.log(`[GRAYS-STUB] Page ${currentPage}: found ${stubs.length} listings`);
      metrics.stubs_found += stubs.length;

      if (stubs.length === 0) {
        console.log(`[GRAYS-STUB] Page ${currentPage}: empty page, stopping`);
        break;
      }

      // Count NEW lot IDs only
      let newLotIds = 0;
      const validStubs: StubAnchor[] = [];
      
      for (const stub of stubs) {
        if (stub.source_stock_id && !allSeenLotIds.has(stub.source_stock_id)) {
          allSeenLotIds.add(stub.source_stock_id);
          newLotIds++;
          validStubs.push(stub);
        } else if (stub.source_stock_id) {
          validStubs.push(stub);
        }
      }
      
      metrics.new_stock_ids_per_page[currentPage] = newLotIds;
      console.log(`[GRAYS-STUB] Page ${currentPage}: ${newLotIds} NEW lot IDs`);

      if (!dry_run && validStubs.length > 0) {
        const { data: result, error } = await supabase.rpc("upsert_stub_anchor_batch", {
          p_source: "grays",
          p_stubs: validStubs,
        });

        if (error) {
          console.error(`[GRAYS-STUB] Batch upsert error:`, error);
          metrics.errors.push({ page: currentPage, error: error.message });
        } else if (result && result.length > 0) {
          metrics.stubs_created += result[0].created_count || 0;
          metrics.stubs_updated += result[0].updated_count || 0;
          metrics.exceptions_queued += result[0].exception_count || 0;
        }
      }

      // Stop when page yields no new lot_ids
      if (newLotIds === 0) {
        consecutiveZeroNewPages++;
        if (consecutiveZeroNewPages >= 2) {
          console.log(`[GRAYS-STUB] ${consecutiveZeroNewPages} consecutive pages with 0 new IDs, stopping`);
          break;
        }
      } else {
        consecutiveZeroNewPages = 0;
      }

      currentPage++;
      // Polite delay between page fetches
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
    console.log(`[GRAYS-STUB] Completed in ${duration}ms:`, metrics);

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
    console.error("[GRAYS-STUB] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
