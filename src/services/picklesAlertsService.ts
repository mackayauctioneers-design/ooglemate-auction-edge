/**
 * Pickles Alerts Service
 * 
 * Triggers fingerprint-matched alerts for Pickles lots.
 * Called after catalogue ingestion or results processing.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Listing } from '@/types';

export type PicklesAlertType = 'UPCOMING' | 'ACTION';

interface PreviousState {
  status: string;
  price: number;
}

interface ProcessAlertsResult {
  success: boolean;
  alertsCreated: number;
  matchesFound: number;
  duplicatesSkipped: number;
  lotsProcessed: number;
  error?: string;
}

/**
 * Process UPCOMING alerts for new catalogue lots
 * Call this after ingesting a Pickles catalogue
 */
export async function processUpcomingAlerts(lots: Listing[]): Promise<ProcessAlertsResult> {
  return processAlerts(lots, 'UPCOMING');
}

/**
 * Process ACTION alerts for status changes
 * Call this after processing Pickles results (passed_in, relisted, etc.)
 */
export async function processActionAlerts(
  lots: Listing[],
  previousStates: Record<string, PreviousState>
): Promise<ProcessAlertsResult> {
  return processAlerts(lots, 'ACTION', previousStates);
}

/**
 * Core alert processing function
 */
async function processAlerts(
  lots: Listing[],
  alertType: PicklesAlertType,
  previousStates?: Record<string, PreviousState>
): Promise<ProcessAlertsResult> {
  try {
    // Filter to Pickles lots only
    const picklesLots = lots.filter(lot => 
      lot.auction_house?.toLowerCase() === 'pickles' ||
      lot.source_site?.toLowerCase() === 'pickles' ||
      lot.source_name?.toLowerCase() === 'pickles'
    );
    
    if (picklesLots.length === 0) {
      return {
        success: true,
        alertsCreated: 0,
        matchesFound: 0,
        duplicatesSkipped: 0,
        lotsProcessed: 0,
      };
    }
    
    console.log(`Processing ${picklesLots.length} Pickles lots for ${alertType} alerts`);
    
    const { data, error } = await supabase.functions.invoke('pickles-alerts', {
      body: {
        lots: picklesLots.map(lot => ({
          lot_id: lot.lot_id,
          lot_key: lot.lot_key,
          listing_url: lot.listing_url,
          auction_house: lot.auction_house || 'Pickles',
          location: lot.location,
          auction_datetime: lot.auction_datetime,
          make: lot.make,
          model: lot.model,
          variant_raw: lot.variant_raw,
          variant_normalised: lot.variant_normalised,
          variant_family: lot.variant_family,
          year: lot.year,
          km: lot.km,
          status: lot.status,
          pass_count: lot.pass_count,
          relist_count: lot.relist_count,
          reserve: lot.reserve,
          price_change_pct: lot.price_change_pct,
          estimated_margin: lot.estimated_margin,
        })),
        alertType,
        previousStates: previousStates || {},
      },
    });
    
    if (error) {
      console.error('Pickles alerts error:', error);
      return {
        success: false,
        alertsCreated: 0,
        matchesFound: 0,
        duplicatesSkipped: 0,
        lotsProcessed: picklesLots.length,
        error: error.message,
      };
    }
    
    console.log('Pickles alerts result:', data);
    
    return {
      success: true,
      alertsCreated: data.alertsCreated || 0,
      matchesFound: data.matchesFound || 0,
      duplicatesSkipped: data.duplicatesSkipped || 0,
      lotsProcessed: data.lotsProcessed || picklesLots.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Pickles alerts exception:', err);
    return {
      success: false,
      alertsCreated: 0,
      matchesFound: 0,
      duplicatesSkipped: 0,
      lotsProcessed: lots.length,
      error: message,
    };
  }
}

/**
 * Check if a lot qualifies for UPCOMING alert
 * (catalogue status with future auction date)
 */
export function isUpcomingAlertCandidate(lot: Listing): boolean {
  if (lot.auction_house?.toLowerCase() !== 'pickles' &&
      lot.source_site?.toLowerCase() !== 'pickles') {
    return false;
  }
  
  // Must be in catalogue/upcoming status
  const upcomingStatuses = ['catalogue', 'upcoming', 'listed'];
  if (!upcomingStatuses.includes(lot.status)) {
    return false;
  }
  
  // Must have future auction date
  if (lot.auction_datetime) {
    const auctionDate = new Date(lot.auction_datetime);
    if (auctionDate <= new Date()) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if a lot qualifies for ACTION alert
 * (status change to passed_in, relisted, or reserve softened)
 */
export function isActionAlertCandidate(
  lot: Listing,
  previousStatus?: string,
  previousPrice?: number
): boolean {
  if (lot.auction_house?.toLowerCase() !== 'pickles' &&
      lot.source_site?.toLowerCase() !== 'pickles') {
    return false;
  }
  
  // Passed in
  if (lot.status === 'passed_in' && previousStatus !== 'passed_in') {
    return true;
  }
  
  // Relisted (pass_count increased)
  if ((lot.pass_count || 0) >= 2) {
    return true;
  }
  
  // Reserve softened (5%+ drop)
  if (previousPrice && lot.reserve && lot.reserve < previousPrice) {
    const dropPct = ((previousPrice - lot.reserve) / previousPrice) * 100;
    if (dropPct >= 5) return true;
  }
  
  // Price drop
  if (lot.price_change_pct && lot.price_change_pct <= -5) {
    return true;
  }
  
  return false;
}
