// OogleMate Data Types - Matching Google Sheets Schema

// Base types for internal tracking
interface SheetRowMeta {
  _rowIndex?: number;
}

export interface AuctionOpportunity extends SheetRowMeta {
  lot_id: string;
  auction_house: string;
  listing_url: string;
  location: string;
  scan_date: string;
  make: string;
  model: string;
  variant_raw: string;
  variant_normalised: string;
  year: number;
  km: number;
  engine: string;
  drivetrain: string;
  transmission: string;
  reserve: number;
  highest_bid: number;
  status: 'listed' | 'passed_in' | 'sold' | 'withdrawn';
  pass_count: number;
  description_score: number; // 0-4
  estimated_get_out: number;
  estimated_margin: number;
  confidence_score: number;
  action: 'Watch' | 'Buy';
  visible_to_dealers: 'Y' | 'N';
  last_action: 'Watch' | 'Buy';
  updated_at: string;
  // Optional: previous day reserve for comparison
  previous_reserve?: number;
}

export interface SaleFingerprint extends SheetRowMeta {
  fingerprint_id: string;
  dealer_name: string;
  dealer_whatsapp: string;
  sale_date: string;
  expires_at: string;
  make: string;
  model: string;
  variant_normalised: string;
  year: number;
  sale_km: number;
  min_km: number; // max(0, sale_km - 15000)
  max_km: number; // sale_km + 15000
  engine: string;
  drivetrain: string;
  transmission: string;
  shared_opt_in: 'Y' | 'N';
  is_active: 'Y' | 'N';
  // New fields for source tracking and spec-only fingerprints
  fingerprint_type?: 'full' | 'spec_only';
  source_sale_id?: string;
  source_import_id?: string;
}

export interface SaleLog extends SheetRowMeta {
  sale_id: string;
  dealer_name: string;
  dealer_whatsapp: string;
  deposit_date: string;
  make: string;
  model: string;
  variant_normalised: string;
  year: number;
  km: number;
  engine: string;
  drivetrain: string;
  transmission: string;
  buy_price?: number;
  sell_price?: number;
  days_to_deposit?: number;
  notes?: string;
  source: 'Manual' | 'CSV';
  created_at: string;
}

// Sales Import Raw - immutable audit trail of all CSV imports
export interface SalesImportRaw extends SheetRowMeta {
  import_id: string;
  uploaded_at: string;
  dealer_name: string;
  source: string; // e.g., 'EasyCars'
  original_row_json: string; // JSON stringified original row
  parse_status: 'success' | 'error' | 'skipped';
  parse_notes: string;
}

// Sales Normalised - parsed and cleaned sales data for review
export interface SalesNormalised extends SheetRowMeta {
  sale_id: string;
  import_id: string;
  dealer_name: string;
  sale_date: string;
  make: string;
  model: string;
  variant_raw: string;
  variant_normalised: string;
  sale_price?: number;
  days_to_sell?: number;
  location?: string;
  km?: number; // nullable - affects fingerprint type
  quality_flag: 'good' | 'review' | 'incomplete';
  notes?: string;
  year?: number;
  engine?: string;
  drivetrain?: string;
  transmission?: string;
  fingerprint_generated: 'Y' | 'N';
  fingerprint_id?: string;
  // New activation/filtering columns
  gross_profit?: number;
  activate: 'Y' | 'N';
  do_not_replicate: 'Y' | 'N';
  tags?: string;
}

// Fingerprint Sync Log - audit trail for sync operations
export interface FingerprintSyncLog {
  synclog_id: string;
  run_at: string;
  mode: 'full' | 'dry_run';
  rows_scanned: number;
  rows_eligible: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  skip_reason_counts: string; // JSON: { "missing_dealer": 5, "not_activated": 10, ... }
  errors: string; // JSON array of error strings
}

// Saved Search - admin-managed search URLs for automated ingestion
export interface SavedSearch extends SheetRowMeta {
  search_id: string;
  source_site: 'Pickles' | 'Manheim' | 'Other';
  label: string;
  search_url: string;
  refresh_frequency_hours: number;
  max_pages: number;
  enabled: 'Y' | 'N';
  last_run_at: string;
  notes: string;
  created_at: string;
  // Run diagnostics
  last_run_status?: 'success' | 'failed';
  last_http_status?: number;
  last_listings_found?: number;
  last_listings_upserted?: number;
  last_error_message?: string;
}

// Run log entry for debugging
export interface SavedSearchRunLog {
  searchId: string;
  fetchedUrl: string;
  httpStatus: number;
  responseSize: number;
  htmlPreview: string; // First 300 chars sanitized or "blocked/redirected"
  listingUrlsSample: string[]; // First 10 parsed listing URLs
}

export interface Dealer extends SheetRowMeta {
  dealer_name: string;
  whatsapp: string;
  role: 'admin' | 'dealer';
  enabled: 'Y' | 'N';
}

export interface AlertLog extends SheetRowMeta {
  alert_id: string;
  created_at: string;
  dealer_name: string;
  recipient_whatsapp?: string; // Legacy, kept for backwards compatibility
  channel: 'in_app';
  lot_id: string;
  fingerprint_id: string;
  action_change: string;
  message_text: string;
  link?: string;
  status: 'new' | 'read' | 'acknowledged';
  read_at?: string;
  acknowledged_at?: string;
  dedup_key: string; // dealer_name + lot_id + action_change + YYYY-MM-DD
  // Lot details for display
  lot_make?: string;
  lot_model?: string;
  lot_variant?: string;
  lot_year?: number;
  auction_house?: string;
  auction_datetime?: string;
  estimated_margin?: number;
  why_flagged?: string[];
}

export interface AppSettings extends SheetRowMeta {
  setting_key: string;
  setting_value: string;
  updated_at: string;
}

export interface AuctionEvent extends SheetRowMeta {
  event_id: string;
  event_title: string;
  auction_house: string;
  location: string;
  start_datetime: string;
  event_url: string;
  active: 'Y' | 'N';
}

// Source types for multi-source listings
export type SourceType = 'auction' | 'classified' | 'retail' | 'dealer';

// Listing status - applies to all source types
export type ListingStatus = 'listed' | 'passed_in' | 'sold' | 'withdrawn';

// Canonical Listings interface - unified for all sources
export interface Listing extends SheetRowMeta {
  // Identity fields
  listing_id: string; // For auctions: auction_house + ":" + lot_number, stable across weeks
  lot_id: string; // Legacy/auction lot number
  lot_key: string; // Legacy: auction_house + ":" + lot_id
  listing_key: string; // Computed unique key for non-auctions
  
  // Source information
  source: SourceType; // 'auction', 'classified', 'retail', 'dealer'
  source_site: string; // auction_house or site name
  
  // Legacy fields for backwards compatibility (map to source/source_site)
  source_type: SourceType;
  source_name: string;
  
  // Event/Location
  event_id: string;
  auction_house: string;
  location: string;
  auction_datetime: string; // For auctions: auction date
  listing_url: string;
  
  // Vehicle details
  make: string;
  model: string;
  variant_raw: string;
  variant_normalised: string;
  year: number;
  km: number;
  fuel: string;
  drivetrain: string;
  transmission: string;
  
  // Pricing
  reserve: number;
  highest_bid: number;
  first_seen_price: number; // Price when first imported
  last_seen_price: number; // Current/most recent price
  price_current: number; // Alias for last_seen_price
  price_prev: number; // Previous price (for change detection)
  price_change_pct: number; // ((last - first) / first) * 100
  
  // Lifecycle
  status: ListingStatus;
  pass_count: number; // Auctions only: incremented when passed_in AND auction_date > prev
  price_drop_count: number; // Number of price decreases observed
  relist_count: number; // Number of times relisted (>7 day gap)
  
  // Timestamps
  first_seen_at: string;
  last_seen_at: string;
  last_auction_date: string; // For pass_count logic: the auction_date when last passed_in
  days_listed: number; // Computed: (today - first_seen_at) in days
  
  // Scoring
  description_score: number;
  estimated_get_out: number;
  estimated_margin: number;
  confidence_score: number;
  action: 'Watch' | 'Buy';
  visible_to_dealers: 'Y' | 'N';
  
  // Tracking
  updated_at: string;
  last_status: string;
  relist_group_id: string;
  
  // Manual override fields
  manual_confidence_score?: number;
  manual_action?: 'Watch' | 'Buy';
  override_enabled: 'Y' | 'N';
}

// Backwards compatibility alias
export type AuctionLot = Listing;

// Calculate lot/listing confidence score
export function calculateLotConfidenceScore(lot: Listing): number {
  let score = 0;
  if (lot.pass_count >= 2) score += 1;
  if (lot.pass_count >= 3) score += 1;
  if (lot.description_score <= 1) score += 1;
  if (lot.estimated_margin >= 2000) score += 1;
  return score;
}

// Determine lot action from confidence
export function determineLotAction(confidenceScore: number): 'Buy' | 'Watch' {
  return confidenceScore >= 3 ? 'Buy' : 'Watch';
}

// Pressure flag reasons - extended for all source types
export type LotFlagReason = 
  | 'PASSED IN x3+'
  | 'PASSED IN x2'
  | 'UNDER-SPECIFIED'
  | 'RESERVE SOFTENING'
  | 'MARGIN OK'
  | 'PRICE_DROPPING'
  | 'FATIGUE_LISTING'
  | 'RELISTED'
  | 'OVERRIDDEN';

// Get pressure flags for a listing
export function getLotFlagReasons(lot: Listing): LotFlagReason[] {
  const reasons: LotFlagReason[] = [];
  
  // Override indicator
  if (lot.override_enabled === 'Y') reasons.push('OVERRIDDEN');
  
  // Auction-specific signals
  const isAuction = lot.source === 'auction' || lot.source_type === 'auction' || (!lot.source && !lot.source_type);
  if (isAuction) {
    if (lot.pass_count >= 3) reasons.push('PASSED IN x3+');
    else if (lot.pass_count === 2) reasons.push('PASSED IN x2');
    
    // Reserve softening for auctions
    if (lot.price_prev && lot.price_current && lot.price_current < lot.price_prev) {
      const dropPercent = ((lot.price_prev - lot.price_current) / lot.price_prev) * 100;
      if (dropPercent >= 5) reasons.push('RESERVE SOFTENING');
    }
  }
  
  // Universal pressure signals
  // PRICE_DROPPING: price_change_pct <= -5%
  if (lot.price_change_pct && lot.price_change_pct <= -5) {
    reasons.push('PRICE_DROPPING');
  }
  
  // FATIGUE_LISTING: days_listed >= 14
  const daysListed = lot.days_listed || (lot.first_seen_at 
    ? Math.floor((new Date().getTime() - new Date(lot.first_seen_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0);
  if (daysListed >= 14) reasons.push('FATIGUE_LISTING');
  
  // RELISTED: pass_count >= 2 (auctions) or relist_count >= 1 (others)
  if (lot.pass_count >= 2 || lot.relist_count >= 1) {
    reasons.push('RELISTED');
  }
  
  if (lot.description_score <= 1) reasons.push('UNDER-SPECIFIED');
  if (lot.estimated_margin >= 1000) reasons.push('MARGIN OK');
  
  return reasons;
}

// UI State Types
export interface OpportunityFilters {
  auction_house: string | null;
  action: 'Watch' | 'Buy' | null;
  pass_count_min: number | null;
  location: string | null;
  margin_min: number | null;
  margin_max: number | null;
  show_all: boolean; // Admin only - bypass margin filter
}

export interface UserContext {
  dealer: Dealer | null;
  isAdmin: boolean;
}

// Why Flagged reasons
export type FlagReason = 
  | 'PASSED IN x3+'
  | 'PASSED IN x2'
  | 'UNDER-SPECIFIED'
  | 'RESERVE SOFTENING'
  | 'MARGIN OK';

// Helper function to derive flag reasons
export function getFlagReasons(opp: AuctionOpportunity): FlagReason[] {
  const reasons: FlagReason[] = [];
  
  if (opp.pass_count >= 3) reasons.push('PASSED IN x3+');
  else if (opp.pass_count === 2) reasons.push('PASSED IN x2');
  
  if (opp.description_score <= 1) reasons.push('UNDER-SPECIFIED');
  
  if (opp.previous_reserve && opp.reserve < opp.previous_reserve) {
    reasons.push('RESERVE SOFTENING');
  }
  
  if (opp.estimated_margin >= 1000) reasons.push('MARGIN OK');
  
  return reasons;
}

// Confidence score calculation
export function calculateConfidenceScore(opp: AuctionOpportunity): number {
  let score = 0;
  
  if (opp.pass_count >= 2) score += 1;
  if (opp.pass_count >= 3) score += 1;
  if (opp.description_score <= 1) score += 1;
  
  if (opp.previous_reserve) {
    const dropPercent = ((opp.previous_reserve - opp.reserve) / opp.previous_reserve) * 100;
    if (dropPercent >= 5) score += 1;
  }
  
  if (opp.estimated_margin >= 2000) score += 1;
  
  return score;
}

// Determine action based on confidence
export function determineAction(confidenceScore: number): 'Buy' | 'Watch' {
  return confidenceScore >= 3 ? 'Buy' : 'Watch';
}

// Strict matching check
export function isStrictMatch(opp: AuctionOpportunity, fp: SaleFingerprint): boolean {
  if (fp.is_active !== 'Y') return false;
  
  const today = new Date();
  const expiresAt = new Date(fp.expires_at);
  if (today > expiresAt) return false;
  
  if (
    opp.make !== fp.make ||
    opp.model !== fp.model ||
    opp.variant_normalised !== fp.variant_normalised ||
    opp.engine !== fp.engine ||
    opp.drivetrain !== fp.drivetrain ||
    opp.transmission !== fp.transmission
  ) return false;
  
  if (Math.abs(opp.year - fp.year) > 1) return false;
  
  // For spec-only fingerprints (no km), skip km check
  // For km-aware fingerprints, check symmetric range: min_km <= listing_km <= max_km
  if (fp.fingerprint_type !== 'spec_only' && fp.sale_km > 0) {
    const minKm = fp.min_km ?? Math.max(0, fp.sale_km - 15000);
    const maxKm = fp.max_km ?? fp.sale_km + 15000;
    if (opp.km < minKm || opp.km > maxKm) return false;
  }
  
  return true;
}

// Format currency
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Format number with commas
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-AU').format(value);
}
