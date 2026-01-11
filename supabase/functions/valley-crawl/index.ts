/**
 * Valley Motor Auctions Crawler (Regional NSW)
 * Scrapes valleymotorauctions.com.au for vehicle listings
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

// Known makes for validation
const KNOWN_MAKES = [
  'Toyota', 'Ford', 'Holden', 'Mazda', 'Nissan', 'Mitsubishi', 'Hyundai', 'Kia',
  'Isuzu', 'Volkswagen', 'Mercedes', 'BMW', 'Audi', 'Subaru', 'Honda', 'Suzuki',
  'Jeep', 'Land Rover', 'Range Rover', 'Lexus', 'Volvo', 'Peugeot', 'Renault',
  'Fiat', 'Alfa Romeo', 'Mini', 'Porsche', 'Jaguar', 'Chrysler', 'Dodge', 'RAM',
  'LDV', 'Great Wall', 'Haval', 'MG', 'GWM', 'BYD', 'Tesla', 'Ssangyong',
];

// Parse vehicles from Valley website HTML/Markdown
function parseVehicles(html: string, markdown: string): ParsedVehicle[] {
  const vehicles: ParsedVehicle[] = [];
  const seenIds = new Set<string>();
  
  console.log(`[valley-crawl] Parsing content, HTML: ${html.length} chars, MD: ${markdown.length} chars`);
  
  const content = markdown || html;
  
  // Pattern 1: Standard vehicle format "YEAR MAKE MODEL VARIANT"
  const makePattern = KNOWN_MAKES.join('|');
  const vehicleRegex = new RegExp(`\\b(19|20)\\d{2}\\s+(${makePattern})\\s+([A-Za-z0-9\\-]+(?:\\s+[A-Za-z0-9\\-]+)*)`, 'gi');
  
  let match;
  while ((match = vehicleRegex.exec(content)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].trim();
    const modelVariant = match[3].trim();
    
    if (year < 2000 || year > new Date().getFullYear() + 1) continue;
    
    // Extract model (first word) and variant (rest)
    const parts = modelVariant.split(/\s+/);
    const model = parts[0];
    const variant = parts.length > 1 ? parts.slice(1).join(' ') : null;
    
    // Create unique ID
    const idKey = `${year}-${make}-${model}`;
    if (seenIds.has(idKey)) continue;
    seenIds.add(idKey);
    
    const lotId = `VMA-${year}-${make.substring(0, 3)}-${model.substring(0, 4)}-${Date.now().toString(36).slice(-4)}`.toUpperCase();
    
    // Get context for additional details
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
      location: 'Hunter Valley', // Valley Motor Auctions region
      auction_datetime: null,
      listing_url: null,
      price,
      status: 'catalogue',
    });
  }
  
  // Pattern 2: Look for lot numbers in structured data
  const lotPattern = /(?:lot|item)[\s:#]*(\d+)/gi;
  while ((match = lotPattern.exec(html)) !== null) {
    const lotNum = match[1];
    const lotId = `VMA-LOT-${lotNum}`;
    
    if (seenIds.has(lotId)) continue;
    
    // Get context
    const contextStart = Math.max(0, match.index - 1000);
    const contextEnd = Math.min(html.length, match.index + 1000);
    const context = html.substring(contextStart, contextEnd);
    
    const year = parseYear(context);
    if (!year || year < 2000) continue;
    
    // Try to extract make/model
    const vmRegex = new RegExp(`(${makePattern})\\s+([A-Za-z0-9\\-]+)`, 'i');
    const vmMatch = context.match(vmRegex);
    if (!vmMatch) continue;
    
    const make = vmMatch[1];
    const model = vmMatch[2];
    
    seenIds.add(lotId);
    
    vehicles.push({
      lot_id: lotId,
      make,
      model,
      variant: null,
      year,
      km: parseKm(context),
      transmission: null,
      fuel: null,
      drivetrain: null,
      location: 'Hunter Valley',
      auction_datetime: null,
      listing_url: null,
      price: parsePrice(context),
      status: 'catalogue',
    });
  }
  
  console.log(`[valley-crawl] Parsed ${vehicles.length} vehicles`);
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

    console.log('[valley-crawl] Starting Valley Motor Auctions crawl');

    // Valley Motor Auctions URLs - use actual search/stock page
    const urls = [
      'https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models',
      'https://www.valleymotorauctions.com.au/online',
    ];

    let allVehicles: ParsedVehicle[] = [];
    let successfulUrl = '';

    for (const url of urls) {
      console.log(`[valley-crawl] Trying URL: ${url}`);
      
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
          console.log(`[valley-crawl] Failed to scrape ${url}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const html = data.data?.html || data.html || '';
        const markdown = data.data?.markdown || data.markdown || '';

        if (html.length < 1000 && markdown.length < 500) {
          console.log(`[valley-crawl] Insufficient content from ${url}`);
          continue;
        }

        const vehicles = parseVehicles(html, markdown);
        if (vehicles.length > 0) {
          allVehicles = vehicles;
          successfulUrl = url;
          console.log(`[valley-crawl] Found ${vehicles.length} vehicles from ${url}`);
          break;
        }
      } catch (e) {
        console.log(`[valley-crawl] Error scraping ${url}:`, e);
        continue;
      }
    }

    if (allVehicles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No vehicles found from any Valley URL',
          urlsTried: urls,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert to ingest format
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
        source: 'valley',
        eventId: `VMA-${new Date().toISOString().split('T')[0]}`,
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
    console.error('[valley-crawl] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
