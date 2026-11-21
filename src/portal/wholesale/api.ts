/* Client for the preview wholesale API. Field names follow the real wholesale_tenders / wholesale_bids columns
   where they appear (public_code, seller_notes, value_car_floor_cents, amount_cents). */
import { useCallback, useEffect, useState } from "react";
import { apiUrl, authHeaders, fetchCredentials } from "../runtime";

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
  /** Where the figures came from: shown under each guide. */
  source?: "market_api" | "recorded_fixture" | "sample_fixture";
  live_check?: { state: "checking" | "done" | "gave_up"; eta_seconds: number | null; poll_after_s: number } | null;
  outlier_ads: Array<{ price_ex_gov: number; year: number; km: number; link: string | null; gap_pct: number | null; note: string | null }>;
}
export interface CarInfo {
  rego: string; state: string; year: number; make: string; model: string; badge: string; km?: number; odometerKm?: number;
  body?: string | null; colour?: string | null; transmission?: string | null; vinMasked?: string | null; notes: string | null;
}
export interface Me { dealer: { id: string; name: string } | null; buyer: { id: string; name: string } | null }
export interface GuideReply { held: boolean; reason: string | null; guide: Guide | null; source: string; engine: string | null; route: string | null; freshExactYearAds: number | null; car: CarInfo & { km: number } }
export interface CarParams {
  rego: string; km: number; badge: string; year: string; make: string; model: string; state: string;
  /** Optional Carsales (or other) advert for this car. Sent so that ad is left out of the buyer guide. */
  adLink: string;
  /** Asking price on that advert, digits only. */
  asking: string;
}
export interface Info { mode: "preview" | "live"; valuationSource: "market_api" | "recorded"; dealer: { name: string }; manualEntry?: boolean; testCars: Array<{ rego: string; label: string; km: number }> }
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
export interface BuyerAlert { id: string; at: string; code: string; text: string }
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
    const bearer = await authHeaders();
    res = await fetch(apiUrl(`/api/wholesale${path}`), {
      method: init?.method ?? "GET", credentials: fetchCredentials,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...bearer },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new WholesaleApiError(0, "network", "The preview server is not reachable.");
  }
  const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) throw new WholesaleApiError(res.status, json.code ?? "error", json.message ?? "Request failed");
  return json as T;
}

function carBody(p: Partial<CarParams> & { km: number }) {
  const out: Record<string, unknown> = { km: p.km };
  for (const k of ["rego", "badge", "make", "model", "state"] as const) if (p[k]) out[k] = p[k];
  if (p.year) out.year = Number(p.year);
  if (p.adLink) out.adLink = p.adLink;
  const asking = Number((p.asking ?? "").replace(/[^0-9]/g, ""));
  if (asking > 0) out.askingPrice = asking;
  return out;
}

export const wholesaleApi = {
  info: () => call<Info>("/info"),
  buyers: () => call<{ buyers: Buyer[] }>("/buyers"),
  lookup: (rego: string) => call<{ car: CarInfo }>("/lookup", { method: "POST", body: { rego } }),
  me: () => call<Me>("/me"),
  guide: (p: Partial<CarParams> & { km: number }) => call<GuideReply>("/guide", { method: "POST", body: carBody(p) }),
  send: (input: Partial<CarParams> & { km: number; buyerIds: string[] | "all"; note: string }) =>
    call<{ code: string; sentTo: number }>("/send", { method: "POST", body: { ...carBody(input), buyerIds: input.buyerIds, note: input.note } }),
  request: (code: string) => call<RequestView>(`/requests/${encodeURIComponent(code)}`),
  requests: () => call<{ requests: RequestView[] }>("/requests"),
  pick: (code: string, bidId: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(code)}/pick`, { method: "POST", body: { bidId } }),
  keep: (code: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(code)}/keep`, { method: "POST", body: {} }),
  collected: (code: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(code)}/collected`, { method: "POST", body: {} }),
  updates: () => call<{ updates: DealerUpdate[] }>("/updates"),
  buyerList: () => call<{ buyers: Buyer[] }>("/buyer/list"),
  // `as` is the preview-only buyer picker. Empty when signed in for real: the server then uses the buyer's own sign-in.
  buyerCars: (as: string) => call<{ buyer: Buyer; cars: BuyerCar[] }>(`/buyer/cars${as ? `?as=${encodeURIComponent(as)}` : ""}`),
  buyerPrice: (as: string, code: string, amountDollars: number, note?: string) =>
    call<{ ok: true }>("/buyer/price", { method: "POST", body: { ...(as ? { as } : {}), code, amountDollars, note } }),
  buyerAlerts: (as: string) => call<{ alerts: BuyerAlert[] }>(`/buyer/alerts${as ? `?as=${encodeURIComponent(as)}` : ""}`),
  buyerHistory: (as: string) => call<{ rows: HistoryRow[] }>(`/buyer/history${as ? `?as=${encodeURIComponent(as)}` : ""}`),
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
