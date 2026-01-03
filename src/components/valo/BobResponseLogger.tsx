import { useEffect, useRef } from 'react';
import { ValoResult } from '@/types';

// ============================================================================
// BOB RESPONSE LOGGER
// ============================================================================
// Logs which Bob response type fired for each valuation.
// Used for Phase 3 testing and threshold tuning.
// Admin-only visibility in dev console.
// ============================================================================

interface BobSignals {
  avgGross: number | null;
  avgDaysToSell: number | null;
  isRepeatLoser: boolean;
  isSlow: boolean;
  isHardWork: boolean;
  isBounceOnly: boolean;
  priceband: 'low' | 'mid' | 'high';
}

export function calculateBobSignals(result: ValoResult): BobSignals {
  const avgGross = result.expected_gross_band 
    ? (result.expected_gross_band.min + result.expected_gross_band.max) / 2 
    : null;
  const avgDaysToSell = result.typical_days_to_sell;
  const avgBuy = result.suggested_buy_range 
    ? (result.suggested_buy_range.min + result.suggested_buy_range.max) / 2 
    : 0;

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

type BobResponseType = 
  | '#1-HIGH-DEALER'
  | '#2-MEDIUM-NETWORK'
  | '#3-LOW-PROXY'
  | '#4-NO-DATA'
  | '#5-HARD-WORK'
  | '#6-HARD-NO'
  | '#7-SLOW'
  | '#8-BOUNCE-ONLY'
  | '#FALLBACK';

export function determineBobResponseType(result: ValoResult): BobResponseType {
  const { confidence, sample_size, suggested_buy_range, tier } = result;
  
  if (sample_size === 0 || !suggested_buy_range) {
    return '#4-NO-DATA';
  }

  const signals = calculateBobSignals(result);

  if (signals.isRepeatLoser) return '#6-HARD-NO';
  if (signals.isBounceOnly) return '#8-BOUNCE-ONLY';
  if (signals.isSlow) return '#7-SLOW';
  if (signals.isHardWork) return '#5-HARD-WORK';
  
  if (confidence === 'HIGH' && tier === 'dealer') return '#1-HIGH-DEALER';
  if (confidence === 'MEDIUM' && tier === 'network') return '#2-MEDIUM-NETWORK';
  if (confidence === 'LOW') return '#3-LOW-PROXY';
  
  return '#FALLBACK';
}

interface BobResponseLoggerProps {
  result: ValoResult | null;
  vehicleDesc: string;
  isAdmin: boolean;
}

export function BobResponseLogger({ result, vehicleDesc, isAdmin }: BobResponseLoggerProps) {
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!result || !isAdmin) return;
    
    const logKey = result.request_id;
    if (loggedRef.current === logKey) return;
    loggedRef.current = logKey;

    const responseType = determineBobResponseType(result);
    const signals = calculateBobSignals(result);

    console.group(`🔊 BOB RESPONSE LOG: ${responseType}`);
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

    const testLogs = JSON.parse(sessionStorage.getItem('bob_test_logs') || '[]');
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
    sessionStorage.setItem('bob_test_logs', JSON.stringify(testLogs.slice(-50)));

  }, [result, vehicleDesc, isAdmin]);

  if (isAdmin && result) {
    return null;
  }

  return null;
}

export function viewBobTestLogs(): void {
  const logs = JSON.parse(sessionStorage.getItem('bob_test_logs') || '[]');
  console.table(logs);
}

if (typeof window !== 'undefined') {
  (window as any).viewBobTestLogs = viewBobTestLogs;
}
