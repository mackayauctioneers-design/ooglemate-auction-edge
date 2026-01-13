import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Normalized listing payload from any classifieds source
 * Source-specific scrapers transform their data to this format before calling this adapter
 */
interface ClassifiedsListing {
  // Required fields
  source_listing_id: string;  // Unique ID from the source (e.g., Gumtree listing ID)
  make: string;
  model: string;
  year: number;
  
  // Optional vehicle details
  variant_raw?: string;
  km?: number | null;
  transmission?: string;
  drivetrain?: string;
  fuel?: string;
  
  // Location
  location?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  
  // Pricing
  price?: number | null;
  
  // Listing metadata
  listing_url?: string;
  listed_date_raw?: string;  // Raw date string from source (not trusted for analytics)
  
  // Seller classification hints (from source scraper)
  seller_hints?: SellerHints;
}

/**
 * Hints extracted by source scrapers to help classify seller type
 * The more hints provided, the more accurate the classification
 */
interface SellerHints {
  // Direct indicators
  seller_badge?: 'dealer' | 'private' | null;      // Explicit badge from source
  seller_name?: string;                             // Seller/dealership name
  has_abn?: boolean;                                // ABN/business number present
  
  // Behavioral indicators
  active_listings_count?: number;                   // How many other active listings this seller has
  seller_account_age_days?: number;                 // How old is the seller's account
  
  // Content indicators (only use if deterministically detectable)
  description_length?: number;                      // Word count of description
  has_finance_mention?: boolean;                    // Mentions financing options
  has_warranty_mention?: boolean;                   // Mentions warranty
  has_dealer_keywords?: boolean;                    // "dealership", "yard", "motors" in description
  
  // Contact indicators
  has_landline?: boolean;                           // Landline vs mobile contact
  has_business_hours?: boolean;                     // Lists business hours
}

// =============================================================================
// DETERMINISTIC SELLER TYPE CLASSIFIER
// =============================================================================

interface ClassificationResult {
  seller_type: 'dealer' | 'private' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

/**
 * Dealer name patterns - regex for common dealership naming conventions
 */
const DEALER_NAME_PATTERNS = [
  /\b(motors?|automotive|auto|cars?|vehicles?)\s*(pty|ltd|group|sales)?\b/i,
  /\b(pty\.?\s*ltd\.?|limited)\b/i,
  /\b(dealership|dealer|yard|showroom)\b/i,
  /\b(used\s*cars?|pre-?owned)\b/i,
  /\b(wholesale|fleet|auction)\b/i,
];

/**
 * Deterministic seller type classifier
 * Uses a scoring system with weighted indicators
 * DOES NOT coerce unknown to private - stores actual classification
 */
function classifySellerType(hints: SellerHints | undefined): ClassificationResult {
  const reasons: string[] = [];
  let dealerScore = 0;
  let privateScore = 0;
  
  if (!hints) {
    return {
      seller_type: 'unknown',
      confidence: 'low',
      reasons: ['No seller hints provided']
    };
  }
  
  // === TIER 1: Explicit badges (highest weight) ===
  if (hints.seller_badge === 'dealer') {
    dealerScore += 100;
    reasons.push('Explicit dealer badge from source');
  } else if (hints.seller_badge === 'private') {
    privateScore += 100;
    reasons.push('Explicit private badge from source');
  }
  
  // === TIER 2: Business indicators (high weight) ===
  if (hints.has_abn === true) {
    dealerScore += 50;
    reasons.push('ABN/business number present');
  }
  
  if (hints.seller_name) {
    const matchedPattern = DEALER_NAME_PATTERNS.find(p => p.test(hints.seller_name!));
    if (matchedPattern) {
      dealerScore += 40;
      reasons.push(`Seller name matches dealer pattern: "${hints.seller_name}"`);
    }
  }
  
  // === TIER 3: Behavioral indicators (medium weight) ===
  if (hints.active_listings_count !== undefined) {
    if (hints.active_listings_count >= 10) {
      dealerScore += 35;
      reasons.push(`High active listings count: ${hints.active_listings_count}`);
    } else if (hints.active_listings_count >= 5) {
      dealerScore += 20;
      reasons.push(`Moderate active listings count: ${hints.active_listings_count}`);
    } else if (hints.active_listings_count === 1) {
      privateScore += 15;
      reasons.push('Single active listing');
    }
  }
  
  // === TIER 4: Content indicators (lower weight, deterministic only) ===
  if (hints.has_finance_mention === true) {
    dealerScore += 20;
    reasons.push('Finance mentioned in listing');
  }
  
  if (hints.has_warranty_mention === true) {
    dealerScore += 15;
    reasons.push('Warranty mentioned in listing');
  }
  
  if (hints.has_dealer_keywords === true) {
    dealerScore += 25;
    reasons.push('Dealer keywords found in description');
  }
  
  // === TIER 5: Contact indicators (lower weight) ===
  if (hints.has_landline === true) {
    dealerScore += 10;
    reasons.push('Landline contact number');
  }
  
  if (hints.has_business_hours === true) {
    dealerScore += 15;
    reasons.push('Business hours listed');
  }
  
  // === Calculate result ===
  const totalScore = dealerScore + privateScore;
  const scoreDiff = Math.abs(dealerScore - privateScore);
  
  let seller_type: 'dealer' | 'private' | 'unknown';
  let confidence: 'high' | 'medium' | 'low';
  
  if (totalScore === 0) {
    seller_type = 'unknown';
    confidence = 'low';
    reasons.push('No classification signals available');
  } else if (dealerScore > privateScore) {
    seller_type = 'dealer';
    confidence = scoreDiff >= 50 ? 'high' : scoreDiff >= 25 ? 'medium' : 'low';
  } else if (privateScore > dealerScore) {
    seller_type = 'private';
    confidence = scoreDiff >= 50 ? 'high' : scoreDiff >= 25 ? 'medium' : 'low';
  } else {
    seller_type = 'unknown';
    confidence = 'low';
    reasons.push('Equal dealer/private scores - ambiguous');
  }
  
  return { seller_type, confidence, reasons };
}

// =============================================================================
// VARIANT FAMILY EXTRACTION
// =============================================================================

const VARIANT_FAMILY_TOKENS = [
  'SR5', 'SR', 'GXL', 'GX', 'GL', 'VX', 'SAHARA', 'KAKADU', 'RUGGED', 'ROGUE',
  'XLT', 'WILDTRAK', 'RAPTOR', 'FX4',
  'ST', 'ST-X', 'STX', 'PRO-4X', 'SL', 'TI',
  'LT', 'LTZ', 'Z71', 'ZR2', 'HIGH COUNTRY',
  'GR', 'GT', 'RS', 'SS', 'HSV',
  'EXCEED', 'LS-M', 'LS-U', 'LS-T',
  'X-TERRAIN', 'CORE', 'PREMIUM',
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

// =============================================================================
// LOCATION NORMALIZATION
// =============================================================================

function normalizeLocation(listing: ClassifiedsListing): string {
  if (listing.location) return listing.location;
  
  const parts: string[] = [];
  if (listing.suburb) parts.push(listing.suburb);
  if (listing.state) parts.push(listing.state.toUpperCase());
  if (listing.postcode) parts.push(listing.postcode);
  
  return parts.join(', ');
}

// =============================================================================
// V2 FINGERPRINT HELPER
// =============================================================================

async function applyFingerprintV2ToListing(
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
    console.error('[classifieds-ingest] Fingerprint v2 error:', error);
    return {
      fingerprint: null,
      fingerprint_version: null,
      fingerprint_confidence: null,
      variant_used: null,
      variant_source: null,
    };
  }

  const out = data?.[0];
  return {
    fingerprint: out?.fingerprint ?? null,
    fingerprint_version: 2,
    fingerprint_confidence: out?.fingerprint_confidence ?? null,
    variant_used: out?.variant_used ?? null,
    variant_source: out?.variant_source ?? null,
  };
}

// Derive region from location for fingerprint
function deriveRegionFromLocation(location: string | null): string | null {
  if (!location) return null;
  const loc = location.toUpperCase();
  
  // NSW regions
  if (['GOSFORD', 'WYONG', 'TUGGERAH', 'ERINA', 'TERRIGAL'].some(s => loc.includes(s))) return 'NSW_CENTRAL_COAST';
  if (['NEWCASTLE', 'MAITLAND', 'HUNTER', 'CHARLESTOWN'].some(s => loc.includes(s))) return 'NSW_HUNTER_NEWCASTLE';
  if (['SYDNEY', 'PARRAMATTA', 'BLACKTOWN', 'PENRITH', 'LIVERPOOL'].some(s => loc.includes(s))) return 'NSW_SYDNEY_METRO';
  if (loc.includes('NSW')) return 'NSW_REGIONAL';
  
  // VIC
  if (['MELBOURNE', 'DANDENONG', 'RINGWOOD'].some(s => loc.includes(s))) return 'VIC_METRO';
  if (loc.includes('VIC')) return 'VIC_REGIONAL';
  
  // QLD
  if (['BRISBANE', 'GOLD COAST', 'SUNSHINE COAST'].some(s => loc.includes(s))) return 'QLD_SE';
  if (loc.includes('QLD')) return 'QLD_REGIONAL';
  
  return null;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { listings, source_name } = body as { 
      listings: ClassifiedsListing[]; 
      source_name: string;
    };

    if (!listings || !Array.isArray(listings) || listings.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty listings array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!source_name) {
      return new Response(
        JSON.stringify({ error: 'Missing source_name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[classifieds-ingest] Starting ingestion of ${listings.length} listings from ${source_name}`);

    // Create ingestion run
    const { data: run, error: runError } = await supabase
      .from('ingestion_runs')
      .insert({
        source: source_name,
        metadata: { 
          listing_count: listings.length,
          source_name 
        }
      })
      .select()
      .single();

    if (runError) {
      console.error('[classifieds-ingest] Failed to create run:', runError);
      throw runError;
    }

    let created = 0;
    let updated = 0;
    let snapshotsCreated = 0;
    const errors: string[] = [];
    const classificationStats = {
      dealer: 0,
      private: 0,
      unknown: 0,
      high_confidence: 0,
      medium_confidence: 0,
      low_confidence: 0,
    };

    for (const listing of listings) {
      // CANONICAL identity: source_name (from request) + source_listing_id
      const listingId = `${source_name}:${listing.source_listing_id}`;
      
      try {
        // Classify seller type - store EXACTLY as classified (no coercion)
        const classification = classifySellerType(listing.seller_hints);
        classificationStats[classification.seller_type]++;
        classificationStats[`${classification.confidence}_confidence`]++;
        
        // Derive variant family
        const variantFamily = deriveVariantFamily(listing.variant_raw || '');
        
        // Normalize location
        const location = normalizeLocation(listing);
        
        // Check if listing exists
        const { data: existing } = await supabase
          .from('vehicle_listings')
          .select('id, status, pass_count, asking_price, location, km')
          .eq('listing_id', listingId)
          .maybeSingle();

        // Apply v2 fingerprint
        const regionId = deriveRegionFromLocation(location);
        const fp = await applyFingerprintV2ToListing(supabase, {
          year: listing.year ?? null,
          make: listing.make ?? null,
          model: listing.model ?? null,
          variant_family: variantFamily || null,
          variant_raw: listing.variant_raw || null,
          body: null,
          transmission: listing.transmission || null,
          fuel: listing.fuel || null,
          drivetrain: listing.drivetrain || null,
          km: listing.km ?? null,
          region_id: regionId,
        });

        // Classifieds-specific data (NO auction fields)
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
          // Store EXACT seller classification (no unknown→private coercion)
          seller_type: classification.seller_type,
          seller_confidence: classification.confidence,
          seller_reasons: classification.reasons,
          // Classifieds use asking_price, NOT reserve
          asking_price: listing.price ?? null,
          // Store raw listed date separately (NOT trusted for analytics)
          listed_date_raw: listing.listed_date_raw || null,
          // Auction-specific fields are NULL for classifieds
          lot_id: null,
          auction_house: null,
          reserve: null,
          auction_datetime: null,
          event_id: null,
          // Source class: classifieds (not auction)
          source_class: 'classifieds',
          // V2 fingerprint fields
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
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          updated++;
          vehicleListingId = existing.id;
        } else {
          // Insert new listing
          // first_seen_at = NOW (ingestion time), not site-reported date
          const { data: inserted, error: insertError } = await supabase
            .from('vehicle_listings')
            .insert({
              ...listingData,
              listing_id: listingId,
              source: source_name,
              status: 'listed',
              visible_to_dealers: true,
              first_seen_at: new Date().toISOString(),  // ALWAYS ingestion time
            })
            .select('id')
            .single();
          
          if (insertError) throw insertError;
          created++;
          vehicleListingId = inserted.id;
        }
        
        // === SNAPSHOT: Always create on every ingestion ===
        const { error: snapshotError } = await supabase
          .from('listing_snapshots')
          .insert({
            listing_id: vehicleListingId,
            seen_at: new Date().toISOString(),
            status: 'listed',
            asking_price: listing.price ?? null,
            reserve: null,  // Classifieds don't have reserve
            location: location || null,
            km: listing.km ?? null,
          });
        
        if (snapshotError) {
          console.error(`[classifieds-ingest] Snapshot error for ${listingId}:`, snapshotError);
        } else {
          snapshotsCreated++;
        }
        
        // Evaluate dealer spec matches for this listing
        try {
          await supabase.rpc('evaluate_dealer_spec_matches_for_listing', {
            p_listing_uuid: vehicleListingId
          });
        } catch (matchError) {
          console.error(`[classifieds-ingest] Match eval error for ${listingId}:`, matchError);
        }
        
        console.log(`[classifieds-ingest] ${existing ? 'Updated' : 'Created'} ${listingId} as ${classification.seller_type} (${classification.confidence})`);
        
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const msg = `Error processing listing ${listingId}: ${errorMsg}`;
        console.error(`[classifieds-ingest] ${msg}`);
        errors.push(msg);
      }
    }

    // Update run status
    await supabase
      .from('ingestion_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: errors.length > 0 ? 'partial' : 'success',
        lots_found: listings.length,
        lots_created: created,
        lots_updated: updated,
        errors,
        metadata: {
          source_name,
          listing_count: listings.length,
          snapshots_created: snapshotsCreated,
          classification_stats: classificationStats,
        }
      })
      .eq('id', run.id);

    console.log(`[classifieds-ingest] Complete: ${created} created, ${updated} updated, ${snapshotsCreated} snapshots, ${errors.length} errors`);
    console.log(`[classifieds-ingest] Classification stats:`, classificationStats);

    return new Response(
      JSON.stringify({
        success: true,
        runId: run.id,
        listingsProcessed: listings.length,
        created,
        updated,
        snapshotsCreated,
        errors,
        classificationStats,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[classifieds-ingest] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// =============================================================================
// EXPORTS FOR TESTING
// =============================================================================

export { 
  classifySellerType, 
  deriveVariantFamily,
  DEALER_NAME_PATTERNS,
};
export type { ClassifiedsListing, SellerHints, ClassificationResult };
