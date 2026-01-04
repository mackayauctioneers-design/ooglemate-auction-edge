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
  // Try YYYY format
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) return parseInt(yearMatch[0]);
  
  // Try compliance date MM/YYYY
  const compMatch = text.match(/\d{2}\/(19|20\d{2})/);
  if (compMatch) return parseInt(compMatch[1]);
  
  return null;
}

// Parse km from text
function parseKm(text: string): number | null {
  const kmMatch = text.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometres)/i);
  if (kmMatch) {
    return parseInt(kmMatch[1].replace(/,/g, ''));
  }
  return null;
}

// Parse auction datetime from card
function parseAuctionDateTime(text: string): string | null {
  // Common patterns: "Wed 15 Jan 10:00 AM", "15/01/2026 10:00"
  const patterns = [
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        // For simplicity, return the matched text - actual parsing would need more context
        return match[0];
      } catch {
        continue;
      }
    }
  }
  return null;
}

// Parse vehicle cards from HTML
function parseVehicleCards(html: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  
  // Multiple patterns to match different card formats
  // Pattern 1: JSON-LD structured data
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonMatch;
  while ((jsonMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data['@type'] === 'Product' || data['@type'] === 'Vehicle') {
        // Extract from structured data
        console.log('[pickles-crawl] Found JSON-LD product data');
      }
    } catch {
      // Skip invalid JSON
    }
  }
  
  // Pattern 2: Vehicle card divs - look for common Pickles patterns
  // Match href patterns like /used/item/toyota-hilux-xxx-12345
  const cardPattern = /<a[^>]*href=["'](\/used\/item\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
  const hrefPattern = /href=["'](\/used\/item\/([^"']+))["']/gi;
  
  // Find all item links
  const itemLinks: Set<string> = new Set();
  let hrefMatch;
  while ((hrefMatch = hrefPattern.exec(html)) !== null) {
    itemLinks.add(hrefMatch[1]);
  }
  
  // Pattern 3: Look for vehicle data in structured attributes
  // data-make, data-model, data-year patterns
  const dataAttrPattern = /data-(?:make|model|year|km|vin|stockno)=["']([^"']+)["']/gi;
  
  // Pattern 4: Parse from visible text in cards
  // Look for vehicle title patterns like "2023 Toyota Hilux SR5"
  const titlePattern = /(19|20)\d{2}\s+(\w+)\s+(\w+(?:\s+\w+)?)/g;
  
  // Extract unique lot IDs from URLs
  const lotIdPattern = /\/used\/item\/[^\/]+-(\d+)/g;
  let lotMatch;
  while ((lotMatch = lotIdPattern.exec(html)) !== null) {
    const lotId = lotMatch[1];
    const fullPath = lotMatch[0];
    
    // Find the surrounding card content for this lot
    const cardStartIdx = html.lastIndexOf('<', lotMatch.index);
    const cardEndIdx = html.indexOf('</a>', lotMatch.index) + 4;
    
    if (cardStartIdx !== -1 && cardEndIdx > cardStartIdx) {
      const cardHtml = html.substring(Math.max(0, lotMatch.index - 2000), Math.min(html.length, lotMatch.index + 2000));
      
      // Extract title/vehicle info
      const titleMatch = cardHtml.match(/(19|20)(\d{2})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+([A-Z][a-z]+(?:\s+[A-Z0-9]+)?)/i);
      
      if (titleMatch) {
        const year = parseInt(titleMatch[1] + titleMatch[2]);
        const make = titleMatch[3].trim();
        const modelVariant = titleMatch[4].trim();
        
        // Split model and variant
        const parts = modelVariant.split(/\s+/);
        const model = parts[0];
        const variant = parts.slice(1).join(' ') || null;
        
        // Extract km
        const km = parseKm(cardHtml);
        
        // Extract location
        const locationMatch = cardHtml.match(/(?:Location|Branch):\s*([^<,]+)/i) || 
                              cardHtml.match(/(Brisbane|Sydney|Melbourne|Perth|Adelaide|Canberra|Darwin|Hobart|Newcastle|Wollongong|Gold Coast|Cairns)/i);
        const location = locationMatch ? locationMatch[1].trim() : null;
        
        // Extract buy method
        const buyMethodMatch = cardHtml.match(/(Pickles Online|Live Auction|Buy Now|Make Offer)/i);
        const buyMethod = buyMethodMatch ? buyMethodMatch[1] : null;
        
        // Extract auction time
        const auctionTime = parseAuctionDateTime(cardHtml);
        
        listings.push({
          listing_id: `pickles-${lotId}`,
          lot_id: lotId,
          listing_url: `https://www.pickles.com.au${fullPath}`,
          make,
          model,
          year,
          km,
          variant_raw: variant,
          variant_family: deriveVariantFamily(variant),
          transmission: cardHtml.match(/\b(Auto|Manual|CVT|DCT)\b/i)?.[1] || null,
          location,
          auction_datetime: auctionTime,
          buy_method: buyMethod,
        });
      }
    }
  }
  
  // Dedupe by lot_id
  const seen = new Set<string>();
  return listings.filter(l => {
    if (seen.has(l.lot_id)) return false;
    seen.add(l.lot_id);
    return true;
  });
}

// Sleep helper for backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { baseUrl, maxPages = 20, startPage = 1 } = await req.json();
    
    // Default Pickles cars URL if not provided
    const crawlBaseUrl = baseUrl || 'https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars?contentkey=all-cars&limit=120';
    
    console.log(`[pickles-crawl] Starting crawl from: ${crawlBaseUrl}`);
    console.log(`[pickles-crawl] Max pages: ${maxPages}, Start page: ${startPage}`);
    
    // Create ingestion run record
    const { data: runData, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: 'pickles_crawl',
        status: 'running',
        metadata: { baseUrl: crawlBaseUrl, maxPages, startPage }
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
    let lastPageListingCount = -1;
    
    // Crawl pages with low concurrency
    while (currentPage <= maxPages && consecutiveEmptyPages < 2) {
      const pageUrl = `${crawlBaseUrl}&page=${currentPage}`;
      console.log(`[pickles-crawl] Fetching page ${currentPage}: ${pageUrl}`);
      
      try {
        // Fetch with retry and backoff
        let html = '';
        let fetchAttempt = 0;
        const maxAttempts = 3;
        
        while (fetchAttempt < maxAttempts) {
          try {
            const response = await fetch(pageUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-AU,en;q=0.9',
              },
            });
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            html = await response.text();
            break;
          } catch (fetchError) {
            fetchAttempt++;
            console.error(`[pickles-crawl] Fetch attempt ${fetchAttempt} failed:`, fetchError);
            if (fetchAttempt < maxAttempts) {
              const backoffMs = Math.pow(2, fetchAttempt) * 1000;
              console.log(`[pickles-crawl] Backing off ${backoffMs}ms...`);
              await sleep(backoffMs);
            } else {
              throw fetchError;
            }
          }
        }
        
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
        
        // Parse listings from HTML
        const listings = parseVehicleCards(html);
        console.log(`[pickles-crawl] Page ${currentPage}: Found ${listings.length} listings`);
        
        // Check for empty page or repeat
        if (listings.length === 0) {
          consecutiveEmptyPages++;
          console.log(`[pickles-crawl] Empty page, consecutive count: ${consecutiveEmptyPages}`);
        } else if (listings.length === lastPageListingCount && currentPage > 1) {
          // Might be repeating - check first listing
          console.log(`[pickles-crawl] Same count as last page, might be done`);
          consecutiveEmptyPages++;
        } else {
          consecutiveEmptyPages = 0;
        }
        
        lastPageListingCount = listings.length;
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
        
        // Rate limit - wait between pages
        if (currentPage < maxPages) {
          await sleep(2000); // 2 second delay between pages
        }
        
      } catch (pageError) {
        const errMsg = pageError instanceof Error ? pageError.message : 'Unknown error';
        errors.push(`Page ${currentPage}: ${errMsg}`);
        console.error(`[pickles-crawl] Page ${currentPage} error:`, pageError);
      }
      
      currentPage++;
    }
    
    // Update run record with results
    const { error: updateRunError } = await supabase
      .from('ingestion_runs')
      .update({
        status: errors.length > 0 ? 'completed_with_errors' : 'success',
        completed_at: new Date().toISOString(),
        lots_found: totalListings,
        lots_created: created,
        lots_updated: updated,
        errors: errors.slice(0, 50), // Cap at 50 errors
        metadata: {
          baseUrl: crawlBaseUrl,
          maxPages,
          startPage,
          pagesProcessed: currentPage - startPage,
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
