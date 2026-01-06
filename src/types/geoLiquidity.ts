// ============================================================================
// GEO-LIQUIDITY SIGNALS
// ============================================================================
// Measures how quickly vehicles sell in different geographic regions.
// Generated for all data but visibility is controlled by feature flag.
// ============================================================================

// Australian states/territories for geo grouping
export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT';

// Liquidity tier classification
export type LiquidityTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

// Core geo-liquidity signal for a vehicle type in a location
export interface GeoLiquiditySignal {
  // Vehicle identification (aggregated)
  make: string;
  model: string;
  variant_family?: string;
  year_range: { min: number; max: number };
  
  // Geographic scope
  state: AustralianState;
  location?: string; // More specific location if available
  
  // Liquidity metrics
  avg_days_to_sell: number | null;
  median_days_to_sell: number | null;
  sample_size: number;
  
  // Demand indicators
  pass_rate: number | null; // % of auction lots that pass in (higher = lower demand)
  relist_rate: number | null; // % that get relisted (higher = lower demand)
  price_drop_rate: number | null; // % with price reductions
  
  // Tier classification
  liquidity_tier: LiquidityTier;
  tier_reason: string;
  
  // Data freshness
  data_period_start: string;
  data_period_end: string;
  last_computed_at: string;
}

// Request for geo-liquidity lookup
export interface GeoLiquidityRequest {
  make: string;
  model: string;
  variant_family?: string;
  year?: number;
  year_tolerance?: number; // Default ±2
  state?: AustralianState;
  location?: string;
}

// Response with computed signal
export interface GeoLiquidityResult {
  signal: GeoLiquiditySignal | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  confidence_reason: string;
  request: GeoLiquidityRequest;
}

// Comparative signals across locations
export interface GeoLiquidityComparison {
  vehicle: {
    make: string;
    model: string;
    variant_family?: string;
    year_range: { min: number; max: number };
  };
  by_state: Partial<Record<AustralianState, GeoLiquiditySignal>>;
  best_location: AustralianState | null;
  worst_location: AustralianState | null;
  spread_days: number | null; // Difference between best and worst avg_days_to_sell
}

// Thresholds for tier classification
export const GEO_LIQUIDITY_THRESHOLDS = {
  // Days to sell thresholds
  HIGH_LIQUIDITY_DAYS: 14, // <= 14 days = high liquidity
  MEDIUM_LIQUIDITY_DAYS: 30, // <= 30 days = medium liquidity
  // Pass rate thresholds (higher = worse)
  HIGH_PASS_RATE: 0.5, // > 50% pass in = concerning
  // Minimum sample size for confidence
  MIN_SAMPLE_HIGH: 10,
  MIN_SAMPLE_MEDIUM: 5,
  MIN_SAMPLE_LOW: 2,
} as const;

// Map location strings to Australian states
export function locationToState(location: string | null | undefined): AustralianState | null {
  if (!location) return null;
  
  const normalized = location.toLowerCase().trim();
  
  // Direct state matches
  if (/\b(nsw|new south wales)\b/.test(normalized)) return 'NSW';
  if (/\b(vic|victoria)\b/.test(normalized)) return 'VIC';
  if (/\b(qld|queensland)\b/.test(normalized)) return 'QLD';
  if (/\b(sa|south australia)\b/.test(normalized)) return 'SA';
  if (/\b(wa|western australia)\b/.test(normalized)) return 'WA';
  if (/\b(tas|tasmania)\b/.test(normalized)) return 'TAS';
  if (/\b(nt|northern territory)\b/.test(normalized)) return 'NT';
  if (/\b(act|canberra)\b/.test(normalized)) return 'ACT';
  
  // Major city mappings
  const cityToState: Record<string, AustralianState> = {
    'sydney': 'NSW',
    'melbourne': 'VIC',
    'brisbane': 'QLD',
    'gold coast': 'QLD',
    'townsville': 'QLD',
    'cairns': 'QLD',
    'adelaide': 'SA',
    'perth': 'WA',
    'hobart': 'TAS',
    'darwin': 'NT',
    'canberra': 'ACT',
    // Pickles yards
    'penrith': 'NSW',
    'milperra': 'NSW',
    'yatala': 'QLD',
    'rockhampton': 'QLD',
    'toowoomba': 'QLD',
    'mackay': 'QLD',
    'laverton': 'VIC',
    'dandenong': 'VIC',
    'lonsdale': 'SA',
    'canning vale': 'WA',
    'belmont': 'WA',
  };
  
  for (const [city, state] of Object.entries(cityToState)) {
    if (normalized.includes(city)) return state;
  }
  
  return null;
}

// Classify liquidity tier from metrics
export function classifyLiquidityTier(
  avgDaysToSell: number | null,
  passRate: number | null,
  sampleSize: number
): { tier: LiquidityTier; reason: string } {
  if (sampleSize < GEO_LIQUIDITY_THRESHOLDS.MIN_SAMPLE_LOW) {
    return { tier: 'UNKNOWN', reason: 'Insufficient data' };
  }
  
  // Days to sell is primary metric
  if (avgDaysToSell !== null) {
    if (avgDaysToSell <= GEO_LIQUIDITY_THRESHOLDS.HIGH_LIQUIDITY_DAYS) {
      // Check if pass rate is still high (counterindicator)
      if (passRate !== null && passRate > GEO_LIQUIDITY_THRESHOLDS.HIGH_PASS_RATE) {
        return { tier: 'MEDIUM', reason: `${avgDaysToSell.toFixed(0)}d avg but ${(passRate * 100).toFixed(0)}% pass rate` };
      }
      return { tier: 'HIGH', reason: `${avgDaysToSell.toFixed(0)}d avg days to sell` };
    }
    
    if (avgDaysToSell <= GEO_LIQUIDITY_THRESHOLDS.MEDIUM_LIQUIDITY_DAYS) {
      return { tier: 'MEDIUM', reason: `${avgDaysToSell.toFixed(0)}d avg days to sell` };
    }
    
    return { tier: 'LOW', reason: `${avgDaysToSell.toFixed(0)}d avg days to sell` };
  }
  
  // Fallback to pass rate if no days data
  if (passRate !== null) {
    if (passRate <= 0.2) return { tier: 'HIGH', reason: `Low ${(passRate * 100).toFixed(0)}% pass rate` };
    if (passRate <= 0.4) return { tier: 'MEDIUM', reason: `${(passRate * 100).toFixed(0)}% pass rate` };
    return { tier: 'LOW', reason: `High ${(passRate * 100).toFixed(0)}% pass rate` };
  }
  
  return { tier: 'UNKNOWN', reason: 'No metrics available' };
}
