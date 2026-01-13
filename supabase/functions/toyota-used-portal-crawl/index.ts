import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * toyota-used-portal-crawl
 * 
 * Crawls Toyota's used vehicle portal to discover listings and extract dealer info.
 * Uses Firecrawl with extended wait times for JS-heavy SPA.
 * Falls back to direct fetch + JSON-LD extraction if Firecrawl fails.
 */

interface PortalListing {
  external_id: string;
  listing_url: string;
  year: number;
  make: string;
  model: string;
  variant_raw?: string;
  km?: number;
  price?: number;
  dealer_name?: string;
  dealer_location?: string;
  dealer_url?: string;
  transmission?: string;
  fuel?: string;
  drivetrain?: string;
  body_type?: string;
}

const PORTAL_BASE_URL = 'https://www.toyota.com.au/used-vehicles/search/';

// Quality gates
const MIN_YEAR = new Date().getFullYear() - 10;
const MAX_KM = 400000;
const MIN_PRICE = 3000;
const MAX_PRICE = 200000;

function validateListing(listing: Partial<PortalListing>): boolean {
  if (!listing.year || listing.year < MIN_YEAR) return false;
  if (!listing.make || !listing.model) return false;
  if (listing.km !== undefined && (listing.km < 0 || listing.km > MAX_KM)) return false;
  if (listing.price !== undefined && (listing.price < MIN_PRICE || listing.price > MAX_PRICE)) return false;
  return true;
}

// Generate stable external ID
function generateExternalId(listing: Partial<PortalListing>, index: number): string {
  // Prefer URL-based ID
  if (listing.listing_url) {
    const urlMatch = listing.listing_url.match(/\/(\d+)\/?$/);
    if (urlMatch) return `toyota_portal_${urlMatch[1]}`;
    
    // Try hash of URL
    const hash = simpleHash(listing.listing_url);
    return `toyota_portal_url_${hash}`;
  }
  
  // Fallback: composite key
  const parts = [
    listing.year || 'UNKNOWN',
    listing.make || 'TOYOTA',
    listing.model || 'UNKNOWN',
    listing.km || 0,
    listing.dealer_name || 'UNKNOWN',
    index
  ];
  return `toyota_portal_${simpleHash(parts.join('|'))}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Parse listings from HTML content
function parseListingsFromHtml(html: string): PortalListing[] {
  const listings: PortalListing[] = [];
  
  // Try JSON-LD first
  const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const json = JSON.parse(match[1]);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item['@type'] === 'Vehicle' || item['@type'] === 'Car' || item['@type'] === 'Product') {
          const listing = parseJsonLdVehicle(item);
          if (listing && validateListing(listing)) {
            listings.push(listing as PortalListing);
          }
        }
        // Check for ItemList
        if (item['@type'] === 'ItemList' && item.itemListElement) {
          for (const elem of item.itemListElement) {
            if (elem.item && (elem.item['@type'] === 'Vehicle' || elem.item['@type'] === 'Car')) {
              const listing = parseJsonLdVehicle(elem.item);
              if (listing && validateListing(listing)) {
                listings.push(listing as PortalListing);
              }
            }
          }
        }
      }
    } catch {
      // Invalid JSON-LD, continue
    }
  }
  
  if (listings.length > 0) {
    console.log(`[toyota-portal] Found ${listings.length} listings from JSON-LD`);
    return listings;
  }
  
  // Fallback: parse vehicle cards from HTML patterns
  // Look for common card patterns
  const cardPatterns = [
    // Toyota-specific patterns
    /<div[^>]*class="[^"]*vehicle-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    /<article[^>]*class="[^"]*vehicle[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
    /<a[^>]*href="[^"]*\/used-vehicles\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
  ];
  
  for (const pattern of cardPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const cardHtml = match[0];
      const listing = parseVehicleCard(cardHtml);
      if (listing && validateListing(listing)) {
        listings.push(listing as PortalListing);
      }
    }
    if (listings.length > 0) break;
  }
  
  console.log(`[toyota-portal] Parsed ${listings.length} listings from HTML`);
  return listings;
}

function parseJsonLdVehicle(item: any): Partial<PortalListing> | null {
  try {
    const name = item.name || item.vehicleModelDate || '';
    const yearMatch = name.match(/\b(20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : item.modelDate ? parseInt(item.modelDate) : null;
    
    // Extract make/model
    let make = item.brand?.name || item.manufacturer?.name || 'TOYOTA';
    let model = item.model || '';
    
    // Try to parse from name if model is empty
    if (!model && name) {
      const parts = name.replace(/\d{4}/, '').trim().split(/\s+/);
      if (parts.length >= 2) {
        make = parts[0];
        model = parts.slice(1).join(' ');
      } else if (parts.length === 1) {
        model = parts[0];
      }
    }
    
    const km = item.mileageFromOdometer?.value 
      ? parseInt(item.mileageFromOdometer.value) 
      : null;
    
    const price = item.offers?.price 
      ? parseInt(item.offers.price) 
      : item.price 
        ? parseInt(item.price) 
        : null;
    
    return {
      external_id: item.sku || item.productID || item.identifier || '',
      listing_url: item.url || item.offers?.url || '',
      year: year || 0,
      make: make.toUpperCase(),
      model: model.toUpperCase(),
      variant_raw: item.vehicleConfiguration || item.bodyType || '',
      km: km || undefined,
      price: price || undefined,
      dealer_name: item.seller?.name || item.offers?.seller?.name || '',
      dealer_location: item.seller?.address?.addressLocality || '',
      dealer_url: item.seller?.url || '',
      transmission: item.vehicleTransmission || '',
      fuel: item.fuelType || '',
      body_type: item.bodyType || '',
    };
  } catch {
    return null;
  }
}

function parseVehicleCard(cardHtml: string): Partial<PortalListing> | null {
  try {
    // Extract URL
    const urlMatch = cardHtml.match(/href="([^"]*\/used-vehicles\/[^"]*)"/i);
    const url = urlMatch ? urlMatch[1] : '';
    
    // Extract title/name
    const titleMatch = cardHtml.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i) 
      || cardHtml.match(/title="([^"]+)"/i)
      || cardHtml.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // Parse year from title
    const yearMatch = title.match(/\b(20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : 0;
    
    // Extract price
    const priceMatch = cardHtml.match(/\$[\s]*([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined;
    
    // Extract km
    const kmMatch = cardHtml.match(/([\d,]+)\s*km/i);
    const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, '')) : undefined;
    
    // Parse make/model from title
    let make = 'TOYOTA';
    let model = '';
    const cleanTitle = title.replace(/\b20\d{2}\b/, '').trim();
    const parts = cleanTitle.split(/\s+/);
    if (parts.length >= 2) {
      if (parts[0].toUpperCase() === 'TOYOTA') {
        model = parts.slice(1).join(' ');
      } else {
        make = parts[0];
        model = parts.slice(1).join(' ');
      }
    } else if (parts.length === 1) {
      model = parts[0];
    }
    
    // Extract dealer info
    const dealerMatch = cardHtml.match(/dealer[^>]*>([^<]+)</i);
    const dealer_name = dealerMatch ? dealerMatch[1].trim() : '';
    
    const locationMatch = cardHtml.match(/location[^>]*>([^<]+)</i)
      || cardHtml.match(/(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i);
    const dealer_location = locationMatch ? locationMatch[1].trim() : '';
    
    return {
      external_id: '',
      listing_url: url.startsWith('http') ? url : `https://www.toyota.com.au${url}`,
      year,
      make: make.toUpperCase(),
      model: model.toUpperCase(),
      km,
      price,
      dealer_name,
      dealer_location,
    };
  } catch {
    return null;
  }
}

async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<string | null> {
  try {
    console.log(`[toyota-portal] Attempting Firecrawl scrape: ${url}`);
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['html', 'markdown'],
        waitFor: 8000, // Extended wait for JS
        onlyMainContent: false,
      }),
    });
    
    if (!response.ok) {
      console.error(`[toyota-portal] Firecrawl error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data.data?.html || data.html || null;
  } catch (error) {
    console.error('[toyota-portal] Firecrawl failed:', error);
    return null;
  }
}

async function directFetch(url: string): Promise<string | null> {
  try {
    console.log(`[toyota-portal] Direct fetch: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    if (!response.ok) {
      console.error(`[toyota-portal] Direct fetch error: ${response.status}`);
      return null;
    }
    
    return await response.text();
  } catch (error) {
    console.error('[toyota-portal] Direct fetch failed:', error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse request params
    let state = 'NSW';
    let maxPages = 3;
    let minYear = MIN_YEAR;
    
    try {
      const body = await req.json();
      state = body.state || state;
      maxPages = body.maxPages || maxPages;
      minYear = body.minYear || minYear;
    } catch {
      // Use defaults
    }
    
    console.log(`[toyota-portal] Starting crawl: state=${state}, maxPages=${maxPages}, minYear=${minYear}`);
    
    const allListings: PortalListing[] = [];
    const dealersSeen = new Map<string, { location: string; url?: string; count: number }>();
    
    // Build search URL with filters
    const searchUrl = `${PORTAL_BASE_URL}?state=${state}&minYear=${minYear}`;
    
    // Attempt scrape
    let html: string | null = null;
    
    if (firecrawlKey) {
      html = await scrapeWithFirecrawl(searchUrl, firecrawlKey);
    }
    
    if (!html) {
      console.log('[toyota-portal] Firecrawl unavailable or failed, trying direct fetch');
      html = await directFetch(searchUrl);
    }
    
    if (!html) {
      console.error('[toyota-portal] All scrape methods failed');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to scrape Toyota portal',
          listings_found: 0,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse listings
    const pageListings = parseListingsFromHtml(html);
    
    // Assign external IDs and track dealers
    for (let i = 0; i < pageListings.length; i++) {
      const listing = pageListings[i];
      
      if (!listing.external_id) {
        listing.external_id = generateExternalId(listing, i);
      }
      
      // Track dealer
      if (listing.dealer_name) {
        const existing = dealersSeen.get(listing.dealer_name);
        if (existing) {
          existing.count++;
        } else {
          dealersSeen.set(listing.dealer_name, {
            location: listing.dealer_location || '',
            url: listing.dealer_url,
            count: 1,
          });
        }
      }
      
      allListings.push(listing);
    }
    
    console.log(`[toyota-portal] Found ${allListings.length} valid listings, ${dealersSeen.size} unique dealers`);
    
    if (allListings.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No listings found - portal may require JS rendering or API access',
          listings_found: 0,
          dealers_found: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Call ingest function
    const ingestPayload = {
      listings: allListings,
      source_name: 'toyota_used_portal',
      dealers: Array.from(dealersSeen.entries()).map(([name, info]) => ({
        name,
        location: info.location,
        url: info.url,
        listing_count: info.count,
      })),
    };
    
    // Invoke toyota-portal-ingest
    const { data: ingestResult, error: ingestError } = await supabase.functions.invoke(
      'toyota-portal-ingest',
      { body: ingestPayload }
    );
    
    if (ingestError) {
      console.error('[toyota-portal] Ingest failed:', ingestError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Ingest failed: ${ingestError.message}`,
          listings_found: allListings.length,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        listings_found: allListings.length,
        dealers_found: dealersSeen.size,
        ingest_result: ingestResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[toyota-portal] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
