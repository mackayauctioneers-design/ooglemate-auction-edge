import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// Variant family whitelist for normalization
const VARIANT_FAMILIES: Record<string, string[]> = {
  'SR5': ['SR5'],
  'Rogue': ['Rogue'],
  'Rugged': ['Rugged', 'Rugged X'],
  'GXL': ['GXL'],
  'GX': ['GX'],
  'Workmate': ['Workmate'],
  'SR': ['SR'],
};

function deriveVariantFamily(variantRaw: string | null): string | null {
  if (!variantRaw) return null;
  const upper = variantRaw.toUpperCase();
  for (const [family, patterns] of Object.entries(VARIANT_FAMILIES)) {
    for (const pattern of patterns) {
      if (upper.includes(pattern.toUpperCase())) {
        return family;
      }
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

// Parse km from text
function parseKm(text: string): number | null {
  const kmMatch = text.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometres)/i);
  if (kmMatch) {
    return parseInt(kmMatch[1].replace(/,/g, ''));
  }
  // Also try just numbers followed by km pattern in the surrounding text
  const altMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*(?:km|kms|KM)/i);
  if (altMatch) {
    return parseInt(altMatch[1].replace(/,/g, ''));
  }
  return null;
}

// Parse auction datetime from card text
function parseAuctionDateTime(text: string): string | null {
  // Look for patterns like "Wed 15 Jan 10:00 AM AEDT"
  const patterns = [
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{1,2}):(\d{2})/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

// Parse vehicle cards from rendered HTML (Firecrawl output)
function parseVehicleCards(html: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const seenLotIds = new Set<string>();
  
  console.log(`[pickles-crawl] Parsing HTML, length: ${html.length}`);
  
  // Look for vehicle card patterns in the rendered HTML
  // Pattern 1: Find all links to /used/item/... pages
  const itemLinkPattern = /href=["'](\/used\/item\/([^"']+)-(\d+))["']/gi;
  const matches: Array<{url: string, slug: string, lotId: string, index: number}> = [];
  
  let match;
  while ((match = itemLinkPattern.exec(html)) !== null) {
    matches.push({
      url: match[1],
      slug: match[2],
      lotId: match[3],
      index: match.index
    });
  }
  
  console.log(`[pickles-crawl] Found ${matches.length} item links`);
  
  // Dedupe by lot ID and process each unique listing
  for (const item of matches) {
    if (seenLotIds.has(item.lotId)) continue;
    seenLotIds.add(item.lotId);
    
    // Extract a context window around this link to find vehicle details
    const contextStart = Math.max(0, item.index - 3000);
    const contextEnd = Math.min(html.length, item.index + 3000);
    const context = html.substring(contextStart, contextEnd);
    
    // Parse the slug for make/model/variant hints
    // Format: make-model-variant-year-lotId or similar
    const slugParts = item.slug.toLowerCase().split('-');
    
    // Try to extract year, make, model from context
    // Look for title patterns like "2023 Toyota Hilux SR5"
    const titlePattern = /(20\d{2}|19\d{2})\s+([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z0-9]+)(?:\s+([A-Z][a-zA-Z0-9\s]+))?/;
    const titleMatch = context.match(titlePattern);
    
    let year: number | null = null;
    let make = '';
    let model = '';
    let variant: string | null = null;
    
    if (titleMatch) {
      year = parseInt(titleMatch[1]);
      make = titleMatch[2];
      model = titleMatch[3];
      variant = titleMatch[4]?.trim() || null;
    } else {
      // Fallback: Try to parse from slug
      // Expected patterns: toyota-hilux-sr5-auto-2023
      for (const part of slugParts) {
        const y = parseYear(part);
        if (y) {
          year = y;
          break;
        }
      }
      
      // Common makes list for matching
      const makes = ['toyota', 'ford', 'holden', 'mazda', 'nissan', 'hyundai', 'kia', 'mitsubishi', 'subaru', 'volkswagen', 'honda', 'suzuki', 'isuzu', 'jeep', 'land rover', 'bmw', 'mercedes', 'audi', 'lexus', 'porsche', 'tesla', 'ram', 'chevrolet', 'great wall', 'ldv', 'mahindra', 'ssangyong', 'haval', 'mg'];
      
      for (const part of slugParts) {
        if (makes.includes(part)) {
          make = part.charAt(0).toUpperCase() + part.slice(1);
          break;
        }
      }
      
      // Model is usually after make in slug
      const makeIdx = slugParts.indexOf(make.toLowerCase());
      if (makeIdx >= 0 && makeIdx < slugParts.length - 1) {
        model = slugParts[makeIdx + 1].charAt(0).toUpperCase() + slugParts[makeIdx + 1].slice(1);
      }
    }
    
    // Skip if we couldn't parse essential fields
    if (!year || !make || !model) {
      console.log(`[pickles-crawl] Skipping lot ${item.lotId} - couldn't parse: year=${year}, make=${make}, model=${model}`);
      continue;
    }
    
    // Extract km
    const km = parseKm(context);
    
    // Extract location
    const locationPatterns = [
      /(?:Location|Branch|Yard):\s*([A-Za-z\s]+)/i,
      /(Brisbane|Sydney|Melbourne|Perth|Adelaide|Canberra|Darwin|Hobart|Newcastle|Wollongong|Gold Coast|Cairns|Townsville|Rockhampton|Mackay|Toowoomba|Geelong|Ballarat|Bendigo|Launceston)/i,
    ];
    let location: string | null = null;
    for (const lp of locationPatterns) {
      const lm = context.match(lp);
      if (lm) {
        location = lm[1].trim();
        break;
      }
    }
    
    // Extract buy method
    const buyMethodMatch = context.match(/(Pickles Online|Live Auction|Buy Now|Make Offer|Timed Auction)/i);
    const buyMethod = buyMethodMatch ? buyMethodMatch[1] : null;
    
    // Extract auction time
    const auctionTime = parseAuctionDateTime(context);
    
    // Extract transmission
    const transMatch = context.match(/\b(Automatic|Manual|Auto|CVT|DCT)\b/i);
    const transmission = transMatch ? transMatch[1] : null;
    
    listings.push({
      listing_id: `pickles-${item.lotId}`,
      lot_id: item.lotId,
      listing_url: `https://www.pickles.com.au${item.url}`,
      make,
      model,
      year,
      km,
      variant_raw: variant,
      variant_family: deriveVariantFamily(variant),
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
    
    // Pickles cars search URL with 120 items per page
    const baseUrl = 'https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars';
    
    console.log(`[pickles-crawl] Starting Firecrawl-based crawl`);
    console.log(`[pickles-crawl] Max pages: ${maxPages}, Start page: ${startPage}`);
    
    // Create ingestion run record
    const { data: runData, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: 'pickles_crawl',
        status: 'running',
        metadata: { baseUrl, maxPages, startPage, engine: 'firecrawl' }
      })
      .select()
      .single();
    
    if (runError) {
      console.error('[pickles-crawl] Failed to create run record:', runError);
      throw runError;
    }
    
    const runId = runData.id;
    console.log(`[pickles-crawl] Created run: ${runId}`);
    
    let currentPage = startPage;
    let totalListings = 0;
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    let consecutiveEmptyPages = 0;
    
    // Crawl pages using Firecrawl for JS rendering
    while (currentPage <= maxPages && consecutiveEmptyPages < 3) {
      const pageUrl = `${baseUrl}?contentkey=all-cars&limit=120&page=${currentPage}`;
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
          console.error(`[pickles-crawl] Failed to save snapshot:`, uploadError);
        } else {
          console.log(`[pickles-crawl] Saved snapshot: ${snapshotPath}`);
        }
        
        // Parse listings from rendered HTML
        const listings = parseVehicleCards(html);
        console.log(`[pickles-crawl] Page ${currentPage}: Found ${listings.length} listings`);
        
        if (listings.length === 0) {
          consecutiveEmptyPages++;
          console.log(`[pickles-crawl] Empty page, consecutive count: ${consecutiveEmptyPages}`);
        } else {
          consecutiveEmptyPages = 0;
        }
        
        totalListings += listings.length;
        
        // Upsert each listing
        for (const listing of listings) {
          const { data: existing } = await supabase
            .from('vehicle_listings')
            .select('id, first_seen_at, pass_count, relist_count')
            .eq('listing_id', listing.listing_id)
            .single();
          
          const now = new Date().toISOString();
          
          if (existing) {
            // Update existing
            const { error: updateError } = await supabase
              .from('vehicle_listings')
              .update({
                make: listing.make,
                model: listing.model,
                year: listing.year,
                km: listing.km,
                variant_raw: listing.variant_raw,
                variant_family: listing.variant_family,
                transmission: listing.transmission,
                location: listing.location,
                listing_url: listing.listing_url,
                auction_datetime: listing.auction_datetime,
                last_seen_at: now,
                updated_at: now,
              })
              .eq('id', existing.id);
            
            if (updateError) {
              errors.push(`Update ${listing.listing_id}: ${updateError.message}`);
            } else {
              updated++;
            }
          } else {
            // Insert new
            const { error: insertError } = await supabase
              .from('vehicle_listings')
              .insert({
                listing_id: listing.listing_id,
                lot_id: listing.lot_id,
                source: 'pickles_crawl',
                auction_house: 'Pickles',
                make: listing.make,
                model: listing.model,
                year: listing.year,
                km: listing.km,
                variant_raw: listing.variant_raw,
                variant_family: listing.variant_family,
                transmission: listing.transmission,
                location: listing.location,
                listing_url: listing.listing_url,
                auction_datetime: listing.auction_datetime,
                status: 'catalogue',
                first_seen_at: now,
                last_seen_at: now,
              });
            
            if (insertError) {
              errors.push(`Insert ${listing.listing_id}: ${insertError.message}`);
            } else {
              created++;
            }
          }
        }
        
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
    
    // Update run record with results
    const finalStatus = errors.length > totalListings / 2 ? 'failed' : 
                       errors.length > 0 ? 'completed_with_errors' : 'success';
    
    const { error: updateRunError } = await supabase
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
          pagesProcessed: currentPage - startPage,
          engine: 'firecrawl',
        }
      })
      .eq('id', runId);
    
    if (updateRunError) {
      console.error('[pickles-crawl] Failed to update run:', updateRunError);
    }
    
    console.log(`[pickles-crawl] Complete. Pages: ${currentPage - startPage}, Listings: ${totalListings}, Created: ${created}, Updated: ${updated}`);
    
    return new Response(JSON.stringify({
      success: true,
      runId,
      pagesProcessed: currentPage - startPage,
      totalListings,
      created,
      updated,
      errors: errors.slice(0, 10),
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
