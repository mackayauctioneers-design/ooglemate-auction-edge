/**
 * VALO Comp-Scoring Function
 *
 * Deterministic, explainable scoring for trade-in valuation comparables.
 * Selects Anchor + Backups, computes market range (P25/P50/P75),
 * and derives suggested trade-in offer range.
 *
 * No magic. No oracle. Just math on governed comps.
 */

import type { ParsedIntent, AdapterResult } from "../outward-search/types.ts";
import { extractSeries } from "../taxonomy/derivePlatform.ts";

// ─── Scoring Helpers ────────────────────────────────────────────

function scoreKm(targetKm: number | null, compKm: number | null): number {
  if (!targetKm || !compKm) return 0;
  const diff = Math.abs(targetKm - compKm);
  if (diff <= 5000) return 15;
  if (diff <= 15000) return 10;
  if (diff <= 30000) return 5;
  return 0;
}

function scoreYear(targetYear: number | null, compYear: number | null): number {
  if (!targetYear || !compYear) return 0;
  const diff = Math.abs(targetYear - compYear);
  if (diff === 0) return 15;
  if (diff === 1) return 8;
  return 0;
}

/**
 * Basic accessory matching against comp text surface.
 * Returns list of matched terms.
 */
function matchAccessories(surface: string, terms: string[]): { hits: string[]; evidence: FeatureEvidence[] } {
  const hits: string[] = [];
  const evidence: FeatureEvidence[] = [];
  for (const t of terms) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(.{0,30}\\b${escaped}\\b.{0,30})`, "i");
    const match = surface.match(regex);
    if (match) {
      hits.push(t.toUpperCase());
      evidence.push({ code: t.toUpperCase(), snippet: match[1].trim() });
    }
  }
  return { hits, evidence };
}

// ─── Per-Comp Scoring ───────────────────────────────────────────

export interface FeatureEvidence {
  code: string;
  snippet: string;
}

export interface ScoredComp extends AdapterResult {
  valo_score: number;
  valo_reasons: string[];
  feature_hits: string[];
  feature_evidence: FeatureEvidence[];
}

export function scoreValoComp(
  intent: ParsedIntent,
  comp: AdapterResult,
): ScoredComp {
  let score = 0;
  const reasons: string[] = [];
  let featureHits: string[] = [];
  let featureEvidence: FeatureEvidence[] = [];

  // Exact variant match
  if (
    comp.variant &&
    intent.badge &&
    comp.variant.toUpperCase() === intent.badge.toUpperCase()
  ) {
    score += 20;
    reasons.push("EXACT_VARIANT");
  }

  // Engine match (critical for pricing accuracy)
  if (intent.engine_type && comp.engine_type) {
    if (comp.engine_type.toUpperCase() === intent.engine_type.toUpperCase()) {
      score += 15;
      reasons.push("ENGINE_MATCH");
    } else {
      // Engine mismatch is a significant pricing signal — penalize
      score -= 10;
      reasons.push("ENGINE_MISMATCH");
    }
  } else if (intent.engine_type && !comp.engine_type) {
    // Comp has unknown engine — slight penalty
    score -= 3;
    reasons.push("ENGINE_UNKNOWN");
  }

  // Year closeness
  const yearScore = scoreYear(intent.year_min, comp.year);
  if (yearScore > 0) {
    score += yearScore;
    reasons.push(yearScore === 15 ? "SAME_YEAR" : "YEAR_CLOSE");
  }

  // KM closeness
  const kmScore = scoreKm(intent.max_km, comp.km);
  if (kmScore > 0) {
    score += kmScore;
    reasons.push(
      kmScore === 15
        ? "KM_VERY_CLOSE"
        : kmScore === 10
          ? "KM_CLOSE"
          : "KM_IN_RANGE",
    );
  }

  // State match
  if (intent.state && comp.state && intent.state === comp.state) {
    score += 5;
    reasons.push("SAME_STATE");
  }

  // Accessory match
  if (intent.accessory_terms?.length) {
    const surface = `${comp.title} ${comp.variant ?? ""} ${comp.description ?? ""}`;
    const result = matchAccessories(surface, intent.accessory_terms);
    featureHits = result.hits;
    featureEvidence = result.evidence;
    if (result.hits.length > 0) {
      score += 10;
      reasons.push(`ACCESSORY_MATCH:${result.hits.join(",")}`);
    }
  }

  // Internal source bonus
  if (comp.source === "internal_db") {
    score += 5;
    reasons.push("INTERNAL_SOURCE");
  }

  return { ...comp, valo_score: score, valo_reasons: reasons, feature_hits: featureHits, feature_evidence: featureEvidence };
}

// ─── Anchor + Backup Selection ──────────────────────────────────

export interface ValoSelection {
  anchor: ScoredComp;
  backups: ScoredComp[];
}

export function selectAnchorAndBackups(
  scored: ScoredComp[],
): ValoSelection | null {
  if (scored.length === 0) return null;

  const sorted = [...scored].sort((a, b) => b.valo_score - a.valo_score);
  const anchor = sorted[0];

  // Backups should differ from anchor by URL to avoid duplicates
  const backups = sorted
    .filter((c) => c.url !== anchor.url)
    .slice(0, 2);

  return { anchor, backups };
}

// ─── Statistical Helpers ────────────────────────────────────────

/** Trim top/bottom 10% of values (if enough data) */
function trimOutliers(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * 0.1);
  return sorted.slice(trim, sorted.length - trim);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── Market Range ───────────────────────────────────────────────

export interface MarketRange {
  p25: number;
  median: number;
  p75: number;
  comp_count: number;
  trimmed: boolean;
}

export function computeMarketRange(comps: ScoredComp[]): MarketRange | null {
  const prices = comps
    .map((c) => c.price ?? c.effective_cost)
    .filter((p): p is number => p != null && p > 0);

  if (prices.length < 3) return null;

  const clean = prices.length >= 10 ? trimOutliers(prices) : prices;

  return {
    p25: percentile(clean, 0.25),
    median: percentile(clean, 0.5),
    p75: percentile(clean, 0.75),
    comp_count: prices.length,
    trimmed: prices.length >= 10,
  };
}

// ─── Trade-In Offer Range ───────────────────────────────────────

const RECON_BUFFER: Record<string, number> = {
  excellent: 500,
  good: 1500,
  fair: 3000,
  poor: 5000,
};

export interface TradeInOffer {
  low: number;
  mid: number;
  high: number;
  allowance_used: number;
  recon_buffer_used: number;
  condition_used: string;
}

export function computeTradeInOffer(
  marketMedian: number,
  intent: ParsedIntent,
): TradeInOffer {
  const allowance = intent.allowance_aud ?? 1000;
  const condition = intent.condition ?? "good";
  const reconBuffer = RECON_BUFFER[condition] ?? 1500;

  const mid = marketMedian - allowance - reconBuffer;
  const low = mid - 1500;
  const high = mid + 1000;

  return {
    low: Math.max(0, low),
    mid: Math.max(0, mid),
    high: Math.max(0, high),
    allowance_used: allowance,
    recon_buffer_used: reconBuffer,
    condition_used: condition,
  };
}

// ─── Confidence ─────────────────────────────────────────────────

export type Confidence = "HIGH" | "MED" | "LOW";

export function computeConfidence(compCount: number): Confidence {
  if (compCount >= 15) return "HIGH";
  if (compCount >= 8) return "MED";
  return "LOW";
}

// ─── Full VALO Result ───────────────────────────────────────────

export interface ValoResult {
  anchor: ScoredComp;
  backups: ScoredComp[];
  market: MarketRange;
  trade_in_offer: TradeInOffer;
  confidence: Confidence;
  all_scored: ScoredComp[];
}

/**
 * Run the full VALO comp-scoring pipeline.
 * Expects pre-filtered comps (structural gates already applied).
 */
export function runValoScoring(
  intent: ParsedIntent,
  comps: AdapterResult[],
): ValoResult | null {
  // ── Series gate: reject cross-generation comps before scoring ──
  let filtered = comps;
  if (intent.series) {
    filtered = comps.filter((c) => {
      // Extract series from comp title (Perplexity comps have title but no model field)
      const titleUpper = (c.title || "").toUpperCase();
      // Try to detect make/model from title for series extraction
      const compMake = intent.make || "";
      const compModel = c.title || "";
      const compSeries = extractSeries(compMake, compModel);
      // If comp has detectable series and it differs, reject
      if (compSeries && compSeries !== intent.series) {
        console.log(`VALO series gate: rejected "${c.title}" (${compSeries} ≠ ${intent.series})`);
        return false;
      }
      return true;
    });
    if (filtered.length < comps.length) {
      console.log(`VALO series gate: ${comps.length - filtered.length} comps rejected, ${filtered.length} remain`);
    }
  }

  // Score all comps
  const scored = filtered.map((c) => scoreValoComp(intent, c));

  // Select anchor + backups
  const selection = selectAnchorAndBackups(scored);
  if (!selection) return null;

  // Market range
  const market = computeMarketRange(scored);
  if (!market) return null;

  // Trade-in offer
  const offer = computeTradeInOffer(market.median, intent);

  // Confidence
  const confidence = computeConfidence(market.comp_count);

  return {
    anchor: selection.anchor,
    backups: selection.backups,
    market,
    trade_in_offer: offer,
    confidence,
    all_scored: scored,
  };
}
