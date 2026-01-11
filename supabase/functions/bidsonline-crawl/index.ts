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
  errors: string[];
}

// Helper: title case
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Helper: parse km from various formats
function parseKm(raw: string | null): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[^0-9]/g, '');
  const km = parseInt(clean);
  if (isNaN(km) || km < 100 || km > 999999) return null;
  return km;
}

// Helper: parse year
function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = parseInt(match[0]);
  const currentYear = new Date().getFullYear();
  if (year < 1980 || year > currentYear + 1) return null;
  return year;
}

// Helper: parse price from various formats
function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[^0-9]/g, '');
  const price = parseInt(clean);
  if (isNaN(price) || price < 100) return null;
  return price;
}

// Parse a single lot from BidsOnline-style HTML
function parseLotItem(html: string, baseUrl: string): ParsedLot | null {
  const errors: string[] = [];
  
  // Try to extract lot ID (various patterns)
  let lotId: string | null = null;
  
  // Pattern 1: data-lot-id or data-id attribute
  const dataLotMatch = html.match(/data-(?:lot-)?id=["']([^"']+)["']/i);
  if (dataLotMatch) lotId = dataLotMatch[1];
  
  // Pattern 2: href with lot number (e.g., /lot/12345)
  if (!lotId) {
    const lotUrlMatch = html.match(/href=["'][^"']*\/lot[s]?\/(\d+)[^"']*["']/i);
    if (lotUrlMatch) lotId = lotUrlMatch[1];
  }
  
  // Pattern 3: item ID in URL
  if (!lotId) {
    const itemMatch = html.match(/href=["'][^"']*[?&](?:item|lot)=(\d+)[^"']*["']/i);
    if (itemMatch) lotId = itemMatch[1];
  }
  
  // Pattern 4: Stock number text
  if (!lotId) {
    const stockMatch = html.match(/(?:stock|lot)\s*#?\s*:?\s*(\d{3,})/i);
    if (stockMatch) lotId = stockMatch[1];
  }
  
  if (!lotId) return null;
  
  // Extract detail URL
  let listingUrl: string | null = null;
  const hrefMatch = html.match(/href=["']([^"']*(?:lot|vehicle|item)[^"']*)["']/i);
  if (hrefMatch) {
    const href = hrefMatch[1];
    listingUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
  }
  
  // Extract year/make/model from title or heading
  let year: number | null = null;
  let make = '';
  let model = '';
  let variantRaw: string | null = null;
  
  // Try various title patterns
  const titlePatterns = [
    /<h\d[^>]*>([^<]+)<\/h\d>/gi,
    /class=["'][^"']*(?:title|heading|name)[^"']*["'][^>]*>([^<]+)/gi,
    /<a[^>]*>([^<]*\d{4}[^<]*(?:toyota|mazda|ford|hyundai|kia|mitsubishi|nissan|holden|volkswagen|honda|subaru)[^<]*)<\/a>/gi,
  ];
  
  for (const pattern of titlePatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const text = match[1].trim();
      // Look for year pattern
      const yearMatch = text.match(/\b(20[0-2]\d)\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[1]);
        // Extract make/model after year
        const afterYear = text.substring(text.indexOf(yearMatch[0]) + 4).trim();
        const parts = afterYear.split(/\s+/);
        if (parts.length >= 2) {
          make = titleCase(parts[0]);
          model = titleCase(parts[1]);
          if (parts.length > 2) {
            variantRaw = parts.slice(2).join(' ');
          }
        }
        break;
      }
    }
    if (year && make) break;
  }
  
  // Fallback: look for common makes in text
  if (!make) {
    const makes = ['toyota', 'mazda', 'ford', 'hyundai', 'kia', 'mitsubishi', 'nissan', 'holden', 'volkswagen', 'honda', 'subaru', 'isuzu', 'mercedes', 'bmw', 'audi'];
    for (const m of makes) {
      const makeMatch = html.match(new RegExp(`\\b${m}\\b`, 'i'));
      if (makeMatch) {
        make = titleCase(m);
        // Try to find model after make
        const modelPattern = new RegExp(`${m}\\s+([a-z0-9-]+)`, 'i');
        const modelMatch = html.match(modelPattern);
        if (modelMatch) {
          model = titleCase(modelMatch[1]);
        }
        break;
      }
    }
  }
  
  if (!make || !model) return null;
  
  // Extract km/odometer
  let km: number | null = null;
  const kmPatterns = [
    /(\d{1,3}[,\s]?\d{3})\s*(?:km|kms|kilometres)/i,
    /(?:odometer|odo|kms?)\s*:?\s*(\d{1,3}[,\s]?\d{3})/i,
  ];
  for (const p of kmPatterns) {
    const m = html.match(p);
    if (m) {
      km = parseKm(m[1]);
      if (km) break;
    }
  }
  
  // Extract transmission
  let transmission: string | null = null;
  if (/\b(?:automatic|auto)\b/i.test(html)) transmission = 'Auto';
  else if (/\bmanual\b/i.test(html)) transmission = 'Manual';
  else if (/\bcvt\b/i.test(html)) transmission = 'CVT';
  
  // Extract fuel type
  let fuel: string | null = null;
  if (/\bdiesel\b/i.test(html)) fuel = 'Diesel';
  else if (/\bpetrol\b/i.test(html) || /\bunleaded\b/i.test(html)) fuel = 'Petrol';
  else if (/\bhybrid\b/i.test(html)) fuel = 'Hybrid';
  else if (/\belectric\b/i.test(html) || /\bev\b/i.test(html)) fuel = 'Electric';
  
  // Extract price/reserve/bid
  let reserve: number | null = null;
  let askingPrice: number | null = null;
  
  const pricePatterns = [
    /\$\s*([\d,]+)/g,
    /(?:reserve|guide|price)\s*:?\s*\$?\s*([\d,]+)/gi,
    /(?:current\s*bid|bid)\s*:?\s*\$?\s*([\d,]+)/gi,
  ];
  
  for (const p of pricePatterns) {
    const matches = html.matchAll(p);
    for (const m of matches) {
      const price = parsePrice(m[1]);
      if (price && price >= 1000 && price <= 500000) {
        if (!askingPrice) askingPrice = price;
        else if (!reserve) reserve = price;
      }
    }
  }
  
  // Extract location
  let location: string | null = null;
  const locationPatterns = [
    /(?:location|yard|branch)\s*:?\s*([^<,]+)/i,
    /(?:sydney|melbourne|brisbane|perth|adelaide|newcastle|parramatta|campbelltown|smithfield)/i,
  ];
  for (const p of locationPatterns) {
    const m = html.match(p);
    if (m) {
      location = titleCase(m[1] || m[0]).trim();
      break;
    }
  }
  
  // Extract auction date
  let auctionDatetime: string | null = null;
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(?:auction|sale)\s*(?:date)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ];
  for (const p of datePatterns) {
    const m = html.match(p);
    if (m) {
      try {
        // Parse as DD/MM/YYYY
        const parts = (m[1] || m[0]).split(/[\/\-]/);
        if (parts.length === 3) {
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1;
          let yr = parseInt(parts[2]);
          if (yr < 100) yr += 2000;
          const d = new Date(yr, month, day);
          if (!isNaN(d.getTime())) {
            auctionDatetime = d.toISOString();
          }
        }
      } catch {}
      break;
    }
  }
  
  // Determine status
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

// Split HTML into lot blocks
function findLotBlocks(html: string): string[] {
  const blocks: string[] = [];
  
  // Common BidsOnline lot container patterns
  const patterns = [
    /<div[^>]*class=["'][^"']*(?:lot-item|vehicle-card|auction-item|listing-item|stock-item)[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]*class=["'][^"']*(?:lot-item|vehicle-card|auction-item|listing-item|stock-item)|\s*$)/gi,
    /<article[^>]*>[\s\S]*?<\/article>/gi,
    /<li[^>]*class=["'][^"']*(?:lot|vehicle|item)[^"']*["'][^>]*>[\s\S]*?<\/li>/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      blocks.push(...matches);
      break;
    }
  }
  
  // Fallback: split by common separators
  if (blocks.length === 0) {
    // Try to find any divs with lot-related classes
    const lotDivs = html.match(/<div[^>]*(?:data-lot|lot-id|vehicle|item)[^>]*>[\s\S]*?(?=<div[^>]*(?:data-lot|lot-id|vehicle|item)|$)/gi);
    if (lotDivs) {
      blocks.push(...lotDivs);
    }
  }
  
  return blocks;
}

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

    // If source_key provided, look up from auction_sources
    let listUrl: string;
    let sourceKey: string;
    let regionHint: string = 'NSW_REGIONAL';
    
    if (source_key) {
      const { data: auctionSource, error: sourceError } = await supabase
        .from('auction_sources')
        .select('*')
        .eq('source_key', source_key)
        .eq('enabled', true)
        .single();
      
      if (sourceError || !auctionSource) {
        return new Response(
          JSON.stringify({ error: `Auction source not found or disabled: ${source_key}` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      listUrl = auctionSource.list_url;
      sourceKey = auctionSource.source_key;
      regionHint = auctionSource.region_hint;
    } else if (body.list_url) {
      listUrl = body.list_url;
      sourceKey = 'manual';
    } else {
      return new Response(
        JSON.stringify({ error: 'Must provide source_key or list_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[bidsonline-crawl] Crawling: ${listUrl} (source: ${sourceKey})`);

    // Fetch page with Firecrawl
    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const crawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url: listUrl,
        formats: ['html'],
        waitFor: 3000, // Wait for JS rendering
      }),
    });

    if (!crawlResponse.ok) {
      const errorText = await crawlResponse.text();
      console.error(`[bidsonline-crawl] Firecrawl error: ${errorText}`);
      
      // Update auction source with error
      if (source_key) {
        await supabase
          .from('auction_sources')
          .update({ last_error: `Firecrawl: ${crawlResponse.status}` })
          .eq('source_key', source_key);
      }
      
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

    console.log(`[bidsonline-crawl] Got ${html.length} bytes of HTML`);

    // Parse lots
    const lotBlocks = findLotBlocks(html);
    console.log(`[bidsonline-crawl] Found ${lotBlocks.length} lot blocks`);

    const parsedLots: ParsedLot[] = [];
    const errors: string[] = [];
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10;

    for (const block of lotBlocks) {
      try {
        const lot = parseLotItem(block, listUrl);
        if (lot) {
          // Apply 10-year window filter
          if (lot.year >= minYear) {
            // Add prefix for deterministic ID
            lot.lot_id = `BIDSONLINE:${lot.lot_id}`;
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
      
      // Log to cron_audit
      await supabase.from('cron_audit_log').insert({
        cron_name: `bidsonline-crawl:${sourceKey}`,
        success: true,
        result: { lotsFound: 0, message: 'No late-model lots found' },
      });
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          lotsFound: 0, 
          message: 'No late-model lots found on page' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map to ingest format and call nsw-regional-ingest
    const ingestPayload = parsedLots.map(lot => ({
      lot_id: lot.lot_id,
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

    // Map source_key to valid ingest source
    const sourceMap: Record<string, string> = {
      'autoauctions_sydney': 'autoauctions',
      'valley_motor_auctions': 'valley',
      'f3_motor_auctions': 'f3',
    };
    const ingestSource = sourceMap[sourceKey] || 'autoauctions';

    console.log(`[bidsonline-crawl] Calling nsw-regional-ingest with ${ingestPayload.length} lots`);

    const ingestResponse = await fetch(`${supabaseUrl}/functions/v1/nsw-regional-ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        lots: ingestPayload,
        source: ingestSource,
        eventId: `${sourceKey}-${new Date().toISOString().slice(0, 10)}`,
        auctionDate: new Date().toISOString().slice(0, 10),
      }),
    });

    const ingestResult = await ingestResponse.json();
    console.log(`[bidsonline-crawl] Ingest result:`, ingestResult);

    // Update auction source with success
    if (source_key) {
      await supabase
        .from('auction_sources')
        .update({ 
          last_success_at: new Date().toISOString(),
          last_lots_found: parsedLots.length,
          last_error: null,
        })
        .eq('source_key', source_key);
    }

    // Log to cron_audit
    await supabase.from('cron_audit_log').insert({
      cron_name: `bidsonline-crawl:${sourceKey}`,
      success: true,
      result: {
        lotsFound: parsedLots.length,
        ingestResult,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        source: sourceKey,
        lotsFound: parsedLots.length,
        ingestResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[bidsonline-crawl] Error:', error);

    // Log to cron_audit
    await supabase.from('cron_audit_log').insert({
      cron_name: 'bidsonline-crawl:error',
      success: false,
      error: errorMsg,
    });

    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
