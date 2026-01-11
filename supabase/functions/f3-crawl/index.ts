/**
 * F3 Motor Auctions Crawler (Newcastle/Hunter region)
 * Scrapes f3motorauctions.com.au for vehicle listings
 * 
 * Strategy: Parse list page HTML cards (no prices available on F3)
 * F3 is "call for price" - we ingest for presence tracking only
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

interface DebugInfo {
  html_len: number;
  cards_found: number;
  mta_ids: string[];
  sample_vehicles: ParsedVehicle[];
}

// Known Australian makes
const KNOWN_MAKES = [
  'toyota', 'ford', 'holden', 'mazda', 'nissan', 'mitsubishi', 'hyundai', 'kia',
  'isuzu', 'volkswagen', 'mercedes', 'bmw', 'audi', 'subaru', 'honda', 'suzuki',
  'jeep', 'land rover', 'lexus', 'volvo', 'peugeot', 'renault', 'ram', 'ldv',
  'great wall', 'haval', 'mg', 'gwm', 'byd', 'tesla', 'ssangyong', 'alfa romeo',
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

// Parse vehicle from a result-item HTML block
function parseResultItem(itemHtml: string): ParsedVehicle | null {
  // Extract MTA ID from URL pattern: MTA=12345
  const mtaMatch = itemHtml.match(/MTA=(\d+)/);
  if (!mtaMatch) return null;
  const mtaId = mtaMatch[1];
  
  // Extract title from result-item-title
  const titleMatch = itemHtml.match(/<h4[^>]*class="result-item-title"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  if (!title) return null;
  
  // Parse year from title (e.g., "2015 FORD ECOSPORT TREND BK")
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
  
  // Parse model - word(s) after make
  const afterMake = title.substring(makeEndIdx).trim();
  const words = afterMake.split(/\s+/).filter(w => w.length > 0);
  const model = words[0] || 'Unknown';
  const variant = words.length > 1 ? words.slice(1).join(' ') : null;
  
  // Extract km from features (e.g., "196904 kms")
  const featuresMatch = itemHtml.match(/<div class="result-item-features">([\s\S]*?)<\/div>/i);
  const featuresHtml = featuresMatch ? featuresMatch[1] : '';
  const km = parseKm(featuresHtml);
  
  // Extract transmission from features
  let transmission: string | null = null;
  if (/\bAUTOMATIC\b/i.test(featuresHtml)) transmission = 'Auto';
  else if (/\bMANUAL\b/i.test(featuresHtml)) transmission = 'Manual';
  else if (/\bCVT\b/i.test(featuresHtml)) transmission = 'CVT';
  
  // Extract fuel from features
  let fuel: string | null = null;
  if (/\bDIESEL\b/i.test(featuresHtml)) fuel = 'Diesel';
  else if (/\bPETROL\b/i.test(featuresHtml) || /\bUNLEADED\b/i.test(featuresHtml)) fuel = 'Petrol';
  else if (/\bHYBRID\b/i.test(featuresHtml)) fuel = 'Hybrid';
  else if (/\bELECTRIC\b/i.test(featuresHtml)) fuel = 'Electric';
  
  // Extract drivetrain from title/features
  const combinedText = title + ' ' + featuresHtml;
  let drivetrain: string | null = null;
  if (/\b4[xX]4\b/.test(combinedText) || /\b4WD\b/i.test(combinedText)) drivetrain = '4WD';
  else if (/\bAWD\b/i.test(combinedText)) drivetrain = 'AWD';
  else if (/\b4[xX]2\b/.test(combinedText) || /\b2WD\b/i.test(combinedText)) drivetrain = '2WD';
  
  // Extract detail URL
  const urlMatch = itemHtml.match(/href="([^"]*cp_veh_inspection_report\.aspx[^"]*)"/i);
  const listingUrl = urlMatch ? urlMatch[1].replace(/&amp;/g, '&') : null;
  
  return {
    lot_id: `F3-MTA-${mtaId}`,
    make,
    model,
    variant,
    year,
    km,
    transmission,
    fuel,
    drivetrain,
    location: 'Beresfield',
    auction_datetime: null,
    listing_url: listingUrl,
    price: null, // F3 is "call for price"
    status: 'catalogue',
  };
}

// Parse all vehicles from list page HTML
function parseListPage(html: string): { vehicles: ParsedVehicle[], mtaIds: string[] } {
  const vehicles: ParsedVehicle[] = [];
  const mtaIds: string[] = [];
  const seenIds = new Set<string>();
  
  // Find all result-item blocks
  const itemPattern = /<div class="result-item format-standard"[^>]*>([\s\S]*?)(?=<div class="result-item format-standard"|<\/div>\s*<\/div>\s*<\/div>\s*$)/gi;
  
  let match;
  while ((match = itemPattern.exec(html)) !== null) {
    const itemHtml = match[0];
    
    // Extract MTA ID for tracking
    const mtaMatch = itemHtml.match(/MTA=(\d+)/);
    if (mtaMatch) {
      mtaIds.push(mtaMatch[1]);
    }
    
    const vehicle = parseResultItem(itemHtml);
    if (vehicle && !seenIds.has(vehicle.lot_id)) {
      seenIds.add(vehicle.lot_id);
      vehicles.push(vehicle);
    }
  }
  
  return { vehicles, mtaIds };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const debug = body.debug === true;
    
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

    console.log('[f3-crawl] Starting F3 Motor Auctions crawl, debug:', debug);

    const listUrl = 'https://www.f3motorauctions.com.au/search_results.aspx?sitekey=F3A&make=All+Makes&model=All+Models';
    
    // Stage 1: Fetch list page
    console.log('[f3-crawl] Fetching list page');
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
        waitFor: 3000,
      }),
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to fetch list page: ${listResponse.status}`);
    }

    const listData = await listResponse.json();
    const html = listData.data?.html || listData.html || '';
    
    console.log(`[f3-crawl] Got HTML: ${html.length} chars`);
    
    if (html.length < 1000) {
      throw new Error('Insufficient HTML content from list page');
    }

    // Parse vehicles from list page
    const { vehicles: allVehicles, mtaIds } = parseListPage(html);
    console.log(`[f3-crawl] Parsed ${allVehicles.length} vehicles, ${mtaIds.length} MTA IDs`);

    // Apply 10-year window filter before ingesting
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;
    const validVehicles = allVehicles.filter(v => v.year >= minYear);
    console.log(`[f3-crawl] After year filter (>=${minYear}): ${validVehicles.length} vehicles`);

    const debugInfo: DebugInfo = {
      html_len: html.length,
      cards_found: allVehicles.length,
      mta_ids: mtaIds.slice(0, 10),
      sample_vehicles: validVehicles.slice(0, 5),
    };

    // In debug mode, return diagnostics without ingesting
    if (debug) {
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
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
        source: 'f3',
        eventId: `F3-${new Date().toISOString().split('T')[0]}`,
        auctionDate: new Date().toISOString().split('T')[0],
      },
    });

    if (ingestResponse.error) {
      throw new Error(`Ingest failed: ${ingestResponse.error.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
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
    console.error('[f3-crawl] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
