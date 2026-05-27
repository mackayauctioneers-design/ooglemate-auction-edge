// rebuild-dealer-intelligence
// Synthesizes a dealer's auto_summary + (optionally) weights from vehicle_sales_truth.
// Triggered by: operator "Rebuild" button, dealer-sales-merge after upload, nightly cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOOKBACK_MONTHS = 24;
const MIN_WINNER_SALES = 3;
const MIN_AVOID_SALES = 2;
const WINNER_MARGIN = 2000;
const WINNER_DAYS = 45;
const AVOID_MARGIN = 500;
const AVOID_DAYS = 90;

interface Bucket {
  key: string;       // MAKE or MAKE|MODEL
  make: string;
  model?: string;
  count: number;
  totalMargin: number;
  totalDays: number;
  daysCount: number;
}

function classify(b: Bucket) {
  const avgMargin = b.totalMargin / b.count;
  const avgDays = b.daysCount > 0 ? b.totalDays / b.daysCount : null;
  return { avgMargin, avgDays };
}

function weightFor(avgMargin: number, avgDays: number | null, isWinner: boolean): number {
  if (isWinner) {
    // 1.3 base, +0.1 per $2k extra margin (cap 1.8), +0.1 if avgDays <= 30
    let w = 1.3 + Math.min(0.4, Math.max(0, (avgMargin - WINNER_MARGIN) / 2000) * 0.1);
    if (avgDays !== null && avgDays <= 30) w += 0.1;
    return Math.min(1.8, Number(w.toFixed(2)));
  }
  // Avoid: weaker margin / slower clear → lower weight
  let w = 0.7;
  if (avgMargin <= 0) w -= 0.2;
  if (avgDays !== null && avgDays >= AVOID_DAYS) w -= 0.2;
  return Math.max(0.3, Number(w.toFixed(2)));
}

async function rebuildOne(sb: any, accountId: string) {
  const since = new Date(Date.now() - LOOKBACK_MONTHS * 30 * 24 * 3600 * 1000).toISOString();

  const { data: sales, error } = await sb
    .from("vehicle_sales_truth")
    .select("make, model, buy_price, sale_price, sold_at, acquired_at, days_to_clear")
    .eq("account_id", accountId)
    .gte("sold_at", since);

  if (error) throw new Error(`sales fetch: ${error.message}`);

  const makeBuckets = new Map<string, Bucket>();
  const mmBuckets = new Map<string, Bucket>();

  for (const s of sales || []) {
    const make = (s.make || "").toUpperCase().trim();
    const model = (s.model || "").toUpperCase().trim();
    if (!make) continue;

    const margin = s.buy_price != null && s.sale_price != null
      ? Number(s.sale_price) - Number(s.buy_price)
      : 0;
    const days = s.days_to_clear != null ? Number(s.days_to_clear) : null;

    const bumpBucket = (m: Map<string, Bucket>, key: string, b: Partial<Bucket>) => {
      const cur = m.get(key) ?? { key, make, count: 0, totalMargin: 0, totalDays: 0, daysCount: 0, ...b };
      cur.count++;
      cur.totalMargin += margin;
      if (days !== null) { cur.totalDays += days; cur.daysCount++; }
      m.set(key, cur);
    };

    bumpBucket(makeBuckets, make, { make });
    if (model) bumpBucket(mmBuckets, `${make}|${model}`, { make, model });
  }

  const winners: any[] = [];
  const avoid: any[] = [];
  const weights = { MAKE: {} as Record<string, number>, MAKE_MODEL: {} as Record<string, number> };

  const handle = (b: Bucket, scope: "MAKE" | "MAKE_MODEL") => {
    const { avgMargin, avgDays } = classify(b);
    const isWinner = b.count >= MIN_WINNER_SALES && avgMargin >= WINNER_MARGIN && (avgDays === null || avgDays <= WINNER_DAYS);
    const isAvoid = !isWinner && b.count >= MIN_AVOID_SALES && (avgMargin <= AVOID_MARGIN || (avgDays !== null && avgDays >= AVOID_DAYS));

    const entry = {
      key: b.key,
      make: b.make,
      model: b.model || null,
      sales: b.count,
      avg_margin: Math.round(avgMargin),
      avg_days_to_clear: avgDays !== null ? Math.round(avgDays) : null,
    };

    if (isWinner) {
      const w = weightFor(avgMargin, avgDays, true);
      weights[scope][b.key] = w;
      winners.push({ ...entry, weight: w });
    } else if (isAvoid) {
      const w = weightFor(avgMargin, avgDays, false);
      weights[scope][b.key] = w;
      avoid.push({ ...entry, weight: w });
    }
  };

  for (const b of makeBuckets.values()) handle(b, "MAKE");
  for (const b of mmBuckets.values()) handle(b, "MAKE_MODEL");

  winners.sort((a, b) => b.avg_margin * b.sales - a.avg_margin * a.sales);
  avoid.sort((a, b) => a.avg_margin - b.avg_margin);

  const totals = (sales || []).length;
  const totalMargin = (sales || []).reduce((s: number, r: any) =>
    s + (r.buy_price && r.sale_price ? Number(r.sale_price) - Number(r.buy_price) : 0), 0);
  const totalDays = (sales || []).reduce((acc: { s: number; n: number }, r: any) =>
    r.days_to_clear != null ? { s: acc.s + Number(r.days_to_clear), n: acc.n + 1 } : acc, { s: 0, n: 0 });

  const auto_summary = {
    generated_at: new Date().toISOString(),
    lookback_months: LOOKBACK_MONTHS,
    total_sales: totals,
    avg_margin: totals > 0 ? Math.round(totalMargin / totals) : 0,
    avg_days_to_clear: totalDays.n > 0 ? Math.round(totalDays.s / totalDays.n) : null,
    winners: winners.slice(0, 30),
    avoid: avoid.slice(0, 30),
  };

  // Read existing row to honor weights_source
  const { data: existing } = await sb
    .from("dealer_intelligence_profiles")
    .select("weights_source, weights")
    .eq("account_id", accountId)
    .maybeSingle();

  const source = existing?.weights_source ?? "blended";
  let finalWeights = weights;

  if (source === "manual") {
    // Don't overwrite manual weights — keep existing
    finalWeights = existing?.weights ?? { MAKE: {}, MAKE_MODEL: {} };
  } else if (source === "blended" && existing?.weights) {
    // Blend: manual overrides per-key win
    const m = existing.weights as { MAKE?: Record<string, number>; MAKE_MODEL?: Record<string, number> };
    finalWeights = {
      MAKE: { ...weights.MAKE, ...(m.MAKE || {}) },
      MAKE_MODEL: { ...weights.MAKE_MODEL, ...(m.MAKE_MODEL || {}) },
    };
  }

  const { error: upErr } = await sb
    .from("dealer_intelligence_profiles")
    .upsert({
      account_id: accountId,
      auto_summary,
      weights: finalWeights,
      last_rebuilt_at: new Date().toISOString(),
    }, { onConflict: "account_id" });

  if (upErr) throw new Error(`upsert: ${upErr.message}`);

  return { account_id: accountId, total_sales: totals, winners: winners.length, avoid: avoid.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const accountId = body.account_id as string | undefined;

  try {
    if (accountId) {
      const out = await rebuildOne(sb, accountId);
      return json({ ok: true, result: out });
    }
    // No id → rebuild every account that has any sales truth
    const { data: ids } = await sb
      .from("vehicle_sales_truth")
      .select("account_id")
      .not("account_id", "is", null);
    const unique = Array.from(new Set((ids || []).map((r: any) => r.account_id)));
    const results: any[] = [];
    for (const a of unique) {
      try { results.push(await rebuildOne(sb, a as string)); }
      catch (e) { results.push({ account_id: a, error: (e as Error).message }); }
    }
    return json({ ok: true, count: results.length, results });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
