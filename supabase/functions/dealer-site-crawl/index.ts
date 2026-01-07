import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================================================
// DEALER CONFIGURATION - HARDENED WITH PARSER MODES
// =============================================================================

type ParserMode = 'digitaldealer' | 'jsonld_detail' | 'unknown';

interface DealerConfig {
  name: string;
  slug: string;              // Used for source_name: "dealer_site:{slug}"
  inventory_url: string;     // Direct inventory page URL
  suburb: string;            // Dealer suburb
  state: string;             // Dealer state
  postcode: string;          // Dealer postcode
  parser_mode: ParserMode;   // REQUIRED: which parser to use
  enabled: boolean;          // Whether to include in cron runs
}

// Max 10 dealers for initial scale
const DEALERS: DealerConfig[] = [
  {
    name: "Brian Hilton Toyota",
    slug: "brian-hilton-toyota",
    inventory_url: "https://brianhiltontoyota.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    parser_mode: 'digitaldealer',
    enabled: true,
  },
  {
    name: "Central Coast Adventure Cars",
    slug: "central-coast-adventure-cars",
    inventory_url: "https://www.centralcoastadventurecars.com.au/stock/",
    suburb: "Wyoming",
    state: "NSW",
    postcode: "2250",
    parser_mode: 'unknown',  // Parser not verified yet
    enabled: false,
  },
  {
    name: "Central Coast Hyundai",
    slug: "central-coast-hyundai",
    inventory_url: "https://www.centralcoasthyundai.com.au/used-vehicles/",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    parser_mode: 'unknown',  // Parser not verified yet
    enabled: false,
  },
];

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_YEAR = 2016;  // Year focus for dealer-grade
const MIN_PRICE = 3000;
const MAX_PRICE = 150000;

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
  listing_url: string;
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

interface QualityGateResult {
  passed: ScrapedVehicle[];
  dropped: number;
  dropReasons: Record<string, number>;
}

/**
 * Generate a stable hash from a string (for URL-based IDs)
 */
function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Pre-ingest quality gate - enforces strict requirements
 */
function applyQualityGate(vehicles: ScrapedVehicle[]): QualityGateResult {
  const passed: ScrapedVehicle[] = [];
  const dropReasons: Record<string, number> = {};
  
  const addDropReason = (reason: string) => {
    dropReasons[reason] = (dropReasons[reason] || 0) + 1;
  };

  for (const v of vehicles) {
    // GATE 1: Must have source_listing_id
    if (!v.source_listing_id || v.source_listing_id.trim() === '') {
      addDropReason('missing_source_listing_id');
      continue;
    }
    
    // GATE 2: Must have listing_url (detail page)
    if (!v.listing_url || v.listing_url.trim() === '') {
      addDropReason('missing_listing_url');
      continue;
    }
    
    // GATE 3: Classifieds REQUIRE price
    if (v.price === undefined || v.price === null || v.price <= 0) {
      addDropReason('missing_price');
      continue;
    }
    
    // GATE 4: Price must be in range
    if (v.price < MIN_PRICE || v.price > MAX_PRICE) {
      addDropReason('price_out_of_range');
      continue;
    }
    
    // GATE 5: Year must be 2016+ for dealer-grade focus
    if (v.year < MIN_YEAR) {
      addDropReason('year_below_2016');
      continue;
    }
    
    // GATE 6: Basic make/model validation
    if (!v.make || !v.model || v.make.length < 2 || v.model.length < 1) {
      addDropReason('invalid_make_model');
      continue;
    }
    
    passed.push(v);
  }
  
  return {
    passed,
    dropped: vehicles.length - passed.length,
    dropReasons,
  };
}

/**
 * Parse vehicles from HTML using data attributes (DigitalDealer platform pattern)
 */
function parseVehiclesFromDigitalDealer(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  const stockItemPattern = /<div[^>]+class="[^"]*stockListItemView[^"]*"[^>]+data-stocknumber="([^"]+)"[^>]+data-stockid="([^"]+)"[^>]*data-stockprice="([^"]*)"[^>]*data-stockyear="([^"]+)"[^>]*data-stockmake="([^"]+)"[^>]*data-stockmodel="([^"]+)"[^>]*/gi;
  
  let match;
  const processedStockNumbers = new Set<string>();
  
  while ((match = stockItemPattern.exec(html)) !== null) {
    const stockNumber = match[1];
    const stockId = match[2];
    const priceStr = match[3];
    const yearStr = match[4];
    const make = match[5];
    const model = match[6];
    
    if (processedStockNumbers.has(stockNumber)) continue;
    processedStockNumbers.add(stockNumber);
    
    const year = parseInt(yearStr);
    const price = priceStr ? parseInt(priceStr) : undefined;
    
    if (!make || !model || !year || year < 1990 || year > 2030) continue;
    
    // Find detail URL
    const urlPattern = new RegExp(`href="([^"]+${stockNumber.toLowerCase()}-${stockId}[^"]+)"`, 'i');
    const urlMatch = urlPattern.exec(html);
    
    if (!urlMatch) {
      console.log(`[dealer-site-crawl] Skipping ${stockNumber}: no detail URL found`);
      continue;
    }
    
    let detailUrl = urlMatch[1];
    if (detailUrl.startsWith('/')) {
      const baseUrl = new URL(dealer.inventory_url);
      detailUrl = `${baseUrl.origin}${detailUrl}`;
    }
    
    vehicles.push({
      source_listing_id: stockNumber,
      make,
      model,
      year,
      price,
      listing_url: detailUrl,
      suburb: dealer.suburb,
      state: dealer.state,
      postcode: dealer.postcode,
      seller_hints: {
        seller_badge: 'dealer',
        seller_name: dealer.name,
        has_abn: true,
        has_dealer_keywords: true,
      }
    });
  }
  
  console.log(`[dealer-site-crawl] Parsed ${vehicles.length} vehicles from DigitalDealer HTML`);
  return vehicles;
}

/**
 * Parse vehicles from JSON-LD structured data
 */
function parseVehiclesFromJsonLd(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  const jsonLdPattern = /<script\s+type\s*=\s*["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim();
      if (!jsonContent) continue;
      
      const data = JSON.parse(jsonContent);
      const items = Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        if (item['@type'] === 'Vehicle' || item['@type'] === 'Car' || item['@type'] === 'Product') {
          const vehicle = parseSchemaOrgVehicle(item, dealer);
          if (vehicle) vehicles.push(vehicle);
        }
        
        if (item['@type'] === 'ItemList' && item.itemListElement) {
          for (const listItem of item.itemListElement) {
            const vehicle = parseSchemaOrgVehicle(listItem.item || listItem, dealer);
            if (vehicle) vehicles.push(vehicle);
          }
        }
        
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
      console.log(`[dealer-site-crawl] JSON-LD parse error: ${e}`);
    }
  }
  
  return vehicles;
}

function parseSchemaOrgVehicle(data: Record<string, unknown>, dealer: DealerConfig): ScrapedVehicle | null {
  try {
    const name = String(data.name || '');
    const nameMatch = name.match(/(\d{4})\s+(\w+)\s+(.+)/);
    if (!nameMatch) return null;
    
    const year = parseInt(nameMatch[1]);
    const make = nameMatch[2];
    const modelVariant = nameMatch[3];
    
    const detailUrl = String(data.url || data.mainEntityOfPage || '');
    
    let sourceId: string | null = null;
    if (data.sku && String(data.sku).trim()) {
      sourceId = String(data.sku).trim();
    } else if (data.productID && String(data.productID).trim()) {
      sourceId = String(data.productID).trim();
    } else if (data.mpn && String(data.mpn).trim()) {
      sourceId = String(data.mpn).trim();
    } else if (data.vehicleIdentificationNumber && String(data.vehicleIdentificationNumber).trim()) {
      const vin = String(data.vehicleIdentificationNumber).trim();
      sourceId = `vin-${vin.slice(-8)}`;
    } else if (detailUrl) {
      sourceId = `url-${stableHash(detailUrl)}`;
    }
    
    if (!sourceId || !detailUrl) return null;
    
    let price: number | undefined;
    const offers = data.offers as Record<string, unknown> | undefined;
    if (offers?.price) {
      price = parseInt(String(offers.price).replace(/[^\d]/g, ''));
    }
    
    let km: number | undefined;
    const mileage = data.mileageFromOdometer as Record<string, unknown> | undefined;
    if (mileage?.value) {
      km = parseInt(String(mileage.value).replace(/[^\d]/g, ''));
    }
    
    return {
      source_listing_id: sourceId,
      make: make,
      model: modelVariant.split(' ')[0],
      year: year,
      variant_raw: modelVariant,
      km: km,
      price: price,
      transmission: data.vehicleTransmission ? String(data.vehicleTransmission) : undefined,
      fuel: data.fuelType ? String(data.fuelType) : undefined,
      listing_url: detailUrl,
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
      formats: ['html'],
      waitFor: 3000,
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
// HEALTH METRICS - 7-day average comparison
// =============================================================================

async function checkHealthAndAlert(
  supabaseUrl: string,
  supabaseKey: string,
  dealerSlug: string,
  currentFound: number
): Promise<{ alert: boolean; avgLast7Days: number | null }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Get last 7 days of runs for this dealer
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: recentRuns } = await supabase
    .from('dealer_crawl_runs')
    .select('vehicles_found')
    .eq('dealer_slug', dealerSlug)
    .gte('run_date', sevenDaysAgo)
    .order('run_date', { ascending: false })
    .limit(7);
  
  if (!recentRuns || recentRuns.length < 3) {
    // Not enough history to compare
    return { alert: false, avgLast7Days: null };
  }
  
  const runs = recentRuns as { vehicles_found: number }[];
  const avgLast7Days = runs.reduce((sum, r) => sum + r.vehicles_found, 0) / runs.length;
  
  // Alert if current run is >50% below 7-day average
  const dropThreshold = 0.5;
  const alert = avgLast7Days > 0 && currentFound < avgLast7Days * (1 - dropThreshold);
  
  if (alert) {
    console.error(`[dealer-site-crawl] HEALTH ALERT: ${dealerSlug} found ${currentFound} vehicles, 7-day avg is ${avgLast7Days.toFixed(1)} (>50% drop)`);
  }
  
  return { alert, avgLast7Days };
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
    
    // Parse request body
    let targetDealers = DEALERS.filter(d => d.enabled);
    let isCronRun = false;
    
    try {
      const body = await req.json();
      if (body.dealer_slugs && Array.isArray(body.dealer_slugs)) {
        // Manual run with specific dealers
        targetDealers = DEALERS.filter(d => body.dealer_slugs.includes(d.slug));
      }
      if (body.cron === true) {
        isCronRun = true;
        // Cron only runs enabled dealers (max 10)
        targetDealers = DEALERS.filter(d => d.enabled).slice(0, 10);
      }
    } catch {
      // No body - use enabled dealers
    }
    
    console.log(`[dealer-site-crawl] Starting crawl of ${targetDealers.length} dealers (cron: ${isCronRun})`);
    
    const runDate = new Date().toISOString().split('T')[0];
    const results: Array<{
      dealer: string;
      slug: string;
      parserMode: ParserMode;
      vehiclesFound: number;
      vehiclesIngested: number;
      vehiclesDropped: number;
      dropReasons: Record<string, number>;
      healthAlert: boolean;
      error?: string;
    }> = [];
    
    for (const dealer of targetDealers) {
      const runStartedAt = new Date().toISOString();
      
      // Skip unknown parser mode
      if (dealer.parser_mode === 'unknown') {
        console.log(`[dealer-site-crawl] Skipping ${dealer.name}: parser_mode=unknown`);
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: 0,
          vehiclesIngested: 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
          error: 'Parser mode unknown - skipped',
        });
        continue;
      }
      
      console.log(`[dealer-site-crawl] Scraping ${dealer.name} (${dealer.parser_mode}): ${dealer.inventory_url}`);
      
      try {
        const scrapeResult = await scrapeWithFirecrawl(dealer.inventory_url, firecrawlKey);
        
        if (!scrapeResult.success || !scrapeResult.data?.html) {
          const error = scrapeResult.error || 'No HTML returned';
          console.error(`[dealer-site-crawl] Failed to scrape ${dealer.name}: ${error}`);
          
          // Record failed run
          await supabase.from('dealer_crawl_runs').upsert({
            run_date: runDate,
            dealer_slug: dealer.slug,
            dealer_name: dealer.name,
            parser_mode: dealer.parser_mode,
            vehicles_found: 0,
            vehicles_ingested: 0,
            vehicles_dropped: 0,
            error: error,
            run_started_at: runStartedAt,
            run_completed_at: new Date().toISOString(),
          }, { onConflict: 'run_date,dealer_slug' });
          
          results.push({
            dealer: dealer.name,
            slug: dealer.slug,
            parserMode: dealer.parser_mode,
            vehiclesFound: 0,
            vehiclesIngested: 0,
            vehiclesDropped: 0,
            dropReasons: {},
            healthAlert: false,
            error,
          });
          continue;
        }
        
        // Parse based on mode
        let rawVehicles: ScrapedVehicle[] = [];
        if (dealer.parser_mode === 'digitaldealer') {
          rawVehicles = parseVehiclesFromDigitalDealer(scrapeResult.data.html, dealer);
        } else if (dealer.parser_mode === 'jsonld_detail') {
          rawVehicles = parseVehiclesFromJsonLd(scrapeResult.data.html, dealer);
        }
        
        console.log(`[dealer-site-crawl] ${dealer.name}: Found ${rawVehicles.length} raw vehicles`);
        
        // Apply quality gate
        const { passed, dropped, dropReasons } = applyQualityGate(rawVehicles);
        console.log(`[dealer-site-crawl] ${dealer.name}: ${passed.length} passed quality gate, ${dropped} dropped`);
        if (Object.keys(dropReasons).length > 0) {
          console.log(`[dealer-site-crawl] ${dealer.name}: Drop reasons:`, dropReasons);
        }
        
        // Check health metrics
        const { alert: healthAlert, avgLast7Days } = await checkHealthAndAlert(supabaseUrl, supabaseKey, dealer.slug, passed.length);
        
        let vehiclesIngested = 0;
        
        if (passed.length > 0) {
          // Build payload with metadata
          const sourceName = `dealer_site:${dealer.slug}`;
          const ingestPayload = {
            source_name: sourceName,
            source_group: 'dealer_site',
            dealer_slug: dealer.slug,
            listings: passed.map(v => ({
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
          
          const ingestResponse = await fetch(`${supabaseUrl}/functions/v1/classifieds-ingest`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(ingestPayload),
          });
          
          if (ingestResponse.ok) {
            const ingestResult = await ingestResponse.json();
            vehiclesIngested = (ingestResult.created || 0) + (ingestResult.updated || 0);
            console.log(`[dealer-site-crawl] ${dealer.name}: Ingested ${vehiclesIngested} vehicles`);
          } else {
            const errorText = await ingestResponse.text();
            console.error(`[dealer-site-crawl] Ingest failed for ${dealer.name}: ${errorText}`);
          }
        }
        
        // Record successful run
        await supabase.from('dealer_crawl_runs').upsert({
          run_date: runDate,
          dealer_slug: dealer.slug,
          dealer_name: dealer.name,
          parser_mode: dealer.parser_mode,
          vehicles_found: passed.length,
          vehicles_ingested: vehiclesIngested,
          vehicles_dropped: dropped,
          drop_reasons: dropReasons,
          error: null,
          run_started_at: runStartedAt,
          run_completed_at: new Date().toISOString(),
        }, { onConflict: 'run_date,dealer_slug' });
        
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: passed.length,
          vehiclesIngested,
          vehiclesDropped: dropped,
          dropReasons,
          healthAlert,
        });
        
        if (healthAlert && avgLast7Days !== null) {
          console.error(`[dealer-site-crawl] ALERT: ${dealer.slug} vehicles dropped >50% (found: ${passed.length}, 7d avg: ${avgLast7Days.toFixed(1)})`);
        }
        
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[dealer-site-crawl] Error processing ${dealer.name}: ${errorMsg}`);
        
        await supabase.from('dealer_crawl_runs').upsert({
          run_date: runDate,
          dealer_slug: dealer.slug,
          dealer_name: dealer.name,
          parser_mode: dealer.parser_mode,
          vehicles_found: 0,
          vehicles_ingested: 0,
          vehicles_dropped: 0,
          error: errorMsg,
          run_started_at: runStartedAt,
          run_completed_at: new Date().toISOString(),
        }, { onConflict: 'run_date,dealer_slug' });
        
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: 0,
          vehiclesIngested: 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
          error: errorMsg,
        });
      }
      
      // Rate limit between dealers
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    const totalFound = results.reduce((sum, r) => sum + r.vehiclesFound, 0);
    const totalIngested = results.reduce((sum, r) => sum + r.vehiclesIngested, 0);
    const totalDropped = results.reduce((sum, r) => sum + r.vehiclesDropped, 0);
    const dealersWithErrors = results.filter(r => r.error).length;
    const dealersWithHealthAlerts = results.filter(r => r.healthAlert).length;
    
    console.log(`[dealer-site-crawl] Complete: ${totalFound} found, ${totalIngested} ingested, ${totalDropped} dropped, ${dealersWithErrors} errors, ${dealersWithHealthAlerts} health alerts`);
    
    return new Response(
      JSON.stringify({
        success: true,
        isCronRun,
        summary: {
          dealersProcessed: results.length,
          totalVehiclesFound: totalFound,
          totalVehiclesIngested: totalIngested,
          totalVehiclesDropped: totalDropped,
          dealersWithErrors,
          dealersWithHealthAlerts,
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
