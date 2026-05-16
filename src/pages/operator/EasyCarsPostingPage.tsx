import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { OperatorGuard } from '@/components/guards/OperatorGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Copy, ExternalLink, Search, Download } from 'lucide-react';

type Trade = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  dealer_name: string | null;
  vin: string | null;
  rego: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  stock_number: string | null;
  sell_price_inc_gst: number | null;
  easycars_post_status: string;
  easycars_ready_at: string | null;
  easycars_ready_by: string | null;
  easycars_posted_at: string | null;
  easycars_posted_by: string | null;
  easycars_stock_number_manual: string | null;
  easycars_post_note: string | null;
  created_at: string;
};

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'manual_ready', label: 'Ready' },
  { key: 'manual_posted', label: 'Posted' },
  { key: 'all', label: 'All' },
];

function fmt(ts: string | null) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function vehicleLabel(t: Trade) {
  return [t.year, t.make, t.model, t.variant].filter(Boolean).join(' ') || '—';
}

function ageHours(ts: string | null): number | null {
  if (!ts) return null;
  return (Date.now() - new Date(ts).getTime()) / 3_600_000;
}

function ageLabel(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function statusBadge(s: string) {
  if (s === 'manual_posted') return <Badge className="bg-green-600 hover:bg-green-600">Posted</Badge>;
  if (s === 'manual_ready') return <Badge className="bg-amber-600 hover:bg-amber-600">Ready</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

async function copyText(text: string, label = 'value') {
  try { await navigator.clipboard.writeText(text); toast.success(`Copied ${label}`); }
  catch { toast.error('Copy failed'); }
}

function buildStockPayload(t: Trade) {
  return JSON.stringify({
    rego: t.rego, vin: t.vin, year: t.year, make: t.make, model: t.model,
    variant: t.variant, series: (t as any).series, odometer_km: (t as any).odometer_km,
    colour: (t as any).colour, body_type: (t as any).body_type,
    transmission: (t as any).transmission, fuel_type: (t as any).fuel_type,
    supplier: t.dealer_name, invoice_number: t.invoice_number,
    invoice_date: t.invoice_date, acquisition_cost: t.sell_price_inc_gst,
    stock_number: t.easycars_stock_number_manual || t.stock_number,
  }, null, 2);
}

function toCSV(rows: Trade[]): string {
  const cols = ['id','created_at','easycars_ready_at','rego','vin','dealer_name','invoice_number','sell_price_inc_gst','year','make','model','variant','easycars_stock_number_manual','easycars_post_note'];
  const esc = (v: any) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n');
}

function EasyCarsPostingPageInner() {
  const [tab, setTab] = useState<string>('manual_ready');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Record<string, { stock: string; note: string }>>({});
  const [userLabel, setUserLabel] = useState<string>('operator');
  const [search, setSearch] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateField, setDateField] = useState<'created_at' | 'easycars_ready_at' | 'easycars_posted_at'>('created_at');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.title = 'EasyCars Posting | Operator';
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserLabel(data.user.email ?? data.user.id);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('trades')
      .select('id,invoice_number,invoice_date,dealer_name,vin,rego,year,make,model,variant,series,odometer_km,colour,body_type,transmission,fuel_type,stock_number,sell_price_inc_gst,easycars_post_status,easycars_ready_at,easycars_ready_by,easycars_posted_at,easycars_posted_by,easycars_stock_number_manual,easycars_post_note,created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (tab !== 'all') q = q.eq('easycars_post_status', tab);
    if (fromDate) q = q.gte(dateField, fromDate);
    if (toDate) q = q.lte(dateField, toDate + 'T23:59:59');
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setTrades((data as Trade[]) ?? []);
    setSelected(new Set());
    setLoading(false);
  }, [tab, fromDate, toDate, dateField]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return trades.filter(t => {
      if (operatorFilter) {
        const op = operatorFilter.toLowerCase();
        const matchOp = (t.easycars_ready_by ?? '').toLowerCase().includes(op)
          || (t.easycars_posted_by ?? '').toLowerCase().includes(op);
        if (!matchOp) return false;
      }
      if (!s) return true;
      return [t.rego, t.vin, t.stock_number, t.easycars_stock_number_manual, t.dealer_name, t.invoice_number]
        .some(v => (v ?? '').toLowerCase().includes(s));
    });
  }, [trades, search, operatorFilter]);

  const counts = useMemo(() => {
    const c = { pending: 0, manual_ready: 0, manual_posted: 0 };
    for (const t of trades) (c as any)[t.easycars_post_status] = ((c as any)[t.easycars_post_status] ?? 0) + 1;
    return c;
  }, [trades]);

  const updateRow = async (id: string, patch: Partial<Trade>) => {
    const { error } = await supabase.from('trades').update(patch as any).eq('id', id);
    if (error) { toast.error(error.message); return false; }
    return true;
  };

  const markReady = async (t: Trade) => {
    const ok = await updateRow(t.id, {
      easycars_post_status: 'manual_ready',
      easycars_ready_at: new Date().toISOString(),
      easycars_ready_by: userLabel,
    });
    if (ok) { toast.success('Marked ready'); load(); }
  };

  const markPosted = async (t: Trade) => {
    const e = editing[t.id] ?? { stock: t.easycars_stock_number_manual ?? '', note: t.easycars_post_note ?? '' };
    const ok = await updateRow(t.id, {
      easycars_post_status: 'manual_posted',
      easycars_posted_at: new Date().toISOString(),
      easycars_posted_by: userLabel,
      easycars_stock_number_manual: e.stock?.trim() || null,
      easycars_post_note: e.note?.trim() || null,
    });
    if (ok) { toast.success('Marked posted to EasyCars'); load(); }
  };

  const revert = async (t: Trade) => {
    const ok = await updateRow(t.id, {
      easycars_post_status: 'pending',
      easycars_ready_at: null,
      easycars_ready_by: null,
      easycars_posted_at: null,
      easycars_posted_by: null,
    });
    if (ok) { toast.success('Reverted to pending'); load(); }
  };

  const bulkMarkReady = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const { error } = await supabase.from('trades').update({
      easycars_post_status: 'manual_ready',
      easycars_ready_at: new Date().toISOString(),
      easycars_ready_by: userLabel,
    } as any).in('id', ids).eq('easycars_post_status', 'pending');
    if (error) toast.error(error.message);
    else { toast.success(`Marked ${ids.length} ready`); load(); }
  };

  const exportCSV = () => {
    const rows = selected.size ? filtered.filter(t => selected.has(t.id)) : filtered;
    if (!rows.length) { toast.error('No rows to export'); return; }
    const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `easycars-${tab}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const toggleSel = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(t => t.id)));
  };

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">EasyCars Posting (Manual)</h1>
          <p className="text-sm text-muted-foreground">
            Fallback workflow. Status here is operator-recorded, not automated.
          </p>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span>Pending in view: <b className="text-foreground">{counts.pending}</b></span>
            <span>Ready: <b className="text-amber-600">{counts.manual_ready}</b></span>
            <span>Posted: <b className="text-green-600">{counts.manual_posted}</b></span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        {STATUS_TABS.map((s) => (
          <button
            key={s.key}
            onClick={() => setTab(s.key)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === s.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-2 p-3 border rounded-md bg-muted/20">
        <div className="lg:col-span-2 relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search rego, VIN, stock, supplier, invoice…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Input placeholder="Operator email" value={operatorFilter} onChange={e => setOperatorFilter(e.target.value)} className="h-9" />
        <select
          value={dateField}
          onChange={e => setDateField(e.target.value as any)}
          className="h-9 px-2 rounded-md border bg-background text-sm"
        >
          <option value="created_at">Created date</option>
          <option value="easycars_ready_at">Ready date</option>
          <option value="easycars_posted_at">Posted date</option>
        </select>
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9" />
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9" />
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 p-2 border rounded-md bg-primary/5">
          <span className="text-sm">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={bulkMarkReady}>Bulk mark ready</Button>
            <Button size="sm" variant="outline" onClick={exportCSV}>Export selected CSV</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 w-8">
                <Checkbox
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="p-2">Created / ID</th>
              <th className="p-2">Vehicle</th>
              <th className="p-2">Rego / VIN</th>
              <th className="p-2">Supplier / Invoice</th>
              <th className="p-2">Acq. cost</th>
              <th className="p-2">Status / Audit</th>
              <th className="p-2">Manual fields</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No trades match.</td></tr>
            )}
            {filtered.map((t) => {
              const e = editing[t.id] ?? { stock: t.easycars_stock_number_manual ?? '', note: t.easycars_post_note ?? '' };
              const isReady = t.easycars_post_status === 'manual_ready';
              const isPosted = t.easycars_post_status === 'manual_posted';
              const readyH = ageHours(t.easycars_ready_at);
              const stale1 = isReady && readyH != null && readyH > 24;
              const stale3 = isReady && readyH != null && readyH > 72;
              const rowCls = stale3 ? 'bg-destructive/10' : stale1 ? 'bg-amber-500/10' : isReady ? 'bg-amber-500/5' : '';
              return (
                <tr key={t.id} className={`border-t align-top ${rowCls}`}>
                  <td className="p-2"><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSel(t.id)} /></td>
                  <td className="p-2 whitespace-nowrap">
                    <div className="text-xs">{fmt(t.created_at)}</div>
                    <button
                      className="text-xs font-mono text-muted-foreground hover:text-foreground"
                      onClick={() => copyText(t.id, 'trade id')}
                      title="Copy trade id"
                    >
                      {t.id.slice(0, 8)}…
                    </button>
                  </td>
                  <td className="p-2">{vehicleLabel(t)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{t.rego ?? '—'}</span>
                      {t.rego && <button onClick={() => copyText(t.rego!, 'rego')}><Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" /></button>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">{t.vin ?? '—'}</span>
                      {t.vin && <button onClick={() => copyText(t.vin!, 'VIN')}><Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" /></button>}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <span>{t.dealer_name ?? '—'}</span>
                      {t.dealer_name && <button onClick={() => copyText(t.dealer_name!, 'supplier')}><Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" /></button>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="font-mono">{t.invoice_number ?? '—'}</span>
                      {t.invoice_number && <button onClick={() => copyText(t.invoice_number!, 'invoice')}><Copy className="h-3 w-3" /></button>}
                    </div>
                    <div className="text-xs text-muted-foreground">{t.invoice_date ?? ''}</div>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {t.sell_price_inc_gst != null ? (
                      <button className="hover:text-primary" onClick={() => copyText(String(t.sell_price_inc_gst), 'cost')}>
                        ${Number(t.sell_price_inc_gst).toLocaleString()}
                      </button>
                    ) : '—'}
                  </td>
                  <td className="p-2 space-y-1">
                    {statusBadge(t.easycars_post_status)}
                    {isReady && (
                      <div className={`text-xs ${stale3 ? 'text-destructive font-medium' : stale1 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                        Age: {ageLabel(readyH)}{stale3 ? ' (>3d!)' : stale1 ? ' (>1d)' : ''}
                      </div>
                    )}
                    {t.easycars_ready_at && (
                      <div className="text-xs text-muted-foreground">
                        Ready: {fmt(t.easycars_ready_at)}<br />
                        by {t.easycars_ready_by}
                      </div>
                    )}
                    {t.easycars_posted_at && (
                      <div className="text-xs text-muted-foreground">
                        Posted: {fmt(t.easycars_posted_at)}<br />
                        by {t.easycars_posted_by}
                      </div>
                    )}
                  </td>
                  <td className="p-2 space-y-1 min-w-[200px]">
                    {isPosted ? (
                      <>
                        <div className="text-xs"><span className="text-muted-foreground">Stock:</span> {t.easycars_stock_number_manual ?? '—'}</div>
                        {t.easycars_post_note && <div className="text-xs"><span className="text-muted-foreground">Note:</span> {t.easycars_post_note}</div>}
                      </>
                    ) : (
                      <>
                        <Input
                          placeholder="EasyCars stock #"
                          value={e.stock}
                          onChange={(ev) => setEditing((s) => ({ ...s, [t.id]: { ...e, stock: ev.target.value } }))}
                          className="h-8"
                        />
                        <Textarea
                          placeholder="Note (optional)"
                          value={e.note}
                          onChange={(ev) => setEditing((s) => ({ ...s, [t.id]: { ...e, note: ev.target.value } }))}
                          rows={2}
                          className="text-xs"
                        />
                      </>
                    )}
                  </td>
                  <td className="p-2 space-y-1 whitespace-nowrap">
                    {t.easycars_post_status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" className="w-full" onClick={() => markReady(t)}>Mark ready</Button>
                        <Button size="sm" className="w-full" onClick={() => markPosted(t)}>Mark posted</Button>
                      </>
                    )}
                    {isReady && (
                      <>
                        <Button size="sm" className="w-full" onClick={() => markPosted(t)}>Mark posted</Button>
                        <Button size="sm" variant="ghost" className="w-full" onClick={() => revert(t)}>Revert</Button>
                      </>
                    )}
                    {isPosted && (
                      <Button size="sm" variant="ghost" className="w-full" onClick={() => revert(t)}>Revert</Button>
                    )}
                    <Button size="sm" variant="ghost" className="w-full" onClick={() => copyText(buildStockPayload(t), 'stock payload')}>
                      <Copy className="h-3 w-3" /> Payload
                    </Button>
                    <Link to={`/operator/trades?id=${t.id}`} className="block">
                      <Button size="sm" variant="ghost" className="w-full">
                        <ExternalLink className="h-3 w-3" /> Open
                      </Button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EasyCarsPostingPage() {
  return (
    <OperatorGuard>
      <EasyCarsPostingPageInner />
    </OperatorGuard>
  );
}
