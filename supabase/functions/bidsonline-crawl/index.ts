import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedLot {
  lot_id: string;
  make: string;
  model: string;
  variant_raw: string | null;
  year: number;
  km: number | null;
  transmission: string | null;
  fuel: string | null;
  location: string | null;
  auction_datetime: string | null;
  listing_url: string | null;
  reserve: number | null;
  asking_price: number | null;
  status: string;
}

interface DebugInfo {
  url: string;
  rawHtmlLength: number;
  lotBlocksFound: number;
  parsedLots: ParsedLot[];
  parserProfile: string;
  errors: string[];
}

// ============= PARSER PROFILES =============
// Each profile has specific extraction patterns for different BidsOnline variants

interface ParserProfile {
  name: string;
  lotBlockPatterns: RegExp[];
  lotIdPatterns: RegExp[];
  titlePatterns: RegExp[];
  urlPatterns: RegExp[];
}

const PARSER_PROFILES: Record<string, ParserProfile> = {
  bidsonline_default: {
    name: 'BidsOnline Default',
    lotBlockPatterns: [
      /<div[^>]*class=["'][^"']*(?:lot-item|vehicle-card|auction-item|listing-item|stock-item)[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*(?:lot-item|vehicle-card|auction-item|listing-item|stock-item)|$)/gi,
      /<article[^>]*>[\s\S]*?<\/article>/gi,
      /<li[^>]*class=["'][^"']*(?:lot|vehicle|item)[^"']*["'][^>]*>[\s\S]*?<\/li>/gi,
    ],
    lotIdPatterns: [
      /data-(?:lot-)?id=["']([^"']+)["']/i,
      /href=["'][^"']*\/lot[s]?\/(\d+)[^"']*["']/i,
      /href=["'][^"']*[?&](?:item|lot)=(\d+)[^"']*["']/i,
      /(?:stock|lot)\s*#?\s*:?\s*(\d{3,})/i,
    ],
    titlePatterns: [
      /<h\d[^>]*>([^<]+)<\/h\d>/gi,
      /class=["'][^"']*(?:title|heading|name)[^"']*["'][^>]*>([^<]+)/gi,
      /<a[^>]*>([^<]*\d{4}[^<]*(?:toyota|mazda|ford|hyundai|kia|mitsubishi|nissan|holden|volkswagen|honda|subaru)[^<]*)<\/a>/gi,
    ],
    urlPatterns: [
      /href=["']([^"']*(?:lot|vehicle|item)[^"']*)["']/i,
    ],
  },
  bidsonline_grid: {
    name: 'BidsOnline Grid Layout',
    lotBlockPatterns: [
      /<div[^>]*class=["'][^"']*(?:vehicle-card|lot-card|grid-item|card)[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*(?:vehicle-card|lot-card|grid-item|card)|$)/gi,
      /<div[^>]*class=["'][^"']*col[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]*class=["'][^"']*col|$)/gi,
    ],
    lotIdPatterns: [
      /data-id=["']([^"']+)["']/i,
      /data-vehicle-id=["']([^"']+)["']/i,
      /href=["'][^"']*\/(\d{4,})["']/i,
    ],
    titlePatterns: [
      /<h[234][^>]*class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([^<]+)/gi,
      /<div[^>]*class=["'][^"']*(?:vehicle-name|lot-title)[^"']*["'][^>]*>([^<]+)/gi,
    ],
    urlPatterns: [
      /href=["']([^"']+)["'][^>]*class=["'][^"']*(?:details|view|more)/i,
      /<a[^>]*href=["']([^"']+)["']/i,
    ],
  },
  bidsonline_table: {
    name: 'BidsOnline Table Layout',
    lotBlockPatterns: [
      /<tr[^>]*(?:data-lot|data-vehicle|class=["'][^"']*(?:lot|vehicle|item))[^>]*>[\s\S]*?<\/tr>/gi,
    ],
    lotIdPatterns: [
      /data-lot-id=["']([^"']+)["']/i,
      /data-id=["']([^"']+)["']/i,
      /<td[^>]*>(?:Lot\s*)?#?\s*(\d+)/i,
    ],
    titlePatterns: [
      /<td[^>]*class=["'][^"']*(?:vehicle|description|title)[^"']*["'][^>]*>([^<]+)/gi,
    ],
    urlPatterns: [
      /href=["']([^"']+)["']/i,
    ],
  },
  custom_f3: {
    name: 'F3 Motor Auctions',
    lotBlockPatterns: [
      /<div[^>]*class=["'][^"']*stock-item[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*stock-item|$)/gi,
    ],
    lotIdPatterns: [
      /F3-MTA-(\d+)/i,
      /data-stock=["']([^"']+)["']/i,
    ],
    titlePatterns: [
      /<h3[^>]*>([^<]+)<\/h3>/gi,
    ],
    urlPatterns: [
      /href=["']([^"']*stock[^"']*)["']/i,
    ],
  },
  custom_valley: {
    name: 'Valley Motor Auctions',
    lotBlockPatterns: [
      /<div[^>]*class=["'][^"']*vehicle-listing[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*vehicle-listing|$)/gi,
    ],
    lotIdPatterns: [
      /VMA-(\d+)/i,
      /stock_id=["']([^"']+)["']/i,
    ],
    titlePatterns: [
      /<div[^>]*class=["'][^"']*vehicle-title[^"']*["'][^>]*>([^<]+)/gi,
    ],
    urlPatterns: [
      /href=["']([^"']*vehicle-detail[^"']*)["']/i,
    ],
  },
};

// ============= HELPERS =============

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function parseKm(raw: string | null): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[^0-9]/g, '');
  const km = parseInt(clean);
  if (isNaN(km) || km < 100 || km > 999999) return null;
  return km;
}

function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = parseInt(match[0]);
  const currentYear = new Date().getFullYear();
  if (year < 1980 || year > currentYear + 1) return null;
  return year;
}

function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[^0-9]/g, '');
  const price = parseInt(clean);
  if (isNaN(price) || price < 100) return null;
  return price;
}

// ============= LOT PARSING =============

function findLotBlocks(html: string, profile: ParserProfile): string[] {
  for (const pattern of profile.lotBlockPatterns) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      return matches;
    }
  }
  return [];
}

function extractLotId(html: string, profile: ParserProfile): string | null {
  for (const pattern of profile.lotIdPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function extractTitle(html: string, profile: ParserProfile): string | null {
  for (const pattern of profile.titlePatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].trim().length > 5) {
        return match[1].trim();
      }
    }
  }
  return null;
}

function extractUrl(html: string, baseUrl: string, profile: ParserProfile): string | null {
  for (const pattern of profile.urlPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const href = match[1];
      return href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    }
  }
  return null;
}

function parseVehicleFromTitle(title: string): { year: number | null; make: string; model: string; variant: string | null } {
  const result = { year: null as number | null, make: '', model: '', variant: null as string | null };
  
  // Extract year
  const yearMatch = title.match(/\b(20[0-2]\d|19\d{2})\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
  }
  
  // Known makes
  const makes = ['toyota', 'mazda', 'ford', 'hyundai', 'kia', 'mitsubishi', 'nissan', 'holden', 
    'volkswagen', 'honda', 'subaru', 'isuzu', 'mercedes', 'bmw', 'audi', 'lexus', 'suzuki',
    'jeep', 'land rover', 'range rover', 'volvo', 'peugeot', 'renault', 'skoda', 'fiat',
    'alfa romeo', 'mini', 'porsche', 'tesla', 'mg', 'ldv', 'great wall', 'haval', 'gwm'];
  
  const lowerTitle = title.toLowerCase();
  for (const make of makes) {
    if (lowerTitle.includes(make)) {
      result.make = titleCase(make);
      // Extract model (word after make)
      const makeIndex = lowerTitle.indexOf(make);
      const afterMake = title.substring(makeIndex + make.length).trim();
      const parts = afterMake.split(/\s+/);
      if (parts.length > 0) {
        result.model = titleCase(parts[0].replace(/[^a-zA-Z0-9-]/g, ''));
        if (parts.length > 1) {
          result.variant = parts.slice(1).join(' ').trim() || null;
        }
      }
      break;
    }
  }
  
  return result;
}

function parseLotItem(html: string, baseUrl: string, profile: ParserProfile): ParsedLot | null {
  const lotId = extractLotId(html, profile);
  if (!lotId) return null;
  
  const title = extractTitle(html, profile);
  const listingUrl = extractUrl(html, baseUrl, profile);
  
  // Parse vehicle info from title
  let year: number | null = null;
  let make = '';
  let model = '';
  let variantRaw: string | null = null;
  
  if (title) {
    const parsed = parseVehicleFromTitle(title);
    year = parsed.year;
    make = parsed.make;
    model = parsed.model;
    variantRaw = parsed.variant;
  }
  
  // Fallback make detection
  if (!make) {
    const makes = ['toyota', 'mazda', 'ford', 'hyundai', 'kia', 'mitsubishi', 'nissan', 'holden'];
    for (const m of makes) {
      if (html.toLowerCase().includes(m)) {
        make = titleCase(m);
        const modelPattern = new RegExp(`${m}\\s+([a-z0-9-]+)`, 'i');
        const modelMatch = html.match(modelPattern);
        if (modelMatch) model = titleCase(modelMatch[1]);
        break;
      }
    }
  }
  
  if (!make || !model) return null;
  
  // Extract km
  let km: number | null = null;
  const kmPatterns = [
    /(\d{1,3}[,\s]?\d{3})\s*(?:km|kms|kilometres)/i,
    /(?:odometer|odo|kms?)\s*:?\s*(\d{1,3}[,\s]?\d{3})/i,
  ];
  for (const p of kmPatterns) {
    const m = html.match(p);
    if (m) { km = parseKm(m[1]); if (km) break; }
  }
  
  // Transmission
  let transmission: string | null = null;
  if (/\b(?:automatic|auto)\b/i.test(html)) transmission = 'Auto';
  else if (/\bmanual\b/i.test(html)) transmission = 'Manual';
  else if (/\bcvt\b/i.test(html)) transmission = 'CVT';
  
  // Fuel
  let fuel: string | null = null;
  if (/\bdiesel\b/i.test(html)) fuel = 'Diesel';
  else if (/\bpetrol\b/i.test(html) || /\bunleaded\b/i.test(html)) fuel = 'Petrol';
  else if (/\bhybrid\b/i.test(html)) fuel = 'Hybrid';
  else if (/\belectric\b/i.test(html) || /\bev\b/i.test(html)) fuel = 'Electric';
  
  // Price
  let reserve: number | null = null;
  let askingPrice: number | null = null;
  const priceMatches = html.matchAll(/\$\s*([\d,]+)/g);
  for (const m of priceMatches) {
    const price = parsePrice(m[1]);
    if (price && price >= 1000 && price <= 500000) {
      if (!askingPrice) askingPrice = price;
      else if (!reserve) reserve = price;
    }
  }
  
  // Location
  let location: string | null = null;
  const locMatch = html.match(/(?:location|yard|branch)\s*:?\s*([^<,]+)/i);
  if (locMatch) location = titleCase(locMatch[1]).trim();
  
  // Auction date
  let auctionDatetime: string | null = null;
  const dateMatch = html.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    try {
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      let yr = parseInt(dateMatch[3]);
      if (yr < 100) yr += 2000;
      const d = new Date(yr, month, day);
      if (!isNaN(d.getTime())) auctionDatetime = d.toISOString();
    } catch {}
  }
  
  // Status
  let status = 'catalogue';
  const statusText = html.toLowerCase();
  if (/\bsold\b/.test(statusText)) status = 'cleared';
  else if (/\bpassed\s*in\b/.test(statusText) || /\bno\s*sale\b/.test(statusText)) status = 'passed_in';
  else if (/\bwithdrawn\b/.test(statusText)) status = 'withdrawn';
  
  return {
    lot_id: lotId,
    make,
    model,
    variant_raw: variantRaw,
    year: year || new Date().getFullYear(),
    km,
    transmission,
    fuel,
    location,
    auction_datetime: auctionDatetime,
    listing_url: listingUrl,
    reserve,
    asking_price: askingPrice,
    status,
  };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { source_key, debug = false } = body;

    if (!source_key) {
      return new Response(
        JSON.stringify({ error: 'Must provide source_key' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up source from registry
    const { data: auctionSource, error: sourceError } = await supabase
      .from('auction_sources')
      .select('*')
      .eq('source_key', source_key)
      .single();
    
    if (sourceError || !auctionSource) {
      return new Response(
        JSON.stringify({ error: `Auction source not found: ${source_key}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CRITICAL: Require preflight pass before crawling
    if (auctionSource.preflight_status !== 'pass' && !debug) {
      return new Response(
        JSON.stringify({ 
          error: 'Preflight required', 
          message: `Source ${source_key} has not passed preflight (status: ${auctionSource.preflight_status}). Run auction-preflight first.`,
          preflight_status: auctionSource.preflight_status,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if source is enabled (skip for debug mode)
    if (!auctionSource.enabled && !debug) {
      return new Response(
        JSON.stringify({ error: `Auction source is disabled: ${source_key}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const listUrl = auctionSource.list_url;
    const regionHint = auctionSource.region_hint;
    const parserProfileName = auctionSource.parser_profile || 'bidsonline_default';
    const profile = PARSER_PROFILES[parserProfileName] || PARSER_PROFILES.bidsonline_default;

    console.log(`[bidsonline-crawl] Crawling: ${listUrl} (source: ${source_key}, profile: ${parserProfileName})`);

    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch page with Firecrawl
    const crawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url: listUrl,
        formats: ['html'],
        waitFor: 3000,
      }),
    });

    if (!crawlResponse.ok) {
      const errorText = await crawlResponse.text();
      console.error(`[bidsonline-crawl] Firecrawl error: ${errorText}`);
      
      // Update auction source with error and increment failure
      const failures = (auctionSource.consecutive_failures || 0) + 1;
      await supabase
        .from('auction_sources')
        .update({ 
          last_error: `Firecrawl: ${crawlResponse.status}`,
          consecutive_failures: failures,
          ...(failures >= 3 ? {
            enabled: false,
            auto_disabled_at: new Date().toISOString(),
            auto_disabled_reason: `3 consecutive crawl failures`,
          } : {}),
        })
        .eq('source_key', source_key);
      
      return new Response(
        JSON.stringify({ error: `Firecrawl failed: ${crawlResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const crawlData = await crawlResponse.json();
    const html = crawlData.data?.html || '';
    
    if (!html) {
      console.error('[bidsonline-crawl] No HTML returned from Firecrawl');
      return new Response(
        JSON.stringify({ error: 'No HTML content returned' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[bidsonline-crawl] Got ${html.length} bytes of HTML, using profile: ${profile.name}`);

    // Parse lots using selected profile
    const lotBlocks = findLotBlocks(html, profile);
    console.log(`[bidsonline-crawl] Found ${lotBlocks.length} lot blocks`);

    const parsedLots: ParsedLot[] = [];
    const errors: string[] = [];
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;

    for (const block of lotBlocks) {
      try {
        const lot = parseLotItem(block, listUrl, profile);
        if (lot) {
          // Apply 10-year window filter
          if (lot.year >= minYear) {
            parsedLots.push(lot);
          }
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    console.log(`[bidsonline-crawl] Parsed ${parsedLots.length} valid lots (10-year window: ${minYear}+)`);

    // Debug mode - return parsed data without ingesting
    if (debug) {
      const debugInfo: DebugInfo = {
        url: listUrl,
        rawHtmlLength: html.length,
        lotBlocksFound: lotBlocks.length,
        parsedLots,
        parserProfile: parserProfileName,
        errors,
      };
      return new Response(
        JSON.stringify(debugInfo),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No lots found
    if (parsedLots.length === 0) {
      console.log('[bidsonline-crawl] No valid lots found');
      
      await supabase.from('cron_audit_log').insert({
        cron_name: `bidsonline-crawl:${source_key}`,
        success: true,
        result: { lotsFound: 0, message: 'No late-model lots found' },
      });
      
      return new Response(
        JSON.stringify({ success: true, lotsFound: 0, message: 'No late-model lots found on page' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== CANONICAL LISTING_ID: {source_key}:{platform_lot_id} =====
    // Map to ingest format with CANONICAL IDs
    const ingestPayload = parsedLots.map(lot => ({
      // CANONICAL: listing_id = source_key:lot_id (NOT "BIDSONLINE:" prefix)
      lot_id: `${source_key}:${lot.lot_id}`,
      make: lot.make,
      model: lot.model,
      variant: lot.variant_raw,
      year: lot.year,
      km: lot.km,
      transmission: lot.transmission,
      fuel: lot.fuel,
      location: lot.location || regionHint.replace('NSW_', '').replace('_', ' '),
      auction_datetime: lot.auction_datetime,
      url: lot.listing_url,
      listing_url: lot.listing_url,
      reserve: lot.reserve,
      price: lot.asking_price,
      status: lot.status,
    }));

    console.log(`[bidsonline-crawl] Calling nsw-regional-ingest with ${ingestPayload.length} lots`);

    // Call ingest function with source = source_key (canonical)
    const ingestResponse = await fetch(`${supabaseUrl}/functions/v1/nsw-regional-ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        lots: ingestPayload,
        source: source_key, // CANONICAL: source = source_key
      }),
    });

    const ingestResult = await ingestResponse.json();
    
    if (!ingestResponse.ok) {
      console.error(`[bidsonline-crawl] Ingest error: ${JSON.stringify(ingestResult)}`);
      return new Response(
        JSON.stringify({ error: 'Ingest failed', details: ingestResult }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update auction source with success
    const validationRuns = (auctionSource.validation_runs || 0) + 1;
    const successfulRuns = (auctionSource.successful_validation_runs || 0) + (ingestResult.created > 0 || ingestResult.updated > 0 ? 1 : 0);
    
    const updateData: Record<string, unknown> = {
      last_success_at: new Date().toISOString(),
      last_lots_found: parsedLots.length,
      last_error: null,
      consecutive_failures: 0,
      validation_runs: validationRuns,
      successful_validation_runs: successfulRuns,
      updated_at: new Date().toISOString(),
    };

    // Auto-enable after 2 successful validation runs
    if (successfulRuns >= 2 && !auctionSource.enabled) {
      updateData.enabled = true;
      updateData.validation_status = 'validated';
      console.log(`[bidsonline-crawl] Auto-enabling ${source_key} after ${successfulRuns} successful runs`);
    }

    await supabase
      .from('auction_sources')
      .update(updateData)
      .eq('source_key', source_key);

    console.log(`[bidsonline-crawl] Complete: ${ingestResult.created} created, ${ingestResult.updated} updated, ${ingestResult.snapshotsAdded} snapshots`);

    return new Response(
      JSON.stringify({
        success: true,
        source_key,
        parserProfile: parserProfileName,
        lotsFound: parsedLots.length,
        ...ingestResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[bidsonline-crawl] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});