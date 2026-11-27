import { useEffect, useRef, useState } from 'react';
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
const POLL_MS = 30_000;
type StatusFilter = 'live' | 'all' | 'expired';
type SourceFilter = 'all' | 'macka' | 'wbm' | 'auctions';

// Finders whose catches go to the Macka/Vassy chat via Carby.
const MACKA_FINDERS = ['maca_feed', 'buy_target', 'bottom_sweep', 'winners', 'winner_hunt'];
// Auction houses (Pickles flags, Grays, Manheim, Slattery, etc.).
const AUCTION_SOURCES = ['pickles', 'grays', 'manheim', 'slattery', 'lloyds', 'united', 'auction_ownfloor'];

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'macka', label: 'Macka-Vassy' },
  { value: 'wbm', label: 'Way Below Market' },
  { value: 'auctions', label: 'Auctions' },
];

interface Catch {
  catch_id: string;
  found_at: string;
  updated_at: string | null;
  source: string | null;
  finder: string | null;
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
  closes_at: string | null;
  alerted_to: string | null;
  status: string | null;
}

function applySource(query: any, source: SourceFilter) {
  if (source === 'wbm') return query.eq('finder', 'memo23_wbm');
  if (source === 'macka') return query.or(`alerted_to.not.is.null,finder.in.(${MACKA_FINDERS.join(',')})`);
  if (source === 'auctions') return query.or(`closes_at.not.is.null,finder.eq.auction_ownfloor,source.in.(${AUCTION_SOURCES.join(',')})`);
  return query;
}

function feedLabel(row: Catch) {
  const src = (row.source ?? '').toLowerCase();
  if (row.closes_at || row.finder === 'auction_ownfloor' || AUCTION_SOURCES.includes(src)) return 'Auction';
  if (row.finder === 'memo23_wbm') return row.alerted_to ? 'WBM · Macka-Vassy' : 'Way Below Market';
  if (row.alerted_to || (row.finder && MACKA_FINDERS.includes(row.finder))) return 'Macka-Vassy';
  return row.finder ?? '—';
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
  const [source, setSource] = useState<SourceFilter>('all');
  const [hasFloor, setHasFloor] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const silentRef = useRef(false);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useBobPagePublisher({
    filters: { status, has_floor: hasFloor, source },
    sortState: 'found_at_desc',
    metrics: { total_caught: total, visible_caught: rows.length, page: page + 1 },
  });

  useEffect(() => {
    document.title = 'Car Sales Watch | Operator';
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Live updates: Supabase Realtime on finder_catches + 30s background poll fallback.
  useEffect(() => {
    let debounce: number | undefined;
    const backgroundRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      silentRef.current = true;
      setRefresh((value) => value + 1);
    };
    const onChange = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(backgroundRefresh, 1_500);
    };
    const channel = supabase
      .channel('car-sales-watch-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finder_catches' }, onChange)
      .subscribe();
    const poll = window.setInterval(backgroundRefresh, POLL_MS);
    document.addEventListener('visibilitychange', backgroundRefresh);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', backgroundRefresh);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let current = true;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    async function loadCatches() {
      try {
        let query = (supabase as any).from('finder_catches')
          .select('catch_id, found_at, updated_at, source, finder, url, year, make, model, badge, km, state, seller_type, ask, floor, gap_dollars, gap_pct, floor_basis, comp_count, check_this, closes_at, alerted_to, status', { count: 'exact' });
        query = applySource(query, source);
        if (status !== 'all') query = query.eq('status', status);
        if (hasFloor) query = query.not('floor', 'is', null);
        const { data, error: queryError, count } = await query
          .order('found_at', { ascending: false })
          .order('updated_at', { ascending: false, nullsFirst: false })
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
          setError(null);
          setNow(Date.now());
          setLastLoaded(Date.now());
        }
      } catch (err) {
        // A failed background refresh keeps the rows already on screen.
        if (current && !silent) {
          setRows([]);
          setTotal(0);
          const detail = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Please try refreshing.';
          setError(`Unable to load catches. ${detail}`);
        }
      } finally {
        if (current && !silent) setIsLoading(false);
      }
    }
    void loadCatches();
    return () => { current = false; };
  }, [page, status, source, hasFloor, refresh]);

  return (
    <OperatorLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
        <div className="flex items-start gap-3">
          <TrendingDown className="h-6 w-6 shrink-0 text-primary mt-1" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">Car Sales Watch</h1>
            <p className="text-sm text-muted-foreground">
              Every best-value car in one place: Macka-Vassy alerts, Way Below Market listings and auction flags, newest catch first. Updates automatically.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Feed">
          {SOURCE_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={source === f.value ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              aria-pressed={source === f.value}
              onClick={() => { setSource(f.value); setPage(0); }}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium tabular-nums" aria-live="polite">{isLoading ? '… caught' : error ? '— caught' : `${total.toLocaleString('en-AU')} caught`}</span>
          {lastLoaded != null && !isLoading && !error && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              Live · updated {caughtAge(new Date(lastLoaded).toISOString(), now)}
            </span>
          )}
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
                    <TableHead>Feed</TableHead>
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
                      <TableCell className="whitespace-nowrap text-xs">
                        <div>{feedLabel(row)}</div>
                        {row.source && <div className="text-muted-foreground">{row.source}</div>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{money(row.ask)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{money(row.floor)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{row.floor == null ? '—' : gapLabel(row.gap_dollars, row.gap_pct)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{[row.state, row.seller_type].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell><Badge variant={row.status === 'live' ? 'secondary' : 'outline'} className="text-xs capitalize">{row.status ?? '—'}</Badge></TableCell>
                      <TableCell>
                        {row.url && (
                          <Button asChild variant="ghost" size="iconSm">
                            <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Open listing for ${[row.year, row.make, row.model].filter(Boolean).join(' ')}`} title="Open listing"><ExternalLink className="h-3.5 w-3.5" /></a>
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
