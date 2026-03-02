/**
 * DISPLAY-ONLY Vehicle Helpers
 * 
 * ⚠️  IDENTITY GOVERNANCE RULE: This file must NOT define identity logic.
 * No model maps, no variant ladders, no badge extraction, no platform classification.
 * 
 * Identity resolution lives EXCLUSIVELY in:
 *   - supabase/functions/_shared/taxonomy/normalizeVehicleIdentity.ts
 *   - supabase/functions/_shared/taxonomy/derivePlatform.ts
 *   - DB taxonomy tables (taxonomy_models, taxonomy_variant_rank)
 * 
 * This file may only contain:
 *   - Source detection helpers (isPicklesSource)
 *   - Display formatting (showing what backend already resolved)
 *   - KM status helpers (business rules, not identity)
 */

/**
 * Check if a lot is from Pickles source
 */
export function isPicklesSource(sourceName?: string, auctionHouse?: string): boolean {
  const source = (sourceName || '').toLowerCase();
  const ah = (auctionHouse || '').toLowerCase();
  return source.includes('pickles') || ah.includes('pickles') || ah === 'pickles';
}

/**
 * Check if KM should be enforced for this listing
 * Returns false for Pickles (KM optional)
 */
export function shouldEnforceKm(sourceName?: string, auctionHouse?: string): boolean {
  if (isPicklesSource(sourceName, auctionHouse)) {
    return false;
  }
  return true;
}

/**
 * Get the KM status for a listing
 */
export function getKmStatus(km: number | null | undefined, _sourceName?: string, _auctionHouse?: string): 'CONFIRMED' | 'UNKNOWN' {
  if (km && km > 0 && km < 900000) {
    return 'CONFIRMED';
  }
  return 'UNKNOWN';
}
