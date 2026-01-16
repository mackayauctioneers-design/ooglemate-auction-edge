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
}

/**
 * Derive the visual kiting state from real hunt/scan data
 * 
 * State priority:
 * 1. strike - Recent BUY/WATCH alert (last 5 minutes)
 * 2. diving - Candidates found, evaluating (recent scan with matches)
 * 3. scanning - Scan currently running OR recent scan activity
 * 4. hovering - Active hunts, waiting
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
      scanStatus
    } = input;

    // No active hunts = idle
    if (activeHunts === 0) {
      return 'idle';
    }

    // Check for recent strike (alert within last 5 minutes)
    if (hasRecentAlert && alertCreatedAt) {
      const alertAge = Date.now() - new Date(alertCreatedAt).getTime();
      const FIVE_MINUTES = 5 * 60 * 1000;
      if (alertAge < FIVE_MINUTES) {
        return 'strike';
      }
    }

    // Check for active scan
    if (scanStatus === 'running') {
      return 'scanning';
    }

    // Check for recent scan activity (last 5 minutes = probably still processing)
    if (lastScanAt) {
      const scanAge = Date.now() - new Date(lastScanAt).getTime();
      const FIVE_MINUTES = 5 * 60 * 1000;
      if (scanAge < FIVE_MINUTES && scansLast60m > 0) {
        return 'scanning';
      }
    }

    // Active scans in last hour = show as active
    if (scansLast60m > 0) {
      return 'hovering';
    }

    // Hunts exist but no recent activity
    return 'hovering';
  }, [
    input.activeHunts,
    input.scansLast60m,
    input.lastScanAt,
    input.hasRecentAlert,
    input.alertCreatedAt,
    input.scanStatus
  ]);
}

/**
 * Convenience hook that takes KitingLive data directly
 */
export function useKitingStateFromLive(
  kitingLive: KitingLive,
  recentAlertAt?: string | null
): KitingState {
  return useKitingState({
    activeHunts: kitingLive.active_hunts,
    scansLast60m: kitingLive.scans_last_60m,
    lastScanAt: kitingLive.last_scan_at,
    hasRecentAlert: !!recentAlertAt,
    alertCreatedAt: recentAlertAt,
  });
}
