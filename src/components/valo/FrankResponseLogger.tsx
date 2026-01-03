import { useEffect, useRef } from 'react';
import { ValoResult } from '@/types';

// ============================================================================
// FRANK RESPONSE LOGGER
// ============================================================================
// Logs which Frank response type fired for each valuation.
// Used for Phase 3 testing and threshold tuning.
// Admin-only visibility in dev console.
// ============================================================================

interface FrankSignals {
  avgGross: number | null;
  avgDaysToSell: number | null;
  isRepeatLoser: boolean;
  isSlow: boolean;
  isHardWork: boolean;
  isBounceOnly: boolean;
  priceband: 'low' | 'mid' | 'high';
}

export function calculateFrankSignals(result: ValoResult): FrankSignals {
  const avgGross = result.expected_gross_band 
    ? (result.expected_gross_band.min + result.expected_gross_band.max) / 2 
    : null;
  const avgDaysToSell = result.typical_days_to_sell;
  const avgBuy = result.suggested_buy_range 
    ? (result.suggested_buy_range.min + result.suggested_buy_range.max) / 2 
    : 0;

  // Bounce-only detection: thin margin AND slow turn = can't own it profitably
  const isBounceOnly = avgGross !== null && avgDaysToSell !== null &&
    avgGross < 2000 && avgDaysToSell > 30;

  return {
    avgGross,
    avgDaysToSell,
    isRepeatLoser: avgGross !== null && avgGross <= 0,
    isSlow: avgDaysToSell !== null && avgDaysToSell > 45,
    isHardWork: avgGross !== null && avgGross > 0 && avgGross < 1500,
    isBounceOnly,
    priceband: avgBuy < 25000 ? 'low' : avgBuy < 50000 ? 'mid' : 'high',
  };
}

type FrankResponseType = 
  | '#1-HIGH-DEALER'    // High confidence, good margins, quick turn
  | '#2-MEDIUM-NETWORK' // Medium confidence from network
  | '#3-LOW-PROXY'      // Low confidence / proxy only
  | '#4-NO-DATA'        // No data - needs human review
  | '#5-HARD-WORK'      // Marginal profit
  | '#6-HARD-NO'        // Repeat loser / negative history
  | '#7-SLOW'           // Slow turner - capital tied up
  | '#8-BOUNCE-ONLY'    // Can't price to own
  | '#FALLBACK';        // Default fallback

export function determineFrankResponseType(result: ValoResult): FrankResponseType {
  const { confidence, sample_size, suggested_buy_range, tier } = result;
  
  // No data case
  if (sample_size === 0 || !suggested_buy_range) {
    return '#4-NO-DATA';
  }

  const signals = calculateFrankSignals(result);

  // Check signals in priority order
  if (signals.isRepeatLoser) return '#6-HARD-NO';
  if (signals.isBounceOnly) return '#8-BOUNCE-ONLY';
  if (signals.isSlow) return '#7-SLOW';
  if (signals.isHardWork) return '#5-HARD-WORK';
  
  // Confidence-based responses
  if (confidence === 'HIGH' && tier === 'dealer') return '#1-HIGH-DEALER';
  if (confidence === 'MEDIUM' && tier === 'network') return '#2-MEDIUM-NETWORK';
  if (confidence === 'LOW') return '#3-LOW-PROXY';
  
  return '#FALLBACK';
}

interface FrankResponseLoggerProps {
  result: ValoResult | null;
  vehicleDesc: string;
  isAdmin: boolean;
}

export function FrankResponseLogger({ result, vehicleDesc, isAdmin }: FrankResponseLoggerProps) {
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!result || !isAdmin) return;
    
    // Prevent duplicate logs
    const logKey = result.request_id;
    if (loggedRef.current === logKey) return;
    loggedRef.current = logKey;

    const responseType = determineFrankResponseType(result);
    const signals = calculateFrankSignals(result);

    // Log to console for Phase 3 testing
    console.group(`🔊 FRANK RESPONSE LOG: ${responseType}`);
    console.log('Vehicle:', vehicleDesc);
    console.log('Confidence:', result.confidence);
    console.log('Tier:', result.tier);
    console.log('Sample Size:', result.sample_size);
    console.log('Signals:', signals);
    console.log('Buy Range:', result.suggested_buy_range);
    console.log('Sell Range:', result.suggested_sell_range);
    console.log('Days to Sell:', result.typical_days_to_sell);
    console.log('Expected Gross:', result.expected_gross_band);
    console.log('Request ID:', result.request_id);
    console.log('Timestamp:', result.timestamp);
    console.groupEnd();

    // Store in session for test review
    const testLogs = JSON.parse(sessionStorage.getItem('frank_test_logs') || '[]');
    testLogs.push({
      timestamp: new Date().toISOString(),
      vehicle: vehicleDesc,
      responseType,
      confidence: result.confidence,
      tier: result.tier,
      sampleSize: result.sample_size,
      signals,
      buyRange: result.suggested_buy_range,
      requestId: result.request_id,
    });
    sessionStorage.setItem('frank_test_logs', JSON.stringify(testLogs.slice(-50))); // Keep last 50

  }, [result, vehicleDesc, isAdmin]);

  // Admin-only test log viewer hint
  if (isAdmin && result) {
    return null; // Logs are in console, no UI needed
  }

  return null;
}

// Export helper to view test logs
export function viewFrankTestLogs(): void {
  const logs = JSON.parse(sessionStorage.getItem('frank_test_logs') || '[]');
  console.table(logs);
}

// Make it available globally for admin testing
if (typeof window !== 'undefined') {
  (window as any).viewFrankTestLogs = viewFrankTestLogs;
}
