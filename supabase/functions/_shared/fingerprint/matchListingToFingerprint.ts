/**
 * FINGERPRINT MATCHING LAYER — Phase 2
 *
 * Scores outward_search_results listings against a dealer's active fingerprints.
 * Architecture: Structural Gate (incl. target ceiling) → Tolerance Scoring → Margin Calc → Confidence → Final Score
 *
 * Max score: 45 pts (tolerance 25 + margin 10 + confidence 10)
 * Viability threshold: 15 pts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StagedListing = {
  id: string;
  make_norm: string | null;
  model_norm: string | null;
  variant_family: string | null;
  year: number | null;
  odometer_km: number | null;
  price_aud: number | null;
  listing_url: string;
};

type Fingerprint = {
  id: string;
  fingerprint_id: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  is_active: boolean;
  expires_at: string | null;
  dealer_profile_id: string | null;
};

type LiquidityProfile = {
  median_sell_price: number | null;
  median_profit: number | null;
  p75_profit: number | null;
  confidence_tier: string;
  flip_count: number;
  min_viable_profit_floor: number;
};

type TargetRow = {
  variant: string | null;
  max_buy_price: number | null;
  median_sale_price: number | null;
  median_profit: number | null;
};

export type FingerprintMatchResult = {
  fingerprint_id: string;
  match_score: number;
  margin_estimate: number;
  margin_band: { low: number; high: number };
  retail_truth: number;
  effective_cost: number;
  turn_speed_delta: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  viable: boolean;
  match_reasons: string[];
};

type GateFailure = { pass: false; reason: string };
type GateSuccess = { pass: true };

const VIABILITY_THRESHOLD = 15;

// ─── Target ceiling resolution ──────────────────────────────────────────────

function resolveCeiling(
  targets: TargetRow[],
  variantFamily: string | null,
): number | null {
  // 1. Exact variant match
  const exact = targets.find(
    (t) =>
      t.variant != null &&
      variantFamily != null &&
      t.variant.toLowerCase() === variantFamily.toLowerCase(),
  );
  // 2. Wildcard (variant is null)
  const wildcard = targets.find((t) => t.variant == null);

  const row = exact ?? wildcard ?? null;
  if (!row) return null;

  if (row.max_buy_price != null) return Number(row.max_buy_price);
  if (row.median_sale_price != null && row.median_profit != null) {
    return Number(row.median_sale_price) - Number(row.median_profit);
  }
  return null;
}

// ─── Step 1: Structural Gate ────────────────────────────────────────────────

function structuralGate(
  listing: StagedListing,
  fp: Fingerprint,
  targetCeiling: number | null,
): GateSuccess | GateFailure {
  if (!listing.make_norm || !listing.model_norm) {
    return { pass: false, reason: "LISTING_IDENTITY_MISSING" };
  }

  if (listing.make_norm.toLowerCase() !== fp.make.toLowerCase()) {
    return { pass: false, reason: "MAKE_MISMATCH" };
  }

  if (listing.model_norm.toLowerCase() !== fp.model.toLowerCase()) {
    return { pass: false, reason: "MODEL_MISMATCH" };
  }

  if (
    fp.variant_family &&
    listing.variant_family &&
    !listing.variant_family.toLowerCase().includes(fp.variant_family.toLowerCase())
  ) {
    return { pass: false, reason: "VARIANT_FAMILY_MISMATCH" };
  }

  // Target ceiling gate — hard discard if listing price exceeds dealer's stated ceiling
  if (
    targetCeiling != null &&
    listing.price_aud != null &&
    listing.price_aud > targetCeiling
  ) {
    return { pass: false, reason: "ABOVE_TARGET_CEILING" };
  }

  return { pass: true };
}

// ─── Step 2: Tolerance Scoring (max 25 pts) ─────────────────────────────────

function toleranceScore(
  listing: StagedListing,
  fp: Fingerprint,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Year: 10 in range, 5 adjacent (±1), 0 beyond
  if (listing.year != null) {
    if (listing.year >= fp.year_min && listing.year <= fp.year_max) {
      score += 10;
      reasons.push("year_in_range");
    } else if (listing.year >= fp.year_min - 1 && listing.year <= fp.year_max + 1) {
      score += 5;
      reasons.push("year_adjacent");
    }
  }

  // KM: 10 in range, 5 within 15% buffer, 0 beyond
  if (listing.odometer_km != null && fp.min_km != null && fp.max_km != null) {
    const kmBuffer = (fp.max_km - fp.min_km) * 0.15;
    if (listing.odometer_km >= fp.min_km && listing.odometer_km <= fp.max_km) {
      score += 10;
      reasons.push("km_in_range");
    } else if (
      listing.odometer_km >= fp.min_km - kmBuffer &&
      listing.odometer_km <= fp.max_km + kmBuffer
    ) {
      score += 5;
      reasons.push("km_adjacent");
    }
  }

  // Variant: 5 exact match, 0 family-only (gate already passed)
  if (
    fp.variant_family &&
    listing.variant_family &&
    listing.variant_family.toLowerCase() === fp.variant_family.toLowerCase()
  ) {
    score += 5;
    reasons.push("variant_exact");
  }

  return { score, reasons };
}

// ─── Step 3: Margin Calculation (10 pts) ────────────────────────────────────

function marginCalc(
  listing: StagedListing,
  liq: LiquidityProfile,
): {
  score: number;
  margin_estimate: number;
  retail_truth: number;
  effective_cost: number;
  margin_band: { low: number; high: number };
  viable: boolean;
  reasons: string[];
} {
  const retail_truth = liq.median_sell_price ?? 0;
  const effective_cost = listing.price_aud ?? 0;
  const margin_estimate = retail_truth - effective_cost;
  const margin_band = {
    low: liq.median_profit ?? 0,
    high: liq.p75_profit ?? 0,
  };
  const viable = margin_estimate >= liq.min_viable_profit_floor;
  const reasons: string[] = [];

  let score = 0;
  if (viable) {
    score = 10;
    reasons.push("margin_viable");
    if (margin_estimate > (liq.p75_profit ?? Infinity)) {
      reasons.push("margin_above_p75");
    }
  } else {
    reasons.push("margin_below_floor");
  }

  return { score, margin_estimate, retail_truth, effective_cost, margin_band, viable, reasons };
}

// ─── Step 4: Confidence Tier (10 pts) ───────────────────────────────────────

function resolveConfidence(
  liquidityTier: string,
  toleranceScoreVal: number,
  flipCount: number,
  viable: boolean,
): "HIGH" | "MEDIUM" | "LOW" {
  if (!viable) return "LOW";
  if (liquidityTier === "HIGH" && toleranceScoreVal >= 20 && flipCount >= 10) return "HIGH";
  if (liquidityTier === "HIGH" && toleranceScoreVal >= 10) return "MEDIUM";
  if (liquidityTier === "MEDIUM" && toleranceScoreVal >= 15) return "MEDIUM";
  return "LOW";
}

const CONFIDENCE_SCORE: Record<string, number> = { HIGH: 10, MEDIUM: 5, LOW: 0 };

// ─── Single fingerprint match ───────────────────────────────────────────────

function matchOne(
  listing: StagedListing,
  fp: Fingerprint,
  liq: LiquidityProfile | null,
  targetCeiling: number | null,
): FingerprintMatchResult | null {
  // Step 1: Structural Gate (includes target ceiling)
  const gate = structuralGate(listing, fp, targetCeiling);
  if (!gate.pass) return null;

  // Step 2: Tolerance
  const tol = toleranceScore(listing, fp);

  // No liquidity profile → can't calculate margin
  if (!liq || liq.median_sell_price == null) {
    return null;
  }

  // Step 3: Margin
  const mar = marginCalc(listing, liq);

  // Step 4: Confidence
  const conf = resolveConfidence(liq.confidence_tier, tol.score, liq.flip_count, mar.viable);
  const confScore = CONFIDENCE_SCORE[conf] ?? 0;

  // Step 5: Final Score
  const match_score = tol.score + mar.score + confScore;
  const reasons = [...tol.reasons, ...mar.reasons, `confidence_${conf.toLowerCase()}`];

  return {
    fingerprint_id: fp.fingerprint_id,
    match_score,
    margin_estimate: mar.margin_estimate,
    margin_band: mar.margin_band,
    retail_truth: mar.retail_truth,
    effective_cost: mar.effective_cost,
    turn_speed_delta: null, // Phase 3
    confidence: conf,
    viable: mar.viable,
    match_reasons: reasons,
  };
}

// ─── Main: score a batch of staged listings ─────────────────────────────────

export async function scoreListingsForDealer(
  sb: ReturnType<typeof createClient>,
  dealerProfileId: string,
  listings: StagedListing[],
): Promise<{ scored: number; no_match: number }> {
  if (listings.length === 0) return { scored: 0, no_match: 0 };

  // 1. Fetch all active fingerprints for this dealer
  const { data: fps, error: fpErr } = await sb
    .from("dealer_fingerprints")
    .select("id, fingerprint_id, make, model, variant_family, year_min, year_max, min_km, max_km, is_active, expires_at, dealer_profile_id")
    .eq("dealer_profile_id", dealerProfileId)
    .eq("is_active", true);

  if (fpErr || !fps?.length) {
    console.warn(`[fingerprint-scorer] No active fingerprints for dealer ${dealerProfileId}`);
    return { scored: 0, no_match: listings.length };
  }

  // Filter expired
  const now = new Date().toISOString();
  const activeFps = fps.filter(
    (f) => !f.expires_at || f.expires_at > now,
  ) as Fingerprint[];

  if (activeFps.length === 0) {
    return { scored: 0, no_match: listings.length };
  }

  // 2. Resolve account_id from dealer_profile for fingerprint_targets lookup
  const { data: profileRow } = await sb
    .from("dealer_profiles")
    .select("account_id")
    .eq("id", dealerProfileId)
    .single();

  const accountId = profileRow?.account_id ?? null;

  // 3. Pre-fetch liquidity profiles + fingerprint_targets for all make/model combos
  const makeModelKeys = [
    ...new Set(activeFps.map((f) => `${f.make.toLowerCase()}|${f.model.toLowerCase()}`)),
  ];
  const liqMap = new Map<string, LiquidityProfile>();
  const targetsMap = new Map<string, TargetRow[]>();

  for (const key of makeModelKeys) {
    const [make, model] = key.split("|");

    // Liquidity profile (best by flip_count)
    const liqPromise = sb
      .from("dealer_liquidity_profiles")
      .select("median_sell_price, median_profit, p75_profit, confidence_tier, flip_count, min_viable_profit_floor")
      .eq("dealer_key", dealerProfileId)
      .ilike("make", make)
      .ilike("model", model)
      .order("flip_count", { ascending: false })
      .limit(1);

    // Fingerprint targets — fetch ALL rows for make/model (variant resolved in TS)
    const targetsPromise = accountId
      ? sb
          .from("fingerprint_targets")
          .select("variant, max_buy_price, median_sale_price, median_profit")
          .eq("account_id", accountId)
          .ilike("make", make)
          .ilike("model", model)
          .eq("status", "active")
      : Promise.resolve({ data: null });

    const [liqResult, targetsResult] = await Promise.all([liqPromise, targetsPromise]);

    if (liqResult.data?.length) {
      liqMap.set(key, liqResult.data[0] as LiquidityProfile);
    }
    if (targetsResult.data?.length) {
      targetsMap.set(key, targetsResult.data as TargetRow[]);
    }
  }

  // 4. Score each listing against all fingerprints, take best
  let scored = 0;
  let no_match = 0;

  for (const listing of listings) {
    const results: FingerprintMatchResult[] = [];

    for (const fp of activeFps) {
      const mmKey = `${fp.make.toLowerCase()}|${fp.model.toLowerCase()}`;
      const liq = liqMap.get(mmKey) ?? null;
      const targets = targetsMap.get(mmKey) ?? [];
      const ceiling = resolveCeiling(targets, listing.variant_family);
      const result = matchOne(listing, fp, liq, ceiling);
      if (result && result.viable && result.match_score >= VIABILITY_THRESHOLD) {
        results.push(result);
      }
    }

    if (results.length === 0) {
      await sb
        .from("outward_search_results")
        .update({ status: "no_match", scored_at: new Date().toISOString() })
        .eq("id", listing.id);
      no_match++;
      continue;
    }

    // Best match wins
    results.sort((a, b) => b.match_score - a.match_score);
    const best = results[0];

    await sb
      .from("outward_search_results")
      .update({
        fingerprint_id: best.fingerprint_id,
        match_score: best.match_score,
        margin_estimate: best.margin_estimate,
        margin_band_low: best.margin_band.low,
        margin_band_high: best.margin_band.high,
        retail_truth: best.retail_truth,
        confidence: best.confidence,
        match_reasons: best.match_reasons,
        status: "scored",
        scored_at: new Date().toISOString(),
      })
      .eq("id", listing.id);
    scored++;
  }

  return { scored, no_match };
}
