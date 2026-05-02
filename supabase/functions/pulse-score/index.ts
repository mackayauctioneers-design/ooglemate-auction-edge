// Pulse Agent — v4 two-tier scoring. Inserts new rows into pulse_alerts.
// Auth: Bearer PULSE_BEARER_TOKEN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PULSE_TOKEN = Deno.env.get("PULSE_BEARER_TOKEN")!;

const KM_DEPRECIATION = 0.10;
const KM_BASELINE = 60000;
const RECENCY_DAYS = 7;
const ALERT_THRESHOLD = 80;
const HOT_THRESHOLD = 90;
const BUYABLE = ["active","listed","inprep","catalogue","relisted","prepcompleted"];
const AUCTION_UPLIFT = 1.18;
const AUCTION_CLOSE_WINDOW_HOURS = 8;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function median(nums: number[]): number {
  const s = [...nums].sort((a,b) => a-b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2;
}

function tier1MarginScore(gap: number): number {
  if (gap < 3000) return 30;
  if (gap < 5000) return 60;
  if (gap < 8000) return 78;
  if (gap < 12000) return 88;
  return 95;
}
function tier1ConfScore(n: number): number {
  if (n < 10) return 50;
  if (n < 25) return 75;
  return 90;
}
function tier2MarginScore(gap: number): number {
  if (gap < 1000) return 20;
  if (gap < 3000) return 55;
  if (gap < 5000) return 75;
  if (gap < 8000) return 88;
  return 95;
}
function tier2ConfScore(n: number): number {
  if (n < 10) return 70;
  return 90;
}

type Row = {
  id: string; source: string|null; source_listing_id: string|null; listing_url: string|null;
  make: string; model: string; year: number; km: number; price: number;
  status: string|null; first_seen_at: string|null; is_dealer_grade: boolean|null;
  source_class: string | null; auction_datetime: string | null;
};

async function fetchPeers(sb: any, make: string, model: string): Promise<Row[]> {
  const sinceIso = new Date(Date.now() - 60*86_400_000).toISOString();
  const all: Row[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb.from("market_listings")
      .select("id,source,source_listing_id,listing_url,make,model,year,km,kilometres,price,asking_price,status,first_seen_at,is_dealer_grade,exclude_from_alerts,source_class,auction_datetime")
      .eq("make", make.toUpperCase())
      .eq("model", model.toUpperCase())
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const status = String(r.status ?? "").toLowerCase();
      if (!BUYABLE.includes(status)) continue;
      if (r.exclude_from_alerts === true) continue;
      const km = (r.km ?? r.kilometres);
      const price = (r.price ?? r.asking_price);
      if (price == null || price <= 1000) continue;
      if (r.year == null || km == null) continue;
      all.push({
        id: r.id, source: r.source, source_listing_id: r.source_listing_id, listing_url: r.listing_url,
        make: r.make, model: r.model, year: Number(r.year), km: Number(km), price: Number(price),
        status: r.status, first_seen_at: r.first_seen_at, is_dealer_grade: r.is_dealer_grade,
        source_class: r.source_class ?? null, auction_datetime: r.auction_datetime ?? null,
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
    if (from > 20000) break; // safety
  }
  return all;
}

type ScoredAlert = {
  market_listing_id: string; source: string|null; source_listing_id: string|null; listing_url: string|null;
  make: string; model: string; year: number; km: number; price: number; status: string|null;
  composite_score: number; tier: number; margin_score: number; conf_score: number; gap: number;
  benchmark_value: number; benchmark_n: number; alert_band: "HOT"|"WARM";
  first_seen_at: string|null;
};

function scoreModel(rows: Row[]): ScoredAlert[] {
  // Tier 1: cohort medians by year
  const cohorts = new Map<number, number[]>();
  for (const r of rows) {
    const norm = r.price + (r.km - KM_BASELINE) * KM_DEPRECIATION;
    if (!cohorts.has(r.year)) cohorts.set(r.year, []);
    cohorts.get(r.year)!.push(norm);
  }
  const cohortMedian = new Map<number, {med: number; n: number}>();
  for (const [yr, arr] of cohorts) {
    if (arr.length >= 5) cohortMedian.set(yr, { med: median(arr), n: arr.length });
  }

  const recencyCutoff = Date.now() - RECENCY_DAYS * 86_400_000;
  const out: ScoredAlert[] = [];

  for (const cand of rows) {
    // data quality skip
    if (cand.km === 0 && cand.year < 2025) continue;
    if (!cand.first_seen_at) continue;
    if (new Date(cand.first_seen_at).getTime() < recencyCutoff) continue;

    let t1: { composite: number; margin: number; conf: number; gap: number; med: number; n: number } | null = null;
    const coh = cohortMedian.get(cand.year);
    if (coh) {
      const norm = cand.price + (cand.km - KM_BASELINE) * KM_DEPRECIATION;
      const gap = coh.med - norm;
      if (gap >= 0) {
        const m = tier1MarginScore(gap);
        const c = tier1ConfScore(coh.n);
        t1 = { composite: Math.round((0.6*m + 0.4*c) * 10) / 10, margin: m, conf: c, gap, med: coh.med, n: coh.n };
      }
    }

    // Tier 2: tight band peers
    let t2: { composite: number; margin: number; conf: number; gap: number; cheapest: number; n: number } | null = null;
    const peers = rows.filter(p =>
      p.id !== cand.id &&
      Math.abs(p.year - cand.year) <= 2 &&
      Math.abs(p.km - cand.km) <= 40000
    );
    if (peers.length >= 5) {
      const normPeers = peers.map(p => p.price + (p.km - cand.km) * KM_DEPRECIATION);
      const cheapest = Math.min(...normPeers);
      const gap = cheapest - cand.price;
      if (gap >= 0) {
        const m = tier2MarginScore(gap);
        const c = tier2ConfScore(peers.length);
        t2 = { composite: Math.round((0.6*m + 0.4*c) * 10) / 10, margin: m, conf: c, gap, cheapest, n: peers.length };
      }
    }

    let chosen: { tier: 1|2; composite: number; margin: number; conf: number; gap: number; bench: number; n: number } | null = null;
    if (t1 && (!t2 || t1.composite >= t2.composite)) {
      chosen = { tier: 1, composite: t1.composite, margin: t1.margin, conf: t1.conf, gap: t1.gap, bench: t1.med, n: t1.n };
    } else if (t2) {
      chosen = { tier: 2, composite: t2.composite, margin: t2.margin, conf: t2.conf, gap: t2.gap, bench: t2.cheapest, n: t2.n };
    }
    if (!chosen) continue;
    if (chosen.composite < ALERT_THRESHOLD) continue;

    out.push({
      market_listing_id: cand.id,
      source: cand.source, source_listing_id: cand.source_listing_id, listing_url: cand.listing_url,
      make: cand.make.toUpperCase(), model: cand.model.toUpperCase(),
      year: cand.year, km: cand.km, price: cand.price, status: cand.status,
      composite_score: chosen.composite, tier: chosen.tier,
      margin_score: chosen.margin, conf_score: chosen.conf, gap: chosen.gap,
      benchmark_value: chosen.bench, benchmark_n: chosen.n,
      alert_band: chosen.composite >= HOT_THRESHOLD ? "HOT" : "WARM",
      first_seen_at: cand.first_seen_at,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== PULSE_TOKEN) return jres(401, { error: "unauthorized" });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let pairs: Array<{ make: string; model: string }> = Array.isArray(body?.models) ? body.models : [];

  if (pairs.length === 0) {
    // Discover all (make, model) with >= 20 buyable in last 60d
    const sinceIso = new Date(Date.now() - 60*86_400_000).toISOString();
    const { data, error } = await sb.from("market_listings")
      .select("make, model, status, first_seen_at")
      .gte("first_seen_at", sinceIso)
      .limit(50000);
    if (error) return jres(500, { error: error.message });
    const counts = new Map<string, number>();
    for (const r of (data ?? [])) {
      const st = String(r.status ?? "").toLowerCase();
      if (!BUYABLE.includes(st)) continue;
      const k = `${String(r.make ?? "").toUpperCase()}||${String(r.model ?? "").toUpperCase()}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    pairs = [...counts.entries()].filter(([_, n]) => n >= 20).map(([k]) => {
      const [make, model] = k.split("||");
      return { make, model };
    });
  }

  let totalScored = 0;
  let totalCreated = 0;
  const byModel: Record<string, number> = {};

  for (const p of pairs) {
    try {
      const rows = await fetchPeers(sb, p.make, p.model);
      totalScored += rows.length;
      const alerts = scoreModel(rows);
      if (alerts.length === 0) {
        byModel[`${p.make} ${p.model}`] = 0;
        continue;
      }
      // Insert in chunks with ON CONFLICT DO NOTHING
      let inserted = 0;
      const CHUNK = 200;
      for (let i = 0; i < alerts.length; i += CHUNK) {
        const slice = alerts.slice(i, i + CHUNK);
        const { data, error } = await sb.from("pulse_alerts")
          .upsert(slice, { onConflict: "market_listing_id,alert_band", ignoreDuplicates: true })
          .select("id");
        if (error) {
          console.error(`[pulse-score] insert error for ${p.make}/${p.model}:`, error.message);
          continue;
        }
        inserted += (data?.length ?? 0);
      }
      totalCreated += inserted;
      byModel[`${p.make} ${p.model}`] = inserted;
    } catch (e) {
      console.error(`[pulse-score] error for ${p.make}/${p.model}:`, (e as Error).message);
      byModel[`${p.make} ${p.model}`] = 0;
    }
  }

  return jres(200, { scored: totalScored, alerts_created: totalCreated, by_model: byModel });
});
