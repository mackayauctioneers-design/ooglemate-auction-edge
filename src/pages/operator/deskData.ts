/**
 * Trading Desk data source. Old /auth admins keep the direct calls (existing server rules).
 * Ooglecars portal sign-ins go through the operator-desk gateway, which verifies the token and
 * limits every read and write to the caller's own yard(s). The browser never sends its yard.
 */
import { supabase } from '@/integrations/supabase/client';

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
    return {
      opportunities: [...(oppsRes.data || []), ...((starredRes.data || []).filter((o: any) => !activeIds.has(o.id)))],
      accounts: (acctsRes.data || []) as { id: string; display_name: string }[],
    };
  },
  async update(id, patch) {
    const { error } = await supabase.from('operator_opportunities').update({ ...patch, updated_at: new Date().toISOString() } as any).eq('id', id);
    if (error) throw error;
  },
};

export function gatewayDeskData(getToken: () => Promise<string | null>): DeskData {
  const token = async () => { const t = await getToken(); if (!t) throw new Error('Signed out'); return t; };
  return {
    gateway: true,
    async list(accountId) { return callDeskGateway(await token(), { action: 'list', account_id: accountId }); },
    async update(id, patch) { await callDeskGateway(await token(), { action: 'update', id, patch }); },
  };
}
