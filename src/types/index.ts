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
  variant_family?: string; // Derived: SR5, GXL, XLT, etc.
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
  // Do Not Buy protection
  do_not_buy?: 'Y' | 'N';
  do_not_buy_reason?: string;
  // Manual fingerprint flag (not from sale record)
  is_manual?: 'Y' | 'N';
  // Buy price for profit analytics (only for sales-based)
  buy_price?: number;
  sell_price?: number;
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
  // Do Not Buy protection
  do_not_buy?: 'Y' | 'N';
  do_not_buy_reason?: string;
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

// ========== NETWORK PROXY VALUATION ==========

export type ValuationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NetworkValuationRequest {
  make: string;
  model: string;
  variant_family?: string; // Optional: used for more precise matching
  year: number;
  year_tolerance?: number; // Default ±2
  km?: number; // Optional: ignored if unavailable
  requesting_dealer?: string; // Used to exclude own sales from network
}

export interface NetworkValuationResult {
  // Aggregated metrics
  avg_buy_price: number | null;
  avg_sell_price: number | null;
  buy_price_range: { min: number; max: number } | null;
  sell_price_range: { min: number; max: number } | null;
  avg_gross_profit: number | null;
  avg_days_to_sell: number | null;
  sample_size: number;
  
  // Confidence and source
  confidence: ValuationConfidence;
  confidence_reason: string;
  data_source: 'internal' | 'network' | 'none';
  
  // Admin-only: contributing fingerprint IDs
  contributing_fingerprint_ids?: string[];
  
  // Request echo for reference
  request: NetworkValuationRequest;
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
export type ListingStatus = 'listed' | 'passed_in' | 'sold' | 'withdrawn' | 'catalogue' | 'upcoming';

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
  variant_family?: string; // Derived: SR5, GXL, XLT, etc.
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
  
  // Data quality flags
  invalid_source: 'Y' | 'N'; // Set to 'Y' if listing_url is missing or invalid
  
  // Exclusion fields (condition risk - damaged/mining/write-off)
  excluded_reason?: string; // e.g., 'condition_risk'
  excluded_keyword?: string; // The keyword that triggered exclusion
}

// ========== CONDITION EXCLUSION FILTER ==========

// Keywords that indicate damaged, mining, or write-off vehicles
export const CONDITION_EXCLUSION_KEYWORDS = [
  'damage', 'damaged', 'hail', 'flood', 'water', 'fire', 'burn',
  'salvage', 'statutory', 'repairable write-off', 'wovr', 'written off',
  'insurance loss', 'accident', 'crash', 'structural', 'chassis', 'bent',
  'mine', 'mines', 'mining', 'ex mine', 'ex-mines', 'underground', 'site vehicle'
];

// Check if any exclusion keyword is present in text (case-insensitive)
export function checkConditionExclusion(texts: (string | undefined)[]): { excluded: boolean; keyword?: string } {
  const combined = texts.filter(Boolean).join(' ').toLowerCase();
  
  for (const keyword of CONDITION_EXCLUSION_KEYWORDS) {
    // Use word boundary matching for short words to avoid false positives
    const pattern = keyword.length <= 4 
      ? new RegExp(`\\b${keyword}\\b`, 'i')
      : new RegExp(keyword, 'i');
    
    if (pattern.test(combined)) {
      return { excluded: true, keyword };
    }
  }
  
  return { excluded: false };
}

// Check if a listing should be excluded based on condition keywords
export function shouldExcludeListing(lot: Partial<Listing>, catalogueText?: string): { excluded: boolean; keyword?: string } {
  return checkConditionExclusion([
    lot.variant_raw,
    lot.variant_normalised,
    catalogueText,
  ]);
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
  // Reserve softening adds +1
  if (lot.price_prev && lot.price_current && lot.price_current < lot.price_prev) {
    const dropPercent = ((lot.price_prev - lot.price_current) / lot.price_prev) * 100;
    if (dropPercent >= 5) score += 1;
  }
  return score;
}

// Check if listing has at least one pressure signal for BUY gate
export interface PressureSignals {
  passCount2Plus: boolean;
  daysListed14Plus: boolean;
  reserveSoftening5Plus: boolean;
  hasPressure: boolean;
}

export function getPressureSignals(lot: Listing): PressureSignals {
  const passCount2Plus = lot.pass_count >= 2;
  const daysListed14Plus = (lot.days_listed || 0) >= 14;
  
  let reserveSoftening5Plus = false;
  if (lot.price_prev && lot.price_current && lot.price_current < lot.price_prev) {
    const dropPercent = ((lot.price_prev - lot.price_current) / lot.price_prev) * 100;
    reserveSoftening5Plus = dropPercent >= 5;
  }
  
  return {
    passCount2Plus,
    daysListed14Plus,
    reserveSoftening5Plus,
    hasPressure: passCount2Plus || daysListed14Plus || reserveSoftening5Plus,
  };
}

// Determine lot action from confidence + pressure gate
// BUY requires: confidence >= 4 AND at least one pressure signal
// WATCH: confidence >= 2
export function determineLotAction(confidenceScore: number, lot?: Listing): 'Buy' | 'Watch' {
  if (confidenceScore >= 4 && lot) {
    const pressure = getPressureSignals(lot);
    if (pressure.hasPressure) {
      return 'Buy';
    }
    // High confidence but no pressure - keep as Watch
    return 'Watch';
  }
  return 'Watch';
}

// Pressure flag reasons - extended for all source types
export type LotFlagReason = 
  | 'FAILED TO SELL x3+'
  | 'RELISTED x2 (inferred)'
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
    if (lot.pass_count >= 3) reasons.push('FAILED TO SELL x3+');
    else if (lot.pass_count === 2) reasons.push('RELISTED x2 (inferred)');
    
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

// Check pressure signals for AuctionOpportunity
export function getOppPressureSignals(opp: AuctionOpportunity): PressureSignals {
  const passCount2Plus = opp.pass_count >= 2;
  const daysListed14Plus = false; // Not tracked on opportunities
  
  let reserveSoftening5Plus = false;
  if (opp.previous_reserve && opp.reserve < opp.previous_reserve) {
    const dropPercent = ((opp.previous_reserve - opp.reserve) / opp.previous_reserve) * 100;
    reserveSoftening5Plus = dropPercent >= 5;
  }
  
  return {
    passCount2Plus,
    daysListed14Plus,
    reserveSoftening5Plus,
    hasPressure: passCount2Plus || daysListed14Plus || reserveSoftening5Plus,
  };
}

// Determine action based on confidence + pressure gate
// BUY requires: confidence >= 4 AND at least one pressure signal
export function determineAction(confidenceScore: number, opp?: AuctionOpportunity): 'Buy' | 'Watch' {
  if (confidenceScore >= 4 && opp) {
    const pressure = getOppPressureSignals(opp);
    if (pressure.hasPressure) {
      return 'Buy';
    }
    return 'Watch';
  }
  return 'Watch';
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

// ========== VARIANT FAMILY EXTRACTION ==========

// Common variant family tokens (uppercase normalized)
// Whitelist from user requirements: SR5, GXL, XLT, ST, ST-X, WILDTRAK, LT, LTZ, Z71, ZR2, GL, GX, VX, SAHARA, GR, GT, RS
const VARIANT_FAMILY_TOKENS = [
  // Toyota
  'SR5', 'GXL', 'GX', 'GL', 'SR', 'RUGGED', 'RUGGED X', 'ROGUE', 'WORKMATE', 'SAHARA', 'VX', 'KAKADU', 'GR',
  // Ford
  'XLT', 'WILDTRAK', 'FX4', 'SPORT', 'RAPTOR', 'XL', 'XLS', 'TREND', 'ST',
  // Holden/Chevrolet
  'LT', 'LTZ', 'Z71', 'ZR2', 'LS', 'SS', 'SSV', 'SV6', 'REDLINE', 'RS',
  // Isuzu
  'LS-M', 'LS-U', 'LS-T', 'SX', 'X-TERRAIN',
  // Mitsubishi
  'GLX', 'GLS', 'GSR', 'EXCEED', 'TOBY PRICE',
  // Nissan
  'ST-X', 'PRO-4X', 'SL', 'N-TREK', 'WARRIOR',
  // Mazda
  'GT', 'XTR', 'GSX', 'TOURING', 'BOSS',
  // VW
  'SPORTLINE', 'CORE', 'STYLE', 'LIFE', 'CANYON',
  // Generic high-value
  'LIMITED', 'PREMIUM', 'PLATINUM', 'TITANIUM', 'ULTIMATE',
];

// Words to strip from variant text before family extraction
const STRIP_WORDS = [
  'DOUBLE CAB', 'DUAL CAB', 'EXTRA CAB', 'SINGLE CAB', 'CREW CAB',
  'CAB CHASSIS', 'PICKUP', 'UTE', 'UTILITY', 'WAGON', 'SUV',
  'AUTO', 'AUTOMATIC', 'MANUAL', 'CVT', 'DSG',
  '4X4', '4X2', 'AWD', '2WD', '4WD',
  '2.8L', '3.0L', '2.4L', '2.0L', '3.5L', '2.7L', '1.8L',
  'TURBO', 'DIESEL', 'PETROL', 'HYBRID', 'TDI', 'D4D',
  'MY', 'SERIES', 'EDITION',
];

/**
 * Extract variant family from variant text.
 * Returns uppercase normalized family token (e.g., "SR5", "XLT", "WILDTRAK").
 * Returns undefined if no known family token is found.
 */
export function extractVariantFamily(variantText: string | undefined | null): string | undefined {
  if (!variantText) return undefined;
  
  // Normalize: uppercase and strip noise words
  let normalized = variantText.toUpperCase();
  
  // Remove strip words
  for (const word of STRIP_WORDS) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  
  // Remove numbers that aren't part of family tokens (e.g., "2021", "150000")
  normalized = normalized.replace(/\b\d{4,}\b/g, ' '); // 4+ digit numbers (years, km)
  
  // Clean up whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // Look for known family tokens (in priority order - more specific first)
  // Sort by length descending to match "RUGGED X" before "RUGGED"
  const sortedTokens = [...VARIANT_FAMILY_TOKENS].sort((a, b) => b.length - a.length);
  
  for (const token of sortedTokens) {
    // Use word boundary matching
    const pattern = new RegExp(`\\b${token.replace(/-/g, '[\\s-]?')}\\b`, 'i');
    if (pattern.test(normalized)) {
      return token.toUpperCase();
    }
  }
  
  return undefined;
}

// ========== VALO AI VALUATION ==========

export interface ValoRequest {
  input_text: string;
  dealer_name?: string;
  location?: string;
  source_link?: string;
  // Optional prefilled fields (from lot click)
  prefill?: {
    make?: string;
    model?: string;
    variant_raw?: string;
    variant_family?: string;
    year?: number;
    km?: number;
    engine?: string;
    transmission?: string;
    drivetrain?: string;
    body_style?: string;
    lot_id?: string;
  };
}

export interface ValoParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  body_style: string | null;
  variant_raw: string | null;
  variant_family: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  km: number | null;
  notes: string | null;
  missing_fields: string[];
  assumptions: string[];
}

export type ValoTier = 'dealer' | 'network' | 'proxy';

export interface ValoComparable {
  // For dealer comps only
  sale_date?: string;
  sell_price?: number;
  buy_price?: number;
  days_to_sell?: number;
  // Anonymised fields (network/proxy)
  is_anonymised: boolean;
}

export interface ValoResult {
  // Parsed vehicle
  parsed: ValoParsedVehicle;
  
  // Valuation metrics
  suggested_buy_range: { min: number; max: number } | null;
  suggested_sell_range: { min: number; max: number } | null;
  expected_gross_band: { min: number; max: number } | null;
  typical_days_to_sell: number | null;
  
  // Confidence and tier
  confidence: ValuationConfidence;
  tier: ValoTier;
  tier_label: string; // "Dealer history" | "Network outcomes" | "Proxy"
  sample_size: number;
  
  // Top comparables (limited, anonymised for network/proxy)
  top_comps: ValoComparable[];
  
  // Request echo
  request_id: string;
  timestamp: string;
}

export interface ValoRequestLog {
  request_id: string;
  dealer_name: string;
  timestamp: string;
  input_text: string;
  parsed_json: string;
  tier_used: ValoTier;
  confidence: ValuationConfidence;
  output_json: string;
}
