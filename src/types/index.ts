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
  max_km: number;
  engine: string;
  drivetrain: string;
  transmission: string;
  shared_opt_in: 'Y' | 'N';
  is_active: 'Y' | 'N';
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

export interface AuctionLot extends SheetRowMeta {
  lot_id: string;
  lot_key: string; // Computed: auction_house + ":" + lot_id (for auctions)
  event_id: string;
  auction_house: string;
  location: string;
  auction_datetime: string;
  listing_url: string;
  make: string;
  model: string;
  variant_raw: string;
  variant_normalised: string;
  year: number;
  km: number;
  fuel: string;
  drivetrain: string;
  transmission: string;
  reserve: number;
  highest_bid: number;
  status: 'listed' | 'passed_in' | 'sold' | 'withdrawn';
  pass_count: number;
  description_score: number;
  estimated_get_out: number;
  estimated_margin: number;
  confidence_score: number;
  action: 'Watch' | 'Buy';
  visible_to_dealers: 'Y' | 'N';
  updated_at: string;
  // Lifecycle fields
  last_status: string;
  last_seen_at: string;
  relist_group_id: string;
  // For reserve softening detection
  previous_reserve?: number;
  // Multi-source support fields
  source_type: SourceType;
  source_name: string;
  listing_id: string;
  listing_key: string; // Computed unique key for all sources
  price_current: number;
  price_prev: number;
  price_drop_count: number;
  relist_count: number;
  first_seen_at: string;
  // Manual override fields
  manual_confidence_score?: number;
  manual_action?: 'Watch' | 'Buy';
  override_enabled: 'Y' | 'N';
}

// Calculate lot confidence score
export function calculateLotConfidenceScore(lot: AuctionLot): number {
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

// Get lot flag reasons - extended for retail signals
export type LotFlagReason = 
  | 'PASSED IN x3+'
  | 'PASSED IN x2'
  | 'UNDER-SPECIFIED'
  | 'RESERVE SOFTENING'
  | 'MARGIN OK'
  | 'PRICE DROPPING'
  | 'FATIGUE LISTING'
  | 'RELISTED'
  | 'OVERRIDDEN';

export function getLotFlagReasons(lot: AuctionLot): LotFlagReason[] {
  const reasons: LotFlagReason[] = [];
  
  // Override indicator
  if (lot.override_enabled === 'Y') reasons.push('OVERRIDDEN');
  
  // Auction signals
  if (lot.source_type === 'auction' || !lot.source_type) {
    if (lot.pass_count >= 3) reasons.push('PASSED IN x3+');
    else if (lot.pass_count === 2) reasons.push('PASSED IN x2');
    
    if (lot.previous_reserve && lot.reserve < lot.previous_reserve) {
      const dropPercent = ((lot.previous_reserve - lot.reserve) / lot.previous_reserve) * 100;
      if (dropPercent >= 5) reasons.push('RESERVE SOFTENING');
    }
  }
  
  // Retail/classified signals
  if (lot.price_drop_count >= 1) reasons.push('PRICE DROPPING');
  if (lot.relist_count >= 1) reasons.push('RELISTED');
  
  // Days listed fatigue (calculate from first_seen_at)
  if (lot.first_seen_at) {
    const firstSeen = new Date(lot.first_seen_at);
    const now = new Date();
    const daysListed = Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
    if (daysListed >= 14) reasons.push('FATIGUE LISTING');
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
  if (opp.km > fp.max_km) return false;
  
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
