/**
 * Generic ASP Auction Crawler
 * Handles auction sites using ASP patterns (F3, AAV, etc.)
 * 
 * Canonical listing_id: {source_key}:{MTA_ID}
 * Supports parser_profile for site-specific variations
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedVehicle {
  lot_id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  km: number | null;
  transmission: string | null;
  fuel: string | null;
  drivetrain: string | null;
  location: string;
  auction_datetime: string | null;
  listing_url: string | null;
  price: number | null;
  status: string;
}

interface SiteConfig {
  defaultLocation: string;
  urlPrefix: string;
  parserType: 'f3_result_item' | 'aav_listing_grid';
}

const SITE_CONFIGS: Record<string, SiteConfig> = {
  'f3': {
    defaultLocation: 'Beresfield',
    urlPrefix: 'https://www.f3motorauctions.com.au/',
    parserType: 'f3_result_item',
  },
  'f3_motor_auctions': {
    defaultLocation: 'Beresfield',
    urlPrefix: 'https://www.f3motorauctions.com.au/',
    parserType: 'f3_result_item',
  },
  'auto_auctions_aav': {
    defaultLocation: 'Sydney',
    urlPrefix: 'https://www.auto-auctions.com.au/',
    parserType: 'aav_listing_grid',
  },
  'valley_motor_auctions': {
    defaultLocation: 'Rutherford',
    urlPrefix: 'https://www.valleymotorauctions.com.au/',
    parserType: 'f3_result_item',  // Uses same F3 result-item structure
  },
};

// Known Australian makes
const KNOWN_MAKES = [
  'toyota', 'ford', 'holden', 'mazda', 'nissan', 'mitsubishi', 'hyundai', 'kia',
  'isuzu', 'volkswagen', 'mercedes', 'bmw', 'audi', 'subaru', 'honda', 'suzuki',
  'jeep', 'land rover', 'lexus', 'volvo', 'peugeot', 'renault', 'ram', 'ldv',
  'great wall', 'haval', 'mg', 'gwm', 'byd', 'tesla', 'ssangyong', 'alfa romeo',
  'porsche', 'jaguar', 'mini', 'fiat', 'citroen', 'skoda', 'seat', 'cupra',
  'genesis', 'infiniti', 'maserati', 'ferrari', 'lamborghini', 'bentley', 'rolls-royce',
];

function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function parseKm(text: string): number | null {
  const match = text.replace(/,/g, '').match(/(\d+)\s*(?:km|kms)/i);
  return match ? parseInt(match[1]) : null;
}

function parseYear(text: string): number | null {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

function parseTransmission(text: string): string | null {
  if (/\bAUTOMATIC\b/i.test(text) || /\bAUTO\b/i.test(text) || /\bAUT\b/i.test(text)) return 'Auto';
  if (/\bMANUAL\b/i.test(text) || /\bMAN\b/i.test(text)) return 'Manual';
  if (/\bCVT\b/i.test(text)) return 'CVT';
  if (/\bS-TRONIC\b/i.test(text) || /\bDSG\b/i.test(text)) return 'Auto';
  return null;
}

function parseFuel(text: string): string | null {
  if (/\bDIESEL\b/i.test(text)) return 'Diesel';
  if (/\bPETROL\b/i.test(text) || /\bUNLEADED\b/i.test(text) || /\bPREMIUM\b/i.test(text)) return 'Petrol';
  if (/\bHYBRID\b/i.test(text)) return 'Hybrid';
  if (/\bELECTRIC\b/i.test(text)) return 'Electric';
  return null;
}

function parseDrivetrain(text: string): string | null {
  if (/\b4[xX]4\b/.test(text) || /\b4WD\b/i.test(text)) return '4WD';
  if (/\bAWD\b/i.test(text)) return 'AWD';
  if (/\b4[xX]2\b/.test(text) || /\b2WD\b/i.test(text)) return '2WD';
  return null;
}

// Parse vehicle from F3-style result-item HTML block
function parseF3ResultItem(itemHtml: string, sourceKey: string, config: SiteConfig): ParsedVehicle | null {
  const mtaMatch = itemHtml.match(/MTA=(\d+)/);
  if (!mtaMatch) return null;
  const mtaId = mtaMatch[1];
  
  const titleMatch = itemHtml.match(/<h4[^>]*class="result-item-title"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  if (!title) return null;
  
  const year = parseYear(title);
  if (!year) return null;
  
  const lowerTitle = title.toLowerCase();
  let make: string | null = null;
  let makeEndIdx = 0;
  for (const m of KNOWN_MAKES) {
    const idx = lowerTitle.indexOf(m);
    if (idx >= 0) {
      make = titleCase(m);
      makeEndIdx = idx + m.length;
      break;
    }
  }
  if (!make) return null;
  
  const afterMake = title.substring(makeEndIdx).trim();
  const words = afterMake.split(/\s+/).filter(w => w.length > 0);
  const model = words[0] || 'Unknown';
  const variant = words.length > 1 ? words.slice(1).join(' ') : null;
  
  const featuresMatch = itemHtml.match(/<div class="result-item-features">([\s\S]*?)<\/div>/i);
  const featuresHtml = featuresMatch ? featuresMatch[1] : '';
  const km = parseKm(featuresHtml);
  const transmission = parseTransmission(featuresHtml);
  const fuel = parseFuel(featuresHtml);
  const drivetrain = parseDrivetrain(title + ' ' + featuresHtml);
  
  const urlMatch = itemHtml.match(/href="([^"]*cp_veh_inspection_report\.aspx[^"]*)"/i);
  let listingUrl: string | null = null;
  if (urlMatch) {
    const rawUrl = urlMatch[1].replace(/&amp;/g, '&');
    listingUrl = rawUrl.startsWith('http') ? rawUrl : config.urlPrefix + rawUrl;
  }
  
  return {
    lot_id: `${sourceKey}:${mtaId}`,
    make,
    model,
    variant,
    year,
    km,
    transmission,
    fuel,
    drivetrain,
    location: config.defaultLocation,
    auction_datetime: null,
    listing_url: listingUrl,
    price: null,
    status: 'catalogue',
  };
}

// Parse vehicle from AAV-style div.listing HTML block
function parseAAVListing(listingHtml: string, sourceKey: string, config: SiteConfig): ParsedVehicle | null {
  // Extract MTA ID from URL: MTA=620675
  const mtaMatch = listingHtml.match(/MTA=(\d+)/);
  if (!mtaMatch) return null;
  const mtaId = mtaMatch[1];
  
  // Extract title: <div class="title"><a href="...">2017 ALFA ROMEO STELVIO FIRST EDITION</a></div>
  const titleMatch = listingHtml.match(/<div class="title"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  if (!title) return null;
  
  // Parse year from title
  const year = parseYear(title);
  if (!year) return null;
  
  // Parse make from title
  const lowerTitle = title.toLowerCase();
  let make: string | null = null;
  let makeEndIdx = 0;
  for (const m of KNOWN_MAKES) {
    const idx = lowerTitle.indexOf(m);
    if (idx >= 0) {
      make = titleCase(m);
      makeEndIdx = idx + m.length;
      break;
    }
  }
  if (!make) return null;
  
  // Parse model and variant from title
  const afterMake = title.substring(makeEndIdx).trim();
  const words = afterMake.split(/\s+/).filter(w => w.length > 0);
  const model = words[0] || 'Unknown';
  const variant = words.length > 1 ? words.slice(1).join(' ') : null;
  
  // Extract gear info (transmission, km, fuel, body style)
  const gearMatches = listingHtml.match(/<div class="gear"[^>]*>([\s\S]*?)<\/div>/gi) || [];
  const gearText = gearMatches.map(g => g.replace(/<[^>]+>/g, ' ')).join(' ');
  
  const km = parseKm(gearText);
  const transmission = parseTransmission(gearText);
  const fuel = parseFuel(gearText);
  const drivetrain = parseDrivetrain(title + ' ' + gearText);
  
  // Build listing URL
  const urlMatch = listingHtml.match(/href="([^"]*cp_veh_inspection_report\.aspx[^"]*)"/i);
  let listingUrl: string | null = null;
  if (urlMatch) {
    const rawUrl = urlMatch[1].replace(/&amp;/g, '&');
    listingUrl = rawUrl.startsWith('http') ? rawUrl : config.urlPrefix + rawUrl;
  }
  
  return {
    lot_id: `${sourceKey}:${mtaId}`,
    make,
    model,
    variant,
    year,
    km,
    transmission,
    fuel,
    drivetrain,
    location: config.defaultLocation,
    auction_datetime: null,
    listing_url: listingUrl,
    price: null,
    status: 'catalogue',
  };
}

// Parse all vehicles from list page HTML
function parseListPage(html: string, sourceKey: string, config: SiteConfig): { vehicles: ParsedVehicle[], mtaIds: string[] } {
  const vehicles: ParsedVehicle[] = [];
  const mtaIds: string[] = [];
  const seenIds = new Set<string>();
  
  // Extract all MTA IDs for tracking
  const allMtaMatches = html.matchAll(/MTA=(\d+)/gi);
  for (const match of allMtaMatches) {
    if (!mtaIds.includes(match[1])) {
      mtaIds.push(match[1]);
    }
  }
  
  if (config.parserType === 'aav_listing_grid') {
    // AAV uses div.listing cards
    const listingPattern = /<div class="listing"[^>]*>([\s\S]*?)(?=<div class="listing"|<\/div>\s*<\/div>\s*<\/div>\s*$|<!-- end \.listing -->)/gi;
    
    let match;
    while ((match = listingPattern.exec(html)) !== null) {
      const vehicle = parseAAVListing(match[0], sourceKey, config);
      if (vehicle && !seenIds.has(vehicle.lot_id)) {
        seenIds.add(vehicle.lot_id);
        vehicles.push(vehicle);
      }
    }
  } else {
    // F3 uses div.result-item cards
    const itemPattern = /<div class="result-item format-standard"[^>]*>([\s\S]*?)(?=<div class="result-item format-standard"|<\/div>\s*<\/div>\s*<\/div>\s*$)/gi;
    
    let match;
    while ((match = itemPattern.exec(html)) !== null) {
      const vehicle = parseF3ResultItem(match[0], sourceKey, config);
      if (vehicle && !seenIds.has(vehicle.lot_id)) {
        seenIds.add(vehicle.lot_id);
        vehicles.push(vehicle);
      }
    }
  }
  
  return { vehicles, mtaIds };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const bodyText = await req.text();
  let body: Record<string, unknown> = {};
  
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = {};
  }
  
  const debug = body.debug === true;
  const sourceKey = body.source_key as string;
  
  if (!sourceKey) {
    return new Response(
      JSON.stringify({ error: 'source_key is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[asp-auction-crawl] Starting crawl for ${sourceKey}, debug: ${debug}`);

    // Fetch auction source config
    const { data: auctionSource, error: sourceError } = await supabase
      .from('auction_sources')
      .select('*')
      .eq('source_key', sourceKey)
      .single();

    if (sourceError || !auctionSource) {
      return new Response(
        JSON.stringify({ error: `Auction source not found: ${sourceKey}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get site-specific config or derive from auction source
    const config: SiteConfig = SITE_CONFIGS[sourceKey] || {
      defaultLocation: auctionSource.region_hint?.split('_').pop() || 'Unknown',
      urlPrefix: new URL(auctionSource.list_url).origin + '/',
      parserType: auctionSource.parser_profile === 'asp_search_results' ? 'aav_listing_grid' : 'f3_result_item',
    };

    const listUrl = auctionSource.list_url;
    
    // Fetch list page via Firecrawl
    console.log(`[asp-auction-crawl] Fetching: ${listUrl}`);
    const listResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: listUrl,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 5000,
      }),
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Failed to fetch list page: ${listResponse.status} - ${errorText}`);
    }

    const listData = await listResponse.json();
    const html = listData.data?.html || listData.html || '';
    
    console.log(`[asp-auction-crawl] Got HTML: ${html.length} chars`);
    
    if (html.length < 1000) {
      await supabase
        .from('auction_sources')
        .update({
          consecutive_failures: (auctionSource.consecutive_failures || 0) + 1,
          last_error: 'Insufficient HTML content',
          updated_at: new Date().toISOString(),
        })
        .eq('source_key', sourceKey);
        
      throw new Error('Insufficient HTML content from list page');
    }

    // Parse vehicles from list page
    const { vehicles: allVehicles, mtaIds } = parseListPage(html, sourceKey, config);
    console.log(`[asp-auction-crawl] Parsed ${allVehicles.length} vehicles, ${mtaIds.length} MTA IDs`);

    // Apply 10-year window filter
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;
    const validVehicles = allVehicles.filter(v => v.year >= minYear);
    console.log(`[asp-auction-crawl] After year filter (>=${minYear}): ${validVehicles.length} vehicles`);

    const debugInfo = {
      html_len: html.length,
      cards_found: allVehicles.length,
      mta_ids: mtaIds.slice(0, 15),
      parser_type: config.parserType,
      sample_vehicles: validVehicles.slice(0, 5),
      url_used: listUrl,
    };

    // In debug mode, return diagnostics without ingesting
    if (debug) {
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          source_key: sourceKey,
          sourceUrl: listUrl,
          diagnostics: debugInfo,
          totalParsed: allVehicles.length,
          validForIngest: validVehicles.length,
          droppedYearFilter: allVehicles.length - validVehicles.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (validVehicles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No valid vehicles found after filtering',
          source_key: sourceKey,
          totalParsed: allVehicles.length,
          diagnostics: debugInfo,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert to ingest format
    const lots = validVehicles.map(v => ({
      lot_id: v.lot_id,
      make: v.make,
      model: v.model,
      variant: v.variant,
      year: v.year,
      km: v.km,
      transmission: v.transmission,
      fuel: v.fuel,
      drivetrain: v.drivetrain,
      location: v.location,
      auction_datetime: v.auction_datetime,
      listing_url: v.listing_url,
      price: v.price,
      status: v.status,
    }));

    // Call the ingest function
    const ingestResponse = await supabase.functions.invoke('nsw-regional-ingest', {
      body: {
        lots,
        source: sourceKey,
        eventId: `${sourceKey.toUpperCase()}-${new Date().toISOString().split('T')[0]}`,
        auctionDate: new Date().toISOString().split('T')[0],
      },
    });

    if (ingestResponse.error) {
      throw new Error(`Ingest failed: ${ingestResponse.error.message}`);
    }

    // Update auction_sources with success
    await supabase
      .from('auction_sources')
      .update({
        last_success_at: new Date().toISOString(),
        last_lots_found: validVehicles.length,
        last_error: null,
        consecutive_failures: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('source_key', sourceKey);

    // Log to cron_audit_log
    const runDate = new Date().toISOString().split('T')[0];
    await supabase.from('cron_audit_log').insert({
      cron_name: `asp-auction-crawl:${sourceKey}`,
      run_date: runDate,
      success: true,
      result: {
        source_key: sourceKey,
        totalParsed: allVehicles.length,
        validForIngest: validVehicles.length,
        droppedYearFilter: allVehicles.length - validVehicles.length,
        ingestResult: ingestResponse.data,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        source_key: sourceKey,
        sourceUrl: listUrl,
        totalParsed: allVehicles.length,
        validForIngest: validVehicles.length,
        droppedYearFilter: allVehicles.length - validVehicles.length,
        ingestResult: ingestResponse.data,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[asp-auction-crawl] Error:', error);
    
    // Log failure
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      const runDate = new Date().toISOString().split('T')[0];
      
      await supabase.from('cron_audit_log').insert({
        cron_name: `asp-auction-crawl:${sourceKey}`,
        run_date: runDate,
        success: false,
        error: errorMsg,
      });
    } catch (logErr) {
      console.error('[asp-auction-crawl] Failed to log to audit:', logErr);
    }
    
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
