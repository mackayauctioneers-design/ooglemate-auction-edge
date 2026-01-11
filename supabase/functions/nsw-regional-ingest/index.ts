import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegionalLot {
  lot_id: string;
  make: string;
  model: string;
  variant_raw: string | null;
  variant_family: string | null;
  year: number;
  km: number | null;
  transmission: string | null;
  drivetrain: string | null;
  fuel: string | null;
  location: string | null;
  region_id: string;
  auction_datetime: string | null;
  listing_url: string | null;
  reserve: number | null;
  asking_price: number | null;
  status: string;
}

// NSW region mapping
function deriveNswRegion(location: string | null): string {
  if (!location) return 'NSW_REGIONAL';
  const loc = location.toUpperCase();
  
  // Hunter/Newcastle
  const hunter = ['NEWCASTLE', 'BERESFIELD', 'MAITLAND', 'CESSNOCK', 'SINGLETON',
    'MUSWELLBROOK', 'HUNTER', 'CHARLESTOWN', 'CARDIFF', 'KOTARA', 'WALLSEND', 
    'MAYFIELD', 'RUTHERFORD', 'KURRI', 'RAYMOND TERRACE'];
  if (hunter.some(s => loc.includes(s))) return 'NSW_HUNTER_NEWCASTLE';
  
  // Central Coast
  const centralCoast = ['GOSFORD', 'WYONG', 'TUGGERAH', 'ERINA', 'TERRIGAL',
    'KARIONG', 'WOY WOY', 'UMINA', 'BATEAU BAY', 'CENTRAL COAST'];
  if (centralCoast.some(s => loc.includes(s))) return 'NSW_CENTRAL_COAST';
  
  // Sydney Metro
  const sydneyMetro = ['SYDNEY', 'PARRAMATTA', 'BLACKTOWN', 'PENRITH', 'LIVERPOOL',
    'CAMPBELLTOWN', 'BANKSTOWN', 'HOMEBUSH', 'RYDE', 'CHATSWOOD', 'HORNSBY',
    'SUTHERLAND', 'MIRANDA', 'KOGARAH', 'ROCKDALE', 'MASCOT', 'ALEXANDRIA',
    'SMITHFIELD', 'WETHERILL', 'MOOREBANK', 'PRESTONS', 'MINTO', 'SILVERWATER',
    'MILPERRA', 'AUBURN', 'REVESBY', 'INGLEBURN'];
  if (sydneyMetro.some(s => loc.includes(s))) return 'NSW_SYDNEY_METRO';
  
  // Everything else in NSW
  return 'NSW_REGIONAL';
}

// Variant family extraction
const VARIANT_FAMILY_TOKENS = [
  'ASCENT SPORT', 'RUGGED X', 'RUGGED-X', 'X-TERRAIN', 'GT-LINE', 'N-LINE',
  'ST-X', 'PRO-4X', 'N-TREK', 'LS-U', 'LS-M', 'LS-T', 'TI-L', 'ST-L',
  'SR5', 'GXL', 'GX', 'VX', 'SAHARA', 'KAKADU', 'ROGUE', 'RUGGED', 'WORKMATE',
  'WILDTRAK', 'RAPTOR', 'XLT', 'XLS', 'XL', 'TITANIUM', 'PLATINUM', 'AMBIENTE', 'TREND',
  'LTZ', 'LT', 'Z71', 'ZR2', 'STORM', 'WARRIOR',
  'HIGHLANDER', 'ELITE', 'ACTIVE',
  'GT', 'GR', 'RS', 'SS', 'SSV', 'SV6', 'XR6', 'XR8',
  'SPORT', 'PREMIUM', 'EXCEED', 'CRUSADE',
];

function deriveVariantFamily(variantRaw: string | null): string | null {
  if (!variantRaw) return null;
  const upper = variantRaw.toUpperCase();
  for (const token of VARIANT_FAMILY_TOKENS) {
    if (upper.includes(token)) {
      return token;
    }
  }
  return null;
}

// Parse lots from crawl output
function parseLots(lots: unknown[], source: string): RegionalLot[] {
  const parsed: RegionalLot[] = [];
  
  for (const lot of lots) {
    const l = lot as Record<string, unknown>;
    
    // Required fields
    const lotId = String(l.lot_id || l.lotId || l.id || l.stock_id || '');
    if (!lotId) continue;
    
    const make = String(l.make || '').trim();
    const model = String(l.model || '').trim();
    if (!make || !model) continue;
    
    const year = parseInt(String(l.year || new Date().getFullYear()));
    if (year < 2000 || year > new Date().getFullYear() + 1) continue;
    
    // Optional fields
    const variantRaw = String(l.variant || l.variant_raw || l.series || '').trim() || null;
    
    let km: number | null = null;
    const kmVal = l.km || l.odometer || l.kilometres;
    if (kmVal !== undefined && kmVal !== null) {
      km = parseInt(String(kmVal).replace(/[,\s]/g, ''));
      if (isNaN(km)) km = null;
    }
    
    const location = String(l.location || l.yard || l.branch || '').trim() || null;
    const regionId = deriveNswRegion(location);
    
    // Skip non-NSW lots
    if (!regionId.startsWith('NSW_')) continue;
    
    const auctionDatetime = String(l.auction_datetime || l.auction_date || '').trim() || null;
    const listingUrl = String(l.listing_url || l.url || '').trim() || null;
    
    let reserve: number | null = null;
    const reserveVal = l.reserve || l.guide_price || l.reserve_price;
    if (reserveVal !== undefined && reserveVal !== null) {
      reserve = parseInt(String(reserveVal).replace(/[,$\s]/g, ''));
      if (isNaN(reserve)) reserve = null;
    }
    
    let askingPrice: number | null = null;
    const priceVal = l.price || l.asking_price || l.current_bid;
    if (priceVal !== undefined && priceVal !== null) {
      askingPrice = parseInt(String(priceVal).replace(/[,$\s]/g, ''));
      if (isNaN(askingPrice)) askingPrice = null;
    }
    
    // Status
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
      listing_url: listingUrl,
      reserve,
      asking_price: askingPrice,
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
    const { lots, source, eventId, auctionDate } = body;

    if (!lots || !Array.isArray(lots)) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: lots (array)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!source) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: source' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validSources = ['f3', 'valley', 'autoauctions', 'southcoast'];
    if (!validSources.includes(source)) {
      return new Response(
        JSON.stringify({ error: `Invalid source: ${source}. Must be one of: ${validSources.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[nsw-regional-ingest] Starting: source=${source}, ${lots.length} lots, event=${eventId || 'N/A'}`);

    // Create ingestion run
    const { data: run, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: `nsw-regional-${source}`,
        metadata: { source, eventId, auctionDate, lotsReceived: lots.length }
      })
      .select()
      .single();

    if (runError) {
      console.error('[nsw-regional-ingest] Failed to create run:', runError);
      throw runError;
    }

    // Parse lots
    const parsedLots = parseLots(lots, source);
    console.log(`[nsw-regional-ingest] Parsed ${parsedLots.length} NSW lots from ${lots.length} input`);

    let created = 0;
    let updated = 0;
    let dropped = 0;
    let snapshotsAdded = 0;
    const errors: string[] = [];
    const dropReasons: Record<string, number> = {};
    const regionCounts: Record<string, number> = {};

    // Source-specific auction house names
    const auctionHouseMap: Record<string, string> = {
      f3: 'F3 Motor Auctions',
      valley: 'Valley Motor Auctions',
      autoauctions: 'Auto Auctions',
      southcoast: 'South Coast Auctions',
    };

    // 10-year window policy: only ingest vehicles from current_year - 10
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 10; // 2016 for 2026
    
    // Price band for dealer-grade ($3k - $150k)
    const PRICE_MIN = 3000;
    const PRICE_MAX = 150000;

    for (const lot of parsedLots) {
      const listingId = `${source}:${lot.lot_id}`;
      
      // Track region distribution
      regionCounts[lot.region_id] = (regionCounts[lot.region_id] || 0) + 1;
      
      // Quality gate: 10-year window policy (year >= current_year - 10)
      if (lot.year < minYear) {
        dropped++;
        dropReasons['year_window_10y'] = (dropReasons['year_window_10y'] || 0) + 1;
        continue;
      }
      
      // Quality gate: price enforcement (but allow catalogue without price for auctions)
      const effectivePrice = lot.reserve ?? lot.asking_price;
      
      // Track price visibility for auction catalogues
      let priceVisibility = 'visible';
      
      // For auction catalogues, allow no_price (they're "call for price" until auction)
      // But if price is present, enforce dealer-grade band
      if (effectivePrice !== null) {
        if (effectivePrice < PRICE_MIN) {
          dropped++;
          dropReasons['price_below_3k'] = (dropReasons['price_below_3k'] || 0) + 1;
          continue;
        }
        if (effectivePrice > PRICE_MAX) {
          dropped++;
          dropReasons['price_above_150k'] = (dropReasons['price_above_150k'] || 0) + 1;
          continue;
        }
      } else {
        // No price = catalogue presence tracking only, mark as hidden
        priceVisibility = 'hidden';
      }
      
      try {
        // Check if listing exists
        const { data: existing } = await supabase
          .from('vehicle_listings')
          .select('id, status, pass_count, relist_count, first_seen_at, reserve, asking_price, km, location')
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
              asking_price: lot.asking_price,
              last_seen_at: new Date().toISOString(),
              status: lot.status,
              relist_count: isRelist ? (existing.relist_count || 0) + 1 : existing.relist_count,
              pass_count: lot.status === 'passed_in' && existing.status !== 'passed_in' 
                ? (existing.pass_count || 0) + 1 
                : existing.pass_count,
              is_dealer_grade: true,
              price_visibility: priceVisibility,
            })
            .eq('id', existing.id);
          updated++;
          
          // Add snapshot if changed
          const hasChanged = 
            existing.status !== lot.status ||
            existing.reserve !== lot.reserve ||
            existing.asking_price !== lot.asking_price ||
            existing.km !== lot.km ||
            existing.location !== lot.location;
          
          if (hasChanged) {
            await supabase.from('listing_snapshots').insert({
              listing_id: listingUuid,
              seen_at: new Date().toISOString(),
              status: lot.status,
              reserve: lot.reserve,
              asking_price: lot.asking_price,
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
              source: source,
              source_class: 'auction',
              auction_house: auctionHouseMap[source],
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
              asking_price: lot.asking_price,
              status: lot.status,
              seller_type: 'dealer',
              visible_to_dealers: true,
              is_dealer_grade: true,
              price_visibility: priceVisibility,
            })
            .select('id')
            .single();
          
          listingUuid = inserted?.id;
          created++;
          
          // Add initial snapshot
          if (listingUuid) {
            await supabase.from('listing_snapshots').insert({
              listing_id: listingUuid,
              seen_at: new Date().toISOString(),
              status: lot.status,
              reserve: lot.reserve,
              asking_price: lot.asking_price,
              km: lot.km,
              location: lot.location,
            });
            snapshotsAdded++;
          }
        }
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const msg = `Error processing lot ${lot.lot_id}: ${errorMsg}`;
        console.error(`[nsw-regional-ingest] ${msg}`);
        errors.push(msg);
      }
    }

    // Update run status with comprehensive metrics
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
          source,
          eventId, 
          auctionDate, 
          lotsReceived: lots.length,
          lotsParsed: parsedLots.length,
          created,
          updated,
          dropped,
          dropReasons,
          regionCounts, 
          snapshotsAdded,
          qualityGates: {
            minYear: currentYear - 10,
            priceMin: 3000,
            priceMax: 150000,
          },
        }
      })
      .eq('id', run.id);

    console.log(`[nsw-regional-ingest] Complete: ${created} created, ${updated} updated, ${dropped} dropped (reasons: ${JSON.stringify(dropReasons)})`);

    return new Response(
      JSON.stringify({
        success: true,
        runId: run.id,
        source,
        lotsReceived: lots.length,
        lotsParsed: parsedLots.length,
        created,
        updated,
        dropped,
        snapshotsAdded,
        dropReasons,
        regionCounts,
        errors: errors.slice(0, 10),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[nsw-regional-ingest] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
