import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Fingerprint {
  id: string;
  fingerprint_id: string;
  dealer_name: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  is_spec_only: boolean;
  is_active: boolean;
}

interface Listing {
  id: string;
  listing_id: string;
  lot_id: string;
  make: string;
  model: string;
  variant_raw: string | null;
  variant_family: string | null;
  year: number;
  km: number | null;
  location: string | null;
  auction_datetime: string | null;
  listing_url: string | null;
  status: string;
  auction_house: string;
}

// Tier 1 matching: exact make+model+variant_family, year ±2
function matchesTier1(listing: Listing, fp: Fingerprint): boolean {
  // Must match make (case-insensitive)
  if (listing.make.toLowerCase() !== fp.make.toLowerCase()) return false;
  
  // Must match model (case-insensitive)
  if (listing.model.toLowerCase() !== fp.model.toLowerCase()) return false;
  
  // Must match variant_family if fingerprint has one
  if (fp.variant_family) {
    const listingFamily = (listing.variant_family || '').toUpperCase();
    const fpFamily = fp.variant_family.toUpperCase();
    // Allow partial match (e.g., SR matches SR5)
    if (!listingFamily.includes(fpFamily) && !fpFamily.includes(listingFamily)) {
      return false;
    }
  }
  
  // Year must be within fingerprint range ±2
  const yearMin = fp.year_min - 2;
  const yearMax = fp.year_max + 2;
  if (listing.year < yearMin || listing.year > yearMax) return false;
  
  // KM constraint only for non-spec-only fingerprints
  if (!fp.is_spec_only && fp.min_km !== null && fp.max_km !== null && listing.km !== null) {
    if (listing.km < fp.min_km || listing.km > fp.max_km) return false;
  }
  
  return true;
}

// Generate dedup key for alerts
function createDedupKey(dealerName: string, listingId: string, alertType: string, actionReason?: string): string {
  const today = new Date().toISOString().split('T')[0];
  const reasonPart = actionReason ? `:${actionReason}` : '';
  return `${dealerName}:${listingId}:${alertType}${reasonPart}:${today}`;
}

// Format auction datetime for display
function formatAuctionTime(datetime: string | null): string {
  if (!datetime) return 'TBA';
  try {
    const date = new Date(datetime);
    return date.toLocaleString('en-AU', { 
      weekday: 'short',
      day: 'numeric', 
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true 
    });
  } catch {
    return 'TBA';
  }
}

// Send push notification via bob-push
async function sendPushNotification(
  supabaseUrl: string,
  supabaseKey: string,
  dealerName: string,
  listing: Listing,
  alertType: string
): Promise<void> {
  const variant = listing.variant_family || listing.variant_raw || '';
  const message = `${listing.model} ${variant} coming up – ${listing.location || 'TBA'} ${formatAuctionTime(listing.auction_datetime)}`;
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/bob-push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dealer_name: dealerName,
        alert_type: alertType === 'UPCOMING' ? 'upcoming_watched' : 'buy_signal',
        vehicle: {
          year: listing.year,
          make: listing.make,
          model: listing.model,
          variant: variant,
        },
        context: {
          auction_house: listing.auction_house,
          location: listing.location,
          auction_time: listing.auction_datetime,
          lot_id: listing.listing_id,
        },
        speak_context: message,
      }),
    });
    
    if (!response.ok) {
      console.log(`[pickles-alerts] Push failed for ${dealerName}: ${response.status}`);
    } else {
      console.log(`[pickles-alerts] Push sent to ${dealerName}: ${message}`);
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[pickles-alerts] Push error for ${dealerName}:`, errMsg);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { alertType = 'UPCOMING', listingIds } = body;

    console.log(`[pickles-alerts] Processing ${alertType} alerts`);

    // Get active fingerprints from database
    const { data: fingerprints, error: fpError } = await supabase
      .from('dealer_fingerprints')
      .select('*')
      .eq('is_active', true);

    if (fpError) {
      console.error('[pickles-alerts] Error fetching fingerprints:', fpError);
      throw fpError;
    }

    console.log(`[pickles-alerts] Found ${fingerprints?.length || 0} active fingerprints`);

    // Get listings to process from database
    let listingsQuery = supabase
      .from('vehicle_listings')
      .select('*')
      .eq('source', 'pickles')
      .eq('visible_to_dealers', true);

    if (listingIds && listingIds.length > 0) {
      listingsQuery = listingsQuery.in('listing_id', listingIds);
    } else if (alertType === 'UPCOMING') {
      // For UPCOMING, get catalogue/listed lots
      listingsQuery = listingsQuery.in('status', ['catalogue', 'listed']);
    } else if (alertType === 'ACTION') {
      // For ACTION, get passed_in lots
      listingsQuery = listingsQuery.in('status', ['passed_in']);
    }

    const { data: listings, error: listingsError } = await listingsQuery;

    if (listingsError) {
      console.error('[pickles-alerts] Error fetching listings:', listingsError);
      throw listingsError;
    }

    console.log(`[pickles-alerts] Processing ${listings?.length || 0} listings`);

    let alertsCreated = 0;
    let alertsSkipped = 0;
    const alertDetails: { dealer: string; listing: string; type: string; message: string }[] = [];

    for (const listing of listings || []) {
      for (const fp of fingerprints || []) {
        // Only process Tier 1 exact matches for alerts
        if (!matchesTier1(listing, fp)) continue;

        const actionReason = alertType === 'ACTION' ? listing.status : undefined;
        const dedupKey = createDedupKey(fp.dealer_name, listing.listing_id, alertType, actionReason);

        // Check for existing alert with same dedup key
        const { data: existingAlert } = await supabase
          .from('alert_logs')
          .select('id')
          .eq('dedup_key', dedupKey)
          .maybeSingle();

        if (existingAlert) {
          alertsSkipped++;
          continue;
        }

        // Create alert message
        const variant = listing.variant_family || listing.variant_raw || '';
        const locationTime = `${listing.location || 'TBA'} ${formatAuctionTime(listing.auction_datetime)}`;
        let messageText: string;

        if (alertType === 'UPCOMING') {
          messageText = `${listing.model} ${variant} coming up – ${locationTime}`;
        } else {
          const reason = listing.status === 'passed_in' ? 'passed in' : listing.status;
          messageText = `${listing.model} ${variant} ${reason} – ${locationTime}`;
        }

        // Insert alert
        const alertId = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const { error: insertError } = await supabase
          .from('alert_logs')
          .insert({
            alert_id: alertId,
            dealer_name: fp.dealer_name,
            listing_id: listing.listing_id,
            fingerprint_id: fp.fingerprint_id,
            alert_type: alertType,
            action_reason: actionReason,
            match_type: 'exact',
            message_text: messageText,
            dedup_key: dedupKey,
            status: 'new',
            lot_make: listing.make,
            lot_model: listing.model,
            lot_variant: variant,
            lot_year: listing.year,
            auction_house: listing.auction_house,
            auction_datetime: listing.auction_datetime,
            location: listing.location,
            listing_url: listing.listing_url,
          });

        if (insertError) {
          console.error(`[pickles-alerts] Failed to create alert for ${listing.listing_id}:`, insertError);
          continue;
        }

        alertsCreated++;
        alertDetails.push({
          dealer: fp.dealer_name,
          listing: listing.listing_id,
          type: alertType,
          message: messageText,
        });

        console.log(`[pickles-alerts] Created ${alertType} alert for ${fp.dealer_name}: ${messageText}`);

        // Send push notification
        await sendPushNotification(supabaseUrl, supabaseKey, fp.dealer_name, listing, alertType);
      }
    }

    console.log(`[pickles-alerts] Complete: ${alertsCreated} created, ${alertsSkipped} skipped (deduped)`);

    return new Response(
      JSON.stringify({
        success: true,
        alertsCreated,
        alertsSkipped,
        alertDetails,
        fingerprintsChecked: fingerprints?.length || 0,
        listingsProcessed: listings?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[pickles-alerts] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
