/**
 * Rollup: dealer_sales_truth -> dealer_sales_fingerprints
 * Aggregates each dealer's sold rows into (make, model, variant, year-band, km-band) buckets.
 * Year band: 2yr buckets. KM band: 25k buckets.
 * Runs every 15 minutes.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const started = Date.now();
  try {
    // Pull all sold rows in batches
    const PAGE = 1000;
    let from = 0;
    const buckets = new Map<string, {
      dealer_id: string; make: string; model: string; variant: string;
      year_from: number; year_to: number; km_from: number; km_to: number;
      count_sold: number;
    }>();

    const ingest = (dealer_id: string, make_in: string, model_in: string, variant_in: string | null, year: number | null, km: number | null) => {
      const make = (make_in || "").toUpperCase().trim();
      const model = (model_in || "").toUpperCase().trim();
      const variant = (variant_in || "BASE").toUpperCase().trim();
      if (!dealer_id || !make || !model) return;
      const y = year ?? 0;
      const k = km ?? 0;
      const year_from = y ? Math.floor(y / 2) * 2 : 0;
      const year_to = year_from ? year_from + 1 : 0;
      const km_from = Math.floor(k / 25000) * 25000;
      const km_to = km_from + 24999;
      const key = `${dealer_id}|${make}|${model}|${variant}|${year_from}|${km_from}`;
      const existing = buckets.get(key);
      if (existing) existing.count_sold += 1;
      else buckets.set(key, { dealer_id, make, model, variant, year_from, year_to, km_from, km_to, count_sold: 1 });
    };

    // Freshness gate: only consider sales within the last 6 months so fingerprints
    // reflect current market pricing, not 2020-2024 anchors.
    const FRESHNESS_DAYS = 180;
    const cutoffIso = new Date(Date.now() - FRESHNESS_DAYS * 86_400_000).toISOString();
    const cutoffDate = cutoffIso.slice(0, 10);

    // Source 1: dealer_sales_truth (filter on sold_date)
    while (true) {
      const { data, error } = await supabase
        .from("dealer_sales_truth")
        .select("dealer_id, make, model, variant, year, km, sold_date")
        .not("dealer_id", "is", null)
        .not("make", "is", null)
        .not("model", "is", null)
        .gte("sold_date", cutoffDate)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) ingest(r.dealer_id, r.make, r.model, r.variant, r.year, r.km);
      if (data.length < PAGE) break;
      from += PAGE;
      if (Date.now() - started > 45_000) break;
    }

    // Source 2: vehicle_sales_truth (account_id → dealer_id)
    let vfrom = 0;
    while (true) {
      const { data, error } = await supabase
        .from("vehicle_sales_truth")
        .select("account_id, make, model, variant, year, km, sold_at")
        .not("account_id", "is", null)
        .not("make", "is", null)
        .not("model", "is", null)
        .gte("sold_at", cutoffDate)
        .range(vfrom, vfrom + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) ingest(r.account_id, r.make, r.model, r.variant, r.year, r.km);
      if (data.length < PAGE) break;
      vfrom += PAGE;
      if (Date.now() - started > 90_000) break;
    }

    const rows = Array.from(buckets.values());

    // Wipe existing per-dealer rows and reinsert (idempotent, simple).
    const dealerIds = [...new Set(rows.map(r => r.dealer_id))];
    if (dealerIds.length > 0) {
      const { error: delErr } = await supabase
        .from("dealer_sales_fingerprints")
        .delete()
        .in("dealer_id", dealerIds);
      if (delErr) throw delErr;
    }

    // Insert in chunks
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from("dealer_sales_fingerprints")
        .insert(slice);
      if (insErr) throw insErr;
      inserted += slice.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      dealers: dealerIds.length,
      fingerprints: inserted,
      sales_scanned: from + buckets.size,
      runtime_ms: Date.now() - started,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
