import { useMemo } from 'react';
import { KitingState } from '@/components/kiting/KitingIndicator';
import { KitingLive } from '@/hooks/useHomeDashboard';

interface KitingStateInput {
  activeHunts: number;
  scansLast60m: number;
  lastScanAt: string | null;
  hasRecentAlert?: boolean;
  alertCreatedAt?: string | null;
  scanStatus?: 'running' | 'completed' | 'failed' | null;
  hasRecentMatch?: boolean;
  matchCreatedAt?: string | null;
}

/**
 * Derive the visual kiting state from real hunt/scan data
 * 
 * State priority (highest to lowest):
 * 1. strike - Recent BUY/WATCH alert (last 10 minutes)
 * 2. diving - Matches found recently but no alert yet (last 10 minutes)
 * 3. scanning - Scan currently running OR recent scan activity (last 2 minutes)
 * 4. hovering - Active hunts, waiting for next scan
 * 5. idle - No active hunts
 */
export function useKitingState(input: KitingStateInput): KitingState {
  return useMemo(() => {
    const {
      activeHunts,
      scansLast60m,
      lastScanAt,
      hasRecentAlert,
      alertCreatedAt,
      scanStatus,
      hasRecentMatch,
      matchCreatedAt,
    } = input;

    // No active hunts = idle
    if (activeHunts === 0) {
      return 'idle';
    }

    const TEN_MINUTES = 10 * 60 * 1000;
    const TWO_MINUTES = 2 * 60 * 1000;
    const now = Date.now();

    // 1. Check for recent strike (alert within last 10 minutes)
    if (hasRecentAlert && alertCreatedAt) {
      const alertAge = now - new Date(alertCreatedAt).getTime();
      if (alertAge < TEN_MINUTES) {
        return 'strike';
      }
    }

    // 2. Check for diving (match found but no alert yet, last 10 minutes)
    if (hasRecentMatch && matchCreatedAt && !hasRecentAlert) {
      const matchAge = now - new Date(matchCreatedAt).getTime();
      if (matchAge < TEN_MINUTES) {
        return 'diving';
      }
    }

    // 3. Check for active scan
    if (scanStatus === 'running') {
      return 'scanning';
    }

    // 4. Check for recent scan activity (last 2 minutes = probably still processing)
    if (lastScanAt) {
      const scanAge = now - new Date(lastScanAt).getTime();
      if (scanAge < TWO_MINUTES) {
        return 'scanning';
      }
    }

    // 5. Active hunts exist = hovering (waiting)
    if (scansLast60m > 0 || activeHunts > 0) {
      return 'hovering';
    }

    return 'hovering';
  }, [
    input.activeHunts,
    input.scansLast60m,
    input.lastScanAt,
    input.hasRecentAlert,
    input.alertCreatedAt,
    input.scanStatus,
    input.hasRecentMatch,
    input.matchCreatedAt,
  ]);
}

/**
 * Convenience hook that takes KitingLive data directly
 */
export function useKitingStateFromLive(
  kitingLive: KitingLive,
  recentAlertAt?: string | null,
  recentMatchAt?: string | null
): KitingState {
  return useKitingState({
    activeHunts: kitingLive.active_hunts,
    scansLast60m: kitingLive.scans_last_60m,
    lastScanAt: kitingLive.last_scan_at,
    hasRecentAlert: !!recentAlertAt,
    alertCreatedAt: recentAlertAt,
    hasRecentMatch: !!recentMatchAt,
    matchCreatedAt: recentMatchAt,
  });
}

/**
 * Derive kiting state for a single hunt based on its scan/alert data
 */
export function deriveHuntKitingState(
  status: string,
  lastScanAt: string | null,
  lastAlertAt: string | null,
  lastMatchAt: string | null,
  scanStatus?: string | null
): KitingState {
  // Paused or done hunts are idle
  if (status !== 'active') {
    return 'idle';
  }

  const TEN_MINUTES = 10 * 60 * 1000;
  const TWO_MINUTES = 2 * 60 * 1000;
  const now = Date.now();

  // Check for recent strike
  if (lastAlertAt) {
    const alertAge = now - new Date(lastAlertAt).getTime();
    if (alertAge < TEN_MINUTES) {
      return 'strike';
    }
  }

  // Check for diving
  if (lastMatchAt && !lastAlertAt) {
    const matchAge = now - new Date(lastMatchAt).getTime();
    if (matchAge < TEN_MINUTES) {
      return 'diving';
    }
  }

  // Check for scanning
  if (scanStatus === 'running') {
    return 'scanning';
  }

  if (lastScanAt) {
    const scanAge = now - new Date(lastScanAt).getTime();
    if (scanAge < TWO_MINUTES) {
      return 'scanning';
    }
  }

  return 'hovering';
}
