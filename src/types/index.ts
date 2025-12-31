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

export interface Dealer extends SheetRowMeta {
  dealer_name: string;
  whatsapp: string;
  role: 'admin' | 'dealer';
  enabled: 'Y' | 'N';
}

export interface AlertLog extends SheetRowMeta {
  alert_id: string;
  sent_at: string;
  recipient_whatsapp: string;
  lot_id: string;
  fingerprint_id: string;
  action_change: string;
  message_text: string;
  status: 'sent' | 'queued' | 'failed';
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

export interface AuctionLot extends SheetRowMeta {
  lot_id: string;
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
  // For reserve softening detection
  previous_reserve?: number;
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

// Get lot flag reasons
export type LotFlagReason = 
  | 'PASSED IN x3+'
  | 'PASSED IN x2'
  | 'UNDER-SPECIFIED'
  | 'RESERVE SOFTENING'
  | 'MARGIN OK';

export function getLotFlagReasons(lot: AuctionLot): LotFlagReason[] {
  const reasons: LotFlagReason[] = [];
  
  if (lot.pass_count >= 3) reasons.push('PASSED IN x3+');
  else if (lot.pass_count === 2) reasons.push('PASSED IN x2');
  
  if (lot.description_score <= 1) reasons.push('UNDER-SPECIFIED');
  
  if (lot.previous_reserve && lot.reserve < lot.previous_reserve) {
    const dropPercent = ((lot.previous_reserve - lot.reserve) / lot.previous_reserve) * 100;
    if (dropPercent >= 5) reasons.push('RESERVE SOFTENING');
  }
  
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
