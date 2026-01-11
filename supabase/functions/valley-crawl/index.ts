/**
 * Valley Motor Auctions Crawler (Regional NSW)
 * Scrapes valleymotorauctions.com.au for vehicle listings
 * 
 * NOTE: valleymotorauctions.com.au blocks automated scrapers.
 * This crawler is configured to handle the block gracefully and return
 * a clear error message. Alternative approaches may be needed.
 * 
 * Strategy: DOM card parsing + detail page fetching
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
  md_len: number;
  candidate_links: string[];
  card_snippets: string[];
  stock_ids: string[];
  vehicles_parsed: number;
}

// Known Australian makes
const KNOWN_MAKES = [
  'toyota', 'ford', 'holden', 'mazda', 'nissan', 'mitsubishi', 'hyundai', 'kia',
  'isuzu', 'volkswagen', 'mercedes', 'bmw', 'audi', 'subaru', 'honda', 'suzuki',
  'jeep', 'land rover', 'range rover', 'lexus', 'volvo', 'peugeot', 'renault',
  'fiat', 'alfa romeo', 'mini', 'porsche', 'jaguar', 'chrysler', 'dodge', 'ram',
  'ldv', 'great wall', 'haval', 'mg', 'gwm', 'byd', 'tesla', 'ssangyong',
];

function parseYear(text: string): number | null {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

function parseKm(text: string): number | null {
  const normalized = text.replace(/\\/g, '').replace(/,/g, '');
  const match = normalized.match(/(\d+)\s*(?:km|kms|kilometres)/i);
  return match ? parseInt(match[1]) : null;
}

function parsePrice(text: string): number | null {
  const normalized = text.replace(/\\/g, '').replace(/,/g, '');
  const match = normalized.match(/\$\s*(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Extract vehicle detail URLs from list page HTML
function extractVehicleLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  
  // Pattern 1: bidsonline.com.au links (common auction platform)
  const bidsOnlinePattern = /href=["']([^"']*bidsonline\.com\.au[^"']*vehicle[^"']*)["']/gi;
  let match;
  while ((match = bidsOnlinePattern.exec(html)) !== null) {
    links.push(match[1]);
  }
  
  // Pattern 2: Local detail page links with stock/lot IDs
  const detailPattern = /href=["']([^"']*(?:vehicle|lot|stock|details?|item)[^"']*(?:\d{4,}|[A-Z]{2,}\d+)[^"']*)["']/gi;
  while ((match = detailPattern.exec(html)) !== null) {
    let url = match[1];
    if (!url.startsWith('http')) {
      url = new URL(url, baseUrl).href;
    }
    if (!links.includes(url)) {
      links.push(url);
    }
  }
  
  // Pattern 3: data-url or data-href attributes
  const dataUrlPattern = /data-(?:url|href)=["']([^"']*(?:vehicle|lot|stock)[^"']*)["']/gi;
  while ((match = dataUrlPattern.exec(html)) !== null) {
    let url = match[1];
    if (!url.startsWith('http')) {
      url = new URL(url, baseUrl).href;
    }
    if (!links.includes(url)) {
      links.push(url);
    }
  }
  
  return links.slice(0, 50);
}

// Extract stock/lot IDs from HTML
function extractStockIds(html: string): string[] {
  const ids: string[] = [];
  
  // Pattern 1: Explicit stock/lot number attributes
  const attrPattern = /(?:stock|lot|item|sku)[-_]?(?:id|no|number)?=["']?([A-Z0-9\-_]{4,20})["']?/gi;
  let match;
  while ((match = attrPattern.exec(html)) !== null) {
    if (!ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  
  // Pattern 2: Stock IDs in text
  const textPattern = /(?:stock|lot|item)\s*[:#]?\s*([A-Z0-9\-_]{4,20})/gi;
  while ((match = textPattern.exec(html)) !== null) {
    if (!ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  
  // Pattern 3: MTA/bidsonline style IDs
  const mtaPattern = /[&?](?:id|lotid|stockid)=(\d+)/gi;
  while ((match = mtaPattern.exec(html)) !== null) {
    const id = `MTA-${match[1]}`;
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  
  return ids;
}

// Extract vehicle cards/blocks from HTML
function extractVehicleCards(html: string): string[] {
  const cards: string[] = [];
  
  // Pattern 1: Common card container patterns
  const cardPatterns = [
    /<(?:div|article|li)[^>]*class=["'][^"']*(?:vehicle|car|lot|stock|listing|item|result|auction)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|article|li)>/gi,
    /<tr[^>]*>[\s\S]*?(?:toyota|ford|holden|mazda|nissan|hyundai)[\s\S]*?<\/tr>/gi,
  ];
  
  for (const pattern of cardPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[0].length < 5000) {
        cards.push(match[0]);
      }
    }
  }
  
  return cards.slice(0, 50);
}

// Parse a vehicle card HTML block
function parseVehicleCard(cardHtml: string, index: number): ParsedVehicle | null {
  const year = parseYear(cardHtml);
  if (!year || year < 2010 || year > new Date().getFullYear() + 1) return null;
  
  const lowerHtml = cardHtml.toLowerCase();
  let make: string | null = null;
  for (const m of KNOWN_MAKES) {
    if (lowerHtml.includes(m)) {
      make = titleCase(m);
      break;
    }
  }
  if (!make) return null;
  
  // Extract model
  const makeIndex = lowerHtml.indexOf(make.toLowerCase());
  const afterMake = cardHtml.substring(makeIndex + make.length, makeIndex + make.length + 100);
  const modelMatch = afterMake.match(/^\s*([A-Za-z0-9\-]+)/);
  const model = modelMatch ? modelMatch[1] : 'Unknown';
  
  // Extract variant
  const variantMatch = afterMake.match(/^\s*[A-Za-z0-9\-]+\s+([A-Za-z0-9\-\s]+?)(?:\s*[\|,<]|\s+\d)/);
  const variant = variantMatch ? variantMatch[1].trim() : null;
  
  // Extract stock/lot ID
  const stockMatch = cardHtml.match(/(?:stock|lot|item)[:\s#]*([A-Z0-9\-_]{4,20})/i) ||
                     cardHtml.match(/id=["']?(\d{4,})["']?/i);
  const lotId = stockMatch 
    ? `VMA-${stockMatch[1]}` 
    : `VMA-${year}-${make.substring(0,3)}-${index}`.toUpperCase();
  
  // Extract URL
  const urlMatch = cardHtml.match(/href=["']([^"']+vehicle[^"']*)["']/i) ||
                   cardHtml.match(/href=["']([^"']+(?:lot|stock|details)[^"']*)["']/i);
  const listingUrl = urlMatch ? urlMatch[1] : null;
  
  return {
    lot_id: lotId,
    make,
    model,
    variant,
    year,
    km: parseKm(cardHtml),
    transmission: /\b(?:auto|automatic)\b/i.test(cardHtml) ? 'Auto' : 
                  /\bmanual\b/i.test(cardHtml) ? 'Manual' : null,
    fuel: /\bdiesel\b/i.test(cardHtml) ? 'Diesel' :
          /\b(?:petrol|unleaded)\b/i.test(cardHtml) ? 'Petrol' :
          /\bhybrid\b/i.test(cardHtml) ? 'Hybrid' : null,
    drivetrain: /\b(?:4wd|4x4)\b/i.test(cardHtml) ? '4WD' :
                /\bawd\b/i.test(cardHtml) ? 'AWD' : null,
    location: 'Hunter Valley',
    auction_datetime: null,
    listing_url: listingUrl,
    price: parsePrice(cardHtml),
    status: 'catalogue',
  };
}

// Parse vehicles using markdown line-by-line approach (fallback)
function parseVehiclesFromMarkdown(markdown: string): ParsedVehicle[] {
  const vehicles: ParsedVehicle[] = [];
  const seenKeys = new Set<string>();
  
  const lines = markdown.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const year = parseYear(line);
    if (!year || year < 2010) continue;
    
    const lowerLine = line.toLowerCase();
    let make: string | null = null;
    for (const m of KNOWN_MAKES) {
      if (lowerLine.includes(m)) {
        make = titleCase(m);
        break;
      }
    }
    if (!make) continue;
    
    const context = lines.slice(i, i + 4).join(' ');
    
    const makeIdx = lowerLine.indexOf(make.toLowerCase());
    const afterMake = line.substring(makeIdx + make.length);
    const modelMatch = afterMake.match(/^\s*([A-Za-z0-9\-]+)/);
    const model = modelMatch ? modelMatch[1] : 'Unknown';
    
    const key = `${year}-${make}-${model}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    
    vehicles.push({
      lot_id: `VMA-${year}-${make.substring(0,3)}-${model.substring(0,4)}-${i}`.toUpperCase(),
      make,
      model,
      variant: null,
      year,
      km: parseKm(context),
      transmission: /\b(?:auto|automatic)\b/i.test(context) ? 'Auto' : 
                    /\bmanual\b/i.test(context) ? 'Manual' : null,
      fuel: /\bdiesel\b/i.test(context) ? 'Diesel' :
            /\b(?:petrol|unleaded)\b/i.test(context) ? 'Petrol' : null,
      drivetrain: /\b(?:4wd|4x4)\b/i.test(context) ? '4WD' :
                  /\bawd\b/i.test(context) ? 'AWD' : null,
      location: 'Hunter Valley',
      auction_datetime: null,
      listing_url: null,
      price: parsePrice(context),
      status: 'catalogue',
    });
  }
  
  return vehicles;
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

    console.log('[valley-crawl] Starting Valley Motor Auctions crawl, debug:', debug);

    // Valley Motor Auctions URLs
    const urls = [
      'https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models',
      'https://www.valleymotorauctions.com.au/',
    ];

    let allVehicles: ParsedVehicle[] = [];
    let successfulUrl = '';
    let debugInfo: DebugInfo | null = null;

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
            waitFor: 3000,
          }),
        });

        if (!response.ok) {
          console.log(`[valley-crawl] Failed to scrape ${url}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const html = data.data?.html || data.html || '';
        const markdown = data.data?.markdown || data.markdown || '';

        console.log(`[valley-crawl] Got HTML: ${html.length} chars, MD: ${markdown.length} chars`);
        
        if (html.length < 500 && markdown.length < 200) {
          console.log(`[valley-crawl] Insufficient content from ${url}`);
          continue;
        }

        // Extract debug info
        const candidateLinks = extractVehicleLinks(html, url);
        const stockIds = extractStockIds(html);
        const cards = extractVehicleCards(html);
        
        console.log(`[valley-crawl] Found ${candidateLinks.length} links, ${stockIds.length} IDs, ${cards.length} cards`);
        
        debugInfo = {
          html_len: html.length,
          md_len: markdown.length,
          candidate_links: candidateLinks.slice(0, 5),
          card_snippets: cards.slice(0, 3).map(c => c.substring(0, 500)),
          stock_ids: stockIds.slice(0, 10),
          vehicles_parsed: 0,
        };

        // Strategy 1: Parse vehicle cards
        const vehicles: ParsedVehicle[] = [];
        const seenIds = new Set<string>();
        
        for (let i = 0; i < cards.length; i++) {
          const vehicle = parseVehicleCard(cards[i], i);
          if (vehicle && !seenIds.has(vehicle.lot_id)) {
            seenIds.add(vehicle.lot_id);
            vehicles.push(vehicle);
          }
        }
        
        // Strategy 2: Fallback to markdown parsing
        if (vehicles.length < 5) {
          const mdVehicles = parseVehiclesFromMarkdown(markdown);
          for (const v of mdVehicles) {
            if (!seenIds.has(v.lot_id)) {
              seenIds.add(v.lot_id);
              vehicles.push(v);
            }
          }
        }
        
        debugInfo.vehicles_parsed = vehicles.length;
        console.log(`[valley-crawl] Parsed ${vehicles.length} vehicles from ${url}`);

        if (vehicles.length > 0 || debug) {
          allVehicles = vehicles;
          successfulUrl = url;
          if (vehicles.length > 0) break;
        }
      } catch (e) {
        console.log(`[valley-crawl] Error scraping ${url}:`, e);
        continue;
      }
    }

    // In debug mode, return diagnostics without ingesting
    if (debug) {
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          sourceUrl: successfulUrl,
          diagnostics: debugInfo,
          vehicles: allVehicles.slice(0, 5),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (allVehicles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No vehicles found from any Valley URL',
          urlsTried: urls,
          diagnostics: debugInfo,
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

    return new Response(
      JSON.stringify({
        success: true,
        sourceUrl: successfulUrl,
        vehiclesFound: allVehicles.length,
        ingestResult: ingestResponse.data,
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
