import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ManheimLot {
  lot_id: string;
  make: string;
  model: string;
  variant_raw: string;
  variant_family: string;
  year: number;
  km: number | null;
  transmission: string | null;
  drivetrain: string | null;
  fuel: string | null;
  location: string;
  region_id: string;
  auction_datetime: string;
  listing_url: string;
  reserve: number | null;
  status: string;
}

// Australia-wide region bucket mapping
function deriveAuRegion(location: string): string {
  if (!location) return 'UNKNOWN';
  const loc = location.toUpperCase();
  
  // === NSW ===
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
  
  // Check for NSW state marker before falling through
  if (loc.includes('NSW') || loc.includes('NEW SOUTH WALES')) return 'NSW_REGIONAL';
  
  // === VIC ===
  const vicMetro = ['MELBOURNE', 'DANDENONG', 'RINGWOOD', 'FRANKSTON', 'CLAYTON',
    'MOORABBIN', 'TULLAMARINE', 'ESSENDON', 'FOOTSCRAY', 'ALTONA', 'SUNSHINE',
    'BROADMEADOWS', 'THOMASTOWN', 'BUNDOORA', 'HEIDELBERG', 'CAMBERWELL',
    'NUNAWADING', 'BOX HILL', 'GLEN WAVERLEY', 'CHELTENHAM', 'LAVERTON'];
  if (vicMetro.some(s => loc.includes(s))) return 'VIC_METRO';
  
  if (loc.includes('VIC') || loc.includes('VICTORIA')) return 'VIC_REGIONAL';
  
  // === QLD ===
  const qldSE = ['BRISBANE', 'GOLD COAST', 'SUNSHINE COAST', 'IPSWICH', 'LOGAN',
    'TOOWOOMBA', 'REDCLIFFE', 'CABOOLTURE', 'MAROOCHYDORE', 'COOLANGATTA',
    'SOUTHPORT', 'BEENLEIGH', 'SPRINGWOOD', 'UNDERWOOD', 'ROCKLEA', 'DARRA'];
  if (qldSE.some(s => loc.includes(s))) return 'QLD_SE';
  
  if (loc.includes('QLD') || loc.includes('QUEENSLAND')) return 'QLD_REGIONAL';
  
  // === SA ===
  const saLocations = ['ADELAIDE', 'ELIZABETH', 'SALISBURY', 'PROSPECT', 'EDWARDSTOWN',
    'POORAKA', 'GEPPS CROSS', 'SA', 'SOUTH AUSTRALIA'];
  if (saLocations.some(s => loc.includes(s))) return 'SA';
  
  // === WA ===
  const waLocations = ['PERTH', 'FREMANTLE', 'JOONDALUP', 'ROCKINGHAM', 'MIDLAND',
    'OSBORNE PARK', 'CANNINGTON', 'WELSHPOOL', 'MALAGA', 'WA', 'WESTERN AUSTRALIA'];
  if (waLocations.some(s => loc.includes(s))) return 'WA';
  
  // === TAS ===
  const tasLocations = ['HOBART', 'LAUNCESTON', 'DEVONPORT', 'BURNIE', 'TAS', 'TASMANIA'];
  if (tasLocations.some(s => loc.includes(s))) return 'TAS';
  
  // === NT ===
  const ntLocations = ['DARWIN', 'ALICE SPRINGS', 'NT', 'NORTHERN TERRITORY'];
  if (ntLocations.some(s => loc.includes(s))) return 'NT';
  
  // === ACT ===
  const actLocations = ['CANBERRA', 'FYSHWICK', 'MITCHELL', 'ACT', 'AUSTRALIAN CAPITAL'];
  if (actLocations.some(s => loc.includes(s))) return 'ACT';
  
  return 'UNKNOWN';
}

// Variant family whitelist for normalization
const VARIANT_FAMILY_TOKENS = [
  'SR5', 'SR', 'GXL', 'GX', 'GL', 'VX', 'SAHARA',
  'XLT', 'WILDTRAK', 'RANGER', 
  'ST', 'ST-X', 'STX',
  'LT', 'LTZ', 'Z71', 'ZR2',
  'GR', 'GT', 'RS', 'SPORT', 'TITANIUM', 'TREND'
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

// Parse Manheim auction feed - expects array of lots from API/crawl
function parseManheimFeed(lots: unknown[]): ManheimLot[] {
  const parsed: ManheimLot[] = [];
  
  for (const lot of lots) {
    const l = lot as Record<string, unknown>;
    
    // Extract required fields with fallbacks
    const lotId = String(l.lot_id || l.lotId || l.id || '');
    if (!lotId) continue;
    
    const make = String(l.make || '').trim();
    const model = String(l.model || '').trim();
    if (!make || !model) continue;
    
    const variantRaw = String(l.variant || l.variant_raw || l.series || '').trim();
    const year = parseInt(String(l.year || l.build_year || new Date().getFullYear()));
    if (year < 2000 || year > new Date().getFullYear() + 1) continue;
    
    // KM parsing
    let km: number | null = null;
    const kmVal = l.km || l.odometer || l.kilometres;
    if (kmVal !== undefined && kmVal !== null) {
      km = parseInt(String(kmVal).replace(/[,\s]/g, ''));
      if (isNaN(km)) km = null;
    }
    
    // Location
    const location = String(l.location || l.yard || l.branch || '').trim();
    const regionId = deriveAuRegion(location);
    
    // Auction datetime
    const auctionDatetime = String(l.auction_datetime || l.auction_date || l.sale_date || '');
    
    // Reserve/price
    let reserve: number | null = null;
    const reserveVal = l.reserve || l.guide_price || l.reserve_price;
    if (reserveVal !== undefined && reserveVal !== null) {
      reserve = parseInt(String(reserveVal).replace(/[,$\s]/g, ''));
      if (isNaN(reserve)) reserve = null;
    }
    
    // Status mapping
    let status = 'catalogue';
    const rawStatus = String(l.status || '').toLowerCase();
    if (rawStatus.includes('sold') || rawStatus.includes('cleared')) status = 'cleared';
    else if (rawStatus.includes('passed') || rawStatus.includes('no sale')) status = 'passed_in';
    else if (rawStatus.includes('withdrawn')) status = 'withdrawn';
    
    // Transmission
    let transmission: string | null = null;
    const trans = String(l.transmission || l.gearbox || '').toLowerCase();
    if (trans.includes('auto')) transmission = 'Auto';
    else if (trans.includes('manual')) transmission = 'Manual';
    else if (trans.includes('cvt')) transmission = 'CVT';
    
    // Fuel
    let fuel: string | null = null;
    const fuelVal = String(l.fuel || l.fuel_type || '').toLowerCase();
    if (fuelVal.includes('diesel')) fuel = 'Diesel';
    else if (fuelVal.includes('petrol') || fuelVal.includes('unleaded')) fuel = 'Petrol';
    else if (fuelVal.includes('hybrid')) fuel = 'Hybrid';
    else if (fuelVal.includes('electric')) fuel = 'Electric';
    
    // Drivetrain
    let drivetrain: string | null = null;
    const driveVal = String(l.drivetrain || l.drive || '').toLowerCase();
    if (driveVal.includes('4wd') || driveVal.includes('4x4')) drivetrain = '4WD';
    else if (driveVal.includes('awd')) drivetrain = 'AWD';
    else if (driveVal.includes('fwd') || driveVal.includes('front')) drivetrain = 'FWD';
    else if (driveVal.includes('rwd') || driveVal.includes('rear')) drivetrain = 'RWD';
    
    parsed.push({
      lot_id: lotId,
      make,
      model,
      variant_raw: variantRaw,
      variant_family: deriveVariantFamily(variantRaw),
      year,
      km,
      transmission,
      drivetrain,
      fuel,
      location,
      region_id: regionId,
      auction_datetime: auctionDatetime,
      listing_url: `https://www.manheim.com.au/lot/${lotId}`,
      reserve,
      status,
    });
  }
  
  return parsed;
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
    const { lots, eventId, auctionDate } = body;

    if (!lots || !Array.isArray(lots)) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: lots (array)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[manheim-ingest] Starting ingestion: ${lots.length} lots, event ${eventId || 'N/A'}`);

    // Create ingestion run
    const { data: run, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: 'manheim',
        metadata: { eventId, auctionDate, lotsReceived: lots.length }
      })
      .select()
      .single();

    if (runError) {
      console.error('[manheim-ingest] Failed to create run:', runError);
      throw runError;
    }

    // Parse lots
    const parsedLots = parseManheimFeed(lots);
    console.log(`[manheim-ingest] Parsed ${parsedLots.length} valid lots from ${lots.length} input`);

    let created = 0;
    let updated = 0;
    let dropped = 0;
    let snapshotsAdded = 0;
    const errors: string[] = [];
    const dropReasons: Record<string, number> = {};
    const regionCounts: Record<string, number> = {};

    const dedupeWarnings: string[] = [];
    
    for (const lot of parsedLots) {
      // Dedupe watch: Include eventId in listing_id if lot_id appears reused
      const baseListingId = `Manheim:${lot.lot_id}`;
      let listingId = baseListingId;
      
      // Check if this lot_id exists with a different event
      const { data: existingWithDifferentEvent } = await supabase
        .from('vehicle_listings')
        .select('id, event_id')
        .eq('listing_id', baseListingId)
        .single();
      
      if (existingWithDifferentEvent && existingWithDifferentEvent.event_id && 
          eventId && existingWithDifferentEvent.event_id !== eventId) {
        // Lot ID reuse detected across events - use event-scoped ID
        listingId = `Manheim:${eventId}:${lot.lot_id}`;
        const warning = `Lot ID reuse detected: ${lot.lot_id} (old: ${existingWithDifferentEvent.event_id}, new: ${eventId})`;
        dedupeWarnings.push(warning);
        console.warn(`[manheim-ingest] ${warning}`);
      }
      
      // Track region distribution
      regionCounts[lot.region_id] = (regionCounts[lot.region_id] || 0) + 1;
      
      // Quality gate: year >= 2016 for dealer grade
      if (lot.year < 2016) {
        dropped++;
        dropReasons['year_below_2016'] = (dropReasons['year_below_2016'] || 0) + 1;
        continue;
      }
      
      try {
        // Check if listing exists
        const { data: existing } = await supabase
          .from('vehicle_listings')
          .select('id, status, pass_count, relist_count, first_seen_at, reserve, km, location')
          .eq('listing_id', listingId)
          .single();

        let listingUuid: string;

        if (existing) {
          listingUuid = existing.id;
          
          // Track status transitions
          const wasPassedIn = existing.status === 'passed_in';
          const nowCatalogue = lot.status === 'catalogue';
          const isRelist = wasPassedIn && nowCatalogue;
          
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
              auction_datetime: lot.auction_datetime || undefined,
              listing_url: lot.listing_url,
              reserve: lot.reserve,
              last_seen_at: new Date().toISOString(),
              status: lot.status,
              relist_count: isRelist ? (existing.relist_count || 0) + 1 : existing.relist_count,
              pass_count: lot.status === 'passed_in' && existing.status !== 'passed_in' 
                ? (existing.pass_count || 0) + 1 
                : existing.pass_count,
              is_dealer_grade: true,
            })
            .eq('id', existing.id);
          updated++;
          
          // Add snapshot if anything changed
          const hasChanged = 
            existing.status !== lot.status ||
            existing.reserve !== lot.reserve ||
            existing.km !== lot.km ||
            existing.location !== lot.location;
          
          if (hasChanged) {
            await supabase.from('listing_snapshots').insert({
              listing_id: listingUuid,
              seen_at: new Date().toISOString(),
              status: lot.status,
              reserve: lot.reserve,
              km: lot.km,
              location: lot.location,
            });
            snapshotsAdded++;
          }
        } else {
          // Insert new listing
          const { data: inserted } = await supabase
            .from('vehicle_listings')
            .insert({
              listing_id: listingId,
              lot_id: lot.lot_id,
              source: 'manheim',
              source_class: 'auction',
              auction_house: 'Manheim',
              event_id: eventId || null,
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
              auction_datetime: lot.auction_datetime || null,
              listing_url: lot.listing_url,
              reserve: lot.reserve,
              status: lot.status,
              seller_type: 'dealer',
              visible_to_dealers: true,
              is_dealer_grade: true,
            })
            .select('id')
            .single();
          
          listingUuid = inserted?.id;
          created++;
          
          // Add initial snapshot for new listing
          if (listingUuid) {
            await supabase.from('listing_snapshots').insert({
              listing_id: listingUuid,
              seen_at: new Date().toISOString(),
              status: lot.status,
              reserve: lot.reserve,
              km: lot.km,
              location: lot.location,
            });
            snapshotsAdded++;
          }
        }
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const msg = `Error processing lot ${lot.lot_id}: ${errorMsg}`;
        console.error(`[manheim-ingest] ${msg}`);
        errors.push(msg);
      }
    }

    // Update run status with dedupe warnings
    await supabase
      .from('ingestion_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: errors.length > 0 ? 'partial' : 'success',
        lots_found: parsedLots.length,
        lots_created: created,
        lots_updated: updated,
        errors,
        metadata: { 
          eventId, 
          auctionDate, 
          dropped, 
          dropReasons, 
          regionCounts, 
          snapshotsAdded,
          dedupeWarnings: dedupeWarnings.length > 0 ? dedupeWarnings : undefined,
        }
      })
      .eq('id', run.id);

    console.log(`[manheim-ingest] Complete: ${created} created, ${updated} updated, ${dropped} dropped, ${snapshotsAdded} snapshots, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        runId: run.id,
        lotsReceived: lots.length,
        lotsParsed: parsedLots.length,
        created,
        updated,
        dropped,
        snapshotsAdded,
        dropReasons,
        regionCounts,
        dedupeWarnings: dedupeWarnings.length > 0 ? dedupeWarnings : undefined,
        errors: errors.slice(0, 10),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[manheim-ingest] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
