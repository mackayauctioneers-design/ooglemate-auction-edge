import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * recompute-fingerprint-performance v1.0
 *
 * Aggregates real-world deal outcomes from deal_truth_ledger back into
 * fingerprint_performance_metrics. Closes the feedback loop.
 *
 * Chain: deal_truth_ledger.matched_opportunity_id → matched_opportunities_v1
 *        → fingerprint_make + fingerprint_model → platform_class
 *
 * Also aggregates operator_opportunities by platform_class for detection counts.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    console.log("[recompute-fp-perf] Starting full recompute...");

    // ── 1. Load all operator opportunities (detection counts by platform_class + best_account_id) ──
    const { data: opps, error: oppsErr } = await sb
      .from("operator_opportunities")
      .select("id, platform_class, best_account_id, status, tier")
      .not("platform_class", "is", null);

    if (oppsErr) throw new Error(`operator_opportunities load: ${oppsErr.message}`);
    console.log(`[recompute-fp-perf] Loaded ${opps?.length || 0} operator opportunities`);

    // ── 2. Load all matched_opportunities_v1 (for fingerprint linkage) ──
    const { data: matchedOpps, error: moErr } = await sb
      .from("matched_opportunities_v1")
      .select("id, account_id, fingerprint_make, fingerprint_model, match_score, anchor_profit, status");

    if (moErr) throw new Error(`matched_opportunities_v1 load: ${moErr.message}`);
    console.log(`[recompute-fp-perf] Loaded ${matchedOpps?.length || 0} matched opportunities`);

    // ── 3. Load deal_truth_ledger (real outcomes) ──
    const { data: deals, error: dealsErr } = await sb
      .from("deal_truth_ledger")
      .select("id, account_id, matched_opportunity_id, status, make, model");

    if (dealsErr) throw new Error(`deal_truth_ledger load: ${dealsErr.message}`);
    console.log(`[recompute-fp-perf] Loaded ${deals?.length || 0} deal truth records`);

    // ── 4. Load deal_truth_events for profit/sell data ──
    const { data: events, error: eventsErr } = await sb
      .from("deal_truth_events")
      .select("deal_id, event_type, event_payload");

    if (eventsErr) throw new Error(`deal_truth_events load: ${eventsErr.message}`);

    // Build deal event lookup: deal_id → { buy_price, sell_price, sold_date, ... }
    const dealData: Record<string, { buy_price?: number; sell_price?: number; purchased_at?: string; sold_at?: string }> = {};
    for (const e of events || []) {
      if (!dealData[e.deal_id]) dealData[e.deal_id] = {};
      const payload = e.event_payload as Record<string, any> || {};
      if (e.event_type === "purchased" || e.event_type === "purchase") {
        dealData[e.deal_id].buy_price = payload.buy_price || payload.price;
        dealData[e.deal_id].purchased_at = payload.date || payload.purchased_at;
      }
      if (e.event_type === "closed" || e.event_type === "sold") {
        dealData[e.deal_id].sell_price = payload.sell_price || payload.price;
        dealData[e.deal_id].sold_at = payload.date || payload.sold_at;
      }
    }

    // ── 5. Build matched_opportunity lookup ──
    const moLookup: Record<string, { platform_class: string; account_id: string; anchor_profit: number | null }> = {};
    for (const mo of matchedOpps || []) {
      const pc = `${(mo.fingerprint_make || "").toUpperCase()}:${(mo.fingerprint_model || "").toUpperCase()}`;
      moLookup[mo.id] = { platform_class: pc, account_id: mo.account_id, anchor_profit: mo.anchor_profit };
    }

    // ── 6. Aggregate metrics per (platform_class, account_id) ──
    interface Agg {
      detected: number;
      reviewed: number;
      approved: number;
      purchased: number;
      closed: number;
      profitable: number;
      lossmaking: number;
      expected_margins: number[];
      realized_margins: number[];
      days_to_sell: number[];
    }

    const metrics: Record<string, Agg> = {};

    function getKey(pc: string, acctId: string | null): string {
      return `${pc}||${acctId || "global"}`;
    }

    function ensure(key: string): Agg {
      if (!metrics[key]) {
        metrics[key] = {
          detected: 0, reviewed: 0, approved: 0, purchased: 0,
          closed: 0, profitable: 0, lossmaking: 0,
          expected_margins: [], realized_margins: [], days_to_sell: [],
        };
      }
      return metrics[key];
    }

    // Count detections from operator_opportunities
    for (const opp of opps || []) {
      if (!opp.platform_class) continue;
      const key = getKey(opp.platform_class, opp.best_account_id);
      const agg = ensure(key);
      agg.detected++;
      if (opp.status === "reviewed" || opp.status === "approved" || opp.status === "assigned") {
        agg.reviewed++;
      }
    }

    // Count detections from matched_opportunities_v1
    for (const mo of matchedOpps || []) {
      const pc = `${(mo.fingerprint_make || "").toUpperCase()}:${(mo.fingerprint_model || "").toUpperCase()}`;
      const key = getKey(pc, mo.account_id);
      const agg = ensure(key);
      agg.detected++;
      if (mo.anchor_profit) agg.expected_margins.push(Number(mo.anchor_profit));
    }

    // Process deal outcomes
    for (const deal of deals || []) {
      let pc: string | null = null;
      let acctId = deal.account_id;

      // Try to resolve platform_class via matched_opportunity linkage
      if (deal.matched_opportunity_id && moLookup[deal.matched_opportunity_id]) {
        const mo = moLookup[deal.matched_opportunity_id];
        pc = mo.platform_class;
      } else if (deal.make && deal.model) {
        pc = `${(deal.make).toUpperCase()}:${(deal.model).toUpperCase()}`;
      }

      if (!pc) continue;

      const key = getKey(pc, acctId);
      const agg = ensure(key);

      const s = deal.status;
      if (s === "approved" || s === "purchased" || s === "delivered" || s === "closed") agg.approved++;
      if (s === "purchased" || s === "delivered" || s === "closed") agg.purchased++;
      if (s === "closed" || s === "aborted") agg.closed++;

      // Realized profit from events
      const dd = dealData[deal.id];
      if (dd && s === "closed") {
        if (dd.buy_price && dd.sell_price) {
          const realizedMargin = dd.sell_price - dd.buy_price;
          agg.realized_margins.push(realizedMargin);
          if (realizedMargin > 0) agg.profitable++;
          else agg.lossmaking++;

          if (dd.purchased_at && dd.sold_at) {
            const days = Math.floor((new Date(dd.sold_at).getTime() - new Date(dd.purchased_at).getTime()) / 86400000);
            if (days >= 0) agg.days_to_sell.push(days);
          }
        }
      }
    }

    // ── 7. Compute rates and accuracy score, upsert ──
    const rows: any[] = [];
    const now = new Date().toISOString();

    for (const [key, agg] of Object.entries(metrics)) {
      const [pc, acctId] = key.split("||");
      const accountId = acctId === "global" ? null : acctId;

      const approvalRate = agg.detected > 0 ? agg.approved / agg.detected : 0;
      const purchaseRate = agg.detected > 0 ? agg.purchased / agg.detected : 0;
      const profitHitRate = agg.purchased > 0 ? agg.profitable / agg.purchased : 0;
      const falseSignalRate = 1 - purchaseRate;

      const avgExpectedMargin = agg.expected_margins.length > 0
        ? agg.expected_margins.reduce((a, b) => a + b, 0) / agg.expected_margins.length
        : 0;
      const avgRealizedMargin = agg.realized_margins.length > 0
        ? agg.realized_margins.reduce((a, b) => a + b, 0) / agg.realized_margins.length
        : 0;
      const avgDaysToSell = agg.days_to_sell.length > 0
        ? agg.days_to_sell.reduce((a, b) => a + b, 0) / agg.days_to_sell.length
        : 0;

      // Composite accuracy score (0-100)
      // 30% profit hit rate, 25% purchase rate, 20% approval rate, 15% margin strength, 10% days efficiency
      const marginStrength = Math.min(avgRealizedMargin / 10000, 1); // $10k = 100%
      const daysEfficiency = avgDaysToSell > 0 ? Math.max(0, 1 - avgDaysToSell / 90) : 0.5; // 90 days = 0%
      const accuracyScore = Math.min(100, Math.max(0, Math.round(
        (profitHitRate * 30) +
        (purchaseRate * 25) +
        (approvalRate * 20) +
        (marginStrength * 15) +
        (daysEfficiency * 10)
      )));

      // Governance status
      let governanceStatus = "active";
      if (agg.detected >= 5 && agg.purchased === 0) governanceStatus = "weak";
      if (agg.purchased >= 3 && profitHitRate < 0.34) governanceStatus = "weak";
      if (accuracyScore < 25 && agg.detected >= 3) governanceStatus = "review_required";

      rows.push({
        platform_class: pc,
        account_id: accountId,
        matches_detected: agg.detected,
        matches_reviewed: agg.reviewed,
        matches_approved: agg.approved,
        matches_purchased: agg.purchased,
        matches_closed: agg.closed,
        matches_profitable: agg.profitable,
        matches_lossmaking: agg.lossmaking,
        avg_expected_margin: Math.round(avgExpectedMargin),
        avg_realized_margin: Math.round(avgRealizedMargin),
        avg_days_to_sell: Math.round(avgDaysToSell * 10) / 10,
        approval_rate: Math.round(approvalRate * 1000) / 1000,
        purchase_rate: Math.round(purchaseRate * 1000) / 1000,
        profit_hit_rate: Math.round(profitHitRate * 1000) / 1000,
        false_signal_rate: Math.round(falseSignalRate * 1000) / 1000,
        fingerprint_accuracy_score: accuracyScore,
        governance_status: governanceStatus,
        last_recomputed_at: now,
      });
    }

    console.log(`[recompute-fp-perf] Computed ${rows.length} fingerprint metrics`);

    // ── 8. Upsert in chunks ──
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const { error: uErr } = await sb
        .from("fingerprint_performance_metrics")
        .upsert(chunk, { onConflict: "platform_class,account_id", ignoreDuplicates: false });

      if (uErr) {
        console.error(`[recompute-fp-perf] Upsert error chunk ${i}:`, uErr.message);
      } else {
        upserted += chunk.length;
      }
    }

    // ── 9. Audit ──
    await sb.from("cron_heartbeat").upsert({
      cron_name: "recompute-fingerprint-performance",
      last_seen_at: now,
      last_ok: true,
      note: JSON.stringify({ upserted, total_keys: rows.length }),
    }, { onConflict: "cron_name" });

    const durationMs = Date.now() - startTime;
    console.log(`[recompute-fp-perf] Done: ${upserted} upserted, ${durationMs}ms`);

    return new Response(JSON.stringify({
      success: true,
      metrics_computed: rows.length,
      upserted,
      duration_ms: durationMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[recompute-fp-perf] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
