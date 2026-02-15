import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AEST timezone (UTC+10, or UTC+11 for AEDT)
const AEST_OFFSET_HOURS = 10;
const QUIET_HOURS_START = 19; // 7pm AEST
const QUIET_HOURS_END = 7;    // 7am AEST

interface Fingerprint {
  id: string;
  fingerprint_id: string;
  dealer_name: string;
  dealer_profile_id: string | null;
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

interface PreviousState {
  status: string;
  highest_bid?: number;
}

// Check if current time is within quiet hours (outside 07:00-19:00 AEST)
function isQuietHours(): boolean {
  const now = new Date();
  const aestHour = (now.getUTCHours() + AEST_OFFSET_HOURS) % 24;
  return aestHour >= QUIET_HOURS_START || aestHour < QUIET_HOURS_END;
}

// Get next quiet hours window end (when we can send)
function getNextWindowStart(): Date {
  const now = new Date();
  const aestHour = (now.getUTCHours() + AEST_OFFSET_HOURS) % 24;
  
  // If we're in quiet hours, calculate when 7am AEST occurs
  const hoursUntilWindowStart = aestHour >= QUIET_HOURS_START 
    ? (24 - aestHour + QUIET_HOURS_END)
    : (QUIET_HOURS_END - aestHour);
  
  const nextStart = new Date(now.getTime() + hoursUntilWindowStart * 60 * 60 * 1000);
  nextStart.setMinutes(0, 0, 0);
  return nextStart;
}

// Tier 1 matching: exact make+model+variant_family, year ±2
function matchesTier1(listing: Listing, fp: Fingerprint): boolean {
  if (listing.make.toLowerCase() !== fp.make.toLowerCase()) return false;
  if (listing.model.toLowerCase() !== fp.model.toLowerCase()) return false;
  
  if (fp.variant_family) {
    const listingFamily = (listing.variant_family || '').toUpperCase();
    const fpFamily = fp.variant_family.toUpperCase();
    if (!listingFamily.includes(fpFamily) && !fpFamily.includes(listingFamily)) {
      return false;
    }
  }
  
  const yearMin = fp.year_min - 2;
  const yearMax = fp.year_max + 2;
  if (listing.year < yearMin || listing.year > yearMax) return false;
  
  if (!fp.is_spec_only && fp.min_km !== null && fp.max_km !== null && listing.km !== null) {
    if (listing.km < fp.min_km || listing.km > fp.max_km) return false;
  }
  
  return true;
}

// Format auction datetime for display in AEST
function formatAuctionTimeAEST(datetime: string | null): string {
  if (!datetime) return 'Time TBC';
  try {
    const date = new Date(datetime);
    if (isNaN(date.getTime())) return 'Time TBC';
    
    // Format in AEST
    return date.toLocaleString('en-AU', { 
      timeZone: 'Australia/Sydney',
      weekday: 'short',
      day: 'numeric', 
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true 
    });
  } catch {
    return 'Time TBC';
  }
}

// Check if this is a valid ACTION alert state change
function isValidStateChange(
  currentStatus: string, 
  previousStatus?: string
): boolean {
  if (!previousStatus) return false;
  
  // Valid state transitions that trigger ACTION alerts
  const validTransitions: Record<string, string[]> = {
    'passed_in': ['listed', 'catalogue'],
    'relisted': ['passed_in', 'sold'],
  };
  
  const allowedFrom = validTransitions[currentStatus];
  return allowedFrom?.includes(previousStatus) ?? false;
}

// Send push notification via bob-push
async function sendPushNotification(
  supabaseUrl: string,
  supabaseKey: string,
  dealerName: string,
  listing: Listing,
  alertType: string,
  alertId: string
): Promise<{ sent: boolean; queued: boolean; queuedUntil?: string }> {
  const variant = listing.variant_family || listing.variant_raw || '';
  const timeDisplay = formatAuctionTimeAEST(listing.auction_datetime);
  const message = `${listing.model} ${variant} coming up – ${listing.location || 'TBA'} ${timeDisplay}`;
  
  // Check quiet hours
  if (isQuietHours()) {
    const queuedUntil = getNextWindowStart();
    console.log(`[pickles-alerts] Quiet hours - queuing push for ${dealerName} until ${queuedUntil.toISOString()}`);
    return { sent: false, queued: true, queuedUntil: queuedUntil.toISOString() };
  }
  
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
          alert_id: alertId,
        },
        speak_context: message,
        // Tell Bob to narrate facts only, no pricing
        bob_mode: 'narrator',
      }),
    });
    
    if (!response.ok) {
      console.log(`[pickles-alerts] Push failed for ${dealerName}: ${response.status}`);
      return { sent: false, queued: false };
    }
    
    console.log(`[pickles-alerts] Push sent to ${dealerName}: ${message}`);
    return { sent: true, queued: false };
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[pickles-alerts] Push error for ${dealerName}:`, errMsg);
    return { sent: false, queued: false };
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
    const { 
      alertType = 'UPCOMING', 
      listingIds,
      previousStates // Map of listing_id -> { status, highest_bid }
    } = body as { 
      alertType?: string; 
      listingIds?: string[];
      previousStates?: Record<string, PreviousState>;
    };

    console.log(`[pickles-alerts] Processing ${alertType} alerts`);

    // Get active Tier-1 fingerprints only
    const { data: fingerprints, error: fpError } = await supabase
      .from('dealer_fingerprints')
      .select('*')
      .eq('is_active', true);

    if (fpError) {
      console.error('[pickles-alerts] Error fetching fingerprints:', fpError);
      throw fpError;
    }

    console.log(`[pickles-alerts] Found ${fingerprints?.length || 0} active fingerprints`);

    // Get listings to process
    let listingsQuery = supabase
      .from('vehicle_listings')
      .select('*')
      .eq('source', 'pickles')
      .eq('visible_to_dealers', true);

    if (listingIds && listingIds.length > 0) {
      listingsQuery = listingsQuery.in('listing_id', listingIds);
    } else if (alertType === 'UPCOMING') {
      listingsQuery = listingsQuery.in('status', ['catalogue', 'listed']);
    } else if (alertType === 'ACTION') {
      listingsQuery = listingsQuery.in('status', ['passed_in', 'relisted']);
    }

    const { data: listings, error: listingsError } = await listingsQuery;

    if (listingsError) {
      console.error('[pickles-alerts] Error fetching listings:', listingsError);
      throw listingsError;
    }

    console.log(`[pickles-alerts] Processing ${listings?.length || 0} listings`);

    let alertsCreated = 0;
    let alertsSkipped = 0;
    let pushSent = 0;
    let pushQueued = 0;
    const alertDetails: { dealer: string; listing: string; type: string; message: string; pushStatus: string }[] = [];

    for (const listing of listings || []) {
      // For ACTION alerts, verify state change
      if (alertType === 'ACTION') {
        const prevState = previousStates?.[listing.listing_id];
        if (!isValidStateChange(listing.status, prevState?.status)) {
          console.log(`[pickles-alerts] Skipping ${listing.listing_id} - no valid state change`);
          continue;
        }
      }

      for (const fp of fingerprints || []) {
        // Only Tier-1 matches
        if (!matchesTier1(listing, fp)) continue;

        // Create alert - using DB unique index for deduplication
        const alertId = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const variant = listing.variant_family || listing.variant_raw || '';
        const timeDisplay = formatAuctionTimeAEST(listing.auction_datetime);
        const locationTime = `${listing.location || 'TBA'} ${timeDisplay}`;
        
        let messageText: string;
        if (alertType === 'UPCOMING') {
          messageText = `${listing.model} ${variant} coming up – ${locationTime}`;
        } else {
          const reason = listing.status === 'passed_in' ? 'passed in' : listing.status;
          messageText = `${listing.model} ${variant} ${reason} – ${locationTime}`;
        }

        // DEALER ISOLATION: Always set dealer_profile_id from fingerprint
        // This ensures alerts are scoped to the specific dealer, not just by name
        const { error: insertError } = await supabase
          .from('alert_logs')
          .insert({
            alert_id: alertId,
            dealer_name: fp.dealer_name,
            dealer_profile_id: fp.dealer_profile_id, // Critical for dealer isolation
            listing_id: listing.listing_id,
            fingerprint_id: fp.fingerprint_id,
            alert_type: alertType,
            action_reason: alertType === 'ACTION' ? listing.status : null,
            previous_status: alertType === 'ACTION' ? previousStates?.[listing.listing_id]?.status : null,
            match_type: 'exact',
            message_text: messageText,
            dedup_key: `${fp.dealer_name}:${listing.listing_id}:${alertType}`,
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
          // Check if it's a unique constraint violation (duplicate)
          if (insertError.code === '23505') {
            console.log(`[pickles-alerts] Duplicate alert skipped: ${fp.dealer_name}/${listing.listing_id}`);
            alertsSkipped++;
            continue;
          }
          console.error(`[pickles-alerts] Failed to create alert for ${listing.listing_id}:`, insertError);
          continue;
        }

        alertsCreated++;
        console.log(`[pickles-alerts] Created ${alertType} alert for ${fp.dealer_name}: ${messageText}`);

        // Also insert into unified opportunities table
        try {
          const oppRow = {
            source_type: 'auction' as const,
            listing_url: listing.listing_url || `pickles://${listing.listing_id}`,
            stock_id: listing.listing_id,
            year: listing.year,
            make: listing.make,
            model: listing.model,
            variant: listing.variant_family || listing.variant_raw || null,
            location: listing.location,
            confidence_score: 0,
            confidence_tier: 'MEDIUM',
            status: 'new',
          };
          await supabase.from('opportunities').upsert(oppRow, { onConflict: 'listing_url', ignoreDuplicates: true });
        } catch (oppErr) {
          console.error(`[pickles-alerts] Opp upsert err:`, oppErr);
        }

        // Send push notification (only on new insert)
        const pushResult = await sendPushNotification(
          supabaseUrl, 
          supabaseKey, 
          fp.dealer_name, 
          listing, 
          alertType,
          alertId
        );

        // Update alert with push status
        if (pushResult.sent) {
          pushSent++;
          await supabase
            .from('alert_logs')
            .update({ push_sent_at: new Date().toISOString() })
            .eq('alert_id', alertId);
        } else if (pushResult.queued) {
          pushQueued++;
          await supabase
            .from('alert_logs')
            .update({ queued_until: pushResult.queuedUntil })
            .eq('alert_id', alertId);
        }

        alertDetails.push({
          dealer: fp.dealer_name,
          listing: listing.listing_id,
          type: alertType,
          message: messageText,
          pushStatus: pushResult.sent ? 'sent' : pushResult.queued ? 'queued' : 'failed',
        });
      }
    }

    console.log(`[pickles-alerts] Complete: ${alertsCreated} created, ${alertsSkipped} skipped, ${pushSent} push sent, ${pushQueued} push queued`);

    return new Response(
      JSON.stringify({
        success: true,
        alertsCreated,
        alertsSkipped,
        pushSent,
        pushQueued,
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
