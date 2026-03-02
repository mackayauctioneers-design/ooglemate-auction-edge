/**
 * MODO (MICA) — Vehicle Condition Assessment Types & Validation
 *
 * MODO is strictly a condition and risk assessor.
 * It does NOT estimate market value, compare listings, or override pricing.
 * It adjusts recon buffer only.
 */

import type { TradeInOffer } from "./scoreValoComps.ts";

// ─── Input Contract ─────────────────────────────────────────────

export interface ModoInput {
  vehicle_identity: {
    make: string;
    model: string;
    variant_family: string | null;
    year: number;
    km: number | null;
  };
  dealer_input: {
    condition_stated: string | null;
    allowance: number;
    description_transcript: string;
  };
  photos: string[]; // signed URLs
}

// ─── MODO Response ──────────────────────────────────────────────

export interface ModoResponse {
  condition_rating: number; // 1–5
  visible_accessories: string[];
  damage_flags: string[];
  risk_flags: string[];
  recommended_recon_buffer: number;
  notes: string;
}

// ─── Validation ─────────────────────────────────────────────────

export function validateModoResponse(raw: unknown): ModoResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("MODO_INVALID: response is not an object");
  }

  const r = raw as Record<string, unknown>;

  // Required keys
  const requiredKeys: (keyof ModoResponse)[] = [
    "condition_rating",
    "visible_accessories",
    "damage_flags",
    "risk_flags",
    "recommended_recon_buffer",
    "notes",
  ];

  for (const key of requiredKeys) {
    if (!(key in r)) {
      throw new Error(`MODO_INVALID: missing key "${key}"`);
    }
  }

  // Unexpected keys
  const allowedKeys = new Set(requiredKeys);
  for (const key of Object.keys(r)) {
    if (!allowedKeys.has(key as keyof ModoResponse)) {
      throw new Error(`MODO_INVALID: unexpected key "${key}"`);
    }
  }

  // condition_rating: 1–5
  if (typeof r.condition_rating !== "number" || r.condition_rating < 1 || r.condition_rating > 5 || !Number.isInteger(r.condition_rating)) {
    throw new Error("MODO_INVALID: condition_rating must be integer 1–5");
  }

  // recommended_recon_buffer: 0–15000
  if (typeof r.recommended_recon_buffer !== "number" || r.recommended_recon_buffer < 0 || r.recommended_recon_buffer > 15000) {
    throw new Error("MODO_INVALID: recommended_recon_buffer must be 0–15000");
  }

  // Arrays
  if (!Array.isArray(r.visible_accessories)) throw new Error("MODO_INVALID: visible_accessories must be array");
  if (!Array.isArray(r.damage_flags)) throw new Error("MODO_INVALID: damage_flags must be array");
  if (!Array.isArray(r.risk_flags)) throw new Error("MODO_INVALID: risk_flags must be array");

  // notes
  if (typeof r.notes !== "string") throw new Error("MODO_INVALID: notes must be string");

  return r as unknown as ModoResponse;
}

// ─── Recon Adjustment ───────────────────────────────────────────

const DEFAULT_RECON: Record<string, number> = {
  excellent: 500,
  good: 1500,
  fair: 3000,
  poor: 5000,
};

export interface AdjustedOffer {
  low: number;
  mid: number;
  high: number;
  recon_delta: number;
  modo_recon: number;
  default_recon: number;
  modo_condition_rating: number;
}

export function applyModoAdjustment(
  originalOffer: TradeInOffer,
  marketMedian: number,
  modo: ModoResponse,
): AdjustedOffer {
  const defaultRecon = DEFAULT_RECON[originalOffer.condition_used] ?? 1500;
  const delta = modo.recommended_recon_buffer - defaultRecon;

  let adjustedMid = originalOffer.mid - delta;

  // Never allow adjustedMid to exceed market median minus allowance
  const ceiling = marketMedian - originalOffer.allowance_used;
  adjustedMid = Math.min(adjustedMid, ceiling);
  adjustedMid = Math.max(0, adjustedMid);

  const adjustedLow = Math.max(0, adjustedMid - 1500);
  const adjustedHigh = Math.max(0, adjustedMid + 1000);

  return {
    low: adjustedLow,
    mid: adjustedMid,
    high: adjustedHigh,
    recon_delta: delta,
    modo_recon: modo.recommended_recon_buffer,
    default_recon: defaultRecon,
    modo_condition_rating: modo.condition_rating,
  };
}

// ─── Confidence Downgrade ───────────────────────────────────────

import type { Confidence } from "./scoreValoComps.ts";

export function applyModoConfidence(
  currentConfidence: Confidence,
  modo: ModoResponse,
): Confidence {
  const shouldDowngrade = modo.condition_rating <= 2 || modo.risk_flags.length > 0;
  if (!shouldDowngrade) return currentConfidence;

  if (currentConfidence === "HIGH") return "MED";
  if (currentConfidence === "MED") return "LOW";
  return "LOW";
}
