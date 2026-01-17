import { z } from "zod";

// Alert types
export type AlertType = "BUY" | "WATCH";
export type ConfidenceLabel = "high" | "medium" | "low";
export type HuntStatus = "active" | "paused" | "done" | "expired";
export type MatchDecision = "buy" | "watch" | "ignore" | "no_evidence";

// ============================================================
// Hunt Alert Payload - the payload stored in hunt_alerts.payload
// ============================================================

export const HuntAlertPayloadSchema = z.object({
  // Vehicle identity - allow null/undefined gracefully
  year: z.union([z.number().int(), z.null()]).optional(),
  make: z.union([z.string(), z.null()]).optional(),
  model: z.union([z.string(), z.null()]).optional(),
  variant: z.union([z.string(), z.null()]).optional(),
  km: z.union([z.number(), z.null()]).optional(),

  // Pricing
  asking_price: z.union([z.number(), z.null()]).optional(),
  proven_exit_value: z.union([z.number(), z.null()]).optional(),

  // Gap analysis
  gap_dollars: z.union([z.number(), z.null()]).optional(),
  gap_pct: z.union([z.number(), z.null()]).optional(),

  // Matching metadata
  match_score: z.union([z.number(), z.null()]).optional(),
  reasons: z.array(z.union([z.string(), z.null()])).optional(),

  // Source info
  source: z.union([z.string(), z.null()]).optional(),
  listing_url: z.union([z.string(), z.null()]).optional(),
  state: z.union([z.string(), z.null()]).optional(),
  suburb: z.union([z.string(), z.null()]).optional(),
});

export type HuntAlertPayload = z.infer<typeof HuntAlertPayloadSchema>;

// ============================================================
// Helper: Parse and validate payload with fallback
// ============================================================

export interface ParsedHuntAlertPayload {
  success: true;
  data: HuntAlertPayload;
}

export interface FailedHuntAlertPayload {
  success: false;
  error: string;
}

export type HuntAlertPayloadResult = ParsedHuntAlertPayload | FailedHuntAlertPayload;

/**
 * Safely parse a hunt alert payload from the database.
 * Returns a typed result with either the validated data or an error.
 */
export function parseHuntAlertPayload(payload: unknown): HuntAlertPayloadResult {
  const result = HuntAlertPayloadSchema.safeParse(payload);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  // Log the error for debugging but don't expose internals
  console.warn("[HuntAlertPayload] Validation failed:", result.error.format());
  return { 
    success: false, 
    error: `Invalid payload: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`
  };
}

// ============================================================
// Hunt Match (for type safety in UI)
// ============================================================

export interface HuntMatch {
  id: string;
  hunt_id: string;
  listing_id: string;
  match_score: number;
  priority_score: number | null;
  confidence_label: ConfidenceLabel | null;
  reasons: string[] | null;
  asking_price: number | null;
  proven_exit_value: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  decision: MatchDecision;
  matched_at: string;
  lane: string | null;
}

// ============================================================
// Hunt Scan (for type safety in UI)
// ============================================================

export interface HuntScanMetadata {
  sources_scanned?: string[];
  rejected_by_gates?: number;
  rejection_reasons?: Record<string, number>; // e.g. { "SERIES_MISMATCH": 5, "ENGINE_MISMATCH": 3 }
  scores?: Array<{ score: number; decision: string }>;
}

export interface HuntScan {
  id: string;
  hunt_id: string;
  started_at: string;
  completed_at: string | null;
  source: string | null;
  status: "running" | "ok" | "error";
  error: string | null;
  candidates_checked: number | null;
  matches_found: number | null;
  alerts_emitted: number | null;
  metadata?: HuntScanMetadata | null;
}

// ============================================================
// Hunt Alert (full row type for UI)
// ============================================================

export interface HuntAlert {
  id: string;
  hunt_id: string;
  listing_id: string;
  alert_type: AlertType;
  created_at: string;
  acknowledged_at: string | null;
  payload: unknown; // Raw from DB, must be parsed with parseHuntAlertPayload
}

// ============================================================
// Sale Hunt (the hunt configuration)
// ============================================================

export interface SaleHunt {
  id: string;
  dealer_id: string;
  source_sale_id: string | null;
  status: HuntStatus;
  priority: number;
  
  // Identity target
  year: number;
  make: string;
  model: string;
  variant_family: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  
  // Badge Authority Layer fields
  model_root: string | null;
  series_family: string | null;
  badge: string | null;
  badge_tier: number | null;
  body_type: string | null;
  engine_family: string | null;
  
  // LC79 Precision Pack fields
  cab_type: string | null;
  engine_code: string | null;
  engine_litres: number | null;
  cylinders: number | null;
  
  // KM targeting
  km: number | null;
  km_band: string | null;
  km_tolerance_pct: number;
  
  // Pricing truth
  proven_exit_method: string;
  proven_exit_value: number | null;
  min_gap_abs_buy: number;
  min_gap_pct_buy: number;
  min_gap_abs_watch: number;
  min_gap_pct_watch: number;
  
  // Source scope
  sources_enabled: string[];
  include_private: boolean;
  
  // Geo scope
  states: string[] | null;
  radius_km: number | null;
  geo_mode: string;
  
  // Freshness
  max_listing_age_days_buy: number;
  max_listing_age_days_watch: number;
  
  // Lifecycle
  created_at: string;
  expires_at: string | null;
  last_scan_at: string | null;
  scan_interval_minutes: number;
  notes: string | null;
  
  // Outward Hunt (Web Discovery)
  last_outward_scan_at: string | null;
  outward_interval_minutes: number | null;
  
  // Must-have keywords for picky buyers
  must_have_raw: string | null;
  must_have_tokens: string[] | null;
  must_have_mode: 'soft' | 'strict' | null;
}
