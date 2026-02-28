/**
 * fleet-score-opportunities
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores every available market vehicle against a fleet client's stock gaps
 * and generates buying instructions for the top-ranked opportunities.
 *
 * Pipeline:
 *   1. Load fleet client's velocity metrics (stock gaps, ranked by opportunity value)
 *   2. Query vehicle_listings for active lots closing within 48h (or all active)
 *   3. Score each listing against the client's stock gaps
 *   4. Upsert scores into fleet_opportunity_scores
 *   5. Generate fleet_buyer_instructions for top-scoring opportunities
 *   6. Route each instruction to the correct buyer (by speciality_makes)
 *
 * Triggered by:
 *   - fleet-velocity-engine (after metrics recompute)
 *   - pg_cron (every 30 minutes during business hours)
 *   - Manual invocation from operator dashboard
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Scoring weights ──────────────────────────────────────────────────────────
const W_GAP_FIT = 40;
const W_MARGIN = 30;
const W_PRICE = 20;
const W_CONDITION = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function yearBand(year: number | null): string {
  if (!year) return "unknown";
  const base = Math.floor(year / 3) * 3;
  return `${base}-${base + 2}`;
}

function normalise(text: string | null): string {
  return (text || "").toUpperCase().trim();
}

interface VelocityMetric {
  id: string;
  make: string;
  model: string;
  year_band: string;
  trim: string | null;
  engine_type: string | null;
  units_sold_30d: number;
  avg_gross_profit_30d: number | null;
  avg_gross_profit_90d: number | null;
  avg_acquisition_cost_90d: number | null;
  avg_sale_price_90d: number | null;
  avg_days_to_sell_90d: number | null;
  stock_gap_units: number;
  opportunity_value_monthly: number | null;
  velocity_score: number | null;
}

interface Listing {
  id: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  trim_class: string | null;
  fuel: string | null;
  asking_price: number | null;
  guide_price: number | null;
  reserve_price: number | null;
  source: string | null;
  location: string | null;
  state: string | null;
  listing_url: string | null;
  sale_close_at: string | null;
  buy_method: string | null;
  auction_house: string | null;
  wovr_indicator: boolean | null;
  damage_noted: boolean | null;
  keys_present: boolean | null;
  starts_drives: boolean | null;
  reserve_status: string | null;
}

interface BuyerUser {
  user_id: string;
  speciality_makes: string[] | null;
  role: string;
}

// ── Scoring function ─────────────────────────────────────────────────────────

function scoreListing(
  listing: Listing,
  metric: VelocityMetric,
  gapRank: number,   // 1 = highest priority gap
  totalGaps: number
): {
  gap_fit_score: number;
  margin_score: number;
  price_score: number;
  condition_score: number;
  composite_score: number;
  target_acquisition_price: number | null;
  expected_gross_profit: number | null;
} {
  // 1. Gap fit score (0-40): higher gap rank = higher score
  const gapFitScore = Math.round(W_GAP_FIT * (1 - (gapRank - 1) / Math.max(totalGaps, 1)));

  // 2. Margin score (0-30): based on historical avg gross profit
  const avgGross = metric.avg_gross_profit_90d || metric.avg_gross_profit_30d || 0;
  const marginScore = avgGross > 0
    ? Math.min(W_MARGIN, Math.round((avgGross / 8000) * W_MARGIN))
    : 0;

  // 3. Price score (0-20): how much below historical acquisition cost is the guide?
  const guidePrice = listing.guide_price || listing.asking_price;
  const historicalAcq = metric.avg_acquisition_cost_90d;
  let priceScore = 0;
  if (guidePrice && historicalAcq && historicalAcq > 0) {
    const discount = (historicalAcq - guidePrice) / historicalAcq;
    if (discount > 0.15) priceScore = W_PRICE;           // >15% below historical: full score
    else if (discount > 0.05) priceScore = Math.round(W_PRICE * 0.7);  // 5-15%: 70%
    else if (discount >= 0) priceScore = Math.round(W_PRICE * 0.4);    // at or just above: 40%
    else priceScore = 0;                                  // more expensive than historical
  }

  // 4. Condition score (0-10): penalties for flags
  let conditionScore = W_CONDITION;
  if (listing.wovr_indicator) conditionScore -= 10;       // WOVR: disqualifying
  if (listing.damage_noted) conditionScore -= 5;
  if (!listing.keys_present) conditionScore -= 2;
  if (!listing.starts_drives) conditionScore -= 3;
  if (listing.reserve_status === "no_reserve") conditionScore += 3; // bonus
  conditionScore = Math.max(0, Math.min(W_CONDITION, conditionScore));

  // Skip WOVR entirely
  if (listing.wovr_indicator) {
    return { gap_fit_score: 0, margin_score: 0, price_score: 0, condition_score: 0, composite_score: 0, target_acquisition_price: null, expected_gross_profit: null };
  }

  const compositeScore = gapFitScore + marginScore + priceScore + conditionScore;

  // Target acquisition price: historical avg acquisition cost, adjusted for condition
  let targetAcqPrice: number | null = null;
  let expectedGrossProfit: number | null = null;
  if (historicalAcq) {
    const conditionMultiplier = listing.damage_noted ? 0.88 : listing.wovr_indicator ? 0 : 1.0;
    targetAcqPrice = Math.round(historicalAcq * conditionMultiplier / 100) * 100; // round to nearest $100
    if (metric.avg_sale_price_90d) {
      expectedGrossProfit = metric.avg_sale_price_90d - targetAcqPrice;
    }
  }

  return {
    gap_fit_score: gapFitScore,
    margin_score: marginScore,
    price_score: priceScore,
    condition_score: conditionScore,
    composite_score: compositeScore,
    target_acquisition_price: targetAcqPrice,
    expected_gross_profit: expectedGrossProfit,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let fleetClientId: string | null = null;
  try {
    const body = await req.json();
    fleetClientId = body.fleet_client_id || null;
  } catch { /* no body */ }

  // Determine clients to process
  let clientIds: string[] = [];
  if (fleetClientId) {
    clientIds = [fleetClientId];
  } else {
    const { data: clients } = await sb.from("fleet_clients").select("id").eq("is_active", true);
    clientIds = (clients || []).map((c: { id: string }) => c.id);
  }

  const summary: Record<string, { listings_scored: number; instructions_created: number }> = {};

  for (const clientId of clientIds) {
    // 1. Load velocity metrics with stock gaps, ranked by opportunity value
    const { data: metrics } = await sb
      .from("fleet_velocity_metrics")
      .select("*")
      .eq("fleet_client_id", clientId)
      .gt("stock_gap_units", 0)
      .order("opportunity_value_monthly", { ascending: false })
      .limit(100);

    if (!metrics || metrics.length === 0) {
      console.log(`[FLEET-SCORE] Client ${clientId}: no stock gaps found, skipping`);
      continue;
    }

    // 2. Build a fast lookup: make+model+yearBand → metric
    const metricLookup = new Map<string, VelocityMetric & { gapRank: number }>();
    metrics.forEach((m: VelocityMetric, idx: number) => {
      const key = `${m.make}||${m.model}||${m.year_band}`;
      metricLookup.set(key, { ...m, gapRank: idx + 1 });
    });

    // 3. Fetch active listings from vehicle_listings (closing within 48h, or all active)
    const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { data: listings } = await sb
      .from("vehicle_listings")
      .select(`
        id, listing_id, make, model, year, km, trim_class, fuel,
        asking_price, guide_price, reserve_price,
        source, location, state, listing_url,
        sale_close_at, buy_method, auction_house,
        wovr_indicator, damage_noted, keys_present, starts_drives, reserve_status
      `)
      .or(`sale_close_at.lte.${cutoff},sale_close_at.is.null`)
      .eq("sale_status", "active")
      .limit(2000);

    if (!listings || listings.length === 0) {
      console.log(`[FLEET-SCORE] Client ${clientId}: no active listings found`);
      continue;
    }

    // 4. Score each listing
    const scoresToUpsert = [];
    const instructionsToCreate = [];
    let listingsScored = 0;

    for (const listing of listings as Listing[]) {
      const make = normalise(listing.make);
      const model = normalise(listing.model);
      const band = yearBand(listing.year);
      const key = `${make}||${model}||${band}`;

      const metric = metricLookup.get(key);
      if (!metric) continue; // not in our gap list

      const scores = scoreListing(listing, metric, metric.gapRank, metrics.length);
      if (scores.composite_score === 0) continue; // WOVR or no match

      listingsScored++;

      const expiresAt = listing.sale_close_at
        ? listing.sale_close_at
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      scoresToUpsert.push({
        fleet_client_id: clientId,
        listing_id: listing.listing_id,
        velocity_metric_id: metric.id,
        ...scores,
        historical_avg_sale_price: metric.avg_sale_price_90d,
        historical_avg_acquisition_cost: metric.avg_acquisition_cost_90d,
        historical_avg_gross_profit: metric.avg_gross_profit_90d,
        historical_days_to_sell: metric.avg_days_to_sell_90d,
        status: "active",
        expires_at: expiresAt,
        scored_at: new Date().toISOString(),
      });

      // Only create instructions for top-scoring opportunities (score >= 50)
      if (scores.composite_score >= 50) {
        instructionsToCreate.push({ listing, metric, scores, expiresAt });
      }
    }

    // 5. Upsert scores
    for (let i = 0; i < scoresToUpsert.length; i += 100) {
      await sb.from("fleet_opportunity_scores").upsert(
        scoresToUpsert.slice(i, i + 100),
        { onConflict: "fleet_client_id,listing_id" }
      );
    }

    // 6. Load buyers for routing
    const { data: buyers } = await sb
      .from("fleet_client_users")
      .select("user_id, speciality_makes, role")
      .eq("fleet_client_id", clientId)
      .eq("is_active", true)
      .in("role", ["buyer", "manager"]);

    const buyerList: BuyerUser[] = buyers || [];

    function assignBuyer(make: string): string | null {
      // Find a buyer with this make as a speciality
      const specialist = buyerList.find((b) =>
        b.speciality_makes && b.speciality_makes.map(normalise).includes(normalise(make))
      );
      if (specialist) return specialist.user_id;
      // Fall back to any buyer
      const anyBuyer = buyerList.find((b) => b.role === "buyer");
      return anyBuyer?.user_id || null;
    }

    // 7. Create instructions for top opportunities
    let instructionsCreated = 0;
    for (const { listing, metric, scores, expiresAt } of instructionsToCreate) {
      // Check if instruction already exists for this listing
      const { data: existing } = await sb
        .from("fleet_buyer_instructions")
        .select("id, status")
        .eq("fleet_client_id", clientId)
        .eq("listing_id", listing.listing_id)
        .single();

      if (existing && !["expired", "lost", "passed"].includes(existing.status)) continue;

      const assignedBuyerId = assignBuyer(listing.make || "");
      const priority = scores.composite_score >= 75 ? "critical" : scores.composite_score >= 60 ? "high" : "normal";

      const closeTime = listing.sale_close_at
        ? new Date(listing.sale_close_at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: "Australia/Perth" })
        : "TBC";

      const instructionText = [
        `${priority.toUpperCase()}: ${listing.year || ""} ${listing.make || ""} ${listing.model || ""}`,
        listing.km ? `${listing.km.toLocaleString()} km` : "",
        `${listing.source || listing.auction_house || "Market"} — closes ${closeTime} AWST`,
        scores.target_acquisition_price ? `Target: $${scores.target_acquisition_price.toLocaleString()}` : "",
        metric.avg_sale_price_90d ? `Avg sell: $${Math.round(metric.avg_sale_price_90d).toLocaleString()}` : "",
        metric.avg_days_to_sell_90d ? `${Math.round(metric.avg_days_to_sell_90d)} days to sell` : "",
        scores.expected_gross_profit ? `Expected gross: $${Math.round(scores.expected_gross_profit).toLocaleString()}` : "",
        `Fills a high-priority stock gap (${metric.stock_gap_units} unit${metric.stock_gap_units !== 1 ? "s" : ""} needed).`,
      ].filter(Boolean).join(" · ");

      await sb.from("fleet_buyer_instructions").upsert({
        fleet_client_id: clientId,
        listing_id: listing.listing_id,
        assigned_buyer_id: assignedBuyerId,
        make: listing.make,
        model: listing.model,
        year: listing.year,
        km: listing.km,
        trim: listing.trim_class,
        source: listing.source,
        auction_house: listing.auction_house,
        listing_url: listing.listing_url,
        sale_close_at: listing.sale_close_at,
        buy_method: listing.buy_method,
        target_acquisition_price: scores.target_acquisition_price,
        expected_gross_profit: scores.expected_gross_profit,
        historical_days_to_sell: metric.avg_days_to_sell_90d,
        composite_score: scores.composite_score,
        instruction_text: instructionText,
        priority,
        wovr_indicator: listing.wovr_indicator || false,
        damage_noted: listing.damage_noted || false,
        no_reserve: listing.reserve_status === "no_reserve",
        status: "pending",
        updated_at: new Date().toISOString(),
      }, { onConflict: "fleet_client_id,listing_id", ignoreDuplicates: false });

      instructionsCreated++;
    }

    summary[clientId] = { listings_scored: listingsScored, instructions_created: instructionsCreated };
    console.log(`[FLEET-SCORE] Client ${clientId}: ${listingsScored} scored, ${instructionsCreated} instructions created`);

    await sb.from("cron_audit_log").insert({
      cron_name: "fleet-score-opportunities",
      status: "success",
      detail: `Client ${clientId}: ${listingsScored} scored, ${instructionsCreated} instructions`,
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ success: true, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
