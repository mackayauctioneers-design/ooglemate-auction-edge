import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ManheimAuctionLot {
  lot_id: string;
  make: string;
  model: string;
  variant?: string;
  year: number;
  km?: number;
  transmission?: string;
  drivetrain?: string;
  fuel?: string;
  location: string;
  auction_datetime?: string;
  reserve?: number;
  status: string;
}

// Rate limiting state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 500;

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// Scrape Manheim auction pages using Firecrawl
async function scrapeManheimPage(apiKey: string, url: string): Promise<{ markdown: string; html: string } | null> {
  try {
    const response = await rateLimitedFetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      console.error(`[manheim-crawl] Scrape failed for ${url}:`, data.error);
      return null;
    }

    return {
      markdown: data.data?.markdown || data.markdown || '',
      html: data.data?.html || data.html || '',
    };
  } catch (error) {
    console.error(`[manheim-crawl] Error scraping ${url}:`, error);
    return null;
  }
}

// Parse lot data from Manheim HTML/markdown
function parseLotFromContent(content: string, lotId: string): ManheimAuctionLot | null {
  // Extract vehicle info using common patterns
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  
  let make = '';
  let model = '';
  let variant = '';
  let year = 0;
  let km: number | undefined;
  let transmission: string | undefined;
  let fuel: string | undefined;
  let location = '';
  let reserve: number | undefined;
  let status = 'catalogue';
  
  // Look for year make model pattern (e.g., "2022 Toyota Hilux SR5")
  const ymPattern = /(\d{4})\s+(\w+)\s+(\w+)\s*(.*)/i;
  for (const line of lines) {
    const match = line.match(ymPattern);
    if (match && parseInt(match[1]) >= 2000 && parseInt(match[1]) <= 2027) {
      year = parseInt(match[1]);
      make = match[2];
      model = match[3];
      variant = match[4] || '';
      break;
    }
  }
  
  // Extract KM
  const kmMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*(?:km|kms|kilometres)/i);
  if (kmMatch) {
    km = parseInt(kmMatch[1].replace(/,/g, ''));
  }
  
  // Extract transmission
  if (/automatic|auto/i.test(content)) transmission = 'Auto';
  else if (/manual/i.test(content)) transmission = 'Manual';
  else if (/cvt/i.test(content)) transmission = 'CVT';
  
  // Extract fuel
  if (/diesel/i.test(content)) fuel = 'Diesel';
  else if (/petrol|unleaded/i.test(content)) fuel = 'Petrol';
  else if (/hybrid/i.test(content)) fuel = 'Hybrid';
  else if (/electric/i.test(content)) fuel = 'Electric';
  
  // Extract location
  const locMatch = content.match(/(?:location|yard|branch):\s*([^\,\n]+)/i);
  if (locMatch) location = locMatch[1].trim();
  
  // Extract reserve/guide price
  const priceMatch = content.match(/\$\s*([\d,]+)/);
  if (priceMatch) {
    reserve = parseInt(priceMatch[1].replace(/,/g, ''));
  }
  
  // Determine status
  if (/sold|cleared/i.test(content)) status = 'cleared';
  else if (/passed\s*in|no\s*sale/i.test(content)) status = 'passed_in';
  else if (/withdrawn/i.test(content)) status = 'withdrawn';
  
  if (!make || !model || year < 2000) {
    return null;
  }
  
  return {
    lot_id: lotId,
    make,
    model,
    variant,
    year,
    km,
    transmission,
    fuel,
    location,
    reserve,
    status,
  };
}

// Discover auction event URLs from Manheim sitemap
async function discoverAuctionEvents(apiKey: string): Promise<string[]> {
  try {
    // Map Manheim site to find auction URLs
    const response = await rateLimitedFetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://www.manheim.com.au/buying',
        search: 'auction',
        limit: 100,
        includeSubdomains: false,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      console.error('[manheim-crawl] Map failed:', data.error);
      return [];
    }

    // Filter for auction event URLs
    const auctionUrls = (data.links || []).filter((url: string) => 
      /auction|sale|event|catalogue/i.test(url) && 
      !url.includes('login') && 
      !url.includes('register')
    );

    console.log(`[manheim-crawl] Discovered ${auctionUrls.length} auction URLs`);
    return auctionUrls.slice(0, 10); // Limit to 10 events per run
  } catch (error) {
    console.error('[manheim-crawl] Error discovering auctions:', error);
    return [];
  }
}

// Extract lot URLs from an auction page
async function extractLotUrls(apiKey: string, auctionUrl: string): Promise<string[]> {
  const content = await scrapeManheimPage(apiKey, auctionUrl);
  if (!content) return [];
  
  // Find lot URLs in the content
  const lotUrlPattern = /https:\/\/(?:www\.)?manheim\.com\.au\/[^\'"\s]*lot[^\'"\s]*/gi;
  const matches = content.html.match(lotUrlPattern) || [];
  
  // Dedupe and clean
  const uniqueLots = [...new Set(matches)].filter(url => 
    !url.includes('undefined') && url.length < 200
  );
  
  console.log(`[manheim-crawl] Found ${uniqueLots.length} lot URLs in ${auctionUrl}`);
  return uniqueLots.slice(0, 50); // Max 50 lots per event
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const telemetry: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    errors: [] as string[],
    warnings: [] as string[],
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!firecrawlKey) {
      console.error('[manheim-crawl] FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl connector not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { mode = 'discover', auctionUrls = [] } = body;

    console.log(`[manheim-crawl] Starting in ${mode} mode`);

    // For demo/testing, we'll use simulated data if no real auction URLs
    // In production, this would discover and crawl real Manheim pages
    let collectedLots: ManheimAuctionLot[] = [];
    const regionCounts: Record<string, number> = {};
    
    if (mode === 'discover') {
      // Discover active auctions
      const eventUrls = await discoverAuctionEvents(firecrawlKey);
      telemetry.eventsDiscovered = eventUrls.length;
      
      if (eventUrls.length === 0) {
        telemetry.warnings = [...(telemetry.warnings as string[]), 'No auction events discovered'];
        console.log('[manheim-crawl] No events found, using fallback sample data');
      }
      
      // For each event, extract and process lots
      for (const eventUrl of eventUrls) {
        try {
          const lotUrls = await extractLotUrls(firecrawlKey, eventUrl);
          
          for (const lotUrl of lotUrls) {
            const lotId = lotUrl.split('/').pop() || `lot-${Date.now()}`;
            const content = await scrapeManheimPage(firecrawlKey, lotUrl);
            
            if (content) {
              const lot = parseLotFromContent(content.markdown + '\n' + content.html, lotId);
              if (lot) {
                collectedLots.push(lot);
              }
            }
          }
        } catch (error) {
          const msg = `Error processing ${eventUrl}: ${error instanceof Error ? error.message : String(error)}`;
          (telemetry.errors as string[]).push(msg);
          console.error(`[manheim-crawl] ${msg}`);
        }
      }
    } else if (mode === 'direct' && auctionUrls.length > 0) {
      // Direct crawl of provided URLs
      for (const url of auctionUrls) {
        const content = await scrapeManheimPage(firecrawlKey, url);
        if (content) {
          const lotId = url.split('/').pop() || `lot-${Date.now()}`;
          const lot = parseLotFromContent(content.markdown + '\n' + content.html, lotId);
          if (lot) {
            collectedLots.push(lot);
          }
        }
      }
    }

    // If no lots collected, log and return early
    if (collectedLots.length === 0) {
      console.log('[manheim-crawl] No lots collected from crawl');
      
      // Create ingestion run record for telemetry
      await supabase.from('ingestion_runs').insert({
        source: 'manheim-crawl',
        status: 'empty',
        lots_found: 0,
        lots_created: 0,
        metadata: { 
          ...telemetry,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        }
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Crawl completed but no lots found',
          lotsCollected: 0,
          telemetry,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call manheim-ingest with collected lots
    const eventId = `CRAWL-${new Date().toISOString().split('T')[0]}`;
    const auctionDate = new Date().toISOString().split('T')[0];

    console.log(`[manheim-crawl] Submitting ${collectedLots.length} lots to manheim-ingest`);

    const { data: ingestResult, error: ingestError } = await supabase.functions.invoke('manheim-ingest', {
      body: {
        lots: collectedLots,
        eventId,
        auctionDate,
      }
    });

    if (ingestError) {
      throw new Error(`Ingest invocation failed: ${ingestError.message}`);
    }

    // Calculate region distribution from ingested lots
    for (const lot of collectedLots) {
      const region = lot.location ? deriveAuRegionFromLocation(lot.location) : 'UNKNOWN';
      regionCounts[region] = (regionCounts[region] || 0) + 1;
    }

    const processingTimeMs = Date.now() - startTime;
    console.log(`[manheim-crawl] Complete in ${processingTimeMs}ms: ${ingestResult.created} created, ${ingestResult.updated} updated`);

    return new Response(
      JSON.stringify({
        success: true,
        lotsCollected: collectedLots.length,
        created: ingestResult.created,
        updated: ingestResult.updated,
        snapshotsAdded: ingestResult.snapshotsAdded,
        dropped: ingestResult.dropped,
        regionCounts: ingestResult.regionCounts || regionCounts,
        telemetry: {
          ...telemetry,
          completedAt: new Date().toISOString(),
          durationMs: processingTimeMs,
          ingestRunId: ingestResult.runId,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[manheim-crawl] Error:', error);
    
    (telemetry.errors as string[]).push(errorMsg);
    telemetry.completedAt = new Date().toISOString();
    telemetry.durationMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMsg,
        telemetry,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper to derive AU region from location string
function deriveAuRegionFromLocation(location: string): string {
  if (!location) return 'UNKNOWN';
  const loc = location.toUpperCase();
  
  // NSW
  const nswSydneyMetro = ['SYDNEY', 'PARRAMATTA', 'BLACKTOWN', 'PENRITH', 'LIVERPOOL', 
    'CAMPBELLTOWN', 'BANKSTOWN', 'HOMEBUSH', 'RYDE', 'CHATSWOOD', 'HORNSBY',
    'SUTHERLAND', 'MIRANDA', 'KOGARAH', 'ROCKDALE', 'MASCOT', 'ALEXANDRIA',
    'SMITHFIELD', 'WETHERILL', 'MOOREBANK', 'PRESTONS', 'MINTO', 'SILVERWATER'];
  if (nswSydneyMetro.some(s => loc.includes(s))) return 'NSW_SYDNEY_METRO';
  
  const nswCentralCoast = ['GOSFORD', 'WYONG', 'TUGGERAH', 'ERINA', 'TERRIGAL', 
    'KARIONG', 'WOY WOY', 'UMINA', 'BATEAU BAY'];
  if (nswCentralCoast.some(s => loc.includes(s))) return 'NSW_CENTRAL_COAST';
  
  const nswHunter = ['NEWCASTLE', 'MAITLAND', 'CESSNOCK', 'SINGLETON', 'MUSWELLBROOK',
    'HUNTER', 'CHARLESTOWN', 'CARDIFF', 'KOTARA', 'WALLSEND', 'MAYFIELD'];
  if (nswHunter.some(s => loc.includes(s))) return 'NSW_HUNTER_NEWCASTLE';
  
  if (loc.includes('NSW') || loc.includes('NEW SOUTH WALES')) return 'NSW_REGIONAL';
  
  // VIC
  const vicMetro = ['MELBOURNE', 'DANDENONG', 'RINGWOOD', 'FRANKSTON', 'CLAYTON',
    'MOORABBIN', 'TULLAMARINE', 'ESSENDON', 'FOOTSCRAY', 'ALTONA', 'SUNSHINE',
    'BROADMEADOWS', 'THOMASTOWN', 'BUNDOORA', 'HEIDELBERG', 'CAMBERWELL',
    'NUNAWADING', 'BOX HILL', 'GLEN WAVERLEY', 'CHELTENHAM', 'LAVERTON'];
  if (vicMetro.some(s => loc.includes(s))) return 'VIC_METRO';
  if (loc.includes('VIC') || loc.includes('VICTORIA')) return 'VIC_REGIONAL';
  
  // QLD
  const qldSE = ['BRISBANE', 'GOLD COAST', 'SUNSHINE COAST', 'IPSWICH', 'LOGAN',
    'TOOWOOMBA', 'REDCLIFFE', 'CABOOLTURE', 'MAROOCHYDORE', 'COOLANGATTA',
    'SOUTHPORT', 'BEENLEIGH', 'SPRINGWOOD', 'UNDERWOOD', 'ROCKLEA', 'DARRA'];
  if (qldSE.some(s => loc.includes(s))) return 'QLD_SE';
  if (loc.includes('QLD') || loc.includes('QUEENSLAND')) return 'QLD_REGIONAL';
  
  // Other states
  if (['ADELAIDE', 'ELIZABETH', 'SALISBURY', 'SA', 'SOUTH AUSTRALIA'].some(s => loc.includes(s))) return 'SA';
  if (['PERTH', 'FREMANTLE', 'JOONDALUP', 'WA', 'WESTERN AUSTRALIA'].some(s => loc.includes(s))) return 'WA';
  if (['HOBART', 'LAUNCESTON', 'TAS', 'TASMANIA'].some(s => loc.includes(s))) return 'TAS';
  if (['DARWIN', 'ALICE SPRINGS', 'NT', 'NORTHERN TERRITORY'].some(s => loc.includes(s))) return 'NT';
  if (['CANBERRA', 'FYSHWICK', 'ACT'].some(s => loc.includes(s))) return 'ACT';
  
  return 'UNKNOWN';
}
