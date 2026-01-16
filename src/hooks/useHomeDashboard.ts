import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Helper to resolve dealer_id from dealerProfile
function useDealerId() {
  const { dealerProfile } = useAuth();
  return dealerProfile?.dealer_profile_id || null;
}

export interface HuntOpportunity {
  type: 'HUNT' | 'TRIGGER';
  severity: 'BUY' | 'WATCH';
  year: number;
  make: string;
  model: string;
  km: number | null;
  asking_price: number | null;
  proven_exit_value: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  confidence: string;
  source: string | null;
  url: string | null;
  why: string[] | null;
  alert_id: string;
  hunt_id: string;
}

export interface KitingLive {
  active_hunts: number;
  scans_last_60m: number;
  candidates_today: number;
  last_scan_at: string | null;
  last_scan_ok: boolean;
  sources: string[];
}

export interface WatchlistItem {
  listing_id: string;
  title: string;
  source: string | null;
  last_seen_at: string | null;
  age_days: number;
  price_change_count_14d: number;
  last_price_change_at: string | null;
  status: 'WATCH' | 'STALE';
  gap_pct: number | null;
  asking_price: number | null;
}

export interface HomeDashboardData {
  today_opportunities: HuntOpportunity[];
  kiting_live: KitingLive;
  watchlist_movement: WatchlistItem[];
}

const DEFAULT_KITING_LIVE: KitingLive = {
  active_hunts: 0,
  scans_last_60m: 0,
  candidates_today: 0,
  last_scan_at: null,
  last_scan_ok: false,
  sources: ['autotrader', 'drive', 'gumtree_dealer', 'pickles']
};

export function useHomeDashboard() {
  const dealerId = useDealerId();
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!dealerId) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: result, error: rpcError } = await (supabase as any).rpc('get_home_dashboard', {
        p_dealer_id: dealerId
      });

      if (rpcError) {
        console.error('[HomeDashboard] RPC error:', rpcError);
        setError(rpcError.message);
        // Set default empty state
        setData({
          today_opportunities: [],
          kiting_live: DEFAULT_KITING_LIVE,
          watchlist_movement: []
        });
      } else {
        setData(result as HomeDashboardData);
      }
    } catch (err) {
      console.error('[HomeDashboard] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData({
        today_opportunities: [],
        kiting_live: DEFAULT_KITING_LIVE,
        watchlist_movement: []
      });
    } finally {
      setIsLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(fetchDashboard, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  return {
    data,
    isLoading,
    error,
    refresh: fetchDashboard,
    opportunities: data?.today_opportunities || [],
    kitingLive: data?.kiting_live || DEFAULT_KITING_LIVE,
    watchlist: data?.watchlist_movement || []
  };
}
