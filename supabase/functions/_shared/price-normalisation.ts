/**
 * Price Normalisation Module
 * 
 * Converts drive-away prices to off-road (excl. govt. charges) equivalent.
 * 
 * State-level on-road cost estimates (stamp duty + rego + CTP as % of price):
 *   VIC: ~6.5% (stamp duty ~4.2% + rego ~$900 + CTP ~$600)
 *   NSW: ~5.5%
 *   QLD: ~5.0%
 *   ACT: ~5.0%
 *   WA:  ~4.5%
 *   SA:  ~4.5%
 *   TAS: ~4.0%
 *   NT:  ~4.0%
 * 
 * IMPORTANT: provenExitValue (from dealer sales truth) is always a wholesale 
 * buy price — it is already off-road. Do NOT adjust it. Only normalise asking_price.
 */

export type PriceType = 'drive_away' | 'excl_govt' | 'unknown';

const ON_ROAD_COST_PCT: Record<string, number> = {
  VIC: 0.065,
  NSW: 0.055,
  QLD: 0.050,
  ACT: 0.050,
  WA:  0.045,
  SA:  0.045,
  TAS: 0.040,
  NT:  0.040,
};

/**
 * Normalise an asking price to off-road (excl. govt. charges) equivalent.
 * 
 * @param askingPrice - The raw asking price from the listing
 * @param priceType - 'drive_away', 'excl_govt', or 'unknown'
 * @param state - Australian state code (VIC, NSW, QLD, etc.)
 * @returns The normalised off-road price
 */
export function normaliseToOffroad(
  askingPrice: number | null,
  priceType: string | null | undefined,
  state: string | null | undefined,
): number | null {
  if (askingPrice === null || askingPrice === undefined) return null;

  // Only adjust drive_away prices — unknown and excl_govt pass through unchanged
  if (priceType !== 'drive_away') return askingPrice;

  // Need a valid state to calculate the deduction
  const stateUpper = (state || '').toUpperCase().trim();
  const pct = ON_ROAD_COST_PCT[stateUpper];
  
  if (!pct) return askingPrice; // Unknown state — conservative, don't adjust

  // Drive-away price includes on-road costs → strip them
  // offroad = driveaway / (1 + pct) — more accurate than driveaway * (1 - pct)
  return Math.round(askingPrice / (1 + pct));
}

/**
 * Detect price type from listing text / price label.
 * 
 * @param text - Price text, title, or listing body to scan
 * @returns Detected price type
 */
export function detectPriceType(text: string | null | undefined): PriceType {
  if (!text) return 'unknown';
  
  const lower = text.toLowerCase();
  
  // Drive Away patterns
  if (/drive\s*away/i.test(lower) || /driveaway/i.test(lower) || /drive-away/i.test(lower)) {
    return 'drive_away';
  }
  
  // Excl. Government Charges patterns
  if (
    /excl\.?\s*govt/i.test(lower) ||
    /excluding\s*government/i.test(lower) ||
    /ex\.?\s*govt/i.test(lower) ||
    /plus\s*on[\s-]*roads?/i.test(lower) ||
    /e\.?g\.?c\.?/i.test(lower) ||
    /excl\.?\s*on[\s-]*road/i.test(lower)
  ) {
    return 'excl_govt';
  }
  
  return 'unknown';
}
