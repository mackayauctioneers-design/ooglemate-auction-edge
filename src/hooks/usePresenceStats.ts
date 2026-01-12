import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PresenceStats {
  runId: string | null;
  runDate: string | null;
  runStatus: string | null;
  newToday: number;
  pendingMissing: number;  // 1 strike (might be gone)
  missingToday: number;    // 2+ strikes (confirmed gone)
  returnedToday: number;
  stillActive: number;
}

export function usePresenceStats() {
  const [stats, setStats] = useState<PresenceStats>({
    runId: null,
    runDate: null,
    runStatus: null,
    newToday: 0,
    pendingMissing: 0,
    missingToday: 0,
    returnedToday: 0,
    stillActive: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Get the latest successful pipeline run
        const { data: latestRun } = await supabase
          .from('pipeline_runs')
          .select('id, started_at, status')
          .in('status', ['SUCCESS', 'PARTIAL_FAIL'])
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        if (!latestRun) {
          setLoading(false);
          return;
        }

        // Get event counts for this run from listing_events
        const { data: events } = await supabase
          .from('listing_events')
          .select('event_type')
          .eq('run_id', latestRun.id)
          .in('event_type', ['FIRST_SEEN', 'WENT_MISSING', 'RETURNED']);

        const newCount = events?.filter(e => e.event_type === 'FIRST_SEEN').length ?? 0;
        const missingCount = events?.filter(e => e.event_type === 'WENT_MISSING').length ?? 0;
        const returnedCount = events?.filter(e => e.event_type === 'RETURNED').length ?? 0;

        // Get still active count (seen this run)
        const { count: activeCount } = await supabase
          .from('vehicle_listings')
          .select('*', { count: 'exact', head: true })
          .eq('last_ingest_run_id', latestRun.id)
          .in('status', ['catalogue', 'listed', 'active']);

        // Get pending missing count (1 strike - active but missed last run)
        const { count: pendingCount } = await supabase
          .from('vehicle_listings')
          .select('*', { count: 'exact', head: true })
          .in('status', ['catalogue', 'listed', 'active'])
          .eq('is_dealer_grade', true)
          .eq('missing_streak', 1);

        setStats({
          runId: latestRun.id,
          runDate: latestRun.started_at,
          runStatus: latestRun.status,
          newToday: newCount,
          pendingMissing: pendingCount ?? 0,
          missingToday: missingCount,
          returnedToday: returnedCount,
          stillActive: activeCount ?? 0,
        });
      } catch (error) {
        console.error('Error fetching presence stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  return { stats, loading };
}
