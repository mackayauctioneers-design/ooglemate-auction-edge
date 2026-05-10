// compute-market-floor
// Given a vehicle listing, computes floor (max-pay) price, deal score (0–100),
// confidence level, and risk flags from `sold_vehicles` (sales truth) and
// `vehicle_listings` (live supply proxy).
//
// Modes:
//   POST { ...listing }                 → single
//   POST { "listings": [ ...listing ] } → batch
//
// Spec: see brief v1.0 (May 2026).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Constants (env-overridable) ─────────────────────────────────────────────
const num = (k: string, d: number) => {
  const v = Deno.env.get(k);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const MARGIN_TARGET = num("MARGIN_TARGET", 0.12);
const ODOMETER_RATE = num("ODOMETER_RATE", 0.04);
const LOOKBACK_DAYS = num("LOOKBACK_DAYS", 180);
const MIN_COMPS_HIGH = num("MIN_COMPS_FOR_HIGH_CONFIDENCE", 10);
const BUY_THRESHOLD = num("BUY_SCORE_THRESHOLD", 75);
const WATCH_THRESHOLD = num("WATCH_SCORE_THRESHOLD", 50);

const FREIGHT_MAP: Record<string, number> = {
  NSW: 0, VIC: 1000, QLD: 1000, TAS: 1300, WA: 1500, SA: 800, NT: 1500, ACT: 200,
};
const AUCTION_FEE_MAP: Record<string, number> = {
  pickles: 500, manheim: 450, grays: 400, slattery: 450,
  bidsonline: 400, valleyauctions: 400, easyauto: 0, asp: 400,
  gumtree: 0, autotrader: 0, facebook: 0, ultimatecar: 0,
};
const VALID_SOURCES = new Set(Object.keys(AUCTION_FEE_MAP));
const VALID_STATES = new Set(Object.keys(FREIGHT_MAP));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round100 = (v: number) => Math.round(v / 100) * 100;

interface Listing {
  listing_id: string;
  source: string;
  make: string;
  model: string;
  series?: string | null;
  variant?: string | null;
  year: number;
  build_date?: string | null;
  compliance_date?: string | null;
  odometer: number;
  transmission?: string;
  body_type?: string | null;
  colour?: string | null;
  state: string;
  ask_price?: number | null;
  auction_end_time?: string | null;
  days_on_market?: number | null;
  reappeared?: boolean;
  damage_notes?: string | null;
  service_history?: "full" | "partial" | "none" | "unknown";
  dealer_id: string;
}

function validate(l: Partial<Listing>): string[] {
  const errs: string[] = [];
  for (const f of ["listing_id", "source", "make", "model", "year", "odometer", "dealer_id", "state"] as const) {
    if (l[f] == null || l[f] === "") errs.push(`missing:${f}`);
  }
  if (l.source && !VALID_SOURCES.has(l.source)) errs.push(`invalid:source=${l.source}`);
  if (l.state && !VALID_STATES.has(l.state)) errs.push(`invalid:state=${l.state}`);
  return errs;
}

async function fetchComps(sb: any, l: Listing) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const odoLo = Math.round(l.odometer * 0.7);
  const odoHi = Math.round(l.odometer * 1.3);

  let q = sb.from("sold_vehicles")
    .select("sale_price,sale_date,odometer,days_to_sell,margin_achieved,series,variant")
    .eq("dealer_id", l.dealer_id)
    .ilike("make", l.make)
    .ilike("model", l.model)
    .gte("year", l.year - 2).lte("year", l.year + 1)
    .gte("odometer", odoLo).lte("odometer", odoHi)
    .gte("sale_date", since)
    .order("sale_date", { ascending: false })
    .limit(40);

  let { data, error } = await q;
  if (error) throw error;
  let rows = data ?? [];

  // Prefer exact series/variant matches if known
  if (l.series || l.variant) {
    const exact = rows.filter((r: any) =>
      (!l.series || (r.series ?? "").toUpperCase() === l.series.toUpperCase()) &&
      (!l.variant || (r.variant ?? "").toUpperCase() === l.variant.toUpperCase())
    );
    if (exact.length >= 5) rows = exact;
  }

  // Widen if too thin
  if (rows.length < 5) {
    const odoLo2 = Math.round(l.odometer * 0.6);
    const odoHi2 = Math.round(l.odometer * 1.4);
    const { data: wide } = await sb.from("sold_vehicles")
      .select("sale_price,sale_date,odometer,days_to_sell,margin_achieved")
      .eq("dealer_id", l.dealer_id)
      .ilike("make", l.make).ilike("model", l.model)
      .gte("year", l.year - 3).lte("year", l.year + 3)
      .gte("odometer", odoLo2).lte("odometer", odoHi2)
      .gte("sale_date", since)
      .order("sale_date", { ascending: false })
      .limit(40);
    rows = wide ?? rows;
  }
  return rows;
}

async function fetchSupply(sb: any, l: Listing): Promise<number> {
  const { count } = await sb.from("vehicle_listings")
    .select("id", { count: "exact", head: true })
    .ilike("make", l.make).ilike("model", l.model)
    .gte("year", l.year - 1).lte("year", l.year + 1)
    .eq("status", "listed");
  return count ?? 0;
}

function recencyWeight(saleDate: string): number {
  const days = (Date.now() - new Date(saleDate).getTime()) / 86400_000;
  if (days <= 30) return 1.0;
  if (days <= 90) return 0.8;
  return 0.5;
}

function compute(l: Listing, comps: any[], liveSupply: number) {
  const computed_at = new Date().toISOString();

  // Weighted avg sale price + avg odo + avg days_to_sell
  let wSum = 0, priceWeighted = 0, odoSum = 0, dtsSum = 0, dtsN = 0;
  for (const c of comps) {
    const w = recencyWeight(c.sale_date);
    wSum += w;
    priceWeighted += Number(c.sale_price) * w;
    odoSum += Number(c.odometer ?? l.odometer);
    if (c.days_to_sell != null) { dtsSum += Number(c.days_to_sell); dtsN++; }
  }
  const avg_sale_price = wSum > 0 ? priceWeighted / wSum : 0;
  const comps_avg_odo = comps.length > 0 ? odoSum / comps.length : l.odometer;
  const avg_days_to_sell = dtsN > 0 ? dtsSum / dtsN : null;

  const odometer_adjustment = Math.round((comps_avg_odo - l.odometer) * ODOMETER_RATE);
  const freight_penalty = FREIGHT_MAP[l.state] ?? 0;
  const auction_fees = AUCTION_FEE_MAP[l.source] ?? 0;
  const target_margin_amount = Math.round(avg_sale_price * MARGIN_TARGET);
  const floor_raw = avg_sale_price + odometer_adjustment - freight_penalty - auction_fees - target_margin_amount;
  const floor_price = comps.length > 0 ? round100(floor_raw) : 0;

  // Margin sub-score
  const ask = l.ask_price ?? null;
  const raw_margin = ask != null && floor_price > 0 ? floor_price - ask : 0;
  const raw_margin_pct = ask != null && ask > 0 ? raw_margin / ask : 0;
  const margin_score = ask == null || floor_price <= 0
    ? 0
    : clamp((raw_margin_pct / 0.20) * 25, 0, 25);

  // Velocity sub-score
  const velocity_score = avg_days_to_sell == null
    ? 0
    : clamp(((30 - avg_days_to_sell) / 30) * 25, 0, 25);

  // Supply sub-score
  const supply_score = clamp(((10 - liveSupply) / 10) * 25, 0, 25);

  // Confidence sub-score
  const n = comps.length;
  const confidence_score = clamp((n / MIN_COMPS_HIGH) * 25, 0, 25);

  const deal_score = Math.round(margin_score + velocity_score + supply_score + confidence_score);

  const confidence_level: "none" | "low" | "medium" | "high" =
    n === 0 ? "none" : n < 3 ? "low" : n < MIN_COMPS_HIGH ? "medium" : "high";

  // Risk flags
  const risk_flags: string[] = [];
  if (l.odometer > 180_000) risk_flags.push("HIGH_ODOMETER");
  if (l.reappeared) risk_flags.push("REAPPEARED");
  if (n < 3) risk_flags.push("LOW_CONFIDENCE");
  if (freight_penalty >= 1300) risk_flags.push("HIGH_FREIGHT");
  if (l.days_on_market != null && l.days_on_market > 21) risk_flags.push("STALE_LISTING");
  if (l.damage_notes && l.damage_notes.trim() !== "") risk_flags.push("DAMAGE_NOTED");
  if (l.service_history === "none") risk_flags.push("NO_SERVICE_HISTORY");
  if (avg_days_to_sell != null && avg_days_to_sell > 45) risk_flags.push("THIN_MARKET");
  if (ask == null) risk_flags.push("PRICE_UNKNOWN");

  let recommended_action: "buy" | "watch" | "pass";
  if (n === 0) recommended_action = "pass";
  else if (deal_score >= BUY_THRESHOLD) recommended_action = "buy";
  else if (deal_score >= WATCH_THRESHOLD) recommended_action = "watch";
  else recommended_action = "pass";

  return {
    listing_id: l.listing_id,
    computed_at,
    floor_price,
    avg_sale_price: Math.round(avg_sale_price),
    freight_penalty,
    auction_fees,
    target_margin_amount,
    odometer_adjustment,
    raw_margin: Math.round(raw_margin),
    raw_margin_pct: Number(raw_margin_pct.toFixed(4)),
    deal_score,
    score_breakdown: {
      margin: Math.round(margin_score),
      velocity: Math.round(velocity_score),
      supply: Math.round(supply_score),
      confidence: Math.round(confidence_score),
    },
    confidence_level,
    comparables_count: n,
    avg_days_to_sell: avg_days_to_sell == null ? null : Math.round(avg_days_to_sell),
    live_supply_count: liveSupply,
    risk_flags,
    recommended_action,
    buy_ceiling: floor_price,
  };
}

async function processOne(sb: any, l: Listing) {
  const errs = validate(l);
  if (errs.length) return { listing_id: l.listing_id ?? null, error: "validation_failed", details: errs };
  try {
    const [comps, supply] = await Promise.all([fetchComps(sb, l), fetchSupply(sb, l)]);
    return compute(l, comps, supply);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { listing_id: l.listing_id, error: "db_error", message: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (Array.isArray(body?.listings)) {
      const results = await Promise.all(body.listings.map((l: Listing) => processOne(sb, l)));
      return new Response(JSON.stringify({ count: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await processOne(sb, body as Listing);
    const status = (result as any).error === "validation_failed" ? 400 : 200;
    return new Response(JSON.stringify(result), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("compute-market-floor fatal:", msg);
    return new Response(JSON.stringify({ error: "internal", message: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
