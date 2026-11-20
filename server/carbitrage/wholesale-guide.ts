import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
  /** Set when the floor did not come from the exact plate year, so the dealer is told plainly. */
  floor_basis_note: string | null;
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
    floor_basis_note: v.floor_basis && v.floor_basis !== "exact_year" ? (v.floor_basis_note ?? "The floor did not come from the exact plate year.") : null,
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
  /** Where answers are kept between restarts, so the key's 60-an-hour limit is not burned on repeat lookups. */
  cacheFile?: string;
}

/** The public /api/v1/valuation answer, as far as the guide needs it. */
interface ApiValuation {
  status?: string;
  floor?: number | null;
  floor_car?: { title?: string; badge?: string; price_ex_gov: number; year: number; km: number; state?: string | null; url?: string | null; drivetrain?: string | null } | null;
  floor_comps?: Array<{ title?: string; badge?: string; price_ex_gov: number; year: number; km: number; state?: string | null; url?: string | null; drivetrain?: string | null }>;
  buying_view?: { thinking?: number | null; cautious?: number | null } | null;
  confidence?: string | { score: number; label: string };
  provisional?: boolean;
  needs_live_search?: boolean;
  floor_basis?: string | null;
  floor_basis_note?: string | null;
  quality_flags?: { weak_floor_reasons?: string[] } | null;
  year_below?: EngineValuation["year_below"];
  outlier_ads?: EngineValuation["outlier_ads"];
  engine?: string;
  job_id?: string;
}

const CONFIDENCE_SCORE: Record<string, number> = { high: 85, medium: 60, low: 30 };

/** Turns the public API answer into the value_car shape that mapGuide reads. The API has no km-adjusted figures, so those stay null. */
export function fromApiValuation(a: ApiValuation | EngineValuation): EngineValuation {
  if (!("floor_comps" in a) && !("buying_view" in a)) return a as EngineValuation;
  const v = a as ApiValuation;
  const ad = (x: NonNullable<ApiValuation["floor_car"]>) => ({
    title: x.title ?? null, year: x.year, badge: x.badge ?? null, km: x.km, price_ex_gov: x.price_ex_gov, km_adjusted_price: null,
    state: x.state ?? null, link: x.url ?? null, drivetrain: x.drivetrain ?? null, match: "exact_spec",
  });
  const label = typeof v.confidence === "string" ? v.confidence : v.confidence?.label ?? "low";
  return {
    status: v.status,
    floor_car: v.floor_car ? ad(v.floor_car) : null,
    comps: (v.floor_comps ?? []).map(ad),
    buy_target: v.buying_view?.cautious ?? null,
    max_buy: v.buying_view?.thinking ?? null,
    confidence: typeof v.confidence === "object" && v.confidence ? v.confidence : { score: CONFIDENCE_SCORE[label] ?? 30, label },
    provisional: v.provisional,
    needs_live_search: v.needs_live_search,
    floor_basis: v.floor_basis ?? null,
    floor_basis_note: v.floor_basis_note ?? (v.floor_basis && v.floor_basis !== "exact_year" ? (v.quality_flags?.weak_floor_reasons?.[0] ?? null) : null),
    year_below: v.year_below ?? null,
    outlier_ads: v.outlier_ads ?? [],
    engine: v.engine,
    job_id: v.job_id,
  };
}

const CACHE_TTL_MS = 6 * 3600_000;
const MAX_CALLS_PER_HOUR = 20; // well under the key's 60 an hour
const memory = new Map<string, { at: number; raw: unknown }>();
const callTimes: number[] = [];

function readCache(file: string | undefined): Record<string, { at: number; raw: unknown }> {
  if (!file || !existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")) as Record<string, { at: number; raw: unknown }>; } catch { return {}; }
}

function writeCache(file: string | undefined, key: string, entry: { at: number; raw: unknown }): void {
  if (!file) return;
  const all = readCache(file);
  all[key] = entry;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
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
  // Cars before 2020 start a paid live Carsales search on this key's route, so the preview holds them instead of asking.
  if (cfg && car.year >= 2020) {
    const cacheKey = [car.year, car.make, car.model, car.badge, car.km, car.state, ownAd?.link ?? "", ownAd?.price ?? ""].join("|").toLowerCase();
    const now = Date.now();
    const hit = memory.get(cacheKey) ?? readCache(cfg.cacheFile)[cacheKey];
    if (hit && now - hit.at < CACHE_TTL_MS) {
      memory.set(cacheKey, hit);
      return { valuation: fromApiValuation(hit.raw as ApiValuation), source: "market_api" };
    }
    while (callTimes.length && now - callTimes[0] > 3600_000) callTimes.shift();
    if (callTimes.length >= MAX_CALLS_PER_HOUR) throw new Error("market_api_preview_call_cap");
    callTimes.push(now);
    const key = readFileSync(cfg.keyFile, "utf8").trim();
    const qs = new URLSearchParams({ year: String(car.year), make: car.make, model: car.model, badge: car.badge, km: String(car.km), state: car.state });
    if (ownAd?.link) qs.set("link", ownAd.link);
    if (ownAd?.price) qs.set("price", String(ownAd.price));
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/api/v1/valuation?${qs.toString()}`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" } });
    if (!res.ok) throw new Error(`market_api_${res.status}`);
    const raw = (await res.json()) as ApiValuation;
    const entry = { at: now, raw };
    memory.set(cacheKey, entry);
    writeCache(cfg.cacheFile, cacheKey, entry);
    return { valuation: fromApiValuation(raw), source: "market_api" };
  }
  const file = FIXTURES[car.fixture];
  if (!file) throw new Error("unknown_fixture");
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8")) as EngineValuation;
  return { valuation: raw, source: car.fixture === "macan-recorded" ? "recorded_fixture" : "sample_fixture" };
}
