import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorGuard } from '@/components/guards/OperatorGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

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
];

function fmt(ts: string | null) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function vehicleLabel(t: Trade) {
  return [t.year, t.make, t.model, t.variant].filter(Boolean).join(' ') || '—';
}

function statusBadge(s: string) {
  if (s === 'manual_posted') return <Badge className="bg-green-600">Posted (manual)</Badge>;
  if (s === 'manual_ready') return <Badge className="bg-amber-600">Ready</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

function EasyCarsPostingPageInner() {
  const [tab, setTab] = useState<string>('pending');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Record<string, { stock: string; note: string }>>({});
  const [userLabel, setUserLabel] = useState<string>('operator');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserLabel(data.user.email ?? data.user.id);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('trades')
      .select('id,invoice_number,invoice_date,dealer_name,vin,rego,year,make,model,variant,stock_number,sell_price_inc_gst,easycars_post_status,easycars_ready_at,easycars_ready_by,easycars_posted_at,easycars_posted_by,easycars_stock_number_manual,easycars_post_note,created_at')
      .eq('easycars_post_status', tab)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setTrades((data as Trade[]) ?? []);
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

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
    const e = editing[t.id] ?? { stock: '', note: '' };
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

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">EasyCars Posting (Manual)</h1>
          <p className="text-sm text-muted-foreground">
            Fallback workflow while EasyCars write access is unresolved. Status here is operator-recorded, not automated.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
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

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2">Invoice</th>
              <th className="p-2">Vehicle</th>
              <th className="p-2">VIN / Rego</th>
              <th className="p-2">Dealer</th>
              <th className="p-2">Price</th>
              <th className="p-2">Status</th>
              <th className="p-2">Manual fields</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No trades in this state.</td></tr>
            )}
            {trades.map((t) => {
              const e = editing[t.id] ?? { stock: t.easycars_stock_number_manual ?? '', note: t.easycars_post_note ?? '' };
              return (
                <tr key={t.id} className="border-t align-top">
                  <td className="p-2">
                    <div className="font-mono">{t.invoice_number ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{fmt(t.invoice_date)}</div>
                  </td>
                  <td className="p-2">{vehicleLabel(t)}</td>
                  <td className="p-2">
                    <div className="font-mono text-xs">{t.vin ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{t.rego ?? '—'}</div>
                  </td>
                  <td className="p-2">{t.dealer_name ?? '—'}</td>
                  <td className="p-2">{t.sell_price_inc_gst != null ? `$${Number(t.sell_price_inc_gst).toLocaleString()}` : '—'}</td>
                  <td className="p-2 space-y-1">
                    {statusBadge(t.easycars_post_status)}
                    {t.easycars_ready_at && <div className="text-xs text-muted-foreground">Ready: {fmt(t.easycars_ready_at)}<br/>by {t.easycars_ready_by}</div>}
                    {t.easycars_posted_at && <div className="text-xs text-muted-foreground">Posted: {fmt(t.easycars_posted_at)}<br/>by {t.easycars_posted_by}</div>}
                  </td>
                  <td className="p-2 space-y-1 min-w-[200px]">
                    {tab === 'manual_posted' ? (
                      <>
                        <div className="text-xs"><span className="text-muted-foreground">Stock:</span> {t.easycars_stock_number_manual ?? '—'}</div>
                        <div className="text-xs"><span className="text-muted-foreground">Note:</span> {t.easycars_post_note ?? '—'}</div>
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
                    {t.easycars_post_status === 'manual_ready' && (
                      <>
                        <Button size="sm" className="w-full" onClick={() => markPosted(t)}>Mark posted</Button>
                        <Button size="sm" variant="ghost" className="w-full" onClick={() => revert(t)}>Revert</Button>
                      </>
                    )}
                    {t.easycars_post_status === 'manual_posted' && (
                      <Button size="sm" variant="ghost" className="w-full" onClick={() => revert(t)}>Revert to pending</Button>
                    )}
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
