import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Play, Trash2, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface ApifyRun {
  id: string;
  source: string;
  run_id: string | null;
  dataset_id: string | null;
  status: string;
  items_fetched: number | null;
  items_upserted: number | null;
  last_error: string | null;
  created_at: string | null;
  completed_at: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle }> = {
  done: { color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', icon: CheckCircle },
  queued: { color: 'bg-blue-500/10 text-blue-500 border-blue-500/30', icon: Clock },
  fetching: { color: 'bg-amber-500/10 text-amber-500 border-amber-500/30', icon: Loader2 },
  error: { color: 'bg-red-500/10 text-red-500 border-red-500/30', icon: XCircle },
  failed: { color: 'bg-red-500/10 text-red-500 border-red-500/30', icon: XCircle },
};

export default function ApifyRunsPage() {
  const [runs, setRuns] = useState<ApifyRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('apify_runs_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setRuns((data as ApifyRun[]) || []);
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const sourceStats = runs.reduce((acc, r) => {
    if (!acc[r.source]) acc[r.source] = { total: 0, done: 0, error: 0, active: 0 };
    acc[r.source].total++;
    if (r.status === 'done') acc[r.source].done++;
    else if (['error', 'failed'].includes(r.status)) acc[r.source].error++;
    else acc[r.source].active++;
    return acc;
  }, {} as Record<string, { total: number; done: number; error: number; active: number }>);

  const triggerScan = async (source: string) => {
    setTriggerLoading(source);
    try {
      const fnMap: Record<string, string> = {
        carsales: 'carsales-scan-cron',
        gumtree: 'gumtree-scan-cron',
        slattery: 'slattery-scan-cron',
        'ultimate-car': 'ultimate-car-scan-cron',
      };
      const fnName = fnMap[source];
      if (!fnName) { toast.error(`No cron function mapped for ${source}`); return; }

      const { error } = await supabase.functions.invoke(fnName, { body: {} });
      if (error) throw error;
      toast.success(`${source} scan triggered`);
      setTimeout(fetchRuns, 3000);
    } catch (err: any) {
      toast.error(err.message || 'Trigger failed');
    } finally {
      setTriggerLoading(null);
    }
  };

  const clearStuck = async (source: string, status: string) => {
    try {
      // We can't do UPDATE via supabase-js on arbitrary conditions easily,
      // so we fetch IDs then update them
      const { data: stuck } = await supabase
        .from('apify_runs_queue')
        .select('id')
        .eq('source', source)
        .eq('status', status)
        .limit(100);

      if (!stuck?.length) { toast.info('Nothing to clear'); return; }

      const ids = stuck.map(r => r.id);
      const { error } = await supabase
        .from('apify_runs_queue')
        .update({ status: 'error', last_error: `Manually cleared from ${status}` })
        .in('id', ids);

      if (error) throw error;
      toast.success(`Cleared ${ids.length} stuck ${source} runs`);
      fetchRuns();
    } catch (err: any) {
      toast.error(err.message || 'Clear failed');
    }
  };

  const statusBadge = (status: string) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.error;
    const Icon = cfg.icon;
    return (
      <Badge variant="outline" className={cfg.color}>
        <Icon className={`h-3 w-3 mr-1 ${status === 'fetching' ? 'animate-spin' : ''}`} />
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Apify Runs Queue</h2>
          <p className="text-sm text-muted-foreground">Monitor scraper runs across all sources</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Source summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(sourceStats).map(([source, stats]) => (
          <Card key={source}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <span className="truncate">{source}</span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    onClick={() => triggerScan(source)}
                    disabled={!!triggerLoading}
                    title="Trigger scan now"
                  >
                    {triggerLoading === source
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Play className="h-3 w-3" />}
                  </Button>
                  {stats.active > 0 && (
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                      onClick={() => clearStuck(source, 'fetching')}
                      title="Clear stuck runs"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-2xl font-bold">{stats.total}</span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-emerald-500">{stats.done} done</span>
                  {stats.error > 0 && <span className="text-red-500">{stats.error} err</span>}
                  {stats.active > 0 && <span className="text-amber-500">{stats.active} active</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Runs table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs (last 100)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-3">Source</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-left py-2 pr-3">Run ID</th>
                  <th className="text-right py-2 pr-3">Fetched</th>
                  <th className="text-right py-2 pr-3">Upserted</th>
                  <th className="text-left py-2 pr-3">Created</th>
                  <th className="text-left py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="py-2 pr-3 font-medium">{run.source}</td>
                    <td className="py-2 pr-3">{statusBadge(run.status)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {run.run_id ? run.run_id.slice(0, 8) + '…' : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {run.items_fetched ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {run.items_upserted ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">
                      {run.created_at
                        ? formatDistanceToNow(parseISO(run.created_at), { addSuffix: true })
                        : '—'}
                    </td>
                    <td className="py-2 text-xs text-red-400 max-w-[200px] truncate">
                      {run.last_error || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {runs.length === 0 && !loading && (
              <div className="text-center py-8 text-muted-foreground">No Apify runs found</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
