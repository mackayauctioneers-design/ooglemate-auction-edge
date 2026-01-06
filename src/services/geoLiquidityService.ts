// ============================================================================
// GEO-LIQUIDITY SERVICE
// ============================================================================
// Computes geo-liquidity signals from sales and listings data.
// Signals are generated for all data - visibility is controlled by feature flag.
// ============================================================================

import { supabase } from '@/integrations/supabase/client';
import {
  GeoLiquiditySignal,
  GeoLiquidityRequest,
  GeoLiquidityResult,
  GeoLiquidityComparison,
  AustralianState,
  LiquidityTier,
  GEO_LIQUIDITY_THRESHOLDS,
  locationToState,
  classifyLiquidityTier,
} from '@/types/geoLiquidity';

// Cache for computed signals
interface SignalCache {
  key: string;
  signal: GeoLiquiditySignal;
  computedAt: number;
}

const signalCache: Map<string, SignalCache> = new Map();
const CACHE_TTL_MS = 300000; // 5 minute cache for computed signals

// Generate cache key from request
function getCacheKey(req: GeoLiquidityRequest): string {
  return `${req.make}:${req.model}:${req.variant_family || ''}:${req.year || ''}:${req.state || ''}`;
}

// Compute geo-liquidity signal for a vehicle type
export async function getGeoLiquiditySignal(
  request: GeoLiquidityRequest
): Promise<GeoLiquidityResult> {
  const cacheKey = getCacheKey(request);
  const now = Date.now();
  
  // Check cache
  const cached = signalCache.get(cacheKey);
  if (cached && (now - cached.computedAt) < CACHE_TTL_MS) {
    return buildResult(cached.signal, request);
  }
  
  try {
    // Compute year range
    const yearTolerance = request.year_tolerance ?? 2;
    const yearMin = request.year ? request.year - yearTolerance : 1990;
    const yearMax = request.year ? request.year + yearTolerance : new Date().getFullYear();
    
    // Query vehicle listings for auction data (pass rates, relist rates)
    let listingsQuery = supabase
      .from('vehicle_listings')
      .select('status, location, pass_count, relist_count, first_seen_at, auction_datetime')
      .ilike('make', request.make)
      .ilike('model', request.model)
      .gte('year', yearMin)
      .lte('year', yearMax);
    
    // Add variant filter if provided
    if (request.variant_family) {
      listingsQuery = listingsQuery.ilike('variant_family', `%${request.variant_family}%`);
    }
    
    // Add location filter if state provided
    if (request.state) {
      // We'll filter in memory since location patterns are complex
    }
    
    const { data: listings, error: listingsError } = await listingsQuery;
    
    if (listingsError) {
      console.error('Error fetching listings for geo-liquidity:', listingsError);
      return {
        signal: null,
        confidence: 'NONE',
        confidence_reason: 'Database error',
        request,
      };
    }
    
    // Filter by state if needed
    let filteredListings = listings || [];
    if (request.state) {
      filteredListings = filteredListings.filter(l => {
        const state = locationToState(l.location);
        return state === request.state;
      });
    }
    
    if (filteredListings.length === 0) {
      return {
        signal: null,
        confidence: 'NONE',
        confidence_reason: 'No matching listings found',
        request,
      };
    }
    
    // Compute metrics
    const sampleSize = filteredListings.length;
    const passedIn = filteredListings.filter(l => l.status === 'passed_in' || l.pass_count > 0);
    const relisted = filteredListings.filter(l => l.relist_count > 0);
    
    const passRate = sampleSize > 0 ? passedIn.length / sampleSize : null;
    const relistRate = sampleSize > 0 ? relisted.length / sampleSize : null;
    
    // Calculate days to sell from listings that have sold
    const soldListings = filteredListings.filter(l => l.status === 'sold');
    let avgDaysToSell: number | null = null;
    let medianDaysToSell: number | null = null;
    
    if (soldListings.length > 0) {
      const daysArray = soldListings
        .map(l => {
          if (!l.first_seen_at || !l.auction_datetime) return null;
          const start = new Date(l.first_seen_at);
          const end = new Date(l.auction_datetime);
          const days = Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          return days;
        })
        .filter((d): d is number => d !== null);
      
      if (daysArray.length > 0) {
        avgDaysToSell = daysArray.reduce((a, b) => a + b, 0) / daysArray.length;
        
        // Median calculation
        const sorted = [...daysArray].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        medianDaysToSell = sorted.length % 2 !== 0
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;
      }
    }
    
    // Determine state from data if not specified
    const detectedState = request.state || detectPrimaryState(filteredListings.map(l => l.location));
    
    // Classify tier
    const { tier, reason } = classifyLiquidityTier(avgDaysToSell, passRate, sampleSize);
    
    // Build signal
    const signal: GeoLiquiditySignal = {
      make: request.make,
      model: request.model,
      variant_family: request.variant_family,
      year_range: { min: yearMin, max: yearMax },
      state: detectedState || 'NSW', // Default if not detectable
      location: request.location,
      avg_days_to_sell: avgDaysToSell,
      median_days_to_sell: medianDaysToSell,
      sample_size: sampleSize,
      pass_rate: passRate,
      relist_rate: relistRate,
      price_drop_rate: null, // Would need price history to compute
      liquidity_tier: tier,
      tier_reason: reason,
      data_period_start: getOldestDate(filteredListings),
      data_period_end: new Date().toISOString().split('T')[0],
      last_computed_at: new Date().toISOString(),
    };
    
    // Cache the signal
    signalCache.set(cacheKey, { key: cacheKey, signal, computedAt: now });
    
    return buildResult(signal, request);
  } catch (error) {
    console.error('Error computing geo-liquidity signal:', error);
    return {
      signal: null,
      confidence: 'NONE',
      confidence_reason: 'Computation error',
      request,
    };
  }
}

// Get comparison across all states
export async function getGeoLiquidityComparison(
  make: string,
  model: string,
  variant_family?: string,
  year?: number
): Promise<GeoLiquidityComparison> {
  const states: AustralianState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  const byState: Partial<Record<AustralianState, GeoLiquiditySignal>> = {};
  
  // Fetch signals for each state in parallel
  const results = await Promise.all(
    states.map(state =>
      getGeoLiquiditySignal({ make, model, variant_family, year, state })
    )
  );
  
  // Populate by_state
  results.forEach((result, i) => {
    if (result.signal) {
      byState[states[i]] = result.signal;
    }
  });
  
  // Find best and worst locations
  const statesWithData = Object.entries(byState)
    .filter(([_, signal]) => signal.avg_days_to_sell !== null)
    .sort((a, b) => (a[1].avg_days_to_sell ?? 999) - (b[1].avg_days_to_sell ?? 999));
  
  const best = statesWithData[0]?.[0] as AustralianState | undefined;
  const worst = statesWithData[statesWithData.length - 1]?.[0] as AustralianState | undefined;
  
  const bestDays = best ? byState[best]?.avg_days_to_sell ?? null : null;
  const worstDays = worst ? byState[worst]?.avg_days_to_sell ?? null : null;
  const spread = bestDays !== null && worstDays !== null ? worstDays - bestDays : null;
  
  const yearTolerance = 2;
  return {
    vehicle: {
      make,
      model,
      variant_family,
      year_range: {
        min: year ? year - yearTolerance : 1990,
        max: year ? year + yearTolerance : new Date().getFullYear(),
      },
    },
    by_state: byState,
    best_location: best || null,
    worst_location: worst || null,
    spread_days: spread,
  };
}

// Build result with confidence assessment
function buildResult(signal: GeoLiquiditySignal, request: GeoLiquidityRequest): GeoLiquidityResult {
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  let confidenceReason: string;
  
  if (signal.sample_size >= GEO_LIQUIDITY_THRESHOLDS.MIN_SAMPLE_HIGH) {
    confidence = 'HIGH';
    confidenceReason = `${signal.sample_size} matching vehicles`;
  } else if (signal.sample_size >= GEO_LIQUIDITY_THRESHOLDS.MIN_SAMPLE_MEDIUM) {
    confidence = 'MEDIUM';
    confidenceReason = `${signal.sample_size} matching vehicles`;
  } else if (signal.sample_size >= GEO_LIQUIDITY_THRESHOLDS.MIN_SAMPLE_LOW) {
    confidence = 'LOW';
    confidenceReason = `Only ${signal.sample_size} matching vehicles`;
  } else {
    confidence = 'NONE';
    confidenceReason = 'Insufficient data';
  }
  
  return { signal, confidence, confidence_reason: confidenceReason, request };
}

// Detect the most common state in a set of locations
function detectPrimaryState(locations: (string | null | undefined)[]): AustralianState | null {
  const stateCounts = new Map<AustralianState, number>();
  
  for (const loc of locations) {
    const state = locationToState(loc);
    if (state) {
      stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
    }
  }
  
  let maxState: AustralianState | null = null;
  let maxCount = 0;
  
  for (const [state, count] of stateCounts) {
    if (count > maxCount) {
      maxState = state;
      maxCount = count;
    }
  }
  
  return maxState;
}

// Get oldest date from listings
function getOldestDate(listings: { first_seen_at: string | null }[]): string {
  let oldest = new Date().toISOString();
  
  for (const l of listings) {
    if (l.first_seen_at && l.first_seen_at < oldest) {
      oldest = l.first_seen_at;
    }
  }
  
  return oldest.split('T')[0];
}

// Clear the cache (for admin use)
export function clearGeoLiquidityCache(): void {
  signalCache.clear();
}
