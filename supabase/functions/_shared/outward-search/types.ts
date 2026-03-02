/**
 * Outward Search v2 — Adapter Interface Contract
 *
 * Every search source (internal DB, Manus, future APIs) must implement
 * the OutwardSearchAdapter interface. This ensures:
 * - Consistent result shape across all sources
 * - Quota/cooldown enforcement at the orchestrator level
 * - Telemetry logging per-source
 * - Identity resolution stays canonical (no adapter does its own parsing)
 */

// ─── Parsed Intent (output of LLM / regex parser) ───────────────
export interface ParsedIntent {
  make: string | null;
  model: string | null;
  badge: string | null;
  year_min: number | null;
  year_max: number | null;
  max_km: number | null;
  price_max: number | null;
}

// ─── Source Registry Row ─────────────────────────────────────────
export interface SourceRegistryEntry {
  source: string;
  display_name: string;
  source_type: string;       // marketplace | auction | dealer_site | aggregator
  adapter_type: string;      // internal_db | manus | api | manual
  tier: string;              // free | premium
  enabled: boolean;
  rate_limit_per_hour: number;
  cooldown_minutes: number;
  last_success_at: string | null;
  last_error_at: string | null;
  consecutive_failures: number;
  config: Record<string, unknown>;
}

// ─── Dealer Entitlement ──────────────────────────────────────────
export interface DealerEntitlement {
  account_id: string;
  plan_tier: string;
  max_searches_per_day: number;
  max_sources_per_search: number;
  allowed_source_tiers: string[];
  searches_used_today: number;
  searches_reset_at: string;
  is_active: boolean;
}

// ─── Adapter Result (what every adapter returns) ─────────────────
export interface AdapterResult {
  source: string;
  title: string;
  year: number | null;
  km: number | null;
  price: number | null;
  effective_cost: number | null;
  location: string | null;
  state: string | null;
  variant: string | null;
  url: string | null;
  score: number;
  match_reason: string[];
  source_class: string | null;
  auction_house: string | null;
  drivetrain: string | null;
  fuel: string | null;
  transmission: string | null;
  days_listed: number | null;
  is_dealer_grade: boolean | null;
}

// ─── Adapter Interface ──────────────────────────────────────────
export interface OutwardSearchAdapter {
  /** Unique source key matching source_registry.source */
  readonly sourceKey: string;

  /**
   * Execute search against this source.
   * Returns matched listings in canonical AdapterResult shape.
   * Must NOT perform identity resolution — caller handles that.
   */
  search(
    intent: ParsedIntent,
    config: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<AdapterResult[]>;
}

// ─── Search Run Telemetry ────────────────────────────────────────
export interface SearchRunRecord {
  id?: string;
  account_id: string | null;
  initiated_by: string;
  instruction: string;
  parsed_intent: ParsedIntent;
  sources_queried: string[];
  total_results: number;
  results_by_source: Record<string, number>;
  cache_hit: boolean;
  gated: boolean;
  gate_reason: string | null;
  quota_snapshot: {
    used: number;
    max: number;
    tier: string;
  } | null;
  duration_ms: number;
  error: string | null;
  status: "pending" | "running" | "completed" | "failed" | "gated";
}

// ─── Quota Check Result ──────────────────────────────────────────
export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  entitlement: DealerEntitlement | null;
  eligible_sources: SourceRegistryEntry[];
}

// ─── Constants ───────────────────────────────────────────────────
export const AUCTION_SOURCES = new Set([
  "pickles", "grays", "manheim", "slattery", "f3",
  "auto_auctions", "vma", "bidsonline",
  "auto_auctions_aav", "pickles_crawl",
]);

export const AUCTION_PREMIUM = 500;
export const FREIGHT_FLAT = 800;
export const MAX_RESULTS = 30;
export const EXCLUDED_LIFECYCLE = ["STALE", "DEAD", "stale", "dead"];
