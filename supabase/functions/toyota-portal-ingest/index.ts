import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * toyota-portal-ingest
 * 
 * Ingests listings from Toyota Used Portal into vehicle_listings.
 * Also upserts dealer candidates into franchise_dealer_candidates.
 */

interface PortalListing {
  external_id: string;
  listing_url: string;
  year: number;
  make: string;
  model: string;
  variant_raw?: string;
  km?: number;
  price?: number;
  dealer_name?: string;
  dealer_location?: string;
  dealer_url?: string;
  transmission?: string;
  fuel?: string;
  drivetrain?: string;
  body_type?: string;
}

interface DealerInfo {
  name: string;
  location?: string;
  url?: string;
  listing_count: number;
}

// Variant family tokens for normalization
const VARIANT_FAMILY_TOKENS = [
  'SR5', 'SR', 'GXL', 'GX', 'GL', 'VX', 'SAHARA', 'KAKADU', 'RUGGED', 'ROGUE',
  'EDGE', 'CRUISER', 'GRANDE', 'ASCENT', 'HYBRID', 'SPORT',
  'ZR', 'SX', 'ATARA', 'KLUGER', 'PRADO', 'LANDCRUISER',
];

function deriveVariantFamily(variantRaw: string): string {
  if (!variantRaw) return '';
  const upper = variantRaw.toUpperCase();
  for (const token of VARIANT_FAMILY_TOKENS) {
    if (upper.includes(token)) {
      return token;
    }
  }
  return '';
}

// Region derivation from location
function deriveRegionFromLocation(location: string | null): string | null {
  if (!location) return null;
  const loc = location.toUpperCase();
  
  // NSW regions
  if (['GOSFORD', 'WYONG', 'TUGGERAH', 'ERINA', 'TERRIGAL', 'CENTRAL COAST'].some(s => loc.includes(s))) return 'NSW_CENTRAL_COAST';
  if (['NEWCASTLE', 'MAITLAND', 'HUNTER', 'CHARLESTOWN', 'CARDIFF', 'CESSNOCK'].some(s => loc.includes(s))) return 'NSW_HUNTER_NEWCASTLE';
  if (['SYDNEY', 'PARRAMATTA', 'BLACKTOWN', 'PENRITH', 'LIVERPOOL', 'CAMPBELLTOWN'].some(s => loc.includes(s))) return 'NSW_SYDNEY_METRO';
  if (loc.includes('NSW')) return 'NSW_REGIONAL';
  
  // VIC
  if (['MELBOURNE', 'DANDENONG', 'RINGWOOD', 'ESSENDON', 'FRANKSTON'].some(s => loc.includes(s))) return 'VIC_METRO';
  if (loc.includes('VIC')) return 'VIC_REGIONAL';
  
  // QLD
  if (['BRISBANE', 'GOLD COAST', 'SUNSHINE COAST', 'IPSWICH'].some(s => loc.includes(s))) return 'QLD_SE';
  if (loc.includes('QLD')) return 'QLD_REGIONAL';
  
  return null;
}

// V2 fingerprint helper
async function applyFingerprintV2(
  supabase: any,
  input: {
    year: number | null;
    make: string | null;
    model: string | null;
    variant_family: string | null;
    variant_raw: string | null;
    body: string | null;
    transmission: string | null;
    fuel: string | null;
    drivetrain: string | null;
    km: number | null;
    region_id: string | null;
  }
) {
  const { data, error } = await supabase.rpc('generate_vehicle_fingerprint_v2', {
    p_year: input.year,
    p_make: input.make,
    p_model: input.model,
    p_variant_family: input.variant_family,
    p_variant_raw: input.variant_raw,
    p_body: input.body,
    p_transmission: input.transmission,
    p_fuel: input.fuel,
    p_drivetrain: input.drivetrain,
    p_km: input.km,
    p_region: input.region_id,
  });

  if (error) {
    console.error('[toyota-portal-ingest] Fingerprint v2 error:', error);
    return {
      fingerprint: null,
      fingerprint_version: 2,
      fingerprint_confidence: 0,
      variant_used: null,
      variant_source: null,
    };
  }

  const out = data?.[0];
  return {
    fingerprint: out?.fingerprint ?? null,
    fingerprint_version: 2,
    fingerprint_confidence: out?.fingerprint_confidence ?? 0,
    variant_used: out?.variant_used ?? null,
    variant_source: out?.variant_source ?? null,
  };
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
    const { listings, source_name, dealers } = body as { 
      listings: PortalListing[]; 
      source_name: string;
      dealers?: DealerInfo[];
    };

    if (!listings || !Array.isArray(listings)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid listings array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[toyota-portal-ingest] Starting ingestion of ${listings.length} listings from ${source_name}`);

    // Create ingestion run
    const { data: run, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: source_name,
        status: 'running',
        metadata: { 
          listing_count: listings.length,
          dealer_count: dealers?.length || 0,
        }
      })
      .select()
      .single();

    if (runError) {
      console.error('[toyota-portal-ingest] Failed to create run:', runError);
      throw runError;
    }

    let created = 0;
    let updated = 0;
    let snapshotsCreated = 0;
    let dealerCandidatesUpserted = 0;
    const errors: string[] = [];

    // Process listings
    for (const listing of listings) {
      const listingId = `toyota_portal:${listing.external_id}`;
      
      try {
        const variantFamily = deriveVariantFamily(listing.variant_raw || '');
        const location = listing.dealer_location || '';
        const regionId = deriveRegionFromLocation(location);
        
        // Check if listing exists
        const { data: existing } = await supabase
          .from('vehicle_listings')
          .select('id, status, asking_price, km, dealer_name')
          .eq('listing_id', listingId)
          .maybeSingle();

        // Apply v2 fingerprint
        const fp = await applyFingerprintV2(supabase, {
          year: listing.year,
          make: listing.make,
          model: listing.model,
          variant_family: variantFamily || null,
          variant_raw: listing.variant_raw || null,
          body: listing.body_type || null,
          transmission: listing.transmission || null,
          fuel: listing.fuel || null,
          drivetrain: listing.drivetrain || null,
          km: listing.km || null,
          region_id: regionId,
        });

        const listingData = {
          make: listing.make,
          model: listing.model,
          variant_raw: listing.variant_raw || null,
          variant_family: variantFamily || null,
          year: listing.year,
          km: listing.km ?? null,
          transmission: listing.transmission || null,
          drivetrain: listing.drivetrain || null,
          fuel: listing.fuel || null,
          location: location || null,
          listing_url: listing.listing_url || null,
          last_seen_at: new Date().toISOString(),
          seller_type: 'dealer',
          asking_price: listing.price ?? null,
          source_class: 'classifieds',
          is_dealer_grade: true,
          visible_to_dealers: true,
          dealer_name: listing.dealer_name || null,
          dealer_url: listing.dealer_url || null,
          external_id: listing.external_id,
          ...fp,
        };

        let vehicleListingId: string;

        if (existing) {
          // Update existing listing
          await supabase
            .from('vehicle_listings')
            .update({
              ...listingData,
              status: 'listed',
              missing_streak: 0,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          updated++;
          vehicleListingId = existing.id;
        } else {
          // Insert new listing
          const { data: inserted, error: insertError } = await supabase
            .from('vehicle_listings')
            .insert({
              ...listingData,
              listing_id: listingId,
              source: source_name,
              status: 'listed',
              first_seen_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          
          if (insertError) {
            errors.push(`Insert error for ${listingId}: ${insertError.message}`);
            continue;
          }
          created++;
          vehicleListingId = inserted.id;
        }
        
        // Create snapshot
        const { error: snapshotError } = await supabase
          .from('listing_snapshots')
          .insert({
            listing_id: vehicleListingId,
            seen_at: new Date().toISOString(),
            status: 'listed',
            asking_price: listing.price ?? null,
            km: listing.km ?? null,
            location: location || null,
          });

        if (!snapshotError) {
          snapshotsCreated++;
        }

        // Evaluate dealer spec matches for new/updated listings
        try {
          await supabase.rpc('evaluate_dealer_spec_matches_for_listing', {
            p_listing_uuid: vehicleListingId
          });
        } catch (matchErr) {
          // Non-fatal
        }
        
      } catch (err: any) {
        errors.push(`Error processing ${listingId}: ${err.message}`);
      }
    }

    // Upsert dealer candidates
    if (dealers && dealers.length > 0) {
      for (const dealer of dealers) {
        if (!dealer.name) continue;
        
        const { error: dealerError } = await supabase
          .from('franchise_dealer_candidates')
          .upsert({
            brand: 'TOYOTA',
            dealer_name: dealer.name,
            dealer_location: dealer.location || null,
            dealer_url: dealer.url || null,
            listing_count: dealer.listing_count,
            last_seen_at: new Date().toISOString(),
          }, {
            onConflict: 'brand,dealer_name',
          });

        if (!dealerError) {
          dealerCandidatesUpserted++;
        }
      }
      console.log(`[toyota-portal-ingest] Upserted ${dealerCandidatesUpserted} dealer candidates`);
    }

    // Update ingestion run
    await supabase
      .from('ingestion_runs')
      .update({
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        completed_at: new Date().toISOString(),
        lots_found: listings.length,
        lots_created: created,
        lots_updated: updated,
        errors: errors.length > 0 ? { messages: errors.slice(0, 10) } : null,
        metadata: {
          snapshots_created: snapshotsCreated,
          dealer_candidates_upserted: dealerCandidatesUpserted,
        },
      })
      .eq('id', run.id);

    console.log(`[toyota-portal-ingest] Complete: ${created} created, ${updated} updated, ${snapshotsCreated} snapshots, ${dealerCandidatesUpserted} dealer candidates`);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: run.id,
        created,
        updated,
        snapshots_created: snapshotsCreated,
        dealer_candidates_upserted: dealerCandidatesUpserted,
        errors: errors.slice(0, 5),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[toyota-portal-ingest] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
