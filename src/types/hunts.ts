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
  // Vehicle identity
  year: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  variant: z.string().nullable().optional(),
  km: z.number().nullable().optional(),

  // Pricing
  asking_price: z.number().nullable(),
  proven_exit_value: z.number().nullable().optional(),

  // Gap analysis
  gap_dollars: z.number().nullable().optional(),
  gap_pct: z.number().nullable().optional(),

  // Matching metadata
  match_score: z.number().nullable().optional(),
  reasons: z.array(z.string()).optional(),

  // Source info
  source: z.string().nullable().optional(),
  listing_url: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  suburb: z.string().nullable().optional(),
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
  confidence_label: ConfidenceLabel | null;
  reasons: string[] | null;
  asking_price: number | null;
  proven_exit_value: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  decision: MatchDecision;
  matched_at: string;
}

// ============================================================
// Hunt Scan (for type safety in UI)
// ============================================================

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
}
