/**
 * Trading Desk data source. Old /auth admins keep the direct calls (existing server rules).
 * Ooglecars portal sign-ins go through the operator-desk gateway, which verifies the token and
 * limits every read and write to the caller's own yard(s). The browser never sends its yard.
 */
import { supabase } from '@/integrations/supabase/client';
import { needsManheimEnd, withManheimEnd } from '../../../supabase/functions/_shared/deskFreshness';

const GATEWAY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/operator-desk`;
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export type DeskWhoami = { owner: boolean; desk: boolean; has_membership: boolean; accounts: { id: string; display_name: string }[] };
export type DeskPatch = { status?: string; is_starred?: boolean; reminder_at?: string | null; assigned_to_account?: string };

export async function callDeskGateway<T>(portalToken: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, 'x-portal-token': portalToken },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Desk request failed (${res.status})`);
  return data as T;
}

export interface DeskData {
  gateway: boolean;
  list(accountId: string): Promise<{ opportunities: any[]; accounts: { id: string; display_name: string }[] }>;
  update(id: string, patch: DeskPatch): Promise<void>;
}

const ACTIONABLE_STATUSES = ['new', 'assigned', 'reviewed'];

export const directDeskData: DeskData = {
  gateway: false,
  async list(filterAccount) {
    const scoped = filterAccount !== 'all';
    const freshFloor = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const activeQuery = supabase.from('operator_opportunities').select('*').in('status', ACTIONABLE_STATUSES).gte('created_at', freshFloor).order('created_at', { ascending: false }).limit(scoped ? 1000 : 500);
    const starredQuery = supabase.from('operator_opportunities').select('*').eq('is_starred', true).not('status', 'in', '("new","assigned","reviewed")').limit(scoped ? 500 : 100);
    if (scoped) { activeQuery.eq('best_account_id', filterAccount); starredQuery.eq('best_account_id', filterAccount); }
    const [oppsRes, starredRes, acctsRes] = await Promise.all([activeQuery, starredQuery, supabase.from('accounts').select('id, display_name')]);
    if (oppsRes.error) throw oppsRes.error;
    const activeIds = new Set((oppsRes.data || []).map((o: any) => o.id));
    let opportunities: any[] = [...(oppsRes.data || []), ...((starredRes.data || []).filter((o: any) => !activeIds.has(o.id)))];
    // Manheim lots have no per-lot end: use the sale close from the latest manheim coverage row (never over a real end).
    const missing = opportunities.filter(needsManheimEnd);
    if (missing.length) {
      try {
        const lids = [...new Set(missing.map((o) => o.listing_id).filter(Boolean))].slice(0, 300);
        const [cov, lst] = await Promise.all([
          (supabase as any).from('source_coverage').select('sales').eq('source', 'manheim').not('sales', 'is', null).order('date', { ascending: false }).limit(1),
          lids.length ? supabase.from('vehicle_listings').select('listing_id, auction_datetime, event_id, auction_location, location').in('listing_id', lids) : Promise.resolve({ data: [] as any[] }),
        ]);
        const sales = cov.data?.[0]?.sales;
        if (Array.isArray(sales)) {
          const byId = Object.fromEntries(((lst as any).data ?? []).map((l: any) => [l.listing_id, l]));
          opportunities = opportunities.map((o) => withManheimEnd(o, byId[o.listing_id], sales));
        }
      } catch { /* leave ends blank */ }
    }
    return {
      opportunities,
      accounts: (acctsRes.data || []) as { id: string; display_name: string }[],
    };
  },
  async update(id, patch) {
    const { error } = await supabase.from('operator_opportunities').update({ ...patch, updated_at: new Date().toISOString() } as any).eq('id', id);
    if (error) throw error;
  },
};

/** Gateway actions. Cross-yard ones (score, send, anchors, finds) are refused by the server unless the caller is the owner. */
export interface GatewayDeskData extends DeskData {
  gateway: true;
  call<T = unknown>(action: string, body?: Record<string, unknown>): Promise<T>;
}

export function gatewayDeskData(getToken: () => Promise<string | null>): GatewayDeskData {
  const token = async () => { const t = await getToken(); if (!t) throw new Error('Signed out'); return t; };
  const call = async <T,>(action: string, body: Record<string, unknown> = {}) => callDeskGateway<T>(await token(), { ...body, action });
  return {
    gateway: true,
    call,
    async list(accountId) { return call('list', { account_id: accountId }); },
    async update(id, patch) { await call('update', { id, patch }); },
  };
}

export const isGateway = (d: DeskData | null | undefined): d is GatewayDeskData => !!d && d.gateway === true;
