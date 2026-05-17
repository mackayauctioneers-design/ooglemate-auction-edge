/**
 * Deterministic Gates — strict pass/fail rules applied to every candidate.
 *
 * Each gate is a pure function. First failure = rejected with reason_code.
 * Reasons are drawn from a fixed enum so the UI/operator debug can render them.
 */

import { extractSeries } from "../taxonomy/derivePlatform.ts";
import { checkBannedSubstitution } from "./banned-substitutions.ts";
import type { StrictIntent } from "./strict-intent.ts";

export type RejectReason =
  | "wrong_make"
  | "wrong_model_family"
  | "banned_substitution"
  | "wrong_generation"
  | "wrong_body"
  | "variant_conflict"
  | "year_out_of_tolerance"
  | "insufficient_identity_confidence"
  | "missing_required_fields";

export interface NormalizedCandidate {
  make: string | null;
  model: string | null;
  variant: string | null;
  series: string | null;
  body_type: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  source: string;
  layer: "internal" | "shadow" | "outward";
  url: string | null;
  identity_confidence: number; // 0..100 from normalizeVehicleIdentity
  raw: Record<string, unknown>;
}

export interface GateResult {
  passed: boolean;
  reason?: RejectReason;
  detail?: string;
  rule: string;
}

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function gateRequiredFields(c: NormalizedCandidate): GateResult {
  if (!c.make || !c.model) return { passed: false, rule: "required_fields", reason: "missing_required_fields", detail: "make/model missing after normalization" };
  return { passed: true, rule: "required_fields" };
}

export function gateMake(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (!intent.make) return { passed: true, rule: "make" };
  if (norm(intent.make) !== norm(c.make)) {
    return { passed: false, rule: "make", reason: "wrong_make", detail: `${c.make} != ${intent.make}` };
  }
  return { passed: true, rule: "make" };
}

export function gateModelFamily(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (!intent.model) return { passed: true, rule: "model_family" };
  const i = norm(intent.model);
  const m = norm(c.model);
  if (!m) return { passed: false, rule: "model_family", reason: "wrong_model_family", detail: "candidate model missing" };
  // Exact or one-contains-other (handles "LANDCRUISER 79" vs "LANDCRUISER")
  if (i === m || i.includes(m) || m.includes(i)) return { passed: true, rule: "model_family" };
  return { passed: false, rule: "model_family", reason: "wrong_model_family", detail: `${c.model} != ${intent.model}` };
}

export function gateBannedSubstitution(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  const banned = checkBannedSubstitution(intent.make, intent.model ?? intent.series, c.model ?? c.series);
  if (banned) {
    return { passed: false, rule: "banned_substitution", reason: "banned_substitution", detail: banned.why };
  }
  return { passed: true, rule: "banned_substitution" };
}

export function gateGeneration(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (!intent.series) return { passed: true, rule: "generation" };
  const cs = c.series ?? extractSeries(c.make ?? "", c.model ?? "");
  if (!cs) {
    // Candidate generation unknown — allow through only if year is compatible
    return { passed: true, rule: "generation", detail: "candidate series unknown, year-compatible pass" };
  }
  if (cs !== intent.series) {
    return { passed: false, rule: "generation", reason: "wrong_generation", detail: `${cs} != ${intent.series}` };
  }
  return { passed: true, rule: "generation" };
}

export function gateBody(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (!intent.body_type) return { passed: true, rule: "body" };
  if (!c.body_type) return { passed: true, rule: "body", detail: "candidate body unknown" };
  const i = norm(intent.body_type);
  const cb = norm(c.body_type);
  if (i === cb) return { passed: true, rule: "body" };
  // Compatible families
  const SUV_LIKE = ["SUV","WAGON"]; // wagons sometimes labelled SUV in feeds
  if (SUV_LIKE.includes(intent.body_type) && SUV_LIKE.includes(c.body_type)) return { passed: true, rule: "body", detail: "suv/wagon compatible" };
  return { passed: false, rule: "body", reason: "wrong_body", detail: `${c.body_type} != ${intent.body_type}` };
}

export function gateVariant(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (!intent.variant) return { passed: true, rule: "variant" };
  if (!c.variant) return { passed: true, rule: "variant", detail: "candidate variant unknown" };
  const i = intent.variant.toUpperCase();
  const v = c.variant.toUpperCase();
  const tokenRe = new RegExp(`(?:^|[\\s\\-\\/,()]+)${i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[\\s\\-\\/,()]+|\\+|$)`, "i");
  if (v === i || tokenRe.test(v)) return { passed: true, rule: "variant" };
  return { passed: false, rule: "variant", reason: "variant_conflict", detail: `${c.variant} not ~ ${intent.variant}` };
}

export function gateYear(intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (!intent.year_min && !intent.year_max) return { passed: true, rule: "year" };
  if (c.year == null) return { passed: true, rule: "year", detail: "candidate year missing" };
  const min = intent.year_min ?? -Infinity;
  const max = intent.year_max ?? intent.year_min ?? Infinity;
  // Tolerance: if single-year intent and confidence < HIGH, allow +-1
  const tol = (intent.year_min && !intent.year_max && intent.model_confidence !== "HIGH") ? 1 : 0;
  if (c.year < min - tol || c.year > max + tol) {
    return { passed: false, rule: "year", reason: "year_out_of_tolerance", detail: `${c.year} not in [${min - tol},${max + tol}]` };
  }
  return { passed: true, rule: "year" };
}

export function gateIdentityConfidence(_intent: StrictIntent, c: NormalizedCandidate): GateResult {
  if (c.identity_confidence < 30) {
    return { passed: false, rule: "identity_confidence", reason: "insufficient_identity_confidence", detail: `confidence ${c.identity_confidence}` };
  }
  return { passed: true, rule: "identity_confidence" };
}

export const ALL_GATES = [
  gateRequiredFields,
  gateMake,
  gateModelFamily,
  gateBannedSubstitution,
  gateGeneration,
  gateBody,
  gateVariant,
  gateYear,
  gateIdentityConfidence,
] as const;
