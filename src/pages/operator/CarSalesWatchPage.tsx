import { useEffect, useState } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { foundLabel, money, kmLabel, gapLabel } from '@/components/trading-desk/caughtPresentation';
import { useBobPagePublisher } from '@/hooks/useBobPagePublisher';

const PAGE_SIZE = 50;
type StatusFilter = 'live' | 'all' | 'expired';
interface Catch {
  catch_id: string;
  found_at: string;
  updated_at: string | null;
  url: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  badge: string | null;
  km: number | null;
  state: string | null;
  seller_type: string | null;
  ask: number | null;
  floor: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  floor_basis: string | null;
  comp_count: number | null;
  check_this: boolean | null;
  status: string | null;
}

function caughtAge(iso: string, now: number) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '—';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function caughtTitle(iso: string) {
  if (!Number.isFinite(Date.parse(iso))) return undefined;
  const date = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(new Date(iso));
  return `${date} · ${foundLabel(iso)}`;
}

export default function CarSalesWatchPage() {
  const [rows, setRows] = useState<Catch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<StatusFilter>('live');
  const [hasFloor, setHasFloor] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useBobPagePublisher({
    filters: { status, has_floor: hasFloor, source: 'memo23_wbm' },
    sortState: 'found_at_desc',
    metrics: { total_caught: total, visible_caught: rows.length, page: page + 1 },
  });

  useEffect(() => {
    document.title = 'Car Sales Watch | Operator';
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let current = true;
    setIsLoading(true);
    setError(null);
    async function loadCatches() {
      try {
        let query = (supabase as any).from('finder_catches')
          .select('catch_id, found_at, updated_at, url, year, make, model, badge, km, state, seller_type, ask, floor, gap_dollars, gap_pct, floor_basis, comp_count, check_this, status', { count: 'exact' })
          .eq('finder', 'memo23_wbm');
        if (status !== 'all') query = query.eq('status', status);
        if (hasFloor) query = query.not('floor', 'is', null);
        const { data, error: queryError, count } = await query
          .order('found_at', { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (queryError) throw queryError;
        if (current) {
          const nextTotal = count ?? 0;
          const lastPage = Math.max(0, Math.ceil(nextTotal / PAGE_SIZE) - 1);
          setTotal(nextTotal);
          if (page > lastPage) {
            setRows([]);
            setPage(lastPage);
          } else {
            setRows((data ?? []) as Catch[]);
          }
          setNow(Date.now());
        }
      } catch (err) {
        if (current) {
          setRows([]);
          setTotal(0);
          const detail = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Please try refreshing.';
          setError(`Unable to load catches. ${detail}`);
        }
      } finally {
        if (current) setIsLoading(false);
      }
    }
    void loadCatches();
    return () => { current = false; };
  }, [page, status, hasFloor, refresh]);

  return (
    <OperatorLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
        <div className="flex items-start gap-3">
          <TrendingDown className="h-6 w-6 shrink-0 text-primary mt-1" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">Car Sales Watch</h1>
            <p className="text-sm text-muted-foreground">
              Carsales listings tagged Well Below Market (memo23 feed), newest catch first. Carsales can drop the tag after we catch it.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium tabular-nums" aria-live="polite">{isLoading ? '… caught' : error ? '— caught' : `${total.toLocaleString('en-AU')} caught`}</span>
          <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
            <div className="flex items-center gap-2">
              <label htmlFor="catch-status" className="text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(value) => { setStatus(value as StatusFilter); setPage(0); }}>
                <SelectTrigger id="catch-status" className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="catch-floor" checked={hasFloor} onCheckedChange={(value) => { setHasFloor(value); setPage(0); }} />
              <label htmlFor="catch-floor" className="text-xs text-muted-foreground">Has our floor</label>
            </div>
            <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)} disabled={isLoading}>Refresh</Button>
          </div>
        </div>

        {isLoading ? (
          <div role="status" aria-label="Loading catches" className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p role="alert" className="py-4 text-sm text-muted-foreground">{error}</p>
        ) : rows.length === 0 ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">No catches match these filters.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Caught</TableHead>
                    <TableHead>Car</TableHead>
                    <TableHead className="text-right">Ask</TableHead>
                    <TableHead className="text-right">Floor</TableHead>
                    <TableHead className="text-right">Gap</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead><span className="sr-only">Listing</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.catch_id}>
                      <TableCell className="whitespace-nowrap text-xs font-medium tabular-nums" title={caughtTitle(row.found_at)}>{caughtAge(row.found_at, now)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{[row.year, row.make, row.model, row.badge].filter(Boolean).join(' ') || '—'}</div>
                        {row.km != null && <div className="text-xs text-muted-foreground">{kmLabel(row.km)}</div>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{money(row.ask)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{money(row.floor)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{row.floor == null ? '—' : gapLabel(row.gap_dollars, row.gap_pct)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{[row.state, row.seller_type].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell><Badge variant={row.status === 'live' ? 'secondary' : 'outline'} className="text-xs capitalize">{row.status ?? '—'}</Badge></TableCell>
                      <TableCell>
                        {row.url && (
                          <Button asChild variant="ghost" size="iconSm">
                            <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Open Carsales listing for ${[row.year, row.make, row.model].filter(Boolean).join(' ')}`} title="Open Carsales listing"><ExternalLink className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!error && pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Button variant="outline" size="sm" disabled={isLoading || page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <span>Page {page + 1} of {pages}</span>
            <Button variant="outline" size="sm" disabled={isLoading || page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
