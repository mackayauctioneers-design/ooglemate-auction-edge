import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, XCircle, Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';

interface QueueItem {
  id: string;
  source: string;
  source_listing_id: string;
  detail_url: string;
  crawl_status: string;
  retry_count: number | null;
  claimed_at: string | null;
  claimed_by: string | null;
  last_crawl_at: string | null;
  last_crawl_error: string | null;
  first_seen_at: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  guide_price: number | null;
  sale_status: string | null;
  wovr_indicator: boolean | null;
  damage_noted: boolean | null;
}

interface QueueStats {
  pending: number;
  processing: number;
  done: number;
  error: number;
  listing_expired: number;
  total: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:         { label: 'Pending',         color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',  icon: <Clock className="h-3 w-3" /> },
  processing:      { label: 'Processing',      color: 'bg-blue-500/10 text-blue-600 border-blue-500/30',        icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  done:            { label: 'Done',            color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', icon: <CheckCircle2 className="h-3 w-3" /> },
  error:           { label: 'Error',           color: 'bg-red-500/10 text-red-600 border-red-500/30',           icon: <XCircle className="h-3 w-3" /> },
  listing_expired: { label: 'Expired',         color: 'bg-slate-500/10 text-slate-500 border-slate-500/30',     icon: <Ban className="h-3 w-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'bg-muted text-muted-foreground border-border', icon: null };
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-xs ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

function fmtPrice(n: number | null) {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
}

function fmtKm(n: number | null) {
  if (n == null) return '—';
  return n.toLocaleString() + ' km';
}

function timeAgo(iso: string | null) {
  if (!iso) return '—';
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return iso; }
}

export default function AuctionEnrichmentQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats>({ pending: 0, processing: 0, done: 0, error: 0, listing_expired: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sourceFilter, setSourceFilter] = useState('all');

  useEffect(() => { document.title = 'Auction Enrichment Queue | Operator'; }, []);

  const fetchStats = useCallback(async () => {
    const { data } = await supabase
      .from('pickles_detail_queue')
      .select('crawl_status')
      .in('crawl_status', ['pending', 'processing', 'done', 'error', 'listing_expired']);

    if (data) {
      const counts: QueueStats = { pending: 0, processing: 0, done: 0, error: 0, listing_expired: 0, total: data.length };
      data.forEach((r: any) => {
        if (r.crawl_status in counts) (counts as any)[r.crawl_status]++;
      });
      setStats(counts);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('pickles_detail_queue')
        .select('id, source, source_listing_id, detail_url, crawl_status, retry_count, claimed_at, claimed_by, last_crawl_at, last_crawl_error, first_seen_at, make, model, year, km, asking_price, guide_price, sale_status, wovr_indicator, damage_noted')
        .order('first_seen_at', { ascending: false })
        .limit(200);

      if (statusFilter !== 'all') query = query.eq('crawl_status', statusFilter);
      if (sourceFilter !== 'all') query = query.eq('source', sourceFilter);

      const { data, error } = await query;
      if (error) throw error;
      setItems((data as QueueItem[]) || []);
    } catch (err) {
      console.error('Failed to fetch queue items:', err);
      toast.error('Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchStats(), fetchItems()]);
  }, [fetchStats, fetchItems]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const resetStuck = async () => {
    setResetting(true);
    try {
      const { data, error } = await supabase.rpc('reset_stuck_auction_queue_items' as never, { p_stuck_minutes: 30 });
      if (error) throw error;
      const count = typeof data === 'number' ? data : 0;
      toast.success(`Reset ${count} stuck item${count !== 1 ? 's' : ''} back to pending`);
      await refresh();
    } catch (err: any) {
      toast.error(`Reset failed: ${err.message}`);
    } finally {
      setResetting(false);
    }
  };

  const statCards = [
    { key: 'pending',         label: 'Pending',    color: 'text-yellow-600' },
    { key: 'processing',      label: 'Processing', color: 'text-blue-600' },
    { key: 'done',            label: 'Done',       color: 'text-emerald-600' },
    { key: 'error',           label: 'Error',      color: 'text-red-600' },
    { key: 'listing_expired', label: 'Expired',    color: 'text-slate-500' },
  ];

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Auction Enrichment Queue</h1>
            <p className="text-muted-foreground text-sm">
              Manus detail extraction pipeline — {stats.total.toLocaleString()} total items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetStuck} disabled={resetting}>
              {resetting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
              Reset Stuck
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {statCards.map(({ key, label, color }) => (
            <Card
              key={key}
              className={`cursor-pointer transition-all ${statusFilter === key ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            >
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className={`text-2xl font-bold ${color}`}>{((stats as any)[key] || 0).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="listing_expired">Expired</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="pickles">Pickles</SelectItem>
              <SelectItem value="grays">Grays</SelectItem>
              <SelectItem value="manheim">Manheim</SelectItem>
            </SelectContent>
          </Select>

          <p className="text-sm text-muted-foreground ml-auto">
            Showing {items.length} items (auto-refresh 15s)
          </p>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Source</TableHead>
                    <TableHead>Listing ID</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Guide</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>First Seen</TableHead>
                    <TableHead>Last Crawl</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No items found
                      </TableCell>
                    </TableRow>
                  ) : items.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{item.source}</Badge>
                      </TableCell>
                      <TableCell>
                        <a
                          href={item.detail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-primary hover:underline"
                        >
                          {item.source_listing_id.slice(0, 12)}…
                        </a>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {item.year && item.make && item.model
                            ? `${item.year} ${item.make} ${item.model}`
                            : <span className="text-muted-foreground italic">Not yet enriched</span>
                          }
                          {item.km && <span className="text-xs text-muted-foreground ml-1">({fmtKm(item.km)})</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {fmtPrice(item.asking_price)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {fmtPrice(item.guide_price)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge status={item.crawl_status} />
                          {item.last_crawl_error && (
                            <p className="text-xs text-red-500 max-w-[200px] truncate" title={item.last_crawl_error}>
                              {item.last_crawl_error}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-sm font-medium ${(item.retry_count || 0) >= 2 ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {item.retry_count || 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(item.first_seen_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(item.last_crawl_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {item.wovr_indicator && (
                            <Badge variant="destructive" className="text-xs px-1 py-0">WOVR</Badge>
                          )}
                          {item.damage_noted && (
                            <Badge variant="outline" className="text-xs px-1 py-0 border-orange-500/50 text-orange-600">DMG</Badge>
                          )}
                          {item.sale_status && item.sale_status !== 'upcoming' && (
                            <Badge variant="outline" className="text-xs px-1 py-0 capitalize">{item.sale_status}</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
