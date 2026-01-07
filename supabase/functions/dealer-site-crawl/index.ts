import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================================================
// NSW CENTRAL COAST DEALER CONFIGURATION
// =============================================================================

interface DealerConfig {
  name: string;
  slug: string;              // Used for source_name: "dealer_site:{slug}"
  inventory_url: string;     // Direct inventory page URL
  suburb: string;            // Dealer suburb
  state: string;             // Dealer state
  postcode: string;          // Dealer postcode
  scrape_config?: {
    pagination?: boolean;    // Whether to follow pagination
    max_pages?: number;      // Max pages to crawl
  };
}

// NSW Central Coast dealers - start with a focused set
const DEALERS: DealerConfig[] = [
  {
    name: "Central Coast Toyota",
    slug: "central-coast-toyota",
    inventory_url: "https://www.centralcoasttoyota.com.au/used-vehicles",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Gosford Holden/GM",
    slug: "gosford-holden",
    inventory_url: "https://www.gosfordholden.com.au/used-cars",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Central Coast Mazda",
    slug: "central-coast-mazda",
    inventory_url: "https://www.centralcoastmazda.com.au/used-vehicles",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Wyong Motor Group",
    slug: "wyong-motor-group",
    inventory_url: "https://www.wyongmotorgroup.com.au/used-vehicles",
    suburb: "Wyong",
    state: "NSW",
    postcode: "2259",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Erina Toyota",
    slug: "erina-toyota",
    inventory_url: "https://www.erinatoyota.com.au/used-vehicles",
    suburb: "Erina",
    state: "NSW",
    postcode: "2250",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Tuggerah Motor Group",
    slug: "tuggerah-motor-group",
    inventory_url: "https://www.tuggerahmotorgroup.com.au/used-vehicles",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2259",
    scrape_config: { pagination: true, max_pages: 5 }
  },
];

// =============================================================================
// VEHICLE PARSING FROM SCRAPED DATA
// =============================================================================

interface ScrapedVehicle {
  source_listing_id: string;  // Stable ID: sku, productID, stock number, or URL hash
  make: string;
  model: string;
  year: number;
  variant_raw?: string;
  km?: number;
  price?: number;
  transmission?: string;
  fuel?: string;
  listing_url: string;        // Vehicle detail page URL (NOT inventory page)
  suburb: string;
  state: string;
  postcode: string;
  seller_hints: {
    seller_badge: 'dealer';
    seller_name: string;
    has_abn: boolean;
    has_dealer_keywords: boolean;
  };
}

/**
 * Generate a stable hash from a string (for URL-based IDs)
 */
function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Parse vehicle data from Firecrawl markdown output
 * NOTE: Markdown parsing is a fallback - prefer JSON-LD structured data
 * This is limited because we can't get stable IDs or detail URLs from markdown
 */
function parseVehiclesFromMarkdown(_markdown: string, _dealer: DealerConfig, _baseUrl: string): ScrapedVehicle[] {
  // Markdown parsing disabled - cannot get stable source_listing_id or detail URLs
  // All vehicles must come from JSON-LD structured data with proper identifiers
  console.log(`[dealer-site-crawl] Markdown parsing skipped - no stable IDs available`);
  return [];
}

/**
 * Parse vehicles from JSON-LD structured data
 * ONLY parses <script type="application/ld+json"> blocks
 */
function parseVehiclesFromStructuredData(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  // STRICT: Only match <script type="application/ld+json"> blocks
  // Use non-greedy match and handle whitespace variations
  const jsonLdPattern = /<script\s+type\s*=\s*["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim();
      if (!jsonContent) continue;
      
      const data = JSON.parse(jsonContent);
      
      // Handle both single objects and arrays
      const items = Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        if (item['@type'] === 'Vehicle' || item['@type'] === 'Car' || item['@type'] === 'Product') {
          const vehicle = parseSchemaOrgVehicle(item, dealer);
          if (vehicle) vehicles.push(vehicle);
        }
        
        // Check for ItemList containing vehicles
        if (item['@type'] === 'ItemList' && item.itemListElement) {
          for (const listItem of item.itemListElement) {
            const vehicle = parseSchemaOrgVehicle(listItem.item || listItem, dealer);
            if (vehicle) vehicles.push(vehicle);
          }
        }
        
        // Check for @graph containing vehicles
        if (item['@graph'] && Array.isArray(item['@graph'])) {
          for (const graphItem of item['@graph']) {
            if (graphItem['@type'] === 'Vehicle' || graphItem['@type'] === 'Car' || graphItem['@type'] === 'Product') {
              const vehicle = parseSchemaOrgVehicle(graphItem, dealer);
              if (vehicle) vehicles.push(vehicle);
            }
          }
        }
      }
    } catch (e) {
      // JSON parsing failed, skip this block
      console.log(`[dealer-site-crawl] JSON-LD parse error: ${e}`);
    }
  }
  
  return vehicles;
}

/**
 * Parse a schema.org Vehicle/Car/Product into our format
 * Requires stable ID (sku/productID/mpn) or detail URL
 */
function parseSchemaOrgVehicle(data: Record<string, unknown>, dealer: DealerConfig): ScrapedVehicle | null {
  try {
    const name = String(data.name || '');
    
    // Try to extract year, make, model from name
    const nameMatch = name.match(/(\d{4})\s+(\w+)\s+(.+)/);
    if (!nameMatch) return null;
    
    const year = parseInt(nameMatch[1]);
    const make = nameMatch[2];
    const modelVariant = nameMatch[3];
    
    // CRITICAL: Get detail URL - this is required for stable ID and proper listing_url
    const detailUrl = String(data.url || data.mainEntityOfPage || '');
    
    // CRITICAL: Get stable source_listing_id
    // Priority: sku > productID > mpn > vehicleIdentificationNumber > hash of detail URL
    let sourceId: string | null = null;
    
    if (data.sku && String(data.sku).trim()) {
      sourceId = String(data.sku).trim();
    } else if (data.productID && String(data.productID).trim()) {
      sourceId = String(data.productID).trim();
    } else if (data.mpn && String(data.mpn).trim()) {
      sourceId = String(data.mpn).trim();
    } else if (data.vehicleIdentificationNumber && String(data.vehicleIdentificationNumber).trim()) {
      // VIN is stable but might be sensitive - use last 8 chars
      const vin = String(data.vehicleIdentificationNumber).trim();
      sourceId = `vin-${vin.slice(-8)}`;
    } else if (detailUrl) {
      // Hash the detail URL for stability
      sourceId = `url-${stableHash(detailUrl)}`;
    }
    
    // REJECT if no stable ID available
    if (!sourceId) {
      console.log(`[dealer-site-crawl] Skipping vehicle without stable ID: ${name}`);
      return null;
    }
    
    // REJECT if no detail URL (we need this for listing_url)
    if (!detailUrl) {
      console.log(`[dealer-site-crawl] Skipping vehicle without detail URL: ${name}`);
      return null;
    }
    
    // Extract price from offers
    let price: number | undefined;
    const offers = data.offers as Record<string, unknown> | undefined;
    if (offers?.price) {
      price = parseInt(String(offers.price).replace(/[^\d]/g, ''));
    }
    
    // Extract mileage
    let km: number | undefined;
    const mileage = data.mileageFromOdometer as Record<string, unknown> | undefined;
    if (mileage?.value) {
      km = parseInt(String(mileage.value).replace(/[^\d]/g, ''));
    }
    
    // Transmission
    const transmission = data.vehicleTransmission 
      ? String(data.vehicleTransmission) 
      : undefined;
    
    // Fuel type
    const fuel = data.fuelType 
      ? String(data.fuelType) 
      : undefined;
    
    return {
      source_listing_id: sourceId,
      make: make,
      model: modelVariant.split(' ')[0],
      year: year,
      variant_raw: modelVariant,
      km: km,
      price: price,
      transmission: transmission,
      fuel: fuel,
      listing_url: detailUrl,  // Vehicle detail page, NOT inventory page
      suburb: dealer.suburb,
      state: dealer.state,
      postcode: dealer.postcode,
      seller_hints: {
        seller_badge: 'dealer',
        seller_name: dealer.name,
        has_abn: true,
        has_dealer_keywords: true,
      }
    };
  } catch {
    return null;
  }
}

// =============================================================================
// FIRECRAWL INTEGRATION
// =============================================================================

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<FirecrawlResponse> {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown', 'html'],
      waitFor: 3000,  // Wait for JS to render
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[dealer-site-crawl] Firecrawl error for ${url}: ${response.status} ${errorText}`);
    return { success: false, error: `HTTP ${response.status}: ${errorText}` };
  }
  
  return await response.json();
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse request body for optional dealer filter
    let targetDealers = DEALERS;
    try {
      const body = await req.json();
      if (body.dealer_slugs && Array.isArray(body.dealer_slugs)) {
        targetDealers = DEALERS.filter(d => body.dealer_slugs.includes(d.slug));
      }
    } catch {
      // No body or invalid JSON - process all dealers
    }
    
    console.log(`[dealer-site-crawl] Starting crawl of ${targetDealers.length} dealers`);
    
    const results: Array<{
      dealer: string;
      vehiclesFound: number;
      vehiclesIngested: number;
      error?: string;
    }> = [];
    
    for (const dealer of targetDealers) {
      const url = dealer.inventory_url;
      if (!url) {
        results.push({ dealer: dealer.name, vehiclesFound: 0, vehiclesIngested: 0, error: 'No URL configured' });
        continue;
      }
      
      console.log(`[dealer-site-crawl] Scraping ${dealer.name}: ${url}`);
      
      try {
        const scrapeResult = await scrapeWithFirecrawl(url, firecrawlKey);
        
        if (!scrapeResult.success || !scrapeResult.data) {
          console.error(`[dealer-site-crawl] Failed to scrape ${dealer.name}: ${scrapeResult.error}`);
          results.push({ dealer: dealer.name, vehiclesFound: 0, vehiclesIngested: 0, error: scrapeResult.error });
          continue;
        }
        
        // Parse vehicles from both structured data and markdown
        let vehicles: ScrapedVehicle[] = [];
        
        // First try structured data (more reliable)
        if (scrapeResult.data.html) {
          vehicles = parseVehiclesFromStructuredData(scrapeResult.data.html, dealer);
          console.log(`[dealer-site-crawl] ${dealer.name}: Found ${vehicles.length} vehicles from structured data`);
        }
        
        // Fall back to or supplement with markdown parsing
        if (vehicles.length === 0 && scrapeResult.data.markdown) {
          vehicles = parseVehiclesFromMarkdown(scrapeResult.data.markdown, dealer, url);
          console.log(`[dealer-site-crawl] ${dealer.name}: Found ${vehicles.length} vehicles from markdown`);
        }
        
        if (vehicles.length === 0) {
          console.log(`[dealer-site-crawl] ${dealer.name}: No vehicles found`);
          results.push({ dealer: dealer.name, vehiclesFound: 0, vehiclesIngested: 0 });
          continue;
        }
        
        // Post to classifieds-ingest
        const sourceName = `dealer_site:${dealer.slug}`;
        const ingestPayload = {
          source_name: sourceName,
          listings: vehicles.map(v => ({
            source_listing_id: v.source_listing_id,
            make: v.make,
            model: v.model,
            year: v.year,
            variant_raw: v.variant_raw,
            km: v.km,
            price: v.price,
            transmission: v.transmission,
            fuel: v.fuel,
            listing_url: v.listing_url,
            suburb: v.suburb,
            state: v.state,
            postcode: v.postcode,
            seller_hints: v.seller_hints,
          })),
        };
        
        // Call classifieds-ingest directly (same Supabase project)
        const ingestResponse = await fetch(`${supabaseUrl}/functions/v1/classifieds-ingest`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(ingestPayload),
        });
        
        if (!ingestResponse.ok) {
          const errorText = await ingestResponse.text();
          console.error(`[dealer-site-crawl] Ingest failed for ${dealer.name}: ${errorText}`);
          results.push({ dealer: dealer.name, vehiclesFound: vehicles.length, vehiclesIngested: 0, error: `Ingest failed: ${errorText}` });
          continue;
        }
        
        const ingestResult = await ingestResponse.json();
        console.log(`[dealer-site-crawl] ${dealer.name}: Ingested ${ingestResult.created + ingestResult.updated} vehicles`);
        
        results.push({
          dealer: dealer.name,
          vehiclesFound: vehicles.length,
          vehiclesIngested: ingestResult.created + ingestResult.updated,
        });
        
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[dealer-site-crawl] Error processing ${dealer.name}: ${errorMsg}`);
        results.push({ dealer: dealer.name, vehiclesFound: 0, vehiclesIngested: 0, error: errorMsg });
      }
      
      // Rate limit between dealers
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    const totalFound = results.reduce((sum, r) => sum + r.vehiclesFound, 0);
    const totalIngested = results.reduce((sum, r) => sum + r.vehiclesIngested, 0);
    const dealersWithErrors = results.filter(r => r.error).length;
    
    console.log(`[dealer-site-crawl] Complete: ${totalFound} found, ${totalIngested} ingested, ${dealersWithErrors} errors`);
    
    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          dealersProcessed: targetDealers.length,
          totalVehiclesFound: totalFound,
          totalVehiclesIngested: totalIngested,
          dealersWithErrors: dealersWithErrors,
        },
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[dealer-site-crawl] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
