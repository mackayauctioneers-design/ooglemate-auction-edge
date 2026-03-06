import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Listing Detail Enrichment Worker v1.0
 *
 * Scrapes listing detail pages via Firecrawl to extract:
 * - dealer_name, fuel_type, transmission, drivetrain, body_type
 * - colour, description, image_urls, seller_type, engine specs
 *
 * Runs every 2 minutes, 100 listings per batch.
 * Rate limit: max 200 pages/min (we do ~50/min with serial processing).
 * Retry up to 3 attempts, then marks details_failed = true.
 */

const BATCH_SIZE = 100;
const TIME_BUDGET_MS = 50000; // 50s budget (leave 10s buffer)
const MAX_ATTEMPTS = 3;
const PARALLEL_SIZE = 5; // 5 concurrent scrapes

interface DetailResult {
  dealer_name: string | null;
  fuel_type: string | null;
  transmission: string | null;
  drivetrain: string | null;
  body_type: string | null;
  colour: string | null;
  description: string | null;
  image_urls: string[] | null;
  seller_type: string | null;
  engine_size_l: number | null;
  engine_family: string | null;
  cylinders: number | null;
}

// ─── Source-specific parsers ───────────────────────────────────

function parseCarsalesMarkdown(md: string): DetailResult {
  const result: DetailResult = {
    dealer_name: null, fuel_type: null, transmission: null,
    drivetrain: null, body_type: null, colour: null,
    description: null, image_urls: null, seller_type: null,
    engine_size_l: null, engine_family: null, cylinders: null,
  };

  // Dealer name - often in "Sold by" or dealer card
  const dealerMatch = md.match(/(?:Sold by|Dealer|Selling dealer)[:\s]*([^\n|]+)/i);
  if (dealerMatch) result.dealer_name = dealerMatch[1].trim();

  // Fuel type
  const fuelMatch = md.match(/(?:Fuel Type|Fuel)[:\s|]*([^\n|,]+)/i);
  if (fuelMatch) result.fuel_type = normFuel(fuelMatch[1].trim());

  // Transmission
  const transMatch = md.match(/(?:Transmission)[:\s|]*([^\n|,]+)/i);
  if (transMatch) result.transmission = normTransmission(transMatch[1].trim());

  // Drivetrain
  const driveMatch = md.match(/(?:Drive Type|Drivetrain|Drive)[:\s|]*([^\n|,]+)/i);
  if (driveMatch) result.drivetrain = normDrivetrain(driveMatch[1].trim());

  // Body type
  const bodyMatch = md.match(/(?:Body Type|Body Style|Body)[:\s|]*([^\n|,]+)/i);
  if (bodyMatch) result.body_type = normBodyType(bodyMatch[1].trim());

  // Colour
  const colourMatch = md.match(/(?:Colour|Color|Ext(?:erior)?\s*Colour)[:\s|]*([^\n|,]+)/i);
  if (colourMatch) result.colour = colourMatch[1].trim().toUpperCase();

  // Engine
  const engineMatch = md.match(/(?:Engine)[:\s|]*([^\n|]+)/i);
  if (engineMatch) {
    const eng = engineMatch[1];
    const litreMatch = eng.match(/(\d+\.?\d*)\s*L/i);
    if (litreMatch) result.engine_size_l = parseFloat(litreMatch[1]);
    const cylMatch = eng.match(/(\d+)\s*cyl/i);
    if (cylMatch) result.cylinders = parseInt(cylMatch[1]);
  }

  // Description - take largest paragraph block
  const paragraphs = md.split('\n\n').filter(p => p.length > 80 && !p.startsWith('#') && !p.startsWith('|'));
  if (paragraphs.length > 0) {
    const longest = paragraphs.reduce((a, b) => a.length > b.length ? a : b);
    result.description = longest.trim().slice(0, 5000);
  }

  // Image URLs
  const imgMatches = [...md.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g)];
  if (imgMatches.length > 0) {
    result.image_urls = imgMatches.map(m => m[1]).slice(0, 20);
  }

  // Seller type
  if (md.match(/dealer|dealership/i) && !md.match(/private\s*seller/i)) {
    result.seller_type = 'dealer';
  } else if (md.match(/private\s*seller/i)) {
    result.seller_type = 'private';
  }

  // Derive engine family
  if (result.engine_size_l) {
    result.engine_family = deriveEngineFamily(result.engine_size_l, result.cylinders);
  }

  return result;
}

function parseAutotraderMarkdown(md: string): DetailResult {
  // Autotrader has similar structure - reuse carsales parser with minor tweaks
  const result = parseCarsalesMarkdown(md);

  // Autotrader-specific dealer pattern
  if (!result.dealer_name) {
    const atDealerMatch = md.match(/(?:About this dealer|Dealer Information)[:\s]*\n*([^\n]+)/i);
    if (atDealerMatch) result.dealer_name = atDealerMatch[1].trim();
  }

  return result;
}

function parseDriveMarkdown(md: string): DetailResult {
  return parseCarsalesMarkdown(md); // Similar structured data
}

function parseGenericMarkdown(md: string): DetailResult {
  return parseCarsalesMarkdown(md); // Fallback to generic extraction
}

// ─── Normalization helpers ─────────────────────────────────────

function normFuel(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.includes('DIESEL')) return 'DIESEL';
  if (upper.includes('PETROL') || upper.includes('UNLEADED')) return 'PETROL';
  if (upper.includes('HYBRID')) return 'HYBRID';
  if (upper.includes('ELECTRIC') || upper.includes('EV')) return 'ELECTRIC';
  if (upper.includes('LPG')) return 'LPG';
  return upper;
}

function normTransmission(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.includes('AUTO') || upper.includes('CVT') || upper.includes('DCT')) return 'AUTOMATIC';
  if (upper.includes('MANUAL')) return 'MANUAL';
  return upper;
}

function normDrivetrain(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.includes('4X4') || upper.includes('4WD') || upper.includes('AWD') || upper.includes('ALL WHEEL')) return '4WD';
  if (upper.includes('2WD') || upper.includes('RWD') || upper.includes('REAR')) return 'RWD';
  if (upper.includes('FWD') || upper.includes('FRONT')) return 'FWD';
  return upper;
}

function normBodyType(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.includes('UTE') || upper.includes('PICK')) return 'UTE';
  if (upper.includes('WAGON')) return 'WAGON';
  if (upper.includes('SUV')) return 'SUV';
  if (upper.includes('SEDAN')) return 'SEDAN';
  if (upper.includes('HATCH')) return 'HATCH';
  if (upper.includes('COUPE')) return 'COUPE';
  if (upper.includes('CAB CHASSIS')) return 'CAB_CHASSIS';
  if (upper.includes('VAN')) return 'VAN';
  if (upper.includes('CONVERTIBLE')) return 'CONVERTIBLE';
  return upper;
}

function deriveEngineFamily(litres: number, cyls: number | null): string | null {
  if (cyls) {
    if (cyls === 8) return 'V8';
    if (cyls === 6) return 'V6';
    if (cyls === 4) return 'I4';
    if (cyls === 3) return 'I3';
  }
  if (litres >= 4.4) return 'V8';
  if (litres >= 3.0 && litres < 4.4) return 'V6';
  if (litres >= 1.5 && litres < 3.0) return 'I4';
  return null;
}

// ─── Scrape a single listing ───────────────────────────────────

async function scrapeDetail(
  firecrawlKey: string,
  url: string,
  source: string,
): Promise<DetailResult> {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 2000,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const markdown = data.data?.markdown || data.markdown || '';

  if (!markdown || markdown.length < 50) {
    throw new Error('Empty or too-short markdown returned');
  }

  // Route to source-specific parser
  if (source === 'carsales') return parseCarsalesMarkdown(markdown);
  if (source === 'autotrader') return parseAutotraderMarkdown(markdown);
  if (source === 'drive') return parseDriveMarkdown(markdown);
  return parseGenericMarkdown(markdown);
}

// ─── Main handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || BATCH_SIZE;

    // Firecrawl blocks autotrader.com.au — excluded at SQL level
    // Autotrader listings are bulk-marked details_failed separately

    // Fetch listings needing detail enrichment
    const { data: filteredListings, error: fetchErr } = await supabase
      .from('retail_listings')
      .select('id, listing_url, source, details_attempts')
      .eq('details_scraped', false)
      .eq('details_failed', false)
      .lt('details_attempts', MAX_ATTEMPTS)
      .not('listing_url', 'is', null)
      .neq('source', 'autotrader')
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (fetchErr) throw new Error(`Query failed: ${fetchErr.message}`);

    if (!filteredListings || filteredListings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No listings to enrich', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`Detail-enrich: processing ${filteredListings.length} listings`);

    const stats = { processed: 0, succeeded: 0, failed: 0, skipped: 0, blocked: blockedListings.length, errors: [] as string[] };

    // Process in parallel chunks
    for (let i = 0; i < filteredListings.length; i += PARALLEL_SIZE) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`Time budget hit after ${stats.processed} items`);
        break;
      }

      const chunk = filteredListings.slice(i, i + PARALLEL_SIZE);

      await Promise.allSettled(chunk.map(async (listing: any) => {
        if (!listing.listing_url) {
          stats.skipped++;
          return;
        }

        try {
          const detail = await scrapeDetail(firecrawlKey, listing.listing_url, listing.source);

          // Build update payload - only set fields that were extracted
          const update: Record<string, any> = {
            details_scraped: true,
            details_scraped_at: new Date().toISOString(),
            details_attempts: (listing.details_attempts || 0) + 1,
          };

          if (detail.dealer_name) update.seller_name_raw = detail.dealer_name;
          if (detail.fuel_type) update.fuel_type = detail.fuel_type;
          if (detail.transmission) update.transmission = detail.transmission;
          if (detail.drivetrain) update.drivetrain = detail.drivetrain;
          if (detail.body_type) update.body_type = detail.body_type;
          if (detail.colour) update.colour = detail.colour;
          if (detail.description) update.description = detail.description;
          if (detail.image_urls) update.image_urls = detail.image_urls;
          if (detail.seller_type) update.seller_type = detail.seller_type;
          if (detail.engine_size_l) update.engine_size_l = detail.engine_size_l;
          if (detail.engine_family) update.engine_family = detail.engine_family;
          if (detail.cylinders) update.cylinders = detail.cylinders;

          const { error: updateErr } = await supabase
            .from('retail_listings')
            .update(update)
            .eq('id', listing.id);

          if (updateErr) {
            throw new Error(`Update failed: ${updateErr.message}`);
          }

          stats.succeeded++;
          stats.processed++;
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          const newAttempts = (listing.details_attempts || 0) + 1;

          await supabase
            .from('retail_listings')
            .update({
              details_attempts: newAttempts,
              details_failed: newAttempts >= MAX_ATTEMPTS,
              enrichment_errors: errMsg.slice(0, 500),
            })
            .eq('id', listing.id);

          stats.failed++;
          stats.processed++;
          stats.errors.push(`${listing.id}: ${errMsg.slice(0, 100)}`);
        }
      }));
    }

    // Audit log
    await supabase.from('cron_audit_log').insert({
      cron_name: 'listing-detail-enrich',
      success: stats.failed < stats.processed || stats.processed === 0,
      result: stats,
      error: stats.errors.length > 0 ? stats.errors.slice(0, 5).join('; ') : null,
    });

    console.log('Detail-enrich complete:', stats);

    return new Response(
      JSON.stringify({ success: true, stats }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Detail-enrich error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
