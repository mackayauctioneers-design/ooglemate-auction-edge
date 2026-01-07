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
  sitemap_url?: string;      // Sitemap URL if available
  inventory_url?: string;    // Direct inventory page URL
  json_endpoint?: string;    // JSON API endpoint if available
  scrape_config?: {
    selector?: string;       // CSS selector for vehicle cards
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
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Gosford Holden/GM",
    slug: "gosford-holden",
    inventory_url: "https://www.gosfordholden.com.au/used-cars",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Central Coast Mazda",
    slug: "central-coast-mazda",
    inventory_url: "https://www.centralcoastmazda.com.au/used-vehicles",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Wyong Motor Group",
    slug: "wyong-motor-group",
    inventory_url: "https://www.wyongmotorgroup.com.au/used-vehicles",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Erina Toyota",
    slug: "erina-toyota",
    inventory_url: "https://www.erinatoyota.com.au/used-vehicles",
    scrape_config: { pagination: true, max_pages: 5 }
  },
  {
    name: "Tuggerah Motor Group",
    slug: "tuggerah-motor-group",
    inventory_url: "https://www.tuggerahmotorgroup.com.au/used-vehicles",
    scrape_config: { pagination: true, max_pages: 5 }
  },
];

// =============================================================================
// VEHICLE PARSING FROM SCRAPED DATA
// =============================================================================

interface ScrapedVehicle {
  source_listing_id: string;
  make: string;
  model: string;
  year: number;
  variant_raw?: string;
  km?: number;
  price?: number;
  transmission?: string;
  fuel?: string;
  listing_url?: string;
  location: string;
  seller_hints: {
    seller_badge: 'dealer';
    seller_name: string;
    has_abn: boolean;
    has_dealer_keywords: boolean;
  };
}

/**
 * Parse vehicle data from Firecrawl markdown output
 * Attempts to extract structured data from dealer page content
 */
function parseVehiclesFromMarkdown(markdown: string, dealer: DealerConfig, baseUrl: string): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  // Common patterns for vehicle listings in markdown
  // Most dealer sites have structured formats with year make model variant
  const vehiclePatterns = [
    // Pattern: "2023 Toyota HiLux SR5" with price and details
    /(\d{4})\s+(Toyota|Ford|Mazda|Holden|Chevrolet|Nissan|Mitsubishi|Hyundai|Kia|Volkswagen|BMW|Mercedes|Audi|Subaru|Honda|Isuzu|LDV|RAM|Jeep|GWM|MG)\s+([A-Za-z0-9\-\s]+?)(?:\n|\s{2,}|$)/gi,
  ];
  
  // Price patterns
  const pricePattern = /\$\s*([\d,]+)/g;
  
  // KM patterns
  const kmPattern = /(\d{1,3}(?:,\d{3})*)\s*(?:km|kms|kilometres)/gi;
  
  // Split content into potential vehicle blocks
  const blocks = markdown.split(/\n(?=\d{4}\s+)/);
  
  for (const block of blocks) {
    for (const pattern of vehiclePatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(block);
      
      if (match) {
        const year = parseInt(match[1]);
        const make = match[2];
        const modelVariant = match[3].trim();
        
        // Skip if year is unreasonable
        if (year < 2010 || year > new Date().getFullYear() + 1) continue;
        
        // Extract price from the same block
        pricePattern.lastIndex = 0;
        const priceMatch = pricePattern.exec(block);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined;
        
        // Extract KM from the same block
        kmPattern.lastIndex = 0;
        const kmMatch = kmPattern.exec(block);
        const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, '')) : undefined;
        
        // Generate a deterministic ID from the vehicle details
        const sourceId = `${year}-${make}-${modelVariant}-${price || 0}`.toLowerCase().replace(/\s+/g, '-');
        
        // Detect transmission
        const transmission = /\b(auto|automatic)\b/i.test(block) ? 'Automatic' :
                            /\b(manual)\b/i.test(block) ? 'Manual' : undefined;
        
        // Detect fuel
        const fuel = /\b(diesel)\b/i.test(block) ? 'Diesel' :
                    /\b(petrol|unleaded)\b/i.test(block) ? 'Petrol' :
                    /\b(hybrid)\b/i.test(block) ? 'Hybrid' :
                    /\b(electric|ev)\b/i.test(block) ? 'Electric' : undefined;
        
        vehicles.push({
          source_listing_id: sourceId,
          make: make,
          model: modelVariant.split(' ')[0], // First word is usually model
          year: year,
          variant_raw: modelVariant,
          km: km,
          price: price,
          transmission: transmission,
          fuel: fuel,
          listing_url: baseUrl,
          location: "Central Coast, NSW",
          seller_hints: {
            seller_badge: 'dealer',
            seller_name: dealer.name,
            has_abn: true,
            has_dealer_keywords: true,
          }
        });
      }
    }
  }
  
  // Deduplicate by source_listing_id
  const seen = new Set<string>();
  return vehicles.filter(v => {
    if (seen.has(v.source_listing_id)) return false;
    seen.add(v.source_listing_id);
    return true;
  });
}

/**
 * Parse vehicles from JSON-LD or structured data if available
 */
function parseVehiclesFromStructuredData(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  // Look for JSON-LD schema.org/Vehicle or schema.org/Car data
  const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      
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
      }
    } catch {
      // JSON parsing failed, skip this block
    }
  }
  
  return vehicles;
}

function parseSchemaOrgVehicle(data: Record<string, unknown>, dealer: DealerConfig): ScrapedVehicle | null {
  try {
    const name = String(data.name || '');
    const description = String(data.description || '');
    
    // Try to extract year, make, model from name
    const nameMatch = name.match(/(\d{4})\s+(\w+)\s+(.+)/);
    if (!nameMatch) return null;
    
    const year = parseInt(nameMatch[1]);
    const make = nameMatch[2];
    const modelVariant = nameMatch[3];
    
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
    
    const sourceId = String(data.sku || data.productID || `${year}-${make}-${modelVariant}`).toLowerCase().replace(/\s+/g, '-');
    
    return {
      source_listing_id: sourceId,
      make: make,
      model: modelVariant.split(' ')[0],
      year: year,
      variant_raw: modelVariant,
      km: km,
      price: price,
      transmission: String(data.vehicleTransmission || ''),
      fuel: String(data.fuelType || ''),
      listing_url: String(data.url || ''),
      location: "Central Coast, NSW",
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
      const url = dealer.inventory_url || dealer.sitemap_url;
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
            location: v.location,
            state: 'NSW',
            suburb: 'Central Coast',
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
