import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Global state for shutdown handler
interface CrawlState {
  supabaseUrl: string;
  supabaseKey: string;
  runId: string;
  lastCompletedPage: number;
  totalListings: number;
  hasMorePages: boolean;
}
let currentCrawlState: CrawlState | null = null;

interface ParsedListing {
  listing_id: string;
  lot_id: string;
  listing_url: string;
  make: string;
  model: string;
  year: number;
  km: number | null;
  variant_raw: string | null;
  variant_family: string | null;
  transmission: string | null;
  location: string | null;
  auction_datetime: string | null;
  buy_method: string | null;
}

// ========== COMPREHENSIVE VARIANT FAMILY EXTRACTION ==========
// Uses deterministic regex patterns and model-specific ladders, NOT AI

// Variant family definitions by make/model (AU market focus)
const MODEL_VARIANT_FAMILIES: Record<string, Record<string, string[]>> = {
  // Toyota
  'toyota': {
    'landcruiser': ['GX', 'GXL', 'VX', 'SAHARA', 'KAKADU'],
    'prado': ['GX', 'GXL', 'VX', 'KAKADU', 'ALTITUDE'],
    'hilux': ['WORKMATE', 'SR', 'SR5', 'ROGUE', 'RUGGED', 'RUGGED X'],
    'corolla': ['ASCENT', 'ASCENT SPORT', 'SX', 'ZR', 'HYBRID', 'GR', 'CROSS'],
    'camry': ['ASCENT', 'ASCENT SPORT', 'SX', 'SL', 'HYBRID'],
    'rav4': ['GX', 'GXL', 'CRUISER', 'EDGE', 'HYBRID'],
    'kluger': ['GX', 'GXL', 'GRANDE', 'HYBRID'],
    'fortuner': ['GX', 'GXL', 'CRUSADE'],
  },
  // Ford
  'ford': {
    'ranger': ['XL', 'XLS', 'XLT', 'WILDTRAK', 'RAPTOR', 'SPORT', 'FX4'],
    'everest': ['AMBIENTE', 'TREND', 'SPORT', 'TITANIUM', 'PLATINUM', 'WILDTRAK'],
    'mustang': ['GT', 'ECOBOOST', 'MACH 1'],
  },
  // Isuzu
  'isuzu': {
    'd-max': ['SX', 'LS-M', 'LS-U', 'X-TERRAIN', 'LS'],
    'mu-x': ['LS-M', 'LS-U', 'LS-T', 'LS'],
  },
  // Mitsubishi
  'mitsubishi': {
    'triton': ['GLX', 'GLX+', 'GLS', 'GSR', 'EXCEED', 'BLACKLINE'],
    'pajero': ['GLX', 'GLS', 'EXCEED', 'SPORT'],
    'outlander': ['ES', 'LS', 'EXCEED', 'ASPIRE', 'GSR'],
  },
  // Mazda
  'mazda': {
    'bt-50': ['XT', 'XTR', 'GT', 'SP', 'THUNDER'],
    'cx-5': ['MAXX', 'MAXX SPORT', 'TOURING', 'GT', 'AKERA'],
  },
  // Nissan
  'nissan': {
    'navara': ['SL', 'ST', 'ST-X', 'PRO-4X', 'N-TREK', 'WARRIOR'],
    'patrol': ['TI', 'TI-L', 'WARRIOR'],
    'x-trail': ['ST', 'ST-L', 'TI', 'TI-L'],
  },
  // Volkswagen
  'volkswagen': {
    'amarok': ['CORE', 'LIFE', 'STYLE', 'PANAMERICANA', 'AVENTURA', 'HIGHLINE', 'V6'],
  },
  // Holden
  'holden': {
    'colorado': ['LS', 'LT', 'LTZ', 'Z71', 'STORM'],
    'commodore': ['EVOKE', 'SV6', 'SS', 'SSV', 'VXR', 'CALAIS'],
    'trailblazer': ['LT', 'LTZ', 'Z71', 'STORM'],
  },
  // Hyundai
  'hyundai': {
    'tucson': ['ACTIVE', 'ELITE', 'HIGHLANDER', 'N-LINE'],
    'santa fe': ['ACTIVE', 'ELITE', 'HIGHLANDER'],
    'i30': ['ACTIVE', 'ELITE', 'N-LINE', 'N'],
  },
  // Kia
  'kia': {
    'sportage': ['S', 'SX', 'GT-LINE', 'GT'],
    'sorento': ['S', 'SI', 'SLI', 'GT-LINE', 'GT'],
    'cerato': ['S', 'SPORT', 'SPORT+', 'GT'],
  },
};

// Generic variant families for fallback matching
const GENERIC_FAMILIES = [
  'ASCENT SPORT', 'RUGGED X', 'RUGGED-X', 'X-TERRAIN', 'GT-LINE', 'N-LINE',
  'ST-X', 'PRO-4X', 'N-TREK', 'LS-U', 'LS-M', 'LS-T', 'TI-L', 'ST-L',
  'SR5', 'GXL', 'GX', 'VX', 'SAHARA', 'KAKADU', 'ROGUE', 'RUGGED', 'WORKMATE',
  'WILDTRAK', 'RAPTOR', 'XLT', 'XLS', 'XL', 'TITANIUM', 'PLATINUM', 'AMBIENTE', 'TREND',
  'LTZ', 'LT', 'Z71', 'ZR2', 'STORM', 'WARRIOR',
  'HIGHLANDER', 'ELITE', 'ACTIVE',
  'GT', 'GR', 'RS', 'SS', 'SSV', 'SV6', 'XR6', 'XR8',
  'SPORT', 'PREMIUM', 'EXCEED', 'CRUSADE',
];

/**
 * Extract variant family using model-specific patterns + generic fallback
 * Uses word boundary matching to prevent false positives
 */
function deriveVariantFamily(make: string | null, model: string | null, variantRaw: string | null, contextText?: string): string | null {
  // Combine all text sources
  const textSources = [variantRaw, contextText].filter(Boolean).join(' ');
  if (!textSources.trim()) return null;
  
  const upper = textSources.toUpperCase();
  const makeLower = (make || '').toLowerCase().trim();
  const modelLower = (model || '').toLowerCase().trim();
  
  // Try model-specific families first
  const makeData = MODEL_VARIANT_FAMILIES[makeLower];
  if (makeData) {
    // Try exact model match
    let families = makeData[modelLower];
    
    // Try partial model match (e.g., "ranger" in "ranger-xlt")
    if (!families) {
      for (const [modelKey, modelFamilies] of Object.entries(makeData)) {
        if (modelLower.includes(modelKey) || modelKey.includes(modelLower)) {
          families = modelFamilies;
          break;
        }
      }
    }
    
    if (families) {
      // Sort by length descending to match longer patterns first
      const sorted = [...families].sort((a, b) => b.length - a.length);
      for (const family of sorted) {
        const pattern = new RegExp(`\\b${family.replace(/[+-]/g, '[+-]?')}\\b`, 'i');
        if (pattern.test(upper)) {
          return family.toUpperCase();
        }
      }
    }
  }
  
  // Fallback to generic families
  for (const family of GENERIC_FAMILIES) {
    const pattern = new RegExp(`\\b${family.replace(/[+-]/g, '[+-]?')}\\b`, 'i');
    if (pattern.test(upper)) {
      return family.toUpperCase();
    }
  }
  
  return null;
}

// Parse year from various formats
function parseYear(text: string): number | null {
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) return parseInt(yearMatch[0]);
  return null;
}

// Parse km from text - handles formats like "165,668 km", "45785km", "165,668 km\\"
function parseKm(text: string): number | null {
  // Remove backslashes that appear in markdown
  const cleaned = text.replace(/\\/g, '');
  
  // Pattern for km values with optional comma separators
  const kmMatch = cleaned.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometres)/i);
  if (kmMatch) {
    return parseInt(kmMatch[1].replace(/,/g, ''));
  }
  return null;
}

// Parse auction datetime from card text and convert to ISO format
function parseAuctionDateTime(text: string): string | null {
  const months: Record<string, number> = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };
  
  // Pattern 1: "Wed 15 Jan 10:00 AM AEDT" or "Tue 20/01/2026 11:00AM"
  const pattern1 = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
  const match1 = text.match(pattern1);
  if (match1) {
    const [, day, month, year, hour, min, ampm] = match1;
    let h = parseInt(hour);
    if (ampm?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  
  // Pattern 2: "15 Jan 2026 10:00" or "Mon 15 Jan 10:00 AM"
  const pattern2 = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
  const match2 = text.match(pattern2);
  if (match2) {
    const [, day, monthStr, year, hour, min, ampm] = match2;
    const monthNum = months[monthStr.toLowerCase()];
    const yearNum = year ? parseInt(year) : new Date().getFullYear();
    let h = parseInt(hour);
    if (ampm?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;
    const d = new Date(yearNum, monthNum, parseInt(day), h, parseInt(min));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  
  return null;
}

// Parse vehicle cards from rendered HTML (Firecrawl output)
function parseVehicleCards(html: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const seenLotIds = new Set<string>();
  
  console.log(`[pickles-crawl] Parsing HTML, length: ${html.length}`);
  
  // URL pattern: /used/details/cars/YEAR-MAKE-MODEL/STOCK_ID
  // Example: /used/details/cars/2017-ford-ranger/62141440
  const detailsLinkPattern = /href=["']?(https:\/\/www\.pickles\.com\.au)?\/used\/details\/cars\/([^"'\s]+)\/(\d+)["']?/gi;
  const matches: Array<{url: string, slug: string, stockId: string, index: number}> = [];
  
  let match;
  while ((match = detailsLinkPattern.exec(html)) !== null) {
    matches.push({
      url: `/used/details/cars/${match[2]}/${match[3]}`,
      slug: match[2],
      stockId: match[3],
      index: match.index
    });
  }
  
  console.log(`[pickles-crawl] Found ${matches.length} detail links`);
  
  // Dedupe by stock ID and process each unique listing
  for (const item of matches) {
    if (seenLotIds.has(item.stockId)) continue;
    seenLotIds.add(item.stockId);
    
    // Extract a context window around this link to find vehicle details
    const contextStart = Math.max(0, item.index - 2000);
    const contextEnd = Math.min(html.length, item.index + 2000);
    const context = html.substring(contextStart, contextEnd);
    
    // Parse the slug for year, make, model
    // Format: YEAR-MAKE-MODEL or YEAR-MAKE-MODEL-VARIANT
    // Examples: 2017-ford-ranger, 2022-toyota-hilux-sr5
    const slugParts = item.slug.toLowerCase().split('-');
    
    let year: number | null = null;
    let make = '';
    let model = '';
    let variant: string | null = null;
    
    // First part should be year (support 1980-2030 for classic cars)
    if (slugParts.length >= 3) {
      const potentialYear = parseInt(slugParts[0]);
      if (potentialYear >= 1980 && potentialYear <= 2030) {
        year = potentialYear;
        make = slugParts[1].charAt(0).toUpperCase() + slugParts[1].slice(1);
        model = slugParts[2].charAt(0).toUpperCase() + slugParts[2].slice(1);
        
        // Remaining parts are variant
        if (slugParts.length > 3) {
          variant = slugParts.slice(3).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        }
      }
    }
    
    // Clean context of backslashes for better parsing
    const cleanedContext = context.replace(/\\/g, ' ');
    
    // Skip if we couldn't parse essential fields
    if (!year || !make || !model) {
      console.log(`[pickles-crawl] Skipping stock ${item.stockId} - couldn't parse: year=${year}, make=${make}, model=${model}, slug=${item.slug}`);
      continue;
    }
    
    // Extract km from cleaned context
    const km = parseKm(cleanedContext);
    
    // Extract location from context
    const locationPatterns = [
      /(Moonah|Brisbane|Sydney|Melbourne|Perth|Adelaide|Canberra|Darwin|Hobart|Newcastle|Wollongong|Gold Coast|Cairns|Townsville|Rockhampton|Mackay|Toowoomba|Geelong|Ballarat|Bendigo|Launceston|Dubbo|Salisbury Plain|Winnellie|Yatala|Eagle Farm|Altona|Dandenong)[,\s]/i,
      /(?:Location|Branch|Yard)[:\s]+([A-Za-z\s]+)/i,
    ];
    let location: string | null = null;
    for (const lp of locationPatterns) {
      const lm = cleanedContext.match(lp);
      if (lm) {
        location = lm[1].trim();
        break;
      }
    }
    
    // Extract buy method
    const buyMethodMatch = cleanedContext.match(/(Pickles Online|Live Auction|Buy Now|Make Offer|Timed Auction)/i);
    const buyMethod = buyMethodMatch ? buyMethodMatch[1] : null;
    
    // Extract auction time
    const auctionTime = parseAuctionDateTime(cleanedContext);
    
    // Extract transmission
    const transMatch = context.match(/\b(Automatic|Manual|Auto|CVT|DCT)\b/i);
    const transmission = transMatch ? transMatch[1] : null;
    
    // Extract variant family using comprehensive extraction (make, model, variant, context)
    const variantFamily = deriveVariantFamily(make, model, variant, cleanedContext);
    
    listings.push({
      listing_id: `pickles-${item.stockId}`,
      lot_id: item.stockId,
      listing_url: `https://www.pickles.com.au${item.url}`,
      make,
      model,
      year,
      km, // KM is OPTIONAL for Pickles - null is valid
      variant_raw: variant,
      variant_family: variantFamily,
      transmission,
      location,
      auction_datetime: auctionTime,
      buy_method: buyMethod,
    });
  }
  
  console.log(`[pickles-crawl] Parsed ${listings.length} unique listings`);
  return listings;
}

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Background crawl processor
async function processCrawl(
  supabaseUrl: string,
  supabaseKey: string,
  firecrawlKey: string,
  runId: string,
  maxPages: number,
  startPage: number,
  yearMin: number | null
) {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const baseUrl = 'https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars';
  const yearFilter = yearMin ? `&year-min=${yearMin}` : '';
  
  let currentPage = startPage;
  let totalListings = 0;
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  let consecutiveEmptyPages = 0;
  
  // Initialize global state for shutdown handler
  currentCrawlState = {
    supabaseUrl,
    supabaseKey,
    runId,
    lastCompletedPage: startPage - 1,
    totalListings: 0,
    hasMorePages: true,
  };
  
  try {
    // Crawl pages using Firecrawl for JS rendering
    while (currentPage <= maxPages && consecutiveEmptyPages < 3) {
      const pageUrl = `${baseUrl}?contentkey=all-cars&limit=120${yearFilter}&page=${currentPage}`;
      console.log(`[pickles-crawl] Scraping page ${currentPage}: ${pageUrl}`);
      
      try {
        // Use Firecrawl to render the page
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: pageUrl,
            formats: ['html'],
            onlyMainContent: false,
            waitFor: 5000, // Wait 5s for JS to render
          }),
        });
        
        if (!firecrawlResponse.ok) {
          const errText = await firecrawlResponse.text();
          console.error(`[pickles-crawl] Firecrawl error:`, errText);
          errors.push(`Page ${currentPage}: Firecrawl error ${firecrawlResponse.status}`);
          consecutiveEmptyPages++;
          currentPage++;
          await sleep(3000);
          continue;
        }
        
        const firecrawlData = await firecrawlResponse.json();
        const html = firecrawlData.data?.html || firecrawlData.html || '';
        
        console.log(`[pickles-crawl] Firecrawl returned HTML length: ${html.length}`);
        
        // Save HTML snapshot for debugging
        const snapshotPath = `crawl-${runId}/page-${currentPage}.html`;
        const { error: uploadError } = await supabase.storage
          .from('pickles-snapshots')
          .upload(snapshotPath, html, {
            contentType: 'text/html',
            upsert: true
          });
        
        if (uploadError) {
          console.error(`[pickles-crawl] Failed to upload snapshot:`, uploadError.message);
        } else {
          console.log(`[pickles-crawl] Saved snapshot: ${snapshotPath}`);
        }
        
        // Parse vehicle cards from the HTML
        const listings = parseVehicleCards(html);
        console.log(`[pickles-crawl] Page ${currentPage}: Found ${listings.length} listings`);
        
        if (listings.length === 0) {
          consecutiveEmptyPages++;
          console.log(`[pickles-crawl] Empty page ${currentPage}, consecutive empty: ${consecutiveEmptyPages}`);
        } else {
          consecutiveEmptyPages = 0;
          
          // Upsert listings into database
          for (const listing of listings) {
            const { error: upsertError } = await supabase
              .from('vehicle_listings')
              .upsert({
                listing_id: listing.listing_id,
                lot_id: listing.lot_id,
                listing_url: listing.listing_url,
                make: listing.make,
                model: listing.model,
                year: listing.year,
                km: listing.km,
                variant_raw: listing.variant_raw,
                variant_family: listing.variant_family,
                transmission: listing.transmission,
                location: listing.location,
                auction_datetime: listing.auction_datetime,
                source: 'pickles_crawl',
                auction_house: 'Pickles',
                status: 'catalogue',
                last_seen_at: new Date().toISOString(),
              }, {
                onConflict: 'listing_id',
                ignoreDuplicates: false
              });
            
            if (upsertError) {
              console.error(`[pickles-crawl] Failed to upsert ${listing.listing_id}:`, upsertError.message);
              errors.push(`Upsert ${listing.listing_id}: ${upsertError.message}`);
            } else {
              updated++;
            }
          }
          
          totalListings += listings.length;
        }
        
        // Update run progress after each page
        await supabase
          .from('ingestion_runs')
          .update({
            lots_found: totalListings,
            lots_updated: updated,
            metadata: {
              baseUrl,
              maxPages,
              startPage,
              yearMin,
              pagesProcessed: currentPage - startPage + 1,
              lastCompletedPage: currentPage,
              engine: 'firecrawl',
            }
          })
          .eq('id', runId);
        
        console.log(`[pickles-crawl] Updated run: found=${totalListings}, created=${created}, updated=${updated}`);
        
        // Update global state for shutdown handler
        currentCrawlState = {
          supabaseUrl,
          supabaseKey,
          runId,
          lastCompletedPage: currentPage,
          totalListings,
          hasMorePages: currentPage < maxPages,
        };
        
        // Throttle between pages (3 seconds)
        if (currentPage < maxPages) {
          console.log(`[pickles-crawl] Waiting 3s before next page...`);
          await sleep(3000);
        }
        
      } catch (pageError) {
        const errMsg = pageError instanceof Error ? pageError.message : 'Unknown error';
        errors.push(`Page ${currentPage}: ${errMsg}`);
        console.error(`[pickles-crawl] Page ${currentPage} error:`, pageError);
        consecutiveEmptyPages++;
      }
      
      currentPage++;
    }
    
    // Update run record with final results
    const finalStatus = errors.length > totalListings / 2 ? 'failed' : 
                       errors.length > 0 ? 'completed_with_errors' : 'success';
    
    // Mark if there are more pages to crawl
    const hasMorePages = currentPage <= maxPages && consecutiveEmptyPages < 3;
    
    await supabase
      .from('ingestion_runs')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        lots_found: totalListings,
        lots_created: created,
        lots_updated: updated,
        errors: errors.slice(0, 50),
        metadata: {
          baseUrl,
          maxPages,
          startPage,
          yearMin,
          pagesProcessed: currentPage - startPage,
          lastCompletedPage: currentPage - 1,
          hasMorePages,
          engine: 'firecrawl',
        }
      })
      .eq('id', runId);
    
    console.log(`[pickles-crawl] Complete. Pages: ${currentPage - startPage}, Listings: ${totalListings}, Created: ${created}, Updated: ${updated}`);
    
  } catch (error) {
    console.error('[pickles-crawl] Background crawl error:', error);
    await supabase
      .from('ingestion_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        errors: [error instanceof Error ? error.message : 'Unknown error']
      })
      .eq('id', runId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!firecrawlKey) {
    console.error('[pickles-crawl] FIRECRAWL_API_KEY not configured');
    return new Response(JSON.stringify({
      success: false,
      error: 'Firecrawl connector not configured. Please enable the Firecrawl connector in Settings.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const maxPages = body.maxPages || 15;
    const startPage = body.startPage || 1;
    const yearMin = body.yearMin || null;
    
    // Pickles cars search URL with 120 items per page
    const baseUrl = 'https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars';
    
    console.log(`[pickles-crawl] Starting Firecrawl-based crawl`);
    console.log(`[pickles-crawl] Max pages: ${maxPages}, Start page: ${startPage}, Year min: ${yearMin || 'any'}`);
    
    // Create ingestion run record
    const { data: runData, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: 'pickles_crawl',
        status: 'running',
        metadata: { baseUrl, maxPages, startPage, engine: 'firecrawl', yearMin }
      })
      .select()
      .single();
    
    if (runError) {
      console.error('[pickles-crawl] Failed to create run record:', runError);
      throw runError;
    }
    
    const runId = runData.id;
    console.log(`[pickles-crawl] Created run: ${runId}`);
    
    // Start background processing using EdgeRuntime.waitUntil
    // This allows us to return immediately while crawl continues
    EdgeRuntime.waitUntil(
      processCrawl(supabaseUrl, supabaseKey, firecrawlKey, runId, maxPages, startPage, yearMin)
    );
    
    // Return immediately with run ID - client can poll for progress
    return new Response(JSON.stringify({
      success: true,
      runId,
      message: 'Crawl started. Check Run History for progress.',
      status: 'running'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[pickles-crawl] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Handle shutdown gracefully - update status so crawl can resume
addEventListener('beforeunload', async (ev) => {
  const reason = (ev as any).detail?.reason;
  console.log('[pickles-crawl] Function shutdown:', reason);
  
  if (currentCrawlState && reason === 'wall_clock') {
    const { supabaseUrl, supabaseKey, runId, lastCompletedPage, hasMorePages } = currentCrawlState;
    console.log('[pickles-crawl] Wall clock limit hit, marking as stopped for resume');
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase
        .from('ingestion_runs')
        .update({
          status: 'stopped',
          completed_at: new Date().toISOString(),
          metadata: {
            engine: 'firecrawl',
            lastCompletedPage,
            hasMorePages,
            stoppedReason: 'wall_clock_limit'
          }
        })
        .eq('id', runId);
      console.log('[pickles-crawl] Updated run status to stopped');
    } catch (err) {
      console.error('[pickles-crawl] Failed to update status on shutdown:', err);
    }
  }
});
