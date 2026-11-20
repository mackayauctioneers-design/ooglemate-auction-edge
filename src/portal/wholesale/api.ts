/* Client for the preview wholesale API. Field names follow the real wholesale_tenders / wholesale_bids columns
   where they appear (public_code, seller_notes, value_car_floor_cents, amount_cents). */
import { useCallback, useEffect, useState } from "react";

export interface GuideAd {
  title: string | null; year: number | null; badge: string | null; series: string | null; drivetrain: string | null;
  km: number | null; price_ex_gov: number; km_adjusted_price: number | null; state: string | null; link: string | null; match: string | null;
}
export interface Guide {
  version: string;
  floor_car: GuideAd;
  floor_dollars: number;
  buy_target: number | null; max_buy: number | null; thinking: number | null; cautious: number | null;
  confidence: { score: number; label: string };
  provisional: boolean;
  comps: GuideAd[];
  generated_at: string;
  floor_basis: string | null;
  floor_basis_note: string | null;
  year_below: { price_ex_gov: number; year: number; km: number; link: string | null } | null;
  outlier_ads: Array<{ price_ex_gov: number; year: number; km: number; link: string | null; gap_pct: number | null; note: string | null }>;
}
export interface CarInfo {
  rego: string; state: string; year: number; make: string; model: string; badge: string; km?: number; odometerKm?: number;
  body?: string | null; colour?: string | null; transmission?: string | null; vinMasked?: string | null; notes: string | null;
}
export interface GuideReply { held: boolean; reason: string | null; guide: Guide | null; source: string; engine: string | null; route: string | null; freshExactYearAds: number | null; car: CarInfo & { km: number } }
export interface Info { mode: "preview"; valuationSource: "market_api" | "recorded"; dealer: { name: string; state: string }; testCars: Array<{ rego: string; label: string; km: number }> }
export interface Buyer { id: string; name: string }
export interface PriceRow { bidId: string; buyerId: string; name: string; amountCents: number; note: string | null; at: string }
export interface Person { business: string; person: string; phone: string | null; email: string; address?: string }
export interface RequestView {
  code: string; status: string; outcome: string | null;
  car: { rego: string; year: number; make: string; model: string; badge: string; km: number; state: string };
  floorCents: number | null; note: string | null;
  sentTo: Buyer[]; prices: PriceRow[]; waiting: Buyer[];
  acceptedBidId: string | null; buyerOfRecord: string | null; finalSaleCents: number | null; createdAt: string;
  guide?: Guide | null; buyer?: Person | null; dealer?: Person;
}
export interface DealerUpdate { at: string; rego: string; car: string; status: "held" | "waiting" | "prices" | "picked" | "handover"; text: string }
export interface BuyerCar {
  code: string; year: number; make: string; model: string; badge: string; km: number; state: string; sellerLabel: string; franchise: boolean;
  note: string | null; guide: Guide | null; myPriceCents: number | null; locked: boolean;
}
export type PriceOutcome = "picked" | "not_picked" | "open" | "dealer_kept";
export interface HistoryRow {
  ref: string; year: number; make: string; model: string; badge: string; km: number; state: string; sellerLabel: string; franchise: boolean;
  events: Array<{ amount: number; at: string; note: string | null }>; outcome: PriceOutcome; outcomeAt: string | null;
}

export class WholesaleApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/wholesale${path}`, {
      method: init?.method ?? "GET", credentials: "include",
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new WholesaleApiError(0, "network", "The preview server is not reachable.");
  }
  const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) throw new WholesaleApiError(res.status, json.code ?? "error", json.message ?? "Request failed");
  return json as T;
}

export const wholesaleApi = {
  info: () => call<Info>("/info"),
  buyers: () => call<{ buyers: Buyer[] }>("/buyers"),
  lookup: (rego: string) => call<{ car: CarInfo }>("/lookup", { method: "POST", body: { rego } }),
  guide: (rego: string, km: number, badge?: string) => call<GuideReply>("/guide", { method: "POST", body: { rego, km, badge } }),
  send: (input: { rego: string; km: number; badge?: string; buyerIds: string[] | "all"; note: string }) =>
    call<{ code: string; sentTo: number }>("/send", { method: "POST", body: input }),
  request: (code: string) => call<RequestView>(`/requests/${encodeURIComponent(code)}`),
  requests: () => call<{ requests: RequestView[] }>("/requests"),
  pick: (code: string, bidId: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(code)}/pick`, { method: "POST", body: { bidId } }),
  keep: (code: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(code)}/keep`, { method: "POST", body: {} }),
  collected: (code: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(code)}/collected`, { method: "POST", body: {} }),
  updates: () => call<{ updates: DealerUpdate[] }>("/updates"),
  buyerList: () => call<{ buyers: Buyer[] }>("/buyer/list"),
  buyerCars: (as: string) => call<{ buyer: Buyer; cars: BuyerCar[] }>(`/buyer/cars?as=${encodeURIComponent(as)}`),
  buyerPrice: (as: string, code: string, amountDollars: number, note?: string) =>
    call<{ ok: true }>("/buyer/price", { method: "POST", body: { as, code, amountDollars, note } }),
  buyerHistory: (as: string) => call<{ rows: HistoryRow[] }>(`/buyer/history?as=${encodeURIComponent(as)}`),
};

export interface Loaded<T> { data: T | null; error: WholesaleApiError | null; loading: boolean; reload: () => void }

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: WholesaleApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    stable().then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => live && setState({ data: null, error: e instanceof WholesaleApiError ? e : new WholesaleApiError(0, "error", String(e)), loading: false }));
    return () => { live = false; };
  }, [stable, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
