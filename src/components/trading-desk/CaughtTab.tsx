// Owner-only "Caught" view: finder catches newest first + per-source coverage strip.
// Portal sign-ins read through the operator-desk gateway (caught_list / coverage_list, refused for yard owners);
// /auth admins read directly, where the tables only allow admins.
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { GatewayDeskData } from '@/pages/operator/deskData';
import { countdown, coverageStrip, foundLabel, gapLabel, kmLabel, money, type CoverageRow } from './caughtPresentation';

const PAGE = 50;
type Catch = {
  catch_id: string; found_at: string; source: string; url: string | null; year: number | null; make: string | null; model: string | null; badge: string | null;
  km: number | null; ask: number | null; floor: number | null; gap_dollars: number | null; gap_pct: number | null; check_this: boolean | null;
  closes_at: string | null; alerted_to: string | null; alerted_at: string | null; status: string | null;
};

async function loadCatches(gw: GatewayDeskData | null, page: number, source: string, status: string) {
  if (gw) return gw.call<{ rows: Catch[]; total: number }>('caught_list', { page, source, status });
  let q = (supabase as any).from('finder_catches').select('*', { count: 'exact' }).order('found_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (source !== 'all') q = q.eq('source', source);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as Catch[], total: count ?? 0 };
}

async function loadCoverage(gw: GatewayDeskData | null): Promise<CoverageRow[]> {
  if (gw) return (await gw.call<{ rows: CoverageRow[] }>('coverage_list')).rows ?? [];
  const since = new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await (supabase as any).from('source_coverage').select('date, source, listings_scanned, new, errors, catches, quiet, received_at').gte('date', since).order('date', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as CoverageRow[];
}

export function CaughtTab({ data, now }: { data: GatewayDeskData | null; now: number }) {
  const [page, setPage] = useState(0);
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState<Catch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);

  useEffect(() => { let live = true; loadCoverage(data).then((r) => live && setCoverage(r)).catch(() => live && setCoverage([])); return () => { live = false; }; }, [data]);
  useEffect(() => {
    let live = true; setLoading(true);
    loadCatches(data, page, source, status)
      .then((r) => { if (live) { setRows(r.rows ?? []); setTotal(r.total ?? 0); } })
      .catch(() => { if (live) { setRows([]); setTotal(0); } })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [data, page, source, status]);

  const strip = coverageStrip(coverage, now);
  const sources = [...new Set([...coverage.map((c) => c.source), ...rows.map((r) => r.source), ...(source !== 'all' ? [source] : [])])].sort();
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-3">
      {strip.chips.length > 0 && (
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border pb-2 text-xs" aria-label="Source coverage">
            <span className="shrink-0 font-semibold text-muted-foreground">Coverage {strip.date}</span>
            {strip.chips.map((c) => (
              <Tooltip key={c.source}>
                <TooltipTrigger asChild>
                  <span className={`shrink-0 rounded border px-2 py-0.5 font-mono ${c.red ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border text-foreground'}`}>
                    {c.source} {c.row ? `${c.row.listings_scanned ?? 0}/${c.row.new ?? 0}/${c.row.catches ?? 0}` : '—'}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <div>Scanned / new / catches</div>
                  {c.reason && <div>{c.reason}</div>}
                  <div>Errors: {c.row?.errors ?? '—'}</div>
                  <div>Last received: {c.row?.received_at ? foundLabel(c.row.received_at) : '—'}</div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="mb-1 block text-xs text-muted-foreground">Source</label>
          <Select value={source} onValueChange={(v) => { setSource(v); setPage(0); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {['live', 'expired', 'sold', 'bought'].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="ml-auto text-sm text-muted-foreground">{total} caught</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p role="status" className="border-y border-border px-3 py-2 text-xs text-muted-foreground">No catches match these filters.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-2">Found</TableHead>
                  <TableHead className="px-2">Source</TableHead>
                  <TableHead className="px-2">Car</TableHead>
                  <TableHead className="px-2 text-right">Ask</TableHead>
                  <TableHead className="px-2 text-right">Floor</TableHead>
                  <TableHead className="px-2 text-right">Gap</TableHead>
                  <TableHead className="px-2">Alerted to</TableHead>
                  <TableHead className="px-2">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const ends = countdown(r.closes_at, now);
                  return (
                    <TableRow key={r.catch_id}>
                      <TableCell className="whitespace-nowrap px-2 text-xs">{foundLabel(r.found_at)}</TableCell>
                      <TableCell className="whitespace-nowrap px-2 text-xs">{r.source}</TableCell>
                      <TableCell className="px-2 text-sm">
                        <span className="font-medium">{[r.year, r.make, r.model, r.badge].filter(Boolean).join(' ')}</span>
                        {r.km != null && <span className="ml-1.5 text-xs text-muted-foreground">{kmLabel(r.km)}</span>}
                        {r.check_this && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">check this</Badge>}
                        {ends && <span className="ml-1.5 text-xs text-muted-foreground" title={r.closes_at ?? undefined}>{ends === 'ended' ? 'auction ended' : `ends in ${ends}`}</span>}
                      </TableCell>
                      <TableCell className="px-2 text-right font-mono text-sm">{money(r.ask)}</TableCell>
                      <TableCell className="px-2 text-right font-mono text-sm">{money(r.floor)}</TableCell>
                      <TableCell className="whitespace-nowrap px-2 text-right font-mono text-sm">{gapLabel(r.gap_dollars, r.gap_pct)}</TableCell>
                      <TableCell className="px-2 text-xs">{r.alerted_to ? <>{r.alerted_to}{r.alerted_at && <span className="ml-1 text-muted-foreground">{foundLabel(r.alerted_at)}</span>}</> : '—'}</TableCell>
                      <TableCell className="px-2 text-xs">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 capitalize hover:text-primary">{r.status ?? 'open'} <ExternalLink className="h-3 w-3" /></a>
                        ) : <span className="capitalize">{r.status ?? '—'}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
