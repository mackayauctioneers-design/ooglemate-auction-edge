/**
 * F3 Motor Auctions Crawler (Newcastle/Hunter region)
 * Scrapes f3motorauctions.com.au for vehicle listings
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

// Parse year from text
function parseYear(text: string): number | null {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

// Parse km from text
function parseKm(text: string): number | null {
  const match = text.replace(/\\/g, '').match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometres)/i);
  return match ? parseInt(match[1].replace(/,/g, '')) : null;
}

// Parse price from text
function parsePrice(text: string): number | null {
  const match = text.replace(/\\/g, '').match(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)/);
  return match ? parseInt(match[1].replace(/,/g, '')) : null;
}

// Parse vehicles from F3 website HTML
function parseVehicles(html: string, markdown: string): ParsedVehicle[] {
  const vehicles: ParsedVehicle[] = [];
  const seenIds = new Set<string>();
  
  console.log(`[f3-crawl] Parsing content, HTML: ${html.length} chars, MD: ${markdown.length} chars`);
  
  // F3 typically shows vehicles in card format
  // Look for vehicle patterns in markdown first (more structured)
  const content = markdown || html;
  
  // Pattern 1: Look for vehicle titles like "2022 Toyota Hilux SR5"
  const vehiclePattern = /\b(19|20)\d{2}\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+([A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-]+)*)/gi;
  
  let match;
  while ((match = vehiclePattern.exec(content)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].trim();
    const modelVariant = match[3].trim();
    
    // Skip if year is out of range
    if (year < 2000 || year > new Date().getFullYear() + 1) continue;
    
    // Skip common false positives
    const skipWords = ['January', 'February', 'March', 'April', 'May', 'June', 
      'July', 'August', 'September', 'October', 'November', 'December',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    if (skipWords.some(w => make.includes(w))) continue;
    
    // Extract model (first word) and variant (rest)
    const parts = modelVariant.split(/\s+/);
    const model = parts[0];
    const variant = parts.length > 1 ? parts.slice(1).join(' ') : null;
    
    // Generate a lot ID from the vehicle info
    const lotId = `F3-${year}-${make}-${model}-${Math.random().toString(36).substr(2, 6)}`.toUpperCase();
    
    if (seenIds.has(`${year}-${make}-${model}`)) continue;
    seenIds.add(`${year}-${make}-${model}`);
    
    // Get context around this match for additional details
    const contextStart = Math.max(0, match.index - 500);
    const contextEnd = Math.min(content.length, match.index + 500);
    const context = content.substring(contextStart, contextEnd);
    
    const km = parseKm(context);
    const price = parsePrice(context);
    
    // Transmission
    let transmission: string | null = null;
    if (/\b(automatic|auto)\b/i.test(context)) transmission = 'Auto';
    else if (/\bmanual\b/i.test(context)) transmission = 'Manual';
    
    // Fuel
    let fuel: string | null = null;
    if (/\bdiesel\b/i.test(context)) fuel = 'Diesel';
    else if (/\b(petrol|unleaded)\b/i.test(context)) fuel = 'Petrol';
    else if (/\bhybrid\b/i.test(context)) fuel = 'Hybrid';
    
    // Drivetrain
    let drivetrain: string | null = null;
    if (/\b(4wd|4x4)\b/i.test(context)) drivetrain = '4WD';
    else if (/\bawd\b/i.test(context)) drivetrain = 'AWD';
    
    vehicles.push({
      lot_id: lotId,
      make,
      model,
      variant,
      year,
      km,
      transmission,
      fuel,
      drivetrain,
      location: 'Beresfield', // F3 is in Beresfield, Newcastle
      auction_datetime: null, // Will be extracted if available
      listing_url: null, // F3 may not have individual URLs
      price,
      status: 'catalogue',
    });
  }
  
  // Pattern 2: Look for stock/lot numbers in the HTML
  const lotPattern = /(?:lot|stock)[\s:#]*([A-Z0-9\-]+)/gi;
  while ((match = lotPattern.exec(html)) !== null) {
    const lotId = match[1];
    if (seenIds.has(lotId)) continue;
    
    // Get context
    const contextStart = Math.max(0, match.index - 1000);
    const contextEnd = Math.min(html.length, match.index + 1000);
    const context = html.substring(contextStart, contextEnd);
    
    const year = parseYear(context);
    if (!year || year < 2000) continue;
    
    // Try to extract make/model from context
    const vmMatch = context.match(/\b(Toyota|Ford|Holden|Mazda|Nissan|Mitsubishi|Hyundai|Kia|Isuzu|Volkswagen|Mercedes|BMW|Audi|Subaru)\s+([A-Za-z0-9\-]+)/i);
    if (!vmMatch) continue;
    
    const make = vmMatch[1];
    const model = vmMatch[2];
    
    seenIds.add(lotId);
    
    vehicles.push({
      lot_id: `F3-${lotId}`,
      make,
      model,
      variant: null,
      year,
      km: parseKm(context),
      transmission: null,
      fuel: null,
      drivetrain: null,
      location: 'Beresfield',
      auction_datetime: null,
      listing_url: null,
      price: parsePrice(context),
      status: 'catalogue',
    });
  }
  
  console.log(`[f3-crawl] Parsed ${vehicles.length} vehicles`);
  return vehicles;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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

    console.log('[f3-crawl] Starting F3 Motor Auctions crawl');

    // F3 Motor Auctions URLs - use the actual search/stock pages
    const urls = [
      'https://www.f3motorauctions.com.au/search_results.aspx?sitekey=F3A&make=All+Makes&model=All+Models',
      'https://www.f3motorauctions.com.au/simulcast.aspx',
    ];

    let allVehicles: ParsedVehicle[] = [];
    let successfulUrl = '';

    for (const url of urls) {
      console.log(`[f3-crawl] Trying URL: ${url}`);
      
      try {
        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            formats: ['markdown', 'html'],
            onlyMainContent: false,
            waitFor: 5000,
          }),
        });

        if (!response.ok) {
          console.log(`[f3-crawl] Failed to scrape ${url}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const html = data.data?.html || data.html || '';
        const markdown = data.data?.markdown || data.markdown || '';

        if (html.length < 1000 && markdown.length < 500) {
          console.log(`[f3-crawl] Insufficient content from ${url}`);
          continue;
        }

        const vehicles = parseVehicles(html, markdown);
        if (vehicles.length > 0) {
          allVehicles = vehicles;
          successfulUrl = url;
          console.log(`[f3-crawl] Found ${vehicles.length} vehicles from ${url}`);
          break;
        }
      } catch (e) {
        console.log(`[f3-crawl] Error scraping ${url}:`, e);
        continue;
      }
    }

    if (allVehicles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No vehicles found from any F3 URL',
          urlsTried: urls,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert to ingest format and call nsw-regional-ingest
    const lots = allVehicles.map(v => ({
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

    const result = ingestResponse.data;

    return new Response(
      JSON.stringify({
        success: true,
        sourceUrl: successfulUrl,
        vehiclesFound: allVehicles.length,
        ingestResult: result,
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
