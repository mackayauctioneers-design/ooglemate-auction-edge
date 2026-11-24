// Carsales "well below market" strip for the Trading Desk.
// Owner-only for now; may become a paid dealer feature. Portal sign-ins go through the operator-desk
// `wbm_list` action, which the server refuses (403) for yard owners. Renders nothing when there is no fresh data.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { GatewayDeskData } from '@/pages/operator/deskData';

type Wbm = { id: string; year: number | null; make: string | null; model: string | null; asking_price: number | null; price_difference: number | null; listing_url: string | null };

async function loadDirect(): Promise<Wbm[]> {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data } = await supabase.from('retail_listings')
    .select('id, year, make, model, asking_price, price_difference, listing_url')
    .eq('source', 'carsales').ilike('price_badge', '%below market%').is('delisted_at', null).gte('last_seen_at', since)
    .order('price_difference', { ascending: false, nullsFirst: false }).limit(12);
  return (data ?? []) as Wbm[];
}

export function WbmStrip({ data }: { data: GatewayDeskData | null }) {
  const [rows, setRows] = useState<Wbm[]>([]);
  useEffect(() => {
    let live = true;
    (data ? data.call<{ listings: Wbm[] }>('wbm_list').then((r) => r.listings ?? []) : loadDirect())
      .then((r) => { if (live) setRows(r); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [data]);
  if (!rows.length) return null;
  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b border-border px-2 py-1 text-xs" aria-label="Carsales well below market">
      <span className="shrink-0 font-semibold text-muted-foreground">Carsales WBM</span>
      {rows.map((r) => (
        <a key={r.id} href={r.listing_url ?? undefined} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-foreground hover:text-primary">
          {r.year} {r.make} {r.model}
          {r.asking_price != null && <span className="font-mono">${Math.round(r.asking_price).toLocaleString('en-AU')}</span>}
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}
