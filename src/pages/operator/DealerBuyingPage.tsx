import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { DeskValuation } from '@/components/trading-desk/DeskOverview';
import { returnedFloorGap, sourceName, sydneyFoundTime } from '@/components/trading-desk/deskPresentation';
import { matchingCars, summariseSales, type SaleRow } from '@/components/dealer-buying/dealerProfile';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-AU')}` : '—');
const kms = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('en-AU')} km`);
const safeUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const ACTIVE = ['new', 'assigned', 'reviewed'];

interface Dealer { id: string; name: string }

function Quiet({ children }: { children: React.ReactNode }) { return <p className="py-3 text-sm text-muted-foreground">{children}</p>; }

export default function DealerBuyingPage() {
  const [dealers, setDealers] = useState<Dealer[] | null>(null);
  const [dealerId, setDealerId] = useState<string>('');
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [opps, setOpps] = useState<any[] | null>(null);
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      const [acc, withSales] = await Promise.all([
        supabase.from('accounts').select('id, display_name').order('display_name'),
        supabase.from('vehicle_sales_truth').select('account_id').order('sold_at', { ascending: false }).limit(1000),
      ]);
      if (acc.error) { setError(true); setDealers([]); return; }
      const list = (acc.data ?? []).map((a) => ({ id: a.id, name: a.display_name ?? 'Unnamed dealer' }));
      setDealers(list);
      const has = new Set((withSales.data ?? []).map((r) => r.account_id));
      setDealerId((list.find((d) => has.has(d.id)) ?? list[0])?.id ?? '');
    })();
  }, []);

  useEffect(() => {
    if (!dealerId) return;
    let live = true;
    setSales(null); setOpps(null); setAlerts(null); setError(false);
    (async () => {
      const fresh = new Date(Date.now() - 14 * 86400000).toISOString();
      const [s, o, h] = await Promise.all([
        supabase.from('vehicle_sales_truth').select('make, model, year, km, sale_price, days_to_clear, transmission').eq('account_id', dealerId).order('sold_at', { ascending: false }).limit(1000),
        supabase.from('operator_opportunities').select('*').in('status', ACTIVE).gte('created_at', fresh).order('created_at', { ascending: false }).limit(1000),
        supabase.from('sale_hunts').select('id').eq('dealer_id', dealerId).limit(200),
      ]);
      if (!live) return;
      if (s.error || o.error) setError(true);
      setSales((s.data as SaleRow[]) ?? []);
      setOpps(o.data ?? []);
      const ids = (h.data ?? []).map((r) => r.id);
      if (!ids.length) { setAlerts([]); return; }
      const a = await supabase.from('hunt_alerts').select('id, alert_type, created_at, payload, acknowledged_at').in('hunt_id', ids).order('created_at', { ascending: false }).limit(10);
      if (live) setAlerts(a.data ?? []);
    })();
    return () => { live = false; };
  }, [dealerId]);

  const summary = useMemo(() => summariseSales(sales ?? []), [sales]);
  const matches = useMemo(() => matchingCars(opps ?? [], summary), [opps, summary]);

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-xl font-semibold">Dealer Buying</h1><p className="text-sm text-muted-foreground">Live cars that fit what each dealer actually sells.</p></div>
          <Select value={dealerId} onValueChange={setDealerId} disabled={!dealers?.length}>
            <SelectTrigger className="w-64" aria-label="Choose dealer"><SelectValue placeholder={dealers ? 'No dealers yet' : 'Loading dealers…'} /></SelectTrigger>
            <SelectContent>{dealers?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
        </header>
        {error ? <p className="text-sm text-muted-foreground">Some data couldn't be loaded. Try again shortly.</p> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">What they sell</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {sales == null ? <Quiet>Loading sales history…</Quiet> : !summary.count ? <Quiet>No sales history for this dealer yet.</Quiet> : <>
                  <div className="flex flex-wrap gap-1.5">{summary.topMakes.map((m) => <Badge key={m.make} variant="secondary">{m.make} · {m.count}</Badge>)}</div>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Sales</dt><dd className="font-mono">{summary.count}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Years</dt><dd className="font-mono">{summary.years ? `${summary.years.min}–${summary.years.max}` : '—'}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Km</dt><dd className="font-mono">{summary.km ? `${Math.round(summary.km.min / 1000)}k–${Math.round(summary.km.max / 1000)}k` : '—'}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Sold for</dt><dd className="font-mono">{summary.price ? `${money(summary.price.min)}–${money(summary.price.max)}` : '—'}</dd></div>
                    {summary.medianDays != null ? <div><dt className="text-xs text-muted-foreground">Typical days to sell</dt><dd className="font-mono">{summary.medianDays}</dd></div> : null}
                  </dl>
                  <Table><TableHeader><TableRow><TableHead>Make / model</TableHead><TableHead className="text-right">Sold</TableHead></TableRow></TableHeader>
                    <TableBody>{summary.topModels.slice(0, 8).map((m) => <TableRow key={m.make + m.model}><TableCell className="py-1.5">{m.make} {m.model}</TableCell><TableCell className="py-1.5 text-right font-mono">{m.count}</TableCell></TableRow>)}</TableBody></Table>
                </>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Matching cars{opps && summary.count ? <span className="ml-2 text-xs font-normal text-muted-foreground">{matches.length}</span> : null}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {opps == null || sales == null ? <Quiet>Loading live cars…</Quiet> : !summary.count ? <Quiet>No sales history for this dealer yet, so there's nothing to match against.</Quiet> : !matches.length ? <Quiet>No live cars match right now.</Quiet> :
                  <Table><TableHeader><TableRow><TableHead>Car</TableHead><TableHead>Km</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Asking</TableHead><TableHead className="text-right">Floor</TableHead><TableHead className="text-right">Cautious buy</TableHead><TableHead className="text-right">Gap</TableHead><TableHead>Found</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>{matches.map((o) => { const url = safeUrl(o.source_url); const floor = returnedFloorGap(o); return (
                      <TableRow key={o.id}>
                        <TableCell className="py-1.5 font-medium">{[o.year, o.make, o.model, o.variant].filter(Boolean).join(' ')}</TableCell>
                        <TableCell className="py-1.5 font-mono text-xs">{kms(o.km)}</TableCell>
                        <TableCell className="py-1.5 text-xs">{sourceName(o.listing_source)}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs">{money(o.asking_price)}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs">{money(floor.dollars)}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs">{money(o.pricing_guide?.target_buy_price)}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs">{money(o.best_under_buy)}</TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">{sydneyFoundTime(o.created_at)}{o.days_listed != null ? ` · ${o.days_listed}d` : ''}</TableCell>
                        <TableCell className="py-1.5">{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open ad" className="text-primary"><ArrowUpRight className="h-4 w-4" /></a> : null}</TableCell>
                      </TableRow>); })}</TableBody></Table>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Recent alerts</CardTitle></CardHeader>
              <CardContent>
                {alerts == null ? <Quiet>Loading alerts…</Quiet> : !alerts.length ? <Quiet>No alerts for this dealer yet.</Quiet> :
                  <ul className="divide-y divide-border text-sm">{alerts.map((a) => { const p = a.payload ?? {}; const url = safeUrl(p.listing_url ?? p.url); return (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate">{[p.year, p.make, p.model, p.variant].filter(Boolean).join(' ') || 'Matched car'}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><Badge variant="outline">{a.alert_type}</Badge>{sydneyFoundTime(a.created_at)}{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open ad" className="text-primary"><ArrowUpRight className="h-4 w-4" /></a> : null}</span>
                    </li>); })}</ul>}
              </CardContent>
            </Card>
          </div>
          <DeskValuation />
        </div>
      </div>
    </OperatorLayout>
  );
}
