/**
 * Pickles Alert Matching Logic
 * 
 * Implements Tier 1 (Exact) matching for fingerprint alerts:
 * - make + model + variant_family must match
 * - year within ±2
 * - km constraint applied only if fingerprint has km cap; spec-only ignores km
 * 
 * Alert Types:
 * - UPCOMING: New catalogue lot matches fingerprint
 * - ACTION: Status change (passed_in, relisted, reserve softened)
 */

import type { SaleFingerprint, Listing, AlertLog } from '@/types';
import { extractVariantFamily } from '@/types';

// Alert types for Pickles
export type PicklesAlertType = 'UPCOMING' | 'ACTION';

// Action reasons
export type PicklesActionReason = 'passed_in' | 'relisted' | 'reserve_softened' | 'price_drop';

// Match result with context
export interface PicklesFingerprintMatch {
  fingerprint: SaleFingerprint;
  lot: Listing;
  matchType: 'exact'; // Only Tier 1 for alerts
  alertType: PicklesAlertType;
  actionReason?: PicklesActionReason;
}

/**
 * Check if a lot matches a fingerprint for Tier 1 (Exact) alerting
 * 
 * Requirements:
 * - make + model + variant_family must match
 * - year within ±2
 * - km constraint applied only if fingerprint has km cap; spec-only ignores km
 */
export function isTier1Match(lot: Listing, fp: SaleFingerprint): boolean {
  // Must be active and not expired
  if (fp.is_active !== 'Y') return false;
  
  const today = new Date();
  const expiresAt = new Date(fp.expires_at);
  if (today > expiresAt) return false;
  
  // Do Not Buy protection
  if (fp.do_not_buy === 'Y') return false;
  
  // Make and model must match exactly (case-insensitive)
  if (lot.make.toLowerCase() !== fp.make.toLowerCase()) return false;
  if (lot.model.toLowerCase() !== fp.model.toLowerCase()) return false;
  
  // Variant family must match
  const lotVariantFamily = lot.variant_family || extractVariantFamily(lot.variant_raw || lot.variant_normalised);
  const fpVariantFamily = fp.variant_family || extractVariantFamily(fp.variant_normalised);
  
  if (!lotVariantFamily || !fpVariantFamily) {
    // If either doesn't have a variant family, fall back to variant_normalised comparison
    const lotVariant = (lot.variant_normalised || lot.variant_raw || '').toLowerCase().trim();
    const fpVariant = (fp.variant_normalised || '').toLowerCase().trim();
    if (lotVariant !== fpVariant) return false;
  } else if (lotVariantFamily.toUpperCase() !== fpVariantFamily.toUpperCase()) {
    return false;
  }
  
  // Year must be within ±2
  if (Math.abs(lot.year - fp.year) > 2) return false;
  
  // KM constraint - only apply if fingerprint has km data (not spec-only)
  if (fp.fingerprint_type !== 'spec_only' && fp.sale_km && fp.sale_km > 0) {
    const minKm = fp.min_km ?? Math.max(0, fp.sale_km - 15000);
    const maxKm = fp.max_km ?? fp.sale_km + 15000;
    
    // Only check if lot has km data
    if (lot.km && lot.km > 0) {
      if (lot.km < minKm || lot.km > maxKm) return false;
    }
  }
  // Spec-only fingerprints bypass km check entirely
  
  return true;
}

/**
 * Find all fingerprints that match a Pickles lot for alerting
 */
export function findMatchingFingerprints(
  lot: Listing,
  fingerprints: SaleFingerprint[]
): SaleFingerprint[] {
  return fingerprints.filter(fp => isTier1Match(lot, fp));
}

/**
 * Generate dedup key for an alert
 * Format: dealer_name|lot_id|alert_type|action_reason|YYYY-MM-DD
 */
export function generateDedupKey(
  dealerName: string,
  lotId: string,
  alertType: PicklesAlertType,
  actionReason?: PicklesActionReason
): string {
  const today = new Date().toISOString().split('T')[0];
  const reasonPart = actionReason || 'new';
  return `${dealerName}|${lotId}|${alertType}|${reasonPart}|${today}`;
}

/**
 * Check if alert already exists (deduplicated)
 */
export function isAlertDuplicate(
  dedupKey: string,
  existingAlerts: Pick<AlertLog, 'dedup_key'>[]
): boolean {
  return existingAlerts.some(a => a.dedup_key === dedupKey);
}

/**
 * Generate alert message text
 */
export function generateAlertMessage(
  lot: Listing,
  alertType: PicklesAlertType,
  actionReason?: PicklesActionReason
): string {
  const vehicle = `${lot.year} ${lot.make} ${lot.model} ${lot.variant_normalised || lot.variant_raw || ''}`.trim();
  
  if (alertType === 'UPCOMING') {
    return `${vehicle} coming up – ${lot.auction_house || 'Pickles'} ${lot.location || ''} ${formatAuctionTime(lot.auction_datetime)}`.trim();
  }
  
  // ACTION alerts
  switch (actionReason) {
    case 'passed_in':
      return `${vehicle} passed in – ready for negotiation`;
    case 'relisted':
      return `${vehicle} relisted (pass #${lot.pass_count || 2}) – seller getting motivated`;
    case 'reserve_softened':
      const dropPct = lot.price_change_pct ? `${Math.abs(lot.price_change_pct).toFixed(0)}%` : '';
      return `${vehicle} reserve dropped ${dropPct} – worth another look`.trim();
    case 'price_drop':
      return `${vehicle} price dropped – check the numbers`;
    default:
      return `${vehicle} – action opportunity`;
  }
}

/**
 * Generate push notification text (shorter format)
 */
export function generatePushText(
  lot: Listing,
  alertType: PicklesAlertType,
  actionReason?: PicklesActionReason
): { title: string; body: string } {
  const vehicle = `${lot.make} ${lot.model} ${lot.variant_family || lot.variant_normalised || ''}`.trim();
  
  if (alertType === 'UPCOMING') {
    return {
      title: 'Bob: Heads up',
      body: `${vehicle} coming up – ${lot.location || 'Auction'} ${formatAuctionTime(lot.auction_datetime)}`
    };
  }
  
  // ACTION alerts
  switch (actionReason) {
    case 'passed_in':
      return {
        title: 'Bob: Passed in',
        body: `${vehicle} – money looks right. Run it past Macca?`
      };
    case 'relisted':
      return {
        title: 'Bob: Back again',
        body: `${vehicle} relisted #${lot.pass_count || 2} – seller's feeling it`
      };
    case 'reserve_softened':
      return {
        title: 'Bob: Reserve dropped',
        body: `${vehicle} – reserve softened. Worth a look.`
      };
    case 'price_drop':
      return {
        title: 'Bob: Price drop',
        body: `${vehicle} – price is moving. Check the numbers.`
      };
    default:
      return {
        title: 'Bob',
        body: `${vehicle} – tap for details`
      };
  }
}

/**
 * Format auction time for display
 */
function formatAuctionTime(auctionDatetime?: string): string {
  if (!auctionDatetime) return '';
  
  try {
    const date = new Date(auctionDatetime);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return `today ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    } else if (diffDays === 1) {
      return 'tomorrow';
    } else if (diffDays > 1 && diffDays <= 7) {
      return date.toLocaleDateString('en-AU', { weekday: 'long' });
    } else {
      return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  } catch {
    return auctionDatetime;
  }
}

/**
 * Determine action reason from lot status change
 */
export function determineActionReason(
  lot: Listing,
  previousStatus?: string,
  previousPrice?: number
): PicklesActionReason | undefined {
  // Passed in
  if (lot.status === 'passed_in' && previousStatus !== 'passed_in') {
    return 'passed_in';
  }
  
  // Relisted (pass_count >= 2)
  if (lot.pass_count >= 2 && (lot.relist_count || 0) > 0) {
    return 'relisted';
  }
  
  // Reserve softened (price dropped >= 5%)
  if (previousPrice && lot.reserve && lot.reserve < previousPrice) {
    const dropPct = ((previousPrice - lot.reserve) / previousPrice) * 100;
    if (dropPct >= 5) {
      return 'reserve_softened';
    }
  }
  
  // General price drop
  if (lot.price_change_pct && lot.price_change_pct <= -5) {
    return 'price_drop';
  }
  
  return undefined;
}

/**
 * Build AlertLog entry for a match
 */
export function buildAlertLogEntry(
  match: PicklesFingerprintMatch,
  dedupKey: string
): Omit<AlertLog, 'alert_id'> {
  const { fingerprint: fp, lot, alertType, actionReason } = match;
  
  return {
    created_at: new Date().toISOString(),
    dealer_name: fp.dealer_name,
    recipient_whatsapp: fp.dealer_whatsapp || undefined,
    channel: 'in_app',
    lot_id: lot.lot_key || lot.lot_id,
    fingerprint_id: fp.fingerprint_id,
    action_change: alertType === 'UPCOMING' ? 'UPCOMING' : `ACTION:${actionReason || 'status_change'}`,
    message_text: generateAlertMessage(lot, alertType, actionReason),
    link: lot.listing_url,
    status: 'new',
    dedup_key: dedupKey,
    lot_make: lot.make,
    lot_model: lot.model,
    lot_variant: lot.variant_normalised || lot.variant_raw,
    lot_year: lot.year,
    auction_house: lot.auction_house || 'Pickles',
    auction_datetime: lot.auction_datetime,
    estimated_margin: lot.estimated_margin,
    why_flagged: alertType === 'ACTION' ? [actionReason?.toUpperCase().replace('_', ' ') || 'STATUS CHANGE'] : undefined,
  };
}
