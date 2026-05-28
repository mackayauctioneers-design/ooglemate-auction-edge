// enrich-strategic-fit
// Post-pass that augments operator_opportunities with:
//   - strategic_fit_score / reason / signals (best dealer by strategic profile)
//   - recommended_dealer_id / reason (argmax across sales-truth + strategic fit)
//   - match_lane: sales_truth | strategic_fit | both
//   - composite_score (fused ranking)
//
// Runs as a cron post-pass after score-operator-opportunities.
// Pure data: relies on dealer_profiles.franchise_brand etc + compute_strategic_fit RPC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;
const MAX_OPPS_PER_RUN = 500;
const STRATEGIC_HIGH = 60;
const STRATEGIC_MEDIUM = 35;

interface Dealer {
  id: string;
  account_id: string | null;
  dealer_name: string;
  franchise_brand: string | null;
  preferred_brands: string[] | null;
  dealership_category: string | null;
  specialist_categories: string[] | null;
  location_state: string | null;
}

function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

// Convert under_buy / margin into 0-100 component scores
function marketGapScore(under_buy: number | null, asking: number | null): number {
  if (!under_buy || !asking) return 0;
  const pct = (under_buy / asking) * 100;
  return clamp(pct * 4); // 25% under = 100
}
function netMarginScore(margin: number | null): number {
  if (!margin) return 0;
  return clamp(margin / 100); // $10k margin = 100
}
function salesTruthScore(margin: number | null, anchorSaleId: string | null): number {
  // Proxy: if there's an anchor sale + margin > 0, this dealer has sold one.
  if (!anchorSaleId) return 0;
  if (!margin || margin <= 0) return 20;
  return clamp(40 + margin / 200);
}
function sourceConfidenceScore(source: string | null): number {
  if (!source) return 30;
  const s = source.toLowerCase();
  if (["pickles","manheim","grays","slattery"].includes(s)) return 100;
  if (["autotrader","carsales","gumtree"].includes(s)) return 75;
  if (s.startsWith("dealer_site:")) return 60;
  return 50;
}
function turnabilityScore(): number { return 50; } // placeholder until days-to-sell wired

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const t0 = Date.now();
  let processed = 0;
  let strategicOnly = 0;
  let both = 0;
  let upgraded = 0;

  try {
    // Load dealers with any strategic profile signal
    const { data: dealers, error: dErr } = await sb
      .from("dealer_profiles")
      .select("id, account_id, dealer_name, franchise_brand, preferred_brands, dealership_category, specialist_categories, location_state")
      .or("franchise_brand.not.is.null,preferred_brands.not.is.null,specialist_categories.not.is.null");
    if (dErr) throw dErr;
    const dealerList = (dealers ?? []) as Dealer[];

    if (dealerList.length === 0) {
      return new Response(JSON.stringify({ ok: true, note: "no strategic dealer profiles", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch recent opportunities (last 7d, actionable)
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: opps, error: oErr } = await sb
      .from("operator_opportunities")
      .select("id, make, model, variant, year, asking_price, listing_source, best_account_id, best_account_name, best_expected_margin, best_under_buy, anchor_sale_id, tier")
      .gte("created_at", since)
      .in("status", ["new", "assigned", "reviewed"])
      .order("created_at", { ascending: false })
      .limit(MAX_OPPS_PER_RUN);
    if (oErr) throw oErr;

    for (const opp of opps ?? []) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      const make = opp.make as string | null;
      if (!make) continue;

      // Compute strategic fit for every dealer; track best
      let bestStrat: { dealer: Dealer; score: number; reason: string; signals: any } | null = null;
      for (const d of dealerList) {
        const { data: fit } = await sb.rpc("compute_strategic_fit", {
          p_dealer_id: d.id,
          p_make: make,
          p_model: opp.model,
          p_body: opp.variant,
          p_state: null,
        });
        const score = (fit as any)?.score ?? 0;
        if (score > 0 && (!bestStrat || score > bestStrat.score)) {
          bestStrat = { dealer: d, score, reason: (fit as any).reason, signals: (fit as any).signals };
        }
      }

      // Sales-truth side
      const stMargin = opp.best_expected_margin as number | null;
      const stScore = salesTruthScore(stMargin, opp.anchor_sale_id);
      const mgScore = marketGapScore(opp.best_under_buy as number | null, opp.asking_price as number | null);
      const nmScore = netMarginScore(stMargin);
      const srcScore = sourceConfidenceScore(opp.listing_source as string | null);
      const turn = turnabilityScore();

      const stratScore = bestStrat?.score ?? 0;

      // Determine lane
      const hasSalesTruth = !!opp.best_account_id && stScore > 0;
      const hasStrategic = stratScore >= STRATEGIC_MEDIUM;
      let lane: string;
      let recommended_dealer_id: string | null = opp.best_account_id as string | null;
      let recommended_dealer_reason: string | null = null;

      if (hasSalesTruth && hasStrategic && bestStrat?.dealer.account_id === opp.best_account_id) {
        lane = "both";
        both++;
        recommended_dealer_reason = `Sales-truth match + ${bestStrat!.reason}`;
      } else if (hasSalesTruth && hasStrategic) {
        // Different winners; promote whichever scores higher overall
        const salesComposite = 0.30 * mgScore + 0.20 * nmScore + 0.20 * stScore + 0.10 * srcScore + 0.05 * turn;
        const stratComposite = 0.30 * mgScore + 0.20 * nmScore + 0.15 * stratScore + 0.10 * srcScore + 0.05 * turn;
        if (stratComposite > salesComposite) {
          lane = "strategic_fit";
          recommended_dealer_id = bestStrat!.dealer.account_id;
          recommended_dealer_reason = bestStrat!.reason;
          upgraded++;
        } else {
          lane = "sales_truth";
          recommended_dealer_reason = "Proven historical sales of similar stock";
        }
      } else if (hasStrategic) {
        lane = "strategic_fit";
        recommended_dealer_id = bestStrat!.dealer.account_id;
        recommended_dealer_reason = bestStrat!.reason;
        strategicOnly++;
      } else if (hasSalesTruth) {
        lane = "sales_truth";
        recommended_dealer_reason = "Proven historical sales of similar stock";
      } else {
        lane = "sales_truth"; // default; no fit either way
      }

      const composite =
        0.30 * mgScore +
        0.20 * nmScore +
        0.20 * stScore +
        0.15 * stratScore +
        0.10 * srcScore +
        0.05 * turn;

      const update: Record<string, any> = {
        strategic_fit_score: stratScore,
        strategic_fit_reason: bestStrat?.reason ?? null,
        strategic_fit_signals: bestStrat?.signals ?? {},
        match_lane: lane,
        recommended_dealer_id,
        recommended_dealer_reason,
        composite_score: composite,
        updated_at: new Date().toISOString(),
      };

      // For pure-strategic with no existing dealer, set best_account_* so the
      // opportunity becomes visible to that dealer.
      if (lane === "strategic_fit" && !opp.best_account_id && bestStrat?.dealer.account_id) {
        update.best_account_id = bestStrat.dealer.account_id;
        update.best_account_name = bestStrat.dealer.dealer_name;
        // Lift tier from WATCH to HIGH when strategic fit is strong AND market gap exists
        if (stratScore >= STRATEGIC_HIGH && mgScore >= 40 && opp.tier === "WATCH") {
          update.tier = "HIGH";
        }
      }

      await sb.from("operator_opportunities").update(update).eq("id", opp.id);
      processed++;
    }

    return new Response(JSON.stringify({
      ok: true,
      processed,
      strategic_only: strategicOnly,
      both,
      upgraded_to_strategic: upgraded,
      duration_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, processed }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
