import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedLot {
  lot_id: string;
  make: string;
  model: string;
  variant_raw: string;
  variant_family: string;
  year: number;
  km: number | null;
  transmission: string;
  drivetrain: string;
  fuel: string;
  location: string;
  auction_datetime: string;
  listing_url: string;
}

// Variant family whitelist for normalization
const VARIANT_FAMILY_TOKENS = [
  'SR5', 'SR', 'GXL', 'GX', 'GL', 'VX', 'SAHARA',
  'XLT', 'WILDTRAK', 'RANGER', 
  'ST', 'ST-X', 'STX',
  'LT', 'LTZ', 'Z71', 'ZR2',
  'GR', 'GT', 'RS'
];

function deriveVariantFamily(variantRaw: string): string {
  if (!variantRaw) return '';
  const upper = variantRaw.toUpperCase();
  for (const token of VARIANT_FAMILY_TOKENS) {
    if (upper.includes(token.toUpperCase())) {
      return token.toUpperCase();
    }
  }
  return '';
}

// Parse Pickles catalogue content
function parsePicklesCatalogue(rawText: string, eventId: string, auctionDate: string): ParsedLot[] {
  const lots: ParsedLot[] = [];
  const seenLots = new Set<string>();
  
  // Multiple patterns to match lot entries
  const patterns = [
    /\|\s*(\d+)\s*\|\s*CP:\s*(\d{2}\/\d{4})\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^|]+)/gi,
    /\|\s*(\d+)\s+CP:\s*(\d{2}\/\d{4})\s*\|\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^|]+)/gi,
    /\|\s*(\d+)\s+CP:\s*\|\s*(\d{2}\/\d{4})\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^|]+)/gi,
  ];
  
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(rawText)) !== null) {
      const lotNumber = match[1];
      if (seenLots.has(lotNumber)) continue;
      
      const compDate = match[2];
      const yearMatch = compDate.match(/\d{2}\/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      
      const make = match[3].trim();
      const model = match[4].trim();
      const remainingText = match[5] || '';
      const parts = remainingText.split(',').map(p => p.trim());
      const variant_raw = parts[0] || '';
      
      // Extract transmission
      let transmission = 'Auto';
      if (/manual/i.test(remainingText)) transmission = 'Manual';
      
      // Extract fuel type
      let fuel = '';
      if (/diesel/i.test(remainingText)) fuel = 'Diesel';
      else if (/petrol|unleaded/i.test(remainingText)) fuel = 'Petrol';
      
      // Extract KM
      let km: number | null = null;
      const kmMatch = remainingText.match(/(\d[\d,]*)\s*\(Kms/i);
      if (kmMatch) km = parseInt(kmMatch[1].replace(/,/g, ''));
      
      // Extract location
      let location = '';
      const locationMatch = remainingText.match(/([A-Za-z\s]+),?\s*(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i);
      if (locationMatch) {
        location = `${locationMatch[1].trim()}, ${locationMatch[2].toUpperCase()}`;
      }
      
      // Extract drivetrain
      let drivetrain = '';
      if (/\b4WD\b|four[- ]?wheel/i.test(remainingText)) drivetrain = '4WD';
      else if (/\bAWD\b/i.test(remainingText)) drivetrain = 'AWD';
      
      const variant_family = deriveVariantFamily(variant_raw);
      
      seenLots.add(lotNumber);
      lots.push({
        lot_id: lotNumber,
        make,
        model,
        variant_raw,
        variant_family,
        year,
        km,
        transmission,
        drivetrain,
        fuel,
        location,
        auction_datetime: auctionDate,
        listing_url: `https://www.pickles.com.au/cars/item/-/details/${eventId}/${lotNumber}`,
      });
    }
  }
  
  return lots.sort((a, b) => parseInt(a.lot_id) - parseInt(b.lot_id));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { catalogueText, eventId, auctionDate } = body;

    if (!catalogueText || !eventId || !auctionDate) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: catalogueText, eventId, auctionDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pickles-ingest] Starting ingestion for event ${eventId}, date ${auctionDate}`);

    // Create ingestion run
    const { data: run, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: 'pickles_catalogue',
        metadata: { eventId, auctionDate }
      })
      .select()
      .single();

    if (runError) {
      console.error('[pickles-ingest] Failed to create run:', runError);
      throw runError;
    }

    // Parse catalogue
    const parsedLots = parsePicklesCatalogue(catalogueText, eventId, auctionDate);
    console.log(`[pickles-ingest] Parsed ${parsedLots.length} lots`);

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const lot of parsedLots) {
      const listingId = `Pickles:${lot.lot_id}`;
      
      try {
        // Check if listing exists
        const { data: existing } = await supabase
          .from('vehicle_listings')
          .select('id, status, pass_count')
          .eq('listing_id', listingId)
          .single();

        if (existing) {
          // Update existing listing
          await supabase
            .from('vehicle_listings')
            .update({
              make: lot.make,
              model: lot.model,
              variant_raw: lot.variant_raw,
              variant_family: lot.variant_family,
              year: lot.year,
              km: lot.km,
              transmission: lot.transmission,
              drivetrain: lot.drivetrain,
              fuel: lot.fuel,
              location: lot.location,
              auction_datetime: lot.auction_datetime,
              listing_url: lot.listing_url,
              last_seen_at: new Date().toISOString(),
              status: 'catalogue',
            })
            .eq('id', existing.id);
          updated++;
        } else {
          // Insert new listing
          await supabase
            .from('vehicle_listings')
            .insert({
              listing_id: listingId,
              lot_id: lot.lot_id,
              source: 'pickles',
              auction_house: 'Pickles',
              event_id: eventId,
              make: lot.make,
              model: lot.model,
              variant_raw: lot.variant_raw,
              variant_family: lot.variant_family,
              year: lot.year,
              km: lot.km,
              transmission: lot.transmission,
              drivetrain: lot.drivetrain,
              fuel: lot.fuel,
              location: lot.location,
              auction_datetime: lot.auction_datetime,
              listing_url: lot.listing_url,
              status: 'catalogue',
              visible_to_dealers: true,
            });
          created++;
        }
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const msg = `Error processing lot ${lot.lot_id}: ${errorMsg}`;
        console.error(`[pickles-ingest] ${msg}`);
        errors.push(msg);
      }
    }

    // Update run status
    await supabase
      .from('ingestion_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: errors.length > 0 ? 'partial' : 'success',
        lots_found: parsedLots.length,
        lots_created: created,
        lots_updated: updated,
        errors,
      })
      .eq('id', run.id);

    console.log(`[pickles-ingest] Complete: ${created} created, ${updated} updated, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        runId: run.id,
        lotsFound: parsedLots.length,
        created,
        updated,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[pickles-ingest] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
