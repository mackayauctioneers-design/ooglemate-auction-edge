// generate-dealer-mandates v1.0
// Turns every qualifying dealer_fingerprints row into an active_mandates row.
// No new tables, no per-dealer logic. Runs daily after recompute-fingerprint-performance.
//
// Flow:
//   dealer_fingerprints (sales_count >= 2, avg_profit >= 1500, is_active=true)
//     -> upsert active_mandates keyed on (dealer_id, created_from_fingerprint_id)
//   Mandates whose source fingerprint no longer qualifies are deactivated (never deleted).
//
// Triggered by:
//   - pg_cron daily at 03:15 UTC
//   - manual button on operator mandates page

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;
const MIN_SALES_COUNT = 2;
const MIN_AVG_PROFIT = 1500;
const DEFAULT_SOURCE_PRIORITY = [
  "pickles",
  "manheim",
  "grays",
  "bidsonline",
  "carsales",
  "autotrader",
  "dealer_sites",
];

interface Fingerprint {
  id: string;
  dealer_profile_id: string | null;
  make: string | null;
  model: string | null;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  min_km: number | null;
  max_km: number | null;
  fingerprint_priority: string | null;
  avg_profit: number | null;
  sales_count: number | null;
  is_active: boolean | null;
}

function priorityRank(p: string | null): string {
  switch ((p || "").toUpperCase()) {
    case "HIGH": return "high";
    case "LOW": return "low";
    default: return "medium";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stats = {
    dealers_processed: 0,
    fingerprints_considered: 0,
    mandates_created: 0,
    mandates_updated: 0,
    mandates_deactivated: 0,
    errors: [] as string[],
    timed_out: false,
  };

  try {
    // 1. Pull all qualifying fingerprints (active, profitable, repeatable).
    const { data: qualifyingFps, error: fpErr } = await sb
      .from("dealer_fingerprints")
      .select(
        "id, dealer_profile_id, make, model, variant_family, year_min, year_max, min_km, max_km, fingerprint_priority, avg_profit, sales_count, is_active",
      )
      .eq("is_active", true)
      .gte("sales_count", MIN_SALES_COUNT)
      .gte("avg_profit", MIN_AVG_PROFIT)
      .not("dealer_profile_id", "is", null)
      .not("make", "is", null)
      .not("model", "is", null);

    if (fpErr) throw new Error(`dealer_fingerprints load: ${fpErr.message}`);
    stats.fingerprints_considered = qualifyingFps?.length || 0;

    // Group by dealer for reporting.
    const byDealer = new Map<string, Fingerprint[]>();
    for (const fp of (qualifyingFps || []) as Fingerprint[]) {
      const k = fp.dealer_profile_id!;
      if (!byDealer.has(k)) byDealer.set(k, []);
      byDealer.get(k)!.push(fp);
    }

    // 2. For each dealer, look up dealer_profiles.account_id once.
    const dealerIds = Array.from(byDealer.keys());
    const { data: dealerRows } = await sb
      .from("dealer_profiles")
      .select("id, account_id")
      .in("id", dealerIds);
    const accountByDealer = new Map<string, string | null>();
    for (const d of dealerRows || []) accountByDealer.set(d.id, d.account_id);

    // 3. Walk each fingerprint -> upsert active_mandates keyed on
    //    (dealer_id, created_from_fingerprint_id). Manual select+update/insert
    //    because no DB unique constraint exists.
    for (const [dealerId, fps] of byDealer.entries()) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        stats.timed_out = true;
        break;
      }
      stats.dealers_processed += 1;
      const accountId = accountByDealer.get(dealerId) ?? null;

      // Pre-load existing auto-generated mandates for this dealer.
      const { data: existing } = await sb
        .from("active_mandates")
        .select("id, created_from_fingerprint_id, is_active")
        .eq("dealer_id", dealerId)
        .not("created_from_fingerprint_id", "is", null);

      const existingByFp = new Map<string, { id: string; is_active: boolean }>();
      for (const m of existing || []) {
        if (m.created_from_fingerprint_id) {
          existingByFp.set(m.created_from_fingerprint_id, {
            id: m.id,
            is_active: m.is_active,
          });
        }
      }

      const qualifyingFpIds = new Set<string>();

      for (const fp of fps) {
        qualifyingFpIds.add(fp.id);
        const avgProfit = Number(fp.avg_profit || 0);
        const minExpectedGp = Math.max(1500, Math.round(avgProfit * 0.5));
        const highPriorityGp = Math.round(avgProfit * 0.8);
        const yearMin = fp.year_min ? fp.year_min - 1 : null;
        const yearMax = fp.year_max ? fp.year_max + 1 : null;
        const kmMin = fp.min_km ?? null;
        const kmMax = fp.max_km != null ? fp.max_km + 20_000 : null;

        const payload = {
          name: `${fp.make} ${fp.model}${fp.variant_family ? " " + fp.variant_family : ""} (auto)`,
          dealer_id: dealerId,
          account_id: accountId,
          created_from_fingerprint_id: fp.id,
          make: fp.make,
          model: fp.model,
          variant_family: fp.variant_family,
          year_min: yearMin,
          year_max: yearMax,
          km_min: kmMin,
          km_max: kmMax,
          min_expected_gp: minExpectedGp,
          high_priority_gp: highPriorityGp,
          priority: priorityRank(fp.fingerprint_priority),
          source_priority: DEFAULT_SOURCE_PRIORITY,
          source_mask: DEFAULT_SOURCE_PRIORITY,
          alert_channels: ["push", "email"],
          confidence_threshold: "medium",
          run_frequency_minutes: 60,
          is_active: true,
          updated_at: new Date().toISOString(),
        };

        const found = existingByFp.get(fp.id);
        if (found) {
          const { error: upErr } = await sb
            .from("active_mandates")
            .update(payload)
            .eq("id", found.id);
          if (upErr) stats.errors.push(`update ${found.id}: ${upErr.message}`);
          else stats.mandates_updated += 1;
        } else {
          const { error: insErr } = await sb
            .from("active_mandates")
            .insert(payload);
          if (insErr) stats.errors.push(`insert fp=${fp.id}: ${insErr.message}`);
          else stats.mandates_created += 1;
        }
      }

      // 4. Deactivate mandates whose source fingerprint no longer qualifies.
      for (const [fpId, m] of existingByFp.entries()) {
        if (!qualifyingFpIds.has(fpId) && m.is_active) {
          const { error: deErr } = await sb
            .from("active_mandates")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", m.id);
          if (deErr) stats.errors.push(`deactivate ${m.id}: ${deErr.message}`);
          else stats.mandates_deactivated += 1;
        }
      }
    }

    console.log("[generate-dealer-mandates] done", stats);
    return new Response(
      JSON.stringify({ ok: true, elapsed_ms: Date.now() - startedAt, ...stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[generate-dealer-mandates] fatal", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ...stats,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
