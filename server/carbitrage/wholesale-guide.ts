import { readFileSync } from "node:fs";

/**
 * Carbitrage guide for a wholesale request. One place that turns the market engine's valuation
 * (the value_car / /api/v1/valuation own-floor shape) into the guide stored on a tender.
 * The mapping is the same one used for wholesale_tenders.value_car_snapshot:
 *   thinking = max_buy, cautious = buy_target, comps = exact plate year only, floor car left out of the list,
 *   the cheapest year-below ad is reference only, outlier ads are "possible buy" lines and never set the floor.
 */

export interface EngineAd {
  title?: string | null;
  link?: string | null;
  price_ex_gov: number;
  km_adjusted_price?: number | null;
  km: number | null;
  year: number | null;
  drivetrain?: string | null;
  series?: string | null;
  badge?: string | null;
  match?: string | null;
  state?: string | null;
}

export interface EngineValuation {
  status?: string;
  floor_car?: (EngineAd & { badge?: string | null }) | null;
  comps?: EngineAd[];
  buy_target?: number | null;
  max_buy?: number | null;
  confidence?: { score: number; label: string } | null;
  provisional?: boolean;
  needs_live_search?: boolean;
  floor_basis?: string | null;
  floor_basis_note?: string | null;
  route?: string;
  engine?: string;
  car?: { year: number | null };
  year_below?: { price_ex_gov: number; year: number; km: number; link: string | null; source?: string; note?: string } | null;
  outlier_ads?: Array<{
    price_ex_gov: number; year: number; km: number; link: string | null; source?: string; gap_pct?: number;
    sets_floor_if_trusted?: boolean; note?: string;
  }>;
  own_ad_excluded?: unknown;
  n_exact_year?: number;
  job_id?: string;
}

export interface GuideAd {
  title: string | null;
  year: number | null;
  badge: string | null;
  series: string | null;
  drivetrain: string | null;
  km: number | null;
  price_ex_gov: number;
  km_adjusted_price: number | null;
  state: string | null;
  link: string | null;
  match: string | null;
}

export interface Guide {
  version: string;
  floor_car: GuideAd;
  floor_dollars: number;
  buy_target: number | null;
  max_buy: number | null;
  thinking: number | null;
  cautious: number | null;
  confidence: { score: number; label: string };
  provisional: boolean;
  thin_evidence: null;
  state: string | null;
  comps: GuideAd[];
  generated_at: string;
  floor_basis: string | null;
  year_below: { price_ex_gov: number; year: number; km: number; link: string | null; source?: string; note?: string } | null;
  outlier_ads: Array<{ price_ex_gov: number; year: number; km: number; link: string | null; gap_pct: number | null; note: string | null }>;
}

const VERSION = "vc-2026-11-19.1";

function ad(x: EngineAd): GuideAd {
  return {
    title: x.title ?? null, year: x.year, badge: x.badge ?? null, series: x.series ?? null, drivetrain: x.drivetrain ?? null,
    km: x.km, price_ex_gov: x.price_ex_gov, km_adjusted_price: x.km_adjusted_price ?? null, state: x.state ?? null,
    link: x.link ?? null, match: x.match ?? null,
  };
}

/** Null when the engine has no usable floor. A car is held, never sent, in that case. */
export function mapGuide(v: EngineValuation, plateYear: number, now: Date): Guide | null {
  const floor = v.floor_car;
  if (v.status === "pending" || v.status === "no_floor") return null;
  if (!floor || !(floor.price_ex_gov > 0)) return null;
  const comps = (v.comps ?? [])
    .filter((c) => c.year === plateYear && c.link !== floor.link)
    .slice(0, 5)
    .map((c) => ad({ ...c, badge: null }));
  const floorAd = ad(floor);
  floorAd.match = null;
  return {
    version: VERSION,
    floor_car: floorAd,
    floor_dollars: floor.price_ex_gov,
    buy_target: v.buy_target ?? null,
    max_buy: v.max_buy ?? null,
    thinking: v.max_buy ?? null,
    cautious: v.buy_target ?? null,
    confidence: v.confidence ?? { score: 0, label: "low" },
    provisional: Boolean(v.provisional),
    thin_evidence: null,
    state: null,
    comps,
    generated_at: now.toISOString(),
    floor_basis: v.floor_basis ?? null,
    year_below: v.year_below ?? null,
    outlier_ads: (v.outlier_ads ?? [])
      .filter((o) => o.sets_floor_if_trusted !== false)
      .slice(0, 2)
      .map((o) => ({ price_ex_gov: o.price_ex_gov, year: o.year, km: o.km, link: o.link, gap_pct: o.gap_pct ?? null, note: o.note ?? null })),
  };
}

export interface MarketApiConfig {
  baseUrl: string;
  keyFile: string;
}

export interface CarSpec {
  year: number; make: string; model: string; badge: string; km: number; state: string; rego?: string; fixture: string;
}

const FIXTURES: Record<string, string> = {
  "macan-recorded": "wholesale-macan-recorded-20261120.json",
  "rav4-sample": "wholesale-rav4-sample.json",
  "captiva-held": "wholesale-captiva-held.json",
};

export interface ValuationResult {
  valuation: EngineValuation;
  source: "market_api" | "recorded_fixture" | "sample_fixture";
}

/**
 * Live: read-only GET /api/v1/valuation on the Carbitrage Market API, with the key read from a file at request time
 * (never logged, never returned). Needs CARBITRAGE_MARKET_API_URL and CARBITRAGE_MARKET_API_KEY_FILE.
 * Otherwise the preview uses the recorded or sample engine output for the test car.
 * The dealer's own ad is excluded by passing the ad link or price with the call, when known.
 */
export async function fetchValuation(car: CarSpec, cfg: MarketApiConfig | null, ownAd?: { link?: string; price?: number }): Promise<ValuationResult> {
  if (cfg) {
    const key = readFileSync(cfg.keyFile, "utf8").trim();
    const qs = new URLSearchParams({ year: String(car.year), make: car.make, model: car.model, badge: car.badge, km: String(car.km), state: car.state });
    if (ownAd?.link) qs.set("link", ownAd.link);
    if (ownAd?.price) qs.set("price", String(ownAd.price));
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/api/v1/valuation?${qs.toString()}`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" } });
    if (!res.ok) throw new Error(`market_api_${res.status}`);
    return { valuation: (await res.json()) as EngineValuation, source: "market_api" };
  }
  const file = FIXTURES[car.fixture];
  if (!file) throw new Error("unknown_fixture");
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8")) as EngineValuation;
  return { valuation: raw, source: car.fixture === "macan-recorded" ? "recorded_fixture" : "sample_fixture" };
}
