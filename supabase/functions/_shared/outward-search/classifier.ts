/**
 * Classifier — runs all gates on a candidate and assigns a bucket.
 *
 * Buckets:
 *   exact_match  – all gates pass, identity_confidence >= 80
 *   near_match   – all gates pass, identity_confidence in [60..80)
 *   ambiguous    – all gates pass but identity_confidence < 60
 *   rejected     – any gate failed
 *
 * Returns the full rule trace for operator debug visibility.
 */

import { ALL_GATES, type NormalizedCandidate, type RejectReason } from "./gates.ts";
import type { StrictIntent } from "./strict-intent.ts";

export type Bucket = "exact_match" | "near_match" | "ambiguous" | "rejected";

export interface ClassificationResult {
  bucket: Bucket;
  confidence_score: number; // 0..100
  rules_fired: string[];    // every gate that ran (passed or failed)
  passed_rules: string[];
  rejection_reason: RejectReason | null;
  rejection_detail: string | null;
}

export function classify(intent: StrictIntent, candidate: NormalizedCandidate): ClassificationResult {
  const rules_fired: string[] = [];
  const passed: string[] = [];

  for (const gate of ALL_GATES) {
    const r = gate(intent, candidate);
    rules_fired.push(r.rule + (r.detail ? `:${r.detail}` : ""));
    if (!r.passed) {
      return {
        bucket: "rejected",
        confidence_score: candidate.identity_confidence,
        rules_fired,
        passed_rules: passed,
        rejection_reason: r.reason ?? null,
        rejection_detail: r.detail ?? null,
      };
    }
    passed.push(r.rule);
  }

  // Identity confidence drives bucket
  let bucket: Bucket;
  if (candidate.identity_confidence >= 80) bucket = "exact_match";
  else if (candidate.identity_confidence >= 60) bucket = "near_match";
  else bucket = "ambiguous";

  return {
    bucket,
    confidence_score: candidate.identity_confidence,
    rules_fired,
    passed_rules: passed,
    rejection_reason: null,
    rejection_detail: null,
  };
}
