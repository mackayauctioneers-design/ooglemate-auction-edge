import { supabase } from '@/integrations/supabase/client';
import { 
  AuctionOpportunity, 
  SaleFingerprint, 
  Dealer, 
  AlertLog,
  AuctionEvent,
  AuctionLot,
  SaleLog,
  AppSettings,
  SalesImportRaw,
  SalesNormalised,
  FingerprintSyncLog,
  SavedSearch,
  NetworkValuationRequest,
  NetworkValuationResult,
  ValuationConfidence,
  DealerSalesHistory,
  SourceType,
  ListingStatus,
  calculateConfidenceScore,
  determineAction,
  calculateLotConfidenceScore,
  determineLotAction,
  getLotFlagReasons,
  getPressureSignals,
  shouldExcludeListing,
  extractVariantFamily
} from '@/types';

const SHEETS = {
  OPPORTUNITIES: 'Auction_Opportunities',
  FINGERPRINTS: 'Sale_Fingerprints',
  DEALERS: 'Dealers',
  ALERTS: 'Alert_Log',
  EVENTS: 'Auction_Events',
  LOTS: 'Listings', // Renamed from Auction_Lots to canonical Listings
  SALES_LOG: 'Sales_Log',
  SETTINGS: 'Settings',
  SALES_IMPORTS_RAW: 'Sales_Imports_Raw',
  SALES_NORMALISED: 'Sales_Normalised',
  FINGERPRINT_SYNC_LOG: 'Fingerprint_Sync_Log',
  SAVED_SEARCHES: 'Saved_Searches',
  DEALER_SALES_HISTORY: 'Dealer_Sales_History',
};

// Check if a listing URL is invalid (placeholder, example, or empty)
function isInvalidListingUrl(url: string): boolean {
  if (!url || url.length < 10) return true;
  
  const invalidPatterns = [
    'example.com',
    'test.example',
    'placeholder',
    'localhost',
    '127.0.0.1',
    'invalid',
  ];
  
  const urlLower = url.toLowerCase();
  for (const pattern of invalidPatterns) {
    if (urlLower.includes(pattern)) return true;
  }
  
  // Must start with http:// or https://
  if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://')) {
    return true;
  }
  
  return false;
}

// Helper to call the edge function
async function callSheetsApi(action: string, sheet: string, data?: any, rowIndex?: number) {
  const { data: response, error } = await supabase.functions.invoke('google-sheets', {
    body: { action, sheet, data, rowIndex },
  });

  if (error) {
    console.error('Sheets API error:', error);
    throw new Error(error.message);
  }

  if (!response.success && response.error) {
    throw new Error(response.error);
  }

  return response;
}

// Parse sheet data to typed objects
function parseOpportunity(row: any): AuctionOpportunity {
  // Read action from sheet if present (normalize to 'Buy' or 'Watch')
  const sheetAction = row.action?.toString().trim();
  const hasValidSheetAction = sheetAction === 'Buy' || sheetAction === 'Watch';

  const opp: AuctionOpportunity = {
    lot_id: row.lot_id || '',
    auction_house: row.auction_house || '',
    listing_url: row.listing_url || '',
    location: row.location || '',
    scan_date: row.scan_date || '',
    make: row.make || '',
    model: row.model || '',
    variant_raw: row.variant_raw || '',
    variant_normalised: row.variant_normalised || '',
    year: parseInt(row.year) || 0,
    km: parseInt(row.km) || 0,
    engine: row.engine || '',
    drivetrain: row.drivetrain || '',
    transmission: row.transmission || '',
    reserve: parseFloat(row.reserve) || 0,
    highest_bid: parseFloat(row.highest_bid) || 0,
    status: row.status || 'listed',
    pass_count: parseInt(row.pass_count) || 0,
    description_score: parseInt(row.description_score) || 0,
    estimated_get_out: parseFloat(row.estimated_get_out) || 0,
    estimated_margin: parseFloat(row.estimated_margin) || 0,
    confidence_score: 0,
    action: 'Watch',
    visible_to_dealers: row.visible_to_dealers || 'N',
    last_action: row.last_action || 'Watch',
    updated_at: row.updated_at || new Date().toISOString(),
    previous_reserve: row.previous_reserve ? parseFloat(row.previous_reserve) : undefined,
    _rowIndex: row._rowIndex,
  };

  // Calculate confidence score
  opp.confidence_score = calculateConfidenceScore(opp);
  
  // Use sheet action if valid, otherwise calculate from confidence + pressure
  opp.action = hasValidSheetAction ? sheetAction : determineAction(opp.confidence_score, opp);

  return opp;
}

function parseFingerprint(row: any): SaleFingerprint {
  const saleKm = row.sale_km ? parseInt(row.sale_km) : undefined;
  
  // Parse min_km and max_km - preserve NULL/undefined for spec-only fingerprints
  let minKm: number | undefined = undefined;
  let maxKm: number | undefined = undefined;
  
  if (row.min_km !== undefined && row.min_km !== '' && row.min_km !== null) {
    minKm = parseInt(row.min_km);
    // Treat as undefined if it's the placeholder value
    if (minKm >= 900000) minKm = undefined;
  }
  
  if (row.max_km !== undefined && row.max_km !== '' && row.max_km !== null) {
    maxKm = parseInt(row.max_km);
    // Treat as undefined if it's a placeholder-derived value
    if (maxKm >= 900000) maxKm = undefined;
  }
  
  // For fingerprints with sale_km but no explicit min/max, calculate them
  // ONLY if this is NOT a spec_only fingerprint
  const fingerprintType = row.fingerprint_type || (saleKm ? 'full' : 'spec_only');
  
  if (fingerprintType === 'full' && saleKm && minKm === undefined) {
    minKm = Math.max(0, saleKm - 15000);
  }
  if (fingerprintType === 'full' && saleKm && maxKm === undefined) {
    maxKm = saleKm + 15000;
  }
    
  return {
    fingerprint_id: row.fingerprint_id || '',
    dealer_name: row.dealer_name || '',
    dealer_whatsapp: row.dealer_whatsapp || '',
    sale_date: row.sale_date || '',
    expires_at: row.expires_at || '',
    make: row.make || '',
    model: row.model || '',
    variant_normalised: row.variant_normalised || '',
    variant_family: row.variant_family || undefined,
    year: parseInt(row.year) || 0,
    sale_km: saleKm || 0,
    min_km: minKm,
    max_km: maxKm,
    engine: row.engine || '',
    drivetrain: row.drivetrain || '',
    transmission: row.transmission || '',
    shared_opt_in: row.shared_opt_in || 'N',
    is_active: row.is_active || 'Y',
    fingerprint_type: fingerprintType,
    source_sale_id: row.source_sale_id || undefined,
    source_import_id: row.source_import_id || undefined,
    do_not_buy: row.do_not_buy || 'N',
    do_not_buy_reason: row.do_not_buy_reason || undefined,
    is_manual: row.is_manual || 'N',
    buy_price: row.buy_price ? parseFloat(row.buy_price) : undefined,
    sell_price: row.sell_price ? parseFloat(row.sell_price) : undefined,
    _rowIndex: row._rowIndex,
  };
}

function parseDealer(row: any): Dealer {
  // Handle pipe-separated format from malformed sheet headers
  const pipeKey = Object.keys(row).find(k => k.includes('|') && k.includes('dealer_name'));
  if (pipeKey && row[pipeKey]) {
    const parts = row[pipeKey].split('|').map((p: string) => p.trim());
    return {
      dealer_name: parts[0] || '',
      whatsapp: parts[1] || '',
      role: parts[2] || 'dealer',
      enabled: parts[3] || 'Y',
      _rowIndex: row._rowIndex,
    };
  }
  
  return {
    dealer_name: row.dealer_name || '',
    whatsapp: row.whatsapp || '',
    role: row.role || 'dealer',
    enabled: row.enabled || 'Y',
    _rowIndex: row._rowIndex,
  };
}

function parseAlert(row: any): AlertLog {
  // Normalize status from legacy values
  let status: 'new' | 'read' | 'acknowledged' = 'new';
  if (row.status === 'read') status = 'read';
  else if (row.status === 'acknowledged') status = 'acknowledged';
  // Legacy statuses map to 'new' for unread
  else if (row.status === 'sent' || row.status === 'queued' || row.status === 'failed') status = 'new';

  // Parse why_flagged - could be JSON array or comma-separated string
  let whyFlagged: string[] = [];
  if (row.why_flagged) {
    try {
      whyFlagged = JSON.parse(row.why_flagged);
    } catch {
      whyFlagged = row.why_flagged.split(',').map((s: string) => s.trim());
    }
  }

  return {
    alert_id: row.alert_id || '',
    created_at: row.created_at || row.sent_at || '',
    dealer_name: row.dealer_name || '',
    recipient_whatsapp: row.recipient_whatsapp || undefined,
    channel: 'in_app',
    lot_id: row.lot_id || '',
    fingerprint_id: row.fingerprint_id || '',
    action_change: row.action_change || '',
    message_text: row.message_text || '',
    link: row.link || row.listing_url || '',
    status,
    read_at: row.read_at || undefined,
    acknowledged_at: row.acknowledged_at || undefined,
    dedup_key: row.dedup_key || '',
    lot_make: row.lot_make || '',
    lot_model: row.lot_model || '',
    lot_variant: row.lot_variant || '',
    lot_year: row.lot_year ? parseInt(row.lot_year) : undefined,
    auction_house: row.auction_house || '',
    auction_datetime: row.auction_datetime || '',
    estimated_margin: row.estimated_margin ? parseFloat(row.estimated_margin) : undefined,
    why_flagged: whyFlagged.length > 0 ? whyFlagged : undefined,
    _rowIndex: row._rowIndex,
  };
}

function parseAuctionEvent(row: any): AuctionEvent {
  return {
    event_id: row.event_id || '',
    event_title: row.event_title || '',
    auction_house: row.auction_house || '',
    location: row.location || '',
    start_datetime: row.start_datetime || '',
    event_url: row.event_url || '',
    active: row.active || 'N',
    _rowIndex: row._rowIndex,
  };
}

function parseListing(row: any): AuctionLot {
  // Compute lot_key from auction_house and lot_id
  const auctionHouse = row.auction_house || '';
  const lotId = row.lot_id || '';
  const lotKey = row.lot_key || (auctionHouse && lotId ? `${auctionHouse}:${lotId}` : '');
  
  // Source fields - support both new (source/source_site) and legacy (source_type/source_name)
  const source = row.source || row.source_type || 'auction';
  const sourceSite = row.source_site || row.source_name || auctionHouse;
  const listingId = row.listing_id || (source === 'auction' ? `${auctionHouse}:${lotId}` : '');
  
  // Compute listing_key
  let listingKey = row.listing_key || '';
  if (!listingKey && sourceSite) {
    if (listingId) {
      listingKey = `${sourceSite}:${listingId}`;
    } else if (row.listing_url) {
      listingKey = `${sourceSite}:${simpleHash(row.listing_url)}`;
    }
  }
  
  // Pricing
  const reserve = parseFloat(row.reserve) || 0;
  const highestBid = parseFloat(row.highest_bid) || 0;
  const firstSeenPrice = parseFloat(row.first_seen_price) || reserve || highestBid || 0;
  const lastSeenPrice = parseFloat(row.last_seen_price) || parseFloat(row.price_current) || reserve || highestBid || 0;
  const priceCurrent = lastSeenPrice;
  const pricePrev = parseFloat(row.price_prev) || 0;
  
  // Calculate price_change_pct
  let priceChangePct = parseFloat(row.price_change_pct) || 0;
  if (!priceChangePct && firstSeenPrice > 0 && lastSeenPrice !== firstSeenPrice) {
    priceChangePct = ((lastSeenPrice - firstSeenPrice) / firstSeenPrice) * 100;
  }
  
  // Calculate days_listed
  const firstSeenAt = row.first_seen_at || '';
  let daysListed = parseInt(row.days_listed) || 0;
  if (!daysListed && firstSeenAt) {
    const firstSeen = new Date(firstSeenAt);
    const now = new Date();
    daysListed = Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
  }
  
  // Parse override fields
  const overrideEnabled = row.override_enabled === 'Y' ? 'Y' : 'N';
  const manualConfidenceScore = row.manual_confidence_score ? parseInt(row.manual_confidence_score) : undefined;
  const manualAction = (row.manual_action === 'Buy' || row.manual_action === 'Watch') ? row.manual_action : undefined;
  
  const listing: AuctionLot = {
    // Identity
    listing_id: listingId,
    lot_id: lotId,
    lot_key: lotKey,
    listing_key: listingKey,
    
    // Source
    source: source,
    source_site: sourceSite,
    source_type: source, // Legacy
    source_name: sourceSite, // Legacy
    
    // Event/Location
    event_id: row.event_id || '',
    auction_house: auctionHouse,
    location: row.location || '',
    auction_datetime: row.auction_datetime || '',
    listing_url: row.listing_url || '',
    
    // Vehicle
    make: row.make || '',
    model: row.model || '',
    variant_raw: row.variant_raw || '',
    variant_normalised: row.variant_normalised || '',
    variant_family: row.variant_family || undefined,
    year: parseInt(row.year) || 0,
    km: parseInt(row.km) || 0,
    fuel: row.fuel || '',
    drivetrain: row.drivetrain || '',
    transmission: row.transmission || '',
    
    // Pricing
    reserve: reserve,
    highest_bid: highestBid,
    first_seen_price: firstSeenPrice,
    last_seen_price: lastSeenPrice,
    price_current: priceCurrent,
    price_prev: pricePrev,
    price_change_pct: priceChangePct,
    
    // Lifecycle
    status: row.status || 'listed',
    pass_count: parseInt(row.pass_count) || 0,
    price_drop_count: parseInt(row.price_drop_count) || 0,
    relist_count: parseInt(row.relist_count) || 0,
    first_seen_at: firstSeenAt,
    last_seen_at: row.last_seen_at || '',
    last_auction_date: row.last_auction_date || '',
    days_listed: daysListed,
    
    // Scoring
    description_score: parseInt(row.description_score) || 0,
    estimated_get_out: parseFloat(row.estimated_get_out) || 0,
    estimated_margin: parseFloat(row.estimated_margin) || 0,
    confidence_score: 0,
    action: 'Watch',
    visible_to_dealers: row.visible_to_dealers || 'N',
    
    // Tracking
    updated_at: row.updated_at || new Date().toISOString(),
    last_status: row.last_status || '',
    relist_group_id: row.relist_group_id || '',
    
    // Override
    override_enabled: overrideEnabled,
    manual_confidence_score: manualConfidenceScore,
    manual_action: manualAction,
    
    // Data quality
    invalid_source: row.invalid_source === 'Y' ? 'Y' : 'N',
    
    // Exclusion (condition risk)
    excluded_reason: row.excluded_reason || undefined,
    excluded_keyword: row.excluded_keyword || undefined,
    
    _rowIndex: row._rowIndex,
  };

  // Calculate confidence score - use override if enabled, else auto-calculate
  if (overrideEnabled === 'Y' && manualConfidenceScore !== undefined) {
    listing.confidence_score = manualConfidenceScore;
  } else {
    const sheetConfidence = parseInt(row.confidence_score);
    if (!isNaN(sheetConfidence) && sheetConfidence > 0) {
      listing.confidence_score = sheetConfidence;
    } else {
      listing.confidence_score = calculateLotConfidenceScore(listing);
    }
  }
  
  // Determine action - use override if enabled, else auto-calculate with pressure gate
  if (overrideEnabled === 'Y' && manualAction) {
    listing.action = manualAction;
  } else {
    const sheetAction = row.action?.toString().trim();
    const hasValidSheetAction = sheetAction === 'Buy' || sheetAction === 'Watch';
    listing.action = hasValidSheetAction ? sheetAction : determineLotAction(listing.confidence_score, listing);
  }

  return listing;
}

// Legacy alias
const parseAuctionLot = parseListing;

// Simple hash function for URL-based listing_key
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

function parseSaleLog(row: any): SaleLog {
  return {
    sale_id: row.sale_id || '',
    dealer_name: row.dealer_name || '',
    dealer_whatsapp: row.dealer_whatsapp || '',
    deposit_date: row.deposit_date || '',
    make: row.make || '',
    model: row.model || '',
    variant_normalised: row.variant_normalised || '',
    year: parseInt(row.year) || 0,
    km: parseInt(row.km) || 0,
    engine: row.engine || '',
    drivetrain: row.drivetrain || '',
    transmission: row.transmission || '',
    buy_price: row.buy_price ? parseFloat(row.buy_price) : undefined,
    sell_price: row.sell_price ? parseFloat(row.sell_price) : undefined,
    days_to_deposit: row.days_to_deposit ? parseInt(row.days_to_deposit) : undefined,
    notes: row.notes || '',
    source: row.source || 'Manual',
    created_at: row.created_at || '',
    _rowIndex: row._rowIndex,
  };
}

const LISTING_HEADERS = [
  // Identity
  'listing_id', 'lot_key', 'lot_id', 'listing_key',
  // Source
  'source', 'source_site', 'source_type', 'source_name',
  // Event/Location
  'event_id', 'auction_house', 'location', 'auction_datetime', 'listing_url',
  // Variant family for tier-2 matching
  'variant_family',
  // Vehicle
  'make', 'model', 'variant_raw', 'variant_normalised', 'year', 'km', 'fuel', 'drivetrain', 'transmission',
  // Pricing
  'reserve', 'highest_bid', 'first_seen_price', 'last_seen_price', 'price_current', 'price_prev', 'price_change_pct',
  // Lifecycle
  'status', 'pass_count', 'price_drop_count', 'relist_count',
  'first_seen_at', 'last_seen_at', 'last_auction_date', 'days_listed',
  // Scoring
  'description_score', 'estimated_get_out', 'estimated_margin', 'confidence_score', 'action', 'visible_to_dealers',
  // Tracking
  'updated_at', 'last_status', 'relist_group_id',
  // Override
  'manual_confidence_score', 'manual_action', 'override_enabled',
  // Data quality
  'invalid_source'
];

// Legacy alias
const LOT_HEADERS = LISTING_HEADERS;

const SALES_LOG_HEADERS = [
  'sale_id', 'dealer_name', 'dealer_whatsapp', 'deposit_date', 'make', 'model',
  'variant_normalised', 'year', 'km', 'engine', 'drivetrain', 'transmission',
  'buy_price', 'sell_price', 'days_to_deposit', 'notes', 'source', 'created_at'
];

const SALES_IMPORTS_RAW_HEADERS = [
  'import_id', 'uploaded_at', 'dealer_name', 'source', 'original_row_json', 'parse_status', 'parse_notes'
];

const SALES_NORMALISED_HEADERS = [
  'sale_id', 'import_id', 'dealer_name', 'sale_date', 'make', 'model', 'variant_raw', 'variant_normalised',
  'sale_price', 'days_to_sell', 'location', 'km', 'quality_flag', 'notes', 'year', 'engine', 'drivetrain',
  'transmission', 'fingerprint_generated', 'fingerprint_id', 'gross_profit', 'activate', 'do_not_replicate', 'tags',
  'do_not_buy', 'do_not_buy_reason'
];

// Parse Sales Imports Raw
function parseSalesImportRaw(row: any): SalesImportRaw {
  return {
    import_id: row.import_id || '',
    uploaded_at: row.uploaded_at || '',
    dealer_name: row.dealer_name || '',
    source: row.source || '',
    original_row_json: row.original_row_json || '',
    parse_status: row.parse_status || 'success',
    parse_notes: row.parse_notes || '',
    _rowIndex: row._rowIndex,
  };
}

// Parse Sales Normalised
function parseSalesNormalised(row: any): SalesNormalised {
  return {
    sale_id: row.sale_id || '',
    import_id: row.import_id || '',
    dealer_name: row.dealer_name || '',
    sale_date: row.sale_date || '',
    make: row.make || '',
    model: row.model || '',
    variant_raw: row.variant_raw || '',
    variant_normalised: row.variant_normalised || '',
    sale_price: row.sale_price ? parseFloat(row.sale_price) : undefined,
    days_to_sell: row.days_to_sell ? parseInt(row.days_to_sell) : undefined,
    location: row.location || undefined,
    km: row.km ? parseInt(row.km) : undefined,
    quality_flag: row.quality_flag || 'review',
    notes: row.notes || undefined,
    year: row.year ? parseInt(row.year) : undefined,
    engine: row.engine || undefined,
    drivetrain: row.drivetrain || undefined,
    transmission: row.transmission || undefined,
    fingerprint_generated: row.fingerprint_generated || 'N',
    fingerprint_id: row.fingerprint_id || undefined,
    gross_profit: row.gross_profit ? parseFloat(row.gross_profit) : undefined,
    activate: row.activate || 'N',
    do_not_replicate: row.do_not_replicate || 'N',
    tags: row.tags || undefined,
    do_not_buy: row.do_not_buy || 'N',
    do_not_buy_reason: row.do_not_buy_reason || undefined,
    _rowIndex: row._rowIndex,
  };
}

export const googleSheetsService = {
  // Get opportunities as a filtered view of Auction_Lots
  // Data source: Auction_Lots only (not a separate opportunities table)
  getOpportunities: async (isAdmin: boolean, dealerFingerprints?: SaleFingerprint[]): Promise<AuctionLot[]> => {
    // Read from Auction_Lots
    let lots: AuctionLot[] = [];
    try {
      const response = await callSheetsApi('read', SHEETS.LOTS);
      lots = response.data.map(parseAuctionLot);
    } catch {
      return [];
    }

    // Apply filtering rules in order:
    // 1. visible_to_dealers = "Y" for dealers (admin sees all)
    // 2. status IN ("listed", "passed_in")
    // 3. estimated_margin >= 1000
    // 4. action IN ("Watch", "Buy")
    const filtered = lots.filter((lot: AuctionLot) => {
      // Admin sees all; dealers only see visible_to_dealers = Y
      if (!isAdmin && lot.visible_to_dealers !== 'Y') return false;
      
      // Status filter
      if (!['listed', 'passed_in'].includes(lot.status)) return false;
      
      // Margin threshold
      if (lot.estimated_margin < 1000) return false;
      
      // Action filter
      if (!['Watch', 'Buy'].includes(lot.action)) return false;
      
      return true;
    });

    // Apply sorting:
    // Primary: action (Buy first, then Watch)
    // Secondary: confidence_score descending
    // Tertiary: auction_datetime ascending
    filtered.sort((a, b) => {
      // Primary: Buy first
      if (a.action !== b.action) {
        return a.action === 'Buy' ? -1 : 1;
      }
      // Secondary: confidence_score descending
      if (a.confidence_score !== b.confidence_score) {
        return b.confidence_score - a.confidence_score;
      }
      // Tertiary: auction_datetime ascending
      const dateA = new Date(a.auction_datetime).getTime() || 0;
      const dateB = new Date(b.auction_datetime).getTime() || 0;
      return dateA - dateB;
    });

    return filtered;
  },

  // Log action change to Alert_Log (Watch → Buy detection)
  // Creates in-app alerts for matching fingerprints
  logActionChange: async (lot: AuctionLot, previousAction: 'Watch' | 'Buy', newAction: 'Watch' | 'Buy'): Promise<void> => {
    if (previousAction === 'Watch' && newAction === 'Buy') {
      // Get all active fingerprints that match this lot
      const fingerprints = await googleSheetsService.getFingerprints();
      const matchingFingerprints = fingerprints.filter(fp => 
        fp.is_active === 'Y' &&
        fp.make === lot.make &&
        fp.model === lot.model &&
        fp.variant_normalised === lot.variant_normalised
      );

      const today = new Date().toISOString().split('T')[0];
      const flagReasons = getLotFlagReasons(lot);

      // Get existing alerts for deduplication
      const existingAlerts = await googleSheetsService.getAlerts();

      for (const fp of matchingFingerprints) {
        const dedupKey = `${fp.dealer_name}|${lot.lot_key}|Watch→Buy|${today}`;
        
        // Check deduplication
        const isDuplicate = existingAlerts.some(a => a.dedup_key === dedupKey);
        if (isDuplicate) {
          console.log(`Skipping duplicate alert for ${fp.dealer_name} on lot ${lot.lot_key}`);
          continue;
        }

        const alert: AlertLog = {
          alert_id: `ALT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          created_at: new Date().toISOString(),
          dealer_name: fp.dealer_name,
          channel: 'in_app',
          lot_id: lot.lot_key,
          fingerprint_id: fp.fingerprint_id,
          action_change: 'Watch→Buy',
          message_text: `${lot.year} ${lot.make} ${lot.model} ${lot.variant_normalised || ''} moved to BUY`,
          link: lot.listing_url,
          status: 'new',
          dedup_key: dedupKey,
          lot_make: lot.make,
          lot_model: lot.model,
          lot_variant: lot.variant_normalised,
          lot_year: lot.year,
          auction_house: lot.auction_house,
          auction_datetime: lot.auction_datetime,
          estimated_margin: lot.estimated_margin,
          why_flagged: flagReasons,
        };
        
        await callSheetsApi('append', SHEETS.ALERTS, alert);
        console.log(`Created in-app alert for ${fp.dealer_name} on lot ${lot.lot_key}`);
      }
    }
  },

  // Get all fingerprints
  getFingerprints: async (): Promise<SaleFingerprint[]> => {
    const response = await callSheetsApi('read', SHEETS.FINGERPRINTS);
    return response.data.map(parseFingerprint);
  },

  // Get dealer's fingerprints
  getDealerFingerprints: async (dealerName: string): Promise<SaleFingerprint[]> => {
    const response = await callSheetsApi('read', SHEETS.FINGERPRINTS);
    return response.data
      .map(parseFingerprint)
      .filter((fp: SaleFingerprint) => fp.dealer_name === dealerName);
  },

  // Get all dealers
  getDealers: async (): Promise<Dealer[]> => {
    const response = await callSheetsApi('read', SHEETS.DEALERS);
    return response.data.map(parseDealer);
  },

  // Get alerts
  getAlerts: async (): Promise<AlertLog[]> => {
    const response = await callSheetsApi('read', SHEETS.ALERTS);
    return response.data.map(parseAlert);
  },

  // Add a new sale fingerprint
  addFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'min_km' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    const saleDate = new Date(fp.sale_date);
    const expiresAt = new Date(saleDate);
    expiresAt.setDate(expiresAt.getDate() + 120);
    
    // Symmetric KM range
    const minKm = Math.max(0, fp.sale_km - 15000);
    const maxKm = fp.sale_km + 15000;
    
    const newFingerprint: SaleFingerprint = {
      ...fp,
      fingerprint_id: `FP-${Date.now()}`,
      expires_at: expiresAt.toISOString().split('T')[0],
      min_km: minKm,
      max_km: maxKm,
      is_active: 'Y',
    };
    
    await callSheetsApi('append', SHEETS.FINGERPRINTS, newFingerprint);
    return newFingerprint;
  },

  // Deactivate a fingerprint
  deactivateFingerprint: async (fingerprintId: string): Promise<void> => {
    // First read all fingerprints to find the row
    const response = await callSheetsApi('read', SHEETS.FINGERPRINTS);
    const fingerprints = response.data.map(parseFingerprint);
    const fp = fingerprints.find((f: SaleFingerprint) => f.fingerprint_id === fingerprintId);
    
    if (fp && fp._rowIndex !== undefined) {
      const updatedFp = { ...fp, is_active: 'N' };
      await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, fp._rowIndex);
    }
  },

  // Get unique filter values from Auction_Lots
  getFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[]; makes: string[] }> => {
    try {
      const response = await callSheetsApi('read', SHEETS.LOTS);
      const lots = response.data.map(parseAuctionLot);
      
      return {
        auction_houses: [...new Set(lots.map((l: AuctionLot) => l.auction_house))].filter(Boolean) as string[],
        locations: [...new Set(lots.map((l: AuctionLot) => l.location))].filter(Boolean) as string[],
        makes: [...new Set(lots.map((l: AuctionLot) => l.make))].filter(Boolean) as string[],
      };
    } catch {
      return { auction_houses: [], locations: [], makes: [] };
    }
  },

  // Add alert log entry
  addAlert: async (alert: Omit<AlertLog, 'alert_id'>): Promise<AlertLog> => {
    const newAlert: AlertLog = {
      ...alert,
      alert_id: `ALT-${Date.now()}`,
    };
    
    await callSheetsApi('append', SHEETS.ALERTS, newAlert);
    return newAlert;
  },

  // Get auction events
  getAuctionEvents: async (): Promise<AuctionEvent[]> => {
    const response = await callSheetsApi('read', SHEETS.EVENTS);
    return response.data.map(parseAuctionEvent);
  },

  // Add a new auction event
  addAuctionEvent: async (event: Omit<AuctionEvent, 'event_id'>): Promise<AuctionEvent> => {
    const newEvent: AuctionEvent = {
      ...event,
      event_id: `EVT-${Date.now()}`,
    };
    
    await callSheetsApi('append', SHEETS.EVENTS, newEvent);
    return newEvent;
  },

  // Update an auction event
  updateAuctionEvent: async (event: AuctionEvent): Promise<void> => {
    if (event._rowIndex !== undefined) {
      await callSheetsApi('update', SHEETS.EVENTS, event, event._rowIndex);
    }
  },

  // Get filter options for events
  getEventFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[] }> => {
    const response = await callSheetsApi('read', SHEETS.EVENTS);
    const events = response.data.map(parseAuctionEvent);
    
    return {
      auction_houses: [...new Set(events.map((e: AuctionEvent) => e.auction_house))].filter(Boolean) as string[],
      locations: [...new Set(events.map((e: AuctionEvent) => e.location))].filter(Boolean) as string[],
    };
  },

  // ========== AUCTION LOTS ==========

  // Get all lots from vehicle_listings database table
  getLots: async (isAdmin: boolean): Promise<AuctionLot[]> => {
    try {
      let query = supabase
        .from('vehicle_listings')
        .select('*')
        .order('auction_datetime', { ascending: true, nullsFirst: false });
      
      // Filter by visibility for dealers
      if (!isAdmin) {
        query = query.eq('visible_to_dealers', true);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching vehicle listings:', error);
        return [];
      }
      
      // Map database rows to AuctionLot format
      return (data || []).map((row): AuctionLot => {
        const listing: AuctionLot = {
          listing_id: row.listing_id,
          lot_id: row.lot_id,
          lot_key: `${row.auction_house}:${row.lot_id}`,
          listing_key: `${row.auction_house}:${row.listing_id}`,
          source: (row.source || 'auction') as SourceType,
          source_site: row.auction_house,
          source_type: (row.source || 'auction') as SourceType,
          source_name: row.auction_house,
          event_id: row.event_id || '',
          auction_house: row.auction_house,
          location: row.location || '',
          auction_datetime: row.auction_datetime || '',
          listing_url: row.listing_url || '',
          make: row.make,
          model: row.model,
          variant_raw: row.variant_raw || '',
          variant_normalised: row.variant_family || row.variant_raw || '',
          variant_family: row.variant_family || undefined,
          year: row.year,
          km: row.km || 0,
          fuel: row.fuel || '',
          drivetrain: row.drivetrain || '',
          transmission: row.transmission || '',
          reserve: row.reserve || 0,
          highest_bid: row.highest_bid || 0,
          first_seen_price: row.reserve || 0,
          last_seen_price: row.reserve || 0,
          price_current: row.reserve || 0,
          price_prev: 0,
          price_change_pct: 0,
          status: (row.status || 'catalogue') as ListingStatus,
          pass_count: row.pass_count || 0,
          price_drop_count: 0,
          relist_count: row.relist_count || 0,
          first_seen_at: row.first_seen_at || '',
          last_seen_at: row.last_seen_at || '',
          last_auction_date: row.last_auction_date || '',
          days_listed: 0,
          description_score: 0,
          estimated_get_out: 0,
          estimated_margin: 0,
          confidence_score: 0,
          action: 'Watch',
          visible_to_dealers: row.visible_to_dealers ? 'Y' : 'N',
          updated_at: row.updated_at || '',
          last_status: '',
          relist_group_id: '',
          override_enabled: 'N',
          invalid_source: 'N',
          excluded_reason: row.excluded_reason || undefined,
          excluded_keyword: row.excluded_keyword || undefined,
        };
        
        // Calculate confidence and action
        listing.confidence_score = calculateLotConfidenceScore(listing);
        listing.action = determineLotAction(listing.confidence_score, listing);
        
        return listing;
      });
    } catch (error) {
      console.error('Error fetching vehicle listings:', error);
      return [];
    }
  },

  // Get lot filter options from database
  getLotFilterOptions: async (): Promise<{ 
    auction_houses: string[]; 
    locations: string[]; 
    makes: string[];
    source_types: string[];
    source_names: string[];
  }> => {
    try {
      const { data, error } = await supabase
        .from('vehicle_listings')
        .select('auction_house, location, make, source');
      
      if (error) {
        console.error('Error fetching filter options:', error);
        return { auction_houses: [], locations: [], makes: [], source_types: [], source_names: [] };
      }
      
      const rows = data || [];
      return {
        auction_houses: [...new Set(rows.map(r => r.auction_house))].filter(Boolean).sort(),
        locations: [...new Set(rows.map(r => r.location))].filter(Boolean).sort(),
        makes: [...new Set(rows.map(r => r.make))].filter(Boolean).sort(),
        source_types: [...new Set(rows.map(r => r.source))].filter(Boolean).sort(),
        source_names: [...new Set(rows.map(r => r.auction_house))].filter(Boolean).sort(),
      };
    } catch {
      return { auction_houses: [], locations: [], makes: [], source_types: [], source_names: [] };
    }
  },

  // Add a new lot
  addLot: async (lot: Omit<AuctionLot, 'lot_id' | 'lot_key' | 'updated_at' | 'confidence_score' | 'action' | 'last_status' | 'last_seen_at'>): Promise<AuctionLot> => {
    const confidenceScore = calculateLotConfidenceScore(lot as AuctionLot);
    const action = determineLotAction(confidenceScore);
    const nowISO = new Date().toISOString();
    const lotId = `LOT-${Date.now()}`;
    const lotKey = `${lot.auction_house}:${lotId}`;
    
    // If status is passed_in on first insert, set pass_count = 1
    const passCount = lot.status === 'passed_in' ? 1 : 0;
    
    const newLot: AuctionLot = {
      ...lot,
      lot_id: lotId,
      lot_key: lotKey,
      pass_count: passCount,
      confidence_score: confidenceScore,
      action: action,
      updated_at: nowISO,
      last_status: '',
      last_seen_at: nowISO,
    };
    
    await callSheetsApi('append', SHEETS.LOTS, newLot);
    return newLot;
  },

  // Update an existing lot
  updateLot: async (lot: AuctionLot): Promise<void> => {
    if (lot._rowIndex !== undefined) {
      const updatedLot = {
        ...lot,
        updated_at: new Date().toISOString(),
      };
      await callSheetsApi('update', SHEETS.LOTS, updatedLot, lot._rowIndex);
    }
  },

  // Upsert lots (for CSV import) - uses lot_key for auctions, listing_key for non-auctions
  upsertLots: async (newLots: Partial<AuctionLot>[]): Promise<{ added: number; updated: number }> => {
    // Read existing lots
    let existingLots: AuctionLot[] = [];
    
    try {
      const response = await callSheetsApi('read', SHEETS.LOTS);
      existingLots = response.data.map(parseAuctionLot);
    } catch {
      // Create sheet if it doesn't exist
      await callSheetsApi('create', SHEETS.LOTS, { headers: LOT_HEADERS });
    }

    let added = 0;
    let updated = 0;
    const nowISO = new Date().toISOString();
    const validStatuses = ['listed', 'passed_in', 'sold', 'withdrawn'];

    for (const newLot of newLots) {
      // Determine source type
      const sourceType = newLot.source_type || 'auction';
      const sourceName = newLot.source_name || newLot.auction_house || '';
      const auctionHouse = newLot.auction_house || '';
      
      // For auctions: require lot_id, for non-auctions: require listing_url or listing_id
      const isAuction = sourceType === 'auction';
      if (isAuction && !newLot.lot_id) continue;
      if (!isAuction && !newLot.listing_url && !newLot.listing_id) continue;
      
      // Compute identity keys
      const incomingLotKey = isAuction 
        ? (newLot.lot_key || `${auctionHouse}:${newLot.lot_id}`)
        : '';
      
      let incomingListingKey = newLot.listing_key || '';
      if (!incomingListingKey && sourceName) {
        if (newLot.listing_id) {
          incomingListingKey = `${sourceName}:${newLot.listing_id}`;
        } else if (newLot.listing_url) {
          incomingListingKey = `${sourceName}:${simpleHash(newLot.listing_url)}`;
        }
      }
      
      // Normalize status
      let incomingStatus = (newLot.status || 'listed').toLowerCase() as 'listed' | 'passed_in' | 'sold' | 'withdrawn';
      if (!validStatuses.includes(incomingStatus)) {
        incomingStatus = 'listed';
      }
      
      // Find existing lot: auctions use lot_key, non-auctions use listing_key
      const existingIndex = isAuction
        ? existingLots.findIndex(l => l.lot_key === incomingLotKey)
        : existingLots.findIndex(l => l.listing_key === incomingListingKey);
      
      if (existingIndex >= 0) {
        // Update existing lot
        const existing = existingLots[existingIndex];
        
        // AUCTION-SPECIFIC: Pass count rule
        // Increment pass_count ONLY when:
        // 1. status becomes passed_in AND
        // 2. auction_date > previous last_auction_date (not a re-import of same run)
        let passCount = existing.pass_count || 0;
        let lastAuctionDate = existing.last_auction_date || '';
        
        if (isAuction && incomingStatus === 'passed_in') {
          const incomingAuctionDate = newLot.auction_datetime || '';
          const prevAuctionDate = existing.last_auction_date || '';
          
          // Only increment if this is a NEW passed_in event (different auction date)
          if (incomingAuctionDate && incomingAuctionDate > prevAuctionDate) {
            passCount = existing.pass_count + 1;
            lastAuctionDate = incomingAuctionDate;
          }
        }
        
        // Price tracking
        const oldPrice = existing.last_seen_price || existing.price_current || 0;
        const newPrice = newLot.price_current || newLot.reserve || newLot.highest_bid || 0;
        let priceDropCount = existing.price_drop_count || 0;
        let pricePrev = existing.price_prev || 0;
        
        if (newPrice > 0 && oldPrice > 0 && newPrice < oldPrice) {
          priceDropCount++;
          pricePrev = oldPrice;
        }
        
        // Relist detection (if last_seen_at > 7 days ago)
        let relistCount = existing.relist_count || 0;
        if (existing.last_seen_at) {
          const lastSeen = new Date(existing.last_seen_at);
          const daysSinceLastSeen = (new Date().getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceLastSeen > 7) {
            relistCount++;
          }
        }
        
        // Compute days_listed
        const firstSeenAt = existing.first_seen_at || nowISO;
        const daysListed = Math.floor((new Date().getTime() - new Date(firstSeenAt).getTime()) / (1000 * 60 * 60 * 24));
        
        // Compute price_change_pct
        const firstSeenPrice = existing.first_seen_price || oldPrice;
        const priceChangePct = firstSeenPrice > 0 ? ((newPrice - firstSeenPrice) / firstSeenPrice) * 100 : 0;
        
        const mergedLot: AuctionLot = {
          ...existing,
          ...newLot,
          // Identity - preserve
          listing_id: existing.listing_id || (isAuction ? `${auctionHouse}:${newLot.lot_id || existing.lot_id}` : (newLot.listing_id || '')),
          lot_key: incomingLotKey || existing.lot_key,
          listing_key: incomingListingKey || existing.listing_key,
          
          // Source - use existing or new
          source: existing.source || sourceType,
          source_site: existing.source_site || sourceName,
          source_type: sourceType,
          source_name: sourceName,
          
          // Status
          status: incomingStatus,
          last_status: existing.status,
          
          // Auction lifecycle
          pass_count: passCount,
          last_auction_date: lastAuctionDate,
          
          // Price tracking
          first_seen_price: existing.first_seen_price || firstSeenPrice,
          last_seen_price: newPrice || oldPrice,
          price_current: newPrice || oldPrice,
          price_prev: pricePrev,
          price_change_pct: priceChangePct,
          price_drop_count: priceDropCount,
          
          // Relist tracking
          relist_count: relistCount,
          
          // Timestamps
          first_seen_at: firstSeenAt,
          last_seen_at: nowISO,
          days_listed: daysListed,
          updated_at: nowISO,
        };
        
        // Recalculate confidence if needed
        if (!newLot.confidence_score) {
          mergedLot.confidence_score = calculateLotConfidenceScore(mergedLot);
        }
        if (!newLot.action) {
          mergedLot.action = determineLotAction(mergedLot.confidence_score);
        }
        
        await callSheetsApi('update', SHEETS.LOTS, mergedLot, existing._rowIndex!);
        updated++;
      } else {
        // Add new lot
        const passCount = isAuction && incomingStatus === 'passed_in' ? 1 : 0;
        const initialPrice = newLot.price_current || newLot.reserve || newLot.highest_bid || 0;
        
        const fullLot: AuctionLot = {
          // Identity
          listing_id: isAuction ? `${auctionHouse}:${newLot.lot_id || ''}` : (newLot.listing_id || ''),
          lot_key: incomingLotKey,
          lot_id: newLot.lot_id || '',
          listing_key: incomingListingKey,
          
          // Source
          source: sourceType,
          source_site: sourceName,
          source_type: sourceType,
          source_name: sourceName,
          
          // Event/Location
          event_id: newLot.event_id || '',
          auction_house: auctionHouse,
          location: newLot.location || '',
          auction_datetime: newLot.auction_datetime || '',
          listing_url: newLot.listing_url || '',
          
          // Vehicle
          make: newLot.make || '',
          model: newLot.model || '',
          variant_raw: newLot.variant_raw || '',
          variant_normalised: newLot.variant_normalised || '',
          year: newLot.year || 0,
          km: newLot.km || 0,
          fuel: newLot.fuel || '',
          drivetrain: newLot.drivetrain || '',
          transmission: newLot.transmission || '',
          
          // Pricing
          reserve: newLot.reserve || 0,
          highest_bid: newLot.highest_bid || 0,
          first_seen_price: initialPrice,
          last_seen_price: initialPrice,
          price_current: initialPrice,
          price_prev: 0,
          price_change_pct: 0,
          
          // Lifecycle
          status: incomingStatus,
          pass_count: passCount,
          price_drop_count: 0,
          relist_count: 0,
          first_seen_at: nowISO,
          last_seen_at: nowISO,
          last_auction_date: isAuction && incomingStatus === 'passed_in' ? (newLot.auction_datetime || nowISO) : '',
          days_listed: 0,
          
          // Scoring
          description_score: newLot.description_score || 0,
          estimated_get_out: newLot.estimated_get_out || 0,
          estimated_margin: newLot.estimated_margin || 0,
          confidence_score: newLot.confidence_score || 0,
          action: newLot.action || 'Watch',
          visible_to_dealers: newLot.visible_to_dealers || 'N',
          
          // Tracking
          updated_at: nowISO,
          last_status: '',
          relist_group_id: newLot.relist_group_id || '',
          
          // Override fields (defaults)
          override_enabled: 'N',
          
          // Data quality - check if listing_url is valid
          invalid_source: isInvalidListingUrl(newLot.listing_url || '') ? 'Y' : 'N',
        };
        
        // Apply condition exclusion filter BEFORE scoring
        const exclusionCheck = shouldExcludeListing(fullLot);
        if (exclusionCheck.excluded) {
          fullLot.excluded_reason = 'condition_risk';
          fullLot.excluded_keyword = exclusionCheck.keyword;
          fullLot.visible_to_dealers = 'N'; // Hidden from dealers
        }
        
        // Calculate confidence (only if not excluded)
        if (!fullLot.excluded_reason) {
          fullLot.confidence_score = calculateLotConfidenceScore(fullLot);
          fullLot.action = determineLotAction(fullLot.confidence_score);
        } else {
          fullLot.confidence_score = 0;
          fullLot.action = 'Watch';
        }
        
        await callSheetsApi('append', SHEETS.LOTS, fullLot);
        added++;
      }
    }

    return { added, updated };
  },

  // ========== SALES LOG ==========

  // Get sales log (last N entries)
  getSalesLog: async (limit?: number): Promise<SaleLog[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.SALES_LOG);
      const sales = response.data.map(parseSaleLog);
      // Sort by created_at descending
      sales.sort((a: SaleLog, b: SaleLog) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return limit ? sales.slice(0, limit) : sales;
    } catch {
      // Create sheet if it doesn't exist
      await callSheetsApi('create', SHEETS.SALES_LOG, { headers: SALES_LOG_HEADERS });
      return [];
    }
  },

  // Add a sale log entry
  addSaleLog: async (sale: Omit<SaleLog, 'sale_id' | 'created_at'>): Promise<SaleLog> => {
    // Ensure sheet exists
    try {
      await callSheetsApi('read', SHEETS.SALES_LOG);
    } catch {
      await callSheetsApi('create', SHEETS.SALES_LOG, { headers: SALES_LOG_HEADERS });
    }

    const newSale: SaleLog = {
      ...sale,
      sale_id: `SALE-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    
    await callSheetsApi('append', SHEETS.SALES_LOG, newSale);
    return newSale;
  },

  // Upsert fingerprint - update if exists for same dealer + strict fields, else create new
  upsertFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'min_km' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    const depositDate = new Date(fp.sale_date);
    const expiresAt = new Date(depositDate);
    expiresAt.setDate(expiresAt.getDate() + 120);
    
    // Symmetric KM range
    const minKm = Math.max(0, fp.sale_km - 15000);
    const maxKm = fp.sale_km + 15000;
    
    const newData = {
      sale_date: fp.sale_date,
      expires_at: expiresAt.toISOString().split('T')[0],
      min_km: minKm,
      max_km: maxKm,
      is_active: 'Y' as const,
    };
    
    // Read existing fingerprints to check for duplicates
    const response = await callSheetsApi('read', SHEETS.FINGERPRINTS);
    const fingerprints = response.data.map(parseFingerprint);
    
    // Find matching fingerprint by dealer + strict fields
    const existingIndex = fingerprints.findIndex((existing: SaleFingerprint) =>
      existing.dealer_name === fp.dealer_name &&
      existing.make === fp.make &&
      existing.model === fp.model &&
      existing.variant_normalised === fp.variant_normalised &&
      existing.year === fp.year &&
      existing.engine === fp.engine &&
      existing.drivetrain === fp.drivetrain &&
      existing.transmission === fp.transmission
    );
    
    if (existingIndex >= 0) {
      // Update existing fingerprint
      const existing = fingerprints[existingIndex];
      const updatedFp: SaleFingerprint = {
        ...existing,
        sale_date: newData.sale_date,
        sale_km: fp.sale_km,
        min_km: newData.min_km,
        max_km: newData.max_km,
        expires_at: newData.expires_at,
        is_active: newData.is_active,
        dealer_whatsapp: fp.dealer_whatsapp || existing.dealer_whatsapp,
        shared_opt_in: fp.shared_opt_in || existing.shared_opt_in,
      };
      
      await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, existing._rowIndex!);
      return updatedFp;
    } else {
      // Create new fingerprint
      const newFingerprint: SaleFingerprint = {
        ...fp,
        fingerprint_id: `FP-${Date.now()}`,
        ...newData,
      };
      
      await callSheetsApi('append', SHEETS.FINGERPRINTS, newFingerprint);
      return newFingerprint;
    }
  },

  // Batch import sales from CSV with relaxed validation
  // CSV imports only require: make, model, year, deposit_date
  // CSV imports default to activate=N - fingerprints generated separately from Sales Review
  importSalesWithFingerprints: async (
    sales: Array<Omit<SaleLog, 'sale_id' | 'created_at'>>
  ): Promise<{ imported: number; fingerprintsUpdated: number; errors: Array<{ row: number; reason: string }> }> => {
    // Ensure sheet exists
    try {
      await callSheetsApi('read', SHEETS.SALES_LOG);
    } catch {
      await callSheetsApi('create', SHEETS.SALES_LOG, { headers: SALES_LOG_HEADERS });
    }

    // Relaxed validation for CSV - only core vehicle identification required
    // dealer_name is NOT required - it should default from the logged-in user
    const csvRequiredFields = ['deposit_date', 'make', 'model', 'year'];
    const errors: Array<{ row: number; reason: string }> = [];
    let imported = 0;
    // Note: fingerprintsUpdated stays 0 for CSV imports since activate defaults to N
    const fingerprintsUpdated = 0;

    for (let i = 0; i < sales.length; i++) {
      const sale = sales[i];
      
      // Validate only CSV required fields
      const missingFields = csvRequiredFields.filter(field => {
        const value = (sale as any)[field];
        return value === undefined || value === null || value === '';
      });
      
      if (missingFields.length > 0) {
        errors.push({ row: i + 1, reason: `Missing: ${missingFields.join(', ')}` });
        continue;
      }

      try {
        // Add to Sales_Log with defaults for optional fields
        const newSale: SaleLog = {
          ...sale,
          // Ensure optional fields have defaults (dealer_name should already be set by frontend)
          dealer_name: sale.dealer_name || 'Unknown',
          variant_normalised: sale.variant_normalised || '',
          km: sale.km || 0,
          engine: sale.engine || '',
          drivetrain: sale.drivetrain || '',
          transmission: sale.transmission || '',
          sale_id: `SALE-${Date.now()}-${i}`,
          created_at: new Date().toISOString(),
        };
        await callSheetsApi('append', SHEETS.SALES_LOG, newSale);
        imported++;

        // NOTE: Do NOT auto-generate fingerprints for CSV imports
        // CSV-imported rows default to activate=N in Sales_Normalised
        // Fingerprints are generated manually via Sales Review page after admin approval
      } catch (error) {
        errors.push({ row: i + 1, reason: `Failed to save: ${error}` });
      }
    }

    return { imported, fingerprintsUpdated, errors };
  },

  // Get app settings
  getSettings: async (): Promise<AppSettings[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.SETTINGS);
      return response.data.map((row: any): AppSettings => ({
        setting_key: row.setting_key || '',
        setting_value: row.setting_value || '',
        updated_at: row.updated_at || '',
        _rowIndex: row._rowIndex,
      }));
    } catch {
      return [];
    }
  },

  // Get a specific setting value
  getSetting: async (key: string): Promise<string | null> => {
    const settings = await googleSheetsService.getSettings();
    const setting = settings.find(s => s.setting_key === key);
    return setting?.setting_value || null;
  },

  // Update or create a setting
  upsertSetting: async (key: string, value: string): Promise<void> => {
    const settings = await googleSheetsService.getSettings();
    const existing = settings.find(s => s.setting_key === key);

    const settingData: AppSettings = {
      setting_key: key,
      setting_value: value,
      updated_at: new Date().toISOString(),
    };

    if (existing && existing._rowIndex !== undefined) {
      await callSheetsApi('update', SHEETS.SETTINGS, settingData, existing._rowIndex);
    } else {
      await callSheetsApi('append', SHEETS.SETTINGS, settingData);
    }
  },

  // Get alerts for a specific dealer
  getDealerAlerts: async (dealerName: string): Promise<AlertLog[]> => {
    const alerts = await googleSheetsService.getAlerts();
    return alerts.filter(a => a.dealer_name === dealerName);
  },

  // Get unread BUY alert count (Watch→Buy only)
  getUnreadAlertCount: async (dealerName?: string): Promise<number> => {
    const alerts = await googleSheetsService.getAlerts();
    return alerts.filter(a => 
      a.status === 'new' && 
      a.action_change === 'Watch→Buy' &&
      (!dealerName || a.dealer_name === dealerName)
    ).length;
  },

  // Get unread BUY alerts (Watch→Buy only)
  getUnreadBuyAlerts: async (dealerName?: string): Promise<AlertLog[]> => {
    const alerts = await googleSheetsService.getAlerts();
    return alerts.filter(a => 
      a.status === 'new' && 
      a.action_change === 'Watch→Buy' &&
      (!dealerName || a.dealer_name === dealerName)
    );
  },

  // Mark alert as read
  markAlertRead: async (alertId: string): Promise<void> => {
    const alerts = await googleSheetsService.getAlerts();
    const alert = alerts.find(a => a.alert_id === alertId);
    
    if (alert && alert._rowIndex !== undefined && alert.status === 'new') {
      await callSheetsApi('update', SHEETS.ALERTS, {
        ...alert,
        status: 'read',
        read_at: new Date().toISOString(),
      }, alert._rowIndex);
    }
  },

  // Mark all BUY alerts as read for a dealer
  markAllBuyAlertsRead: async (dealerName?: string): Promise<number> => {
    const alerts = await googleSheetsService.getAlerts();
    const buyAlerts = alerts.filter(a => 
      a.status === 'new' && 
      a.action_change === 'Watch→Buy' &&
      (!dealerName || a.dealer_name === dealerName)
    );
    
    let count = 0;
    for (const alert of buyAlerts) {
      if (alert._rowIndex !== undefined) {
        await callSheetsApi('update', SHEETS.ALERTS, {
          ...alert,
          status: 'read',
          read_at: new Date().toISOString(),
        }, alert._rowIndex);
        count++;
      }
    }
    return count;
  },

  // Mark alert as acknowledged
  acknowledgeAlert: async (alertId: string): Promise<void> => {
    const alerts = await googleSheetsService.getAlerts();
    const alert = alerts.find(a => a.alert_id === alertId);
    
    if (alert && alert._rowIndex !== undefined) {
      await callSheetsApi('update', SHEETS.ALERTS, {
        ...alert,
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
      }, alert._rowIndex);
    }
  },

  // ========== SALES IMPORTS (Audit Trail) ==========

  // Append raw import rows (immutable - never delete) - uses batch append to avoid rate limits
  appendSalesImportsRaw: async (rows: SalesImportRaw[]): Promise<void> => {
    // Ensure sheet exists
    try {
      await callSheetsApi('read', SHEETS.SALES_IMPORTS_RAW);
    } catch {
      await callSheetsApi('create', SHEETS.SALES_IMPORTS_RAW, { headers: SALES_IMPORTS_RAW_HEADERS });
    }

    // Batch append all rows in a single API call to avoid rate limits
    if (rows.length > 0) {
      await callSheetsApi('batch_append', SHEETS.SALES_IMPORTS_RAW, rows);
    }
  },

  // Get all raw imports
  getSalesImportsRaw: async (importId?: string): Promise<SalesImportRaw[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.SALES_IMPORTS_RAW);
      let rows = response.data.map(parseSalesImportRaw);
      if (importId) {
        rows = rows.filter((r: SalesImportRaw) => r.import_id === importId);
      }
      return rows;
    } catch {
      return [];
    }
  },

  // ========== SALES NORMALISED ==========

  // Append normalised sales - uses batch append to avoid rate limits
  appendSalesNormalised: async (rows: SalesNormalised[]): Promise<void> => {
    // Ensure sheet exists
    try {
      await callSheetsApi('read', SHEETS.SALES_NORMALISED);
    } catch {
      await callSheetsApi('create', SHEETS.SALES_NORMALISED, { headers: SALES_NORMALISED_HEADERS });
    }

    // Batch append all rows in a single API call to avoid rate limits
    if (rows.length > 0) {
      await callSheetsApi('batch_append', SHEETS.SALES_NORMALISED, rows);
    }
  },

  // Get normalised sales with optional filters (deduplicated)
  getSalesNormalised: async (filters?: {
    importId?: string;
    dealerName?: string;
    qualityFlag?: string;
    make?: string;
    model?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<SalesNormalised[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.SALES_NORMALISED);
      let rows = response.data.map(parseSalesNormalised);

      // Deduplicate based on composite key: make + model + year + km + sale_date + dealer_name
      // Keep the first occurrence (which has the lowest row index, i.e. earliest entry)
      const seen = new Set<string>();
      rows = rows.filter((r: SalesNormalised) => {
        const key = [
          r.dealer_name?.toLowerCase().trim() || '',
          r.make?.toLowerCase().trim() || '',
          r.model?.toLowerCase().trim() || '',
          r.year || '',
          r.km || '',
          r.sale_date || '',
        ].join('|');
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      if (filters) {
        if (filters.importId) rows = rows.filter((r: SalesNormalised) => r.import_id === filters.importId);
        if (filters.dealerName) rows = rows.filter((r: SalesNormalised) => r.dealer_name === filters.dealerName);
        if (filters.qualityFlag) rows = rows.filter((r: SalesNormalised) => r.quality_flag === filters.qualityFlag);
        if (filters.make) rows = rows.filter((r: SalesNormalised) => r.make === filters.make);
        if (filters.model) rows = rows.filter((r: SalesNormalised) => r.model === filters.model);
        if (filters.dateFrom) rows = rows.filter((r: SalesNormalised) => r.sale_date >= filters.dateFrom!);
        if (filters.dateTo) rows = rows.filter((r: SalesNormalised) => r.sale_date <= filters.dateTo!);
      }

      return rows;
    } catch {
      return [];
    }
  },

  // Get unique filter values for Sales Normalised
  getSalesNormalisedFilterOptions: async (): Promise<{
    importIds: string[];
    dealers: string[];
    makes: string[];
    models: string[];
    qualityFlags: string[];
  }> => {
    const rows = await googleSheetsService.getSalesNormalised();
    return {
      importIds: [...new Set(rows.map(r => r.import_id).filter(Boolean))].sort(),
      dealers: [...new Set(rows.map(r => r.dealer_name).filter(Boolean))].sort(),
      makes: [...new Set(rows.map(r => r.make).filter(Boolean))].sort(),
      models: [...new Set(rows.map(r => r.model).filter(Boolean))].sort(),
      qualityFlags: ['good', 'review', 'incomplete'],
    };
  },

  // Update a normalised sale row
  updateSalesNormalised: async (sale: SalesNormalised): Promise<void> => {
    if (sale._rowIndex === undefined) {
      throw new Error('Cannot update sale without row index');
    }
    await callSheetsApi('update', SHEETS.SALES_NORMALISED, sale, sale._rowIndex);
  },

  // Generate fingerprints from selected normalised sales
  // Only generates from rows where activate=Y AND do_not_replicate!=Y
  generateFingerprintsFromNormalised: async (saleIds: string[]): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> => {
    const sales = await googleSheetsService.getSalesNormalised();
    const selected = sales.filter((s: SalesNormalised) => saleIds.includes(s.sale_id));

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const sale of selected) {
      // Skip if already generated
      if (sale.fingerprint_generated === 'Y') {
        skipped++;
        continue;
      }

      // CRITICAL: Only generate from activate=Y AND do_not_replicate!=Y AND do_not_buy!=Y
      if (sale.activate !== 'Y') {
        errors.push(`Sale ${sale.sale_id}: Not activated (set Activate=Y first)`);
        continue;
      }
      if (sale.do_not_replicate === 'Y') {
        errors.push(`Sale ${sale.sale_id}: Marked as Do Not Replicate`);
        continue;
      }
      if (sale.do_not_buy === 'Y') {
        errors.push(`Sale ${sale.sale_id}: Marked as Do Not Buy`);
        continue;
      }

      // Validate required fields for fingerprint - relaxed: only need make, model, dealer
      if (!sale.make || !sale.model || !sale.dealer_name) {
        errors.push(`Sale ${sale.sale_id}: Missing make, model, or dealer_name`);
        continue;
      }

      try {
        // Determine fingerprint type based on km/engine/drivetrain/transmission availability
        const hasKm = sale.km !== undefined && sale.km !== null && sale.km > 0;
        const hasFullSpecs = hasKm && sale.engine && sale.drivetrain && sale.transmission;
        const fingerprintType = hasFullSpecs ? 'full' : 'spec_only';

        // Create fingerprint with source linkbacks
        const fp = await googleSheetsService.upsertFingerprintFromSale({
          dealer_name: sale.dealer_name,
          dealer_whatsapp: '',
          sale_date: sale.sale_date,
          make: sale.make,
          model: sale.model,
          variant_normalised: sale.variant_normalised || '',
          year: sale.year || 0,
          sale_km: hasKm ? sale.km! : 0,
          engine: sale.engine || '',
          drivetrain: sale.drivetrain || '',
          transmission: sale.transmission || '',
          shared_opt_in: 'N',
          fingerprint_type: fingerprintType,
          source_sale_id: sale.sale_id,
          source_import_id: sale.import_id,
        });

        // Update sale with fingerprint reference
        const fingerprintNotes = fingerprintType === 'spec_only'
          ? `${sale.notes || ''} [spec_only]`.trim()
          : sale.notes;
        
        await googleSheetsService.updateSalesNormalised({
          ...sale,
          fingerprint_generated: 'Y',
          fingerprint_id: fp.fingerprint_id,
          notes: fingerprintNotes,
        });

        // Count as created or updated based on whether it existed before
        if (fp._isNew) {
          created++;
        } else {
          updated++;
        }
      } catch (err) {
        errors.push(`Sale ${sale.sale_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return { created, updated, skipped, errors };
  },

  // New upsert function that tracks source_sale_id for idempotency
  upsertFingerprintFromSale: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'min_km' | 'max_km' | 'is_active'> & { 
    fingerprint_type: 'full' | 'spec_only';
    source_sale_id: string;
    source_import_id: string;
  }): Promise<SaleFingerprint & { _isNew: boolean }> => {
    const existingFingerprints = await googleSheetsService.getFingerprints();
    
    // Check for existing fingerprint by source_sale_id first (idempotent)
    const existingBySource = existingFingerprints.find(
      (f: SaleFingerprint) => f.source_sale_id === fp.source_sale_id
    );

    // For CSV imports (has source_import_id), use activation date (now) + 120 days
    // For manual entries, use sale_date + 120 days
    const isFromCsvImport = !!fp.source_import_id;
    const baseDate = isFromCsvImport ? new Date() : new Date(fp.sale_date || new Date());
    const expiresAt = new Date(baseDate);
    expiresAt.setDate(expiresAt.getDate() + 120);
    
    // Symmetric KM range: sale_km ± 15000
    // For spec_only, km is not meaningful
    const minKm = fp.fingerprint_type === 'spec_only' ? 0 : Math.max(0, fp.sale_km - 15000);
    const maxKm = fp.fingerprint_type === 'spec_only' ? 999999 : fp.sale_km + 15000;

    if (existingBySource) {
      // Update existing fingerprint - just reactivate it
      const updatedFp: SaleFingerprint = {
        ...existingBySource,
        is_active: 'Y',
        expires_at: expiresAt.toISOString().split('T')[0],
        min_km: minKm,
        max_km: maxKm,
      };
      
      if (existingBySource._rowIndex !== undefined) {
        await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, existingBySource._rowIndex);
      }
      
      return { ...updatedFp, _isNew: false };
    }

    // Create new fingerprint
    const newFingerprint: SaleFingerprint = {
      fingerprint_id: `FP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      dealer_name: fp.dealer_name,
      dealer_whatsapp: fp.dealer_whatsapp || '',
      sale_date: fp.sale_date,
      expires_at: expiresAt.toISOString().split('T')[0],
      make: fp.make,
      model: fp.model,
      variant_normalised: fp.variant_normalised,
      year: fp.year,
      sale_km: fp.sale_km,
      min_km: minKm,
      max_km: maxKm,
      engine: fp.engine,
      drivetrain: fp.drivetrain,
      transmission: fp.transmission,
      shared_opt_in: fp.shared_opt_in || 'N',
      is_active: 'Y',
      fingerprint_type: fp.fingerprint_type,
      source_sale_id: fp.source_sale_id,
      source_import_id: fp.source_import_id,
    };
    
    await callSheetsApi('append', SHEETS.FINGERPRINTS, newFingerprint);
    return { ...newFingerprint, _isNew: true };
  },

  // Backfill: generate fingerprints for all activate=Y rows that don't have one
  backfillFingerprintsFromActivated: async (): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> => {
    const sales = await googleSheetsService.getSalesNormalised();
    
    // Find rows that are activate=Y, do_not_replicate!=Y, do_not_buy!=Y, and no fingerprint generated
    const needsFingerprint = sales.filter((s: SalesNormalised) => 
      s.activate === 'Y' && 
      s.do_not_replicate !== 'Y' && 
      s.do_not_buy !== 'Y' &&
      s.fingerprint_generated !== 'Y'
    );

    if (needsFingerprint.length === 0) {
      return { created: 0, updated: 0, skipped: 0, errors: [] };
    }

    // Use existing function with the sale IDs
    const saleIds = needsFingerprint.map(s => s.sale_id);
    return googleSheetsService.generateFingerprintsFromNormalised(saleIds);
  },

  // ========== COMPREHENSIVE FINGERPRINT SYNC ==========

  // Extract variant from description/variant_raw using common patterns
  extractVariant: (text: string): string => {
    if (!text) return '';
    
    // Common variant patterns to extract
    const patterns = [
      // Toyota/Ford/Mazda variants
      /\b(SR5|GXL|VX|GX|SX|ZX|GLX|GLS|GTI|GT|VTI|VTi|LTZ|LT|LS|RS|SS|HSV|ST|STI|XLT|FX4|Wildtrak|Raptor|Laramie|Lariat|Sport|Limited|Platinum|Executive|Prestige|Highline|Sportline|R-Line|S-Line|M Sport|AMG|Type R|Nismo|TRD|GR)\b/i,
      // Trim levels
      /\b(Premium|Luxury|Elite|Base|Standard|Touring|Adventure|Rugged|Rogue|Urban|Country)\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].toUpperCase();
      }
    }
    
    return '';
  },

  // Comprehensive sync with audit logging
  syncFingerprintsFromSales: async (options: {
    dryRun?: boolean;
    defaultDealerName?: string;
    saleIds?: string[]; // Optional - sync only specific sales
  } = {}): Promise<{
    created: number;
    updated: number;
    skipped: number;
    eligible: number;
    scanned: number;
    skipReasons: Record<string, number>;
    errors: string[];
    syncLogId: string;
  }> => {
    const { dryRun = false, defaultDealerName, saleIds } = options;
    
    // Load all sales
    const allSales = await googleSheetsService.getSalesNormalised();
    const existingFingerprints = await googleSheetsService.getFingerprints();
    
    // Filter to specific sales if provided
    const salesToProcess = saleIds 
      ? allSales.filter(s => saleIds.includes(s.sale_id))
      : allSales;
    
    const scanned = salesToProcess.length;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const skipReasons: Record<string, number> = {};
    const errors: string[] = [];
    const eligible: SalesNormalised[] = [];
    
    const addSkipReason = (reason: string) => {
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      skipped++;
    };
    
    // Eligibility check for each row
    for (const sale of salesToProcess) {
      // Rule 1: activate = 'Y' AND do_not_replicate != 'Y'
      if (sale.activate !== 'Y') {
        addSkipReason('not_activated');
        continue;
      }
      if (sale.do_not_replicate === 'Y') {
        addSkipReason('do_not_replicate');
        continue;
      }
      
      // Rule 2: dealer_name present (can default)
      let dealerName = sale.dealer_name;
      if (!dealerName && defaultDealerName) {
        dealerName = defaultDealerName;
      }
      if (!dealerName) {
        addSkipReason('missing_dealer_name');
        continue;
      }
      
      // Rule 3: make present
      if (!sale.make) {
        addSkipReason('missing_make');
        continue;
      }
      
      // Rule 4: model present
      if (!sale.model) {
        addSkipReason('missing_model');
        continue;
      }
      
      // Rule 5: year present
      if (!sale.year) {
        addSkipReason('missing_year');
        continue;
      }
      
      // Rule 6: variant_normalised present (try fallback)
      let variantNormalised = sale.variant_normalised;
      if (!variantNormalised) {
        // Try to extract from variant_raw or description
        variantNormalised = googleSheetsService.extractVariant(sale.variant_raw || '');
      }
      if (!variantNormalised) {
        addSkipReason('missing_variant');
        continue;
      }
      
      // This sale is eligible
      eligible.push({
        ...sale,
        dealer_name: dealerName,
        variant_normalised: variantNormalised,
      });
    }
    
    // If dry run, return early with counts
    if (dryRun) {
      const syncLogId = `SYNC-${Date.now()}-DRY`;
      
      // Write sync log even for dry run
      const syncLog: FingerprintSyncLog = {
        synclog_id: syncLogId,
        run_at: new Date().toISOString(),
        mode: 'dry_run',
        rows_scanned: scanned,
        rows_eligible: eligible.length,
        rows_created: 0,
        rows_updated: 0,
        rows_skipped: skipped,
        skip_reason_counts: JSON.stringify(skipReasons),
        errors: JSON.stringify([]),
      };
      
      try {
        await callSheetsApi('append', SHEETS.FINGERPRINT_SYNC_LOG, syncLog);
      } catch (e) {
        console.error('Failed to write sync log:', e);
      }
      
      return {
        created: 0,
        updated: 0,
        skipped,
        eligible: eligible.length,
        scanned,
        skipReasons,
        errors: [],
        syncLogId,
      };
    }
    
    // Build fingerprint unique key index for idempotent upsert
    // Key: dealer_name + make + model + variant_normalised + year + fingerprint_type
    const fingerprintIndex = new Map<string, SaleFingerprint>();
    existingFingerprints.forEach(fp => {
      const key = [
        fp.dealer_name,
        fp.make,
        fp.model,
        fp.variant_normalised,
        String(fp.year),
        fp.fingerprint_type || 'full',
      ].join('|').toLowerCase();
      fingerprintIndex.set(key, fp);
    });
    
    // Process eligible sales
    for (const sale of eligible) {
      try {
        // Determine fingerprint type
        const hasKm = sale.km !== undefined && sale.km !== null && sale.km > 0;
        const hasFullSpecs = hasKm && sale.engine && sale.drivetrain && sale.transmission;
        const fingerprintType = hasFullSpecs ? 'full' : 'spec_only';
        
        // Build unique key
        const key = [
          sale.dealer_name,
          sale.make,
          sale.model,
          sale.variant_normalised,
          String(sale.year),
          fingerprintType,
        ].join('|').toLowerCase();
        
        // Check if fingerprint exists
        const existingFp = fingerprintIndex.get(key);
        
        // Calculate expires_at
        // For CSV imports (has import_id), use activation date (now) + 120 days
        // For manual entries, use sale_date + 120 days
        const isFromCsvImport = !!sale.import_id;
        const baseDate = isFromCsvImport ? new Date() : new Date(sale.sale_date || new Date());
        const expiresAt = new Date(baseDate);
        expiresAt.setDate(expiresAt.getDate() + 120);
        const expiresAtStr = expiresAt.toISOString().split('T')[0];
        
        // Symmetric KM range calculation
        const saleKm = sale.km || 0;
        const minKm = fingerprintType === 'spec_only' ? 0 : Math.max(0, saleKm - 15000);
        const maxKm = fingerprintType === 'spec_only' ? 999999 : saleKm + 15000;
        
        if (existingFp) {
          // Update existing fingerprint - reactivate and update expires_at
          const updatedFp: SaleFingerprint = {
            ...existingFp,
            is_active: 'Y',
            expires_at: expiresAtStr,
            source_sale_id: sale.sale_id,
            source_import_id: sale.import_id,
          };
          
          if (existingFp._rowIndex !== undefined) {
            await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, existingFp._rowIndex);
          }
          updated++;
        } else {
          // Create new fingerprint
          const newFp: SaleFingerprint = {
            fingerprint_id: `FP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            dealer_name: sale.dealer_name,
            dealer_whatsapp: '',
            sale_date: sale.sale_date || '',
            expires_at: expiresAtStr,
            make: sale.make,
            model: sale.model,
            variant_normalised: sale.variant_normalised || '',
            year: sale.year || 0,
            sale_km: saleKm,
            min_km: minKm,
            max_km: maxKm,
            engine: sale.engine || '',
            drivetrain: sale.drivetrain || '',
            transmission: sale.transmission || '',
            shared_opt_in: 'N',
            is_active: 'Y',
            fingerprint_type: fingerprintType,
            source_sale_id: sale.sale_id,
            source_import_id: sale.import_id,
          };
          
          await callSheetsApi('append', SHEETS.FINGERPRINTS, newFp);
          
          // Add to index to prevent duplicates within this sync
          fingerprintIndex.set(key, newFp);
          created++;
        }
        
        // Update sales row with fingerprint_generated = Y
        if (sale._rowIndex !== undefined) {
          await googleSheetsService.updateSalesNormalised({
            ...sale,
            fingerprint_generated: 'Y',
            notes: fingerprintType === 'spec_only' 
              ? `${sale.notes || ''} [spec_only]`.trim() 
              : sale.notes,
          });
        }
      } catch (err) {
        errors.push(`Sale ${sale.sale_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    // Write sync log
    const syncLogId = `SYNC-${Date.now()}`;
    const syncLog: FingerprintSyncLog = {
      synclog_id: syncLogId,
      run_at: new Date().toISOString(),
      mode: 'full',
      rows_scanned: scanned,
      rows_eligible: eligible.length,
      rows_created: created,
      rows_updated: updated,
      rows_skipped: skipped,
      skip_reason_counts: JSON.stringify(skipReasons),
      errors: JSON.stringify(errors),
    };
    
    try {
      await callSheetsApi('append', SHEETS.FINGERPRINT_SYNC_LOG, syncLog);
    } catch (e) {
      console.error('Failed to write sync log:', e);
    }
    
    return {
      created,
      updated,
      skipped,
      eligible: eligible.length,
      scanned,
      skipReasons,
      errors,
      syncLogId,
    };
  },

  // Get sync logs for viewing
  getSyncLogs: async (limit?: number): Promise<FingerprintSyncLog[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.FINGERPRINT_SYNC_LOG);
      let logs = response.data.map((row: any) => ({
        synclog_id: row.synclog_id || '',
        run_at: row.run_at || '',
        mode: row.mode || 'full',
        rows_scanned: parseInt(row.rows_scanned) || 0,
        rows_eligible: parseInt(row.rows_eligible) || 0,
        rows_created: parseInt(row.rows_created) || 0,
        rows_updated: parseInt(row.rows_updated) || 0,
        rows_skipped: parseInt(row.rows_skipped) || 0,
        skip_reason_counts: row.skip_reason_counts || '{}',
        errors: row.errors || '[]',
      }));
      
      // Sort by run_at DESC
      logs.sort((a: FingerprintSyncLog, b: FingerprintSyncLog) => 
        new Date(b.run_at).getTime() - new Date(a.run_at).getTime()
      );
      
      if (limit) {
        logs = logs.slice(0, limit);
      }
      
      return logs;
    } catch {
      return [];
    }
  },

  // Bulk update variant_normalised by extracting from variant_raw
  bulkExtractVariants: async (saleIds: string[]): Promise<{ updated: number; failed: number }> => {
    const sales = await googleSheetsService.getSalesNormalised();
    const toUpdate = sales.filter(s => saleIds.includes(s.sale_id));
    
    let updated = 0;
    let failed = 0;
    
    for (const sale of toUpdate) {
      const extracted = googleSheetsService.extractVariant(sale.variant_raw || '');
      if (extracted && sale._rowIndex !== undefined) {
        try {
          await googleSheetsService.updateSalesNormalised({
            ...sale,
            variant_normalised: extracted,
          });
          updated++;
        } catch {
          failed++;
        }
      } else {
        failed++;
      }
    }
    
    return { updated, failed };
  },

  // Bulk reactivate fingerprints - sets expires_at = today + 120 days and is_active = Y
  reactivateFingerprints: async (fingerprintIds: string[]): Promise<{ reactivated: number; failed: number }> => {
    const fingerprints = await googleSheetsService.getFingerprints();
    const toReactivate = fingerprints.filter(fp => fingerprintIds.includes(fp.fingerprint_id));
    
    let reactivated = 0;
    let failed = 0;
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 120);
    const expiresAtStr = expiresAt.toISOString().split('T')[0];
    
    for (const fp of toReactivate) {
      if (fp._rowIndex !== undefined) {
        try {
          const updatedFp: SaleFingerprint = {
            ...fp,
            is_active: 'Y',
            expires_at: expiresAtStr,
          };
          await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, fp._rowIndex);
          reactivated++;
        } catch {
          failed++;
        }
      } else {
        failed++;
      }
    }
    
    return { reactivated, failed };
  },

  // Backfill min_km for existing fingerprints that don't have it
  backfillMinKm: async (): Promise<{ updated: number; skipped: number }> => {
    const fingerprints = await googleSheetsService.getFingerprints();
    
    let updated = 0;
    let skipped = 0;
    
    for (const fp of fingerprints) {
      // Only update fingerprints that have sale_km but no proper min_km
      // (min_km defaults to 0 if missing, so check if it needs recalculation)
      const expectedMinKm = fp.fingerprint_type === 'spec_only' ? 0 : Math.max(0, fp.sale_km - 15000);
      const expectedMaxKm = fp.fingerprint_type === 'spec_only' ? 999999 : fp.sale_km + 15000;
      
      // Skip if already correct
      if (fp.min_km === expectedMinKm && fp.max_km === expectedMaxKm) {
        skipped++;
        continue;
      }
      
      if (fp._rowIndex !== undefined) {
        try {
          const updatedFp: SaleFingerprint = {
            ...fp,
            min_km: expectedMinKm,
            max_km: expectedMaxKm,
          };
          await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, fp._rowIndex);
          updated++;
        } catch {
          skipped++;
        }
      } else {
        skipped++;
      }
    }
    
    return { updated, skipped };
  },

  // Fix KM for spec-only fingerprints: clear placeholder KM ranges
  fixSpecOnlyKm: async (): Promise<{ 
    fingerprintsFixed: number; 
    fingerprintsSkipped: number;
  }> => {
    let fingerprintsFixed = 0;
    let fingerprintsSkipped = 0;
    
    const fingerprints = await googleSheetsService.getFingerprints();
    console.log(`Checking ${fingerprints.length} fingerprints for spec-only KM fix`);
    
    for (const fp of fingerprints) {
      // Check if fingerprint needs fixing:
      // - min_km >= 900,000 (placeholder value)
      // - OR sale_km is falsy (no source km data)
      const hasPlaceholderKm = (fp.min_km !== undefined && fp.min_km !== null && fp.min_km >= 900000);
      const hasNoSourceKm = !fp.sale_km;
      
      if (!hasPlaceholderKm && !hasNoSourceKm) {
        fingerprintsSkipped++;
        continue;
      }
      
      if (fp._rowIndex === undefined) {
        fingerprintsSkipped++;
        continue;
      }
      
      try {
        // Create updated fingerprint with NULL km values and spec_only type
        const updatedFp: SaleFingerprint = {
          ...fp,
          min_km: undefined as any,  // Will be written as empty/null
          max_km: undefined as any,  // Will be written as empty/null
          fingerprint_type: 'spec_only',
        };
        
        await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, fp._rowIndex);
        fingerprintsFixed++;
        console.log(`Fixed fingerprint ${fp.fingerprint_id}: set to spec_only, cleared KM ranges`);
      } catch (err) {
        console.error(`Failed to fix fingerprint ${fp.fingerprint_id}:`, err);
        fingerprintsSkipped++;
      }
    }
    
    console.log(`Spec-only KM fix complete: ${fingerprintsFixed} fixed, ${fingerprintsSkipped} skipped`);
    return { fingerprintsFixed, fingerprintsSkipped };
  },

  // Backfill variant_family for existing fingerprints and listings
  backfillVariantFamily: async (): Promise<{
    fingerprintsUpdated: number; 
    fingerprintsSkipped: number;
    lotsUpdated: number;
    lotsSkipped: number;
  }> => {
    let fingerprintsUpdated = 0;
    let fingerprintsSkipped = 0;
    let lotsUpdated = 0;
    let lotsSkipped = 0;

    // Step 1: Ensure headers include variant_family by triggering a reset_headers call
    // This ensures the sheet has the correct schema before we try to write variant_family
    try {
      await callSheetsApi('reset_headers', SHEETS.FINGERPRINTS, { 
        headers: [
          'fingerprint_id', 'dealer_name', 'dealer_whatsapp', 'sale_date', 'expires_at', 'make', 'model', 
          'variant_normalised', 'variant_family', 'year', 'sale_km', 'min_km', 'max_km', 'engine', 'drivetrain', 'transmission', 
          'shared_opt_in', 'is_active', 'fingerprint_type', 'source_sale_id', 'source_import_id',
          'do_not_buy', 'do_not_buy_reason'
        ]
      });
      console.log('Reset Sale_Fingerprints headers to include variant_family');
    } catch (headerError) {
      console.error('Failed to reset fingerprints headers:', headerError);
    }

    try {
      await callSheetsApi('reset_headers', SHEETS.LOTS, { 
        headers: LISTING_HEADERS
      });
      console.log('Reset Listings headers to include variant_family');
    } catch (headerError) {
      console.error('Failed to reset listings headers:', headerError);
    }

    // Step 2: Backfill fingerprints
    const fingerprints = await googleSheetsService.getFingerprints();
    console.log(`Backfilling variant_family for ${fingerprints.length} fingerprints`);
    
    for (const fp of fingerprints) {
      // Skip if already has variant_family
      if (fp.variant_family) {
        fingerprintsSkipped++;
        continue;
      }
      
      // Derive from variant_normalised
      const derived = extractVariantFamily(fp.variant_normalised);
      if (!derived) {
        fingerprintsSkipped++;
        continue;
      }
      
      if (fp._rowIndex !== undefined) {
        try {
          const updatedFp: SaleFingerprint = {
            ...fp,
            variant_family: derived,
          };
          await callSheetsApi('update', SHEETS.FINGERPRINTS, updatedFp, fp._rowIndex);
          fingerprintsUpdated++;
          console.log(`Updated fingerprint ${fp.fingerprint_id} with variant_family: ${derived}`);
        } catch (err) {
          console.error(`Failed to update fingerprint ${fp.fingerprint_id}:`, err);
          fingerprintsSkipped++;
        }
      } else {
        fingerprintsSkipped++;
      }
    }

    // Step 3: Backfill listings
    const lots = await googleSheetsService.getLots(true);
    console.log(`Backfilling variant_family for ${lots.length} listings`);
    
    for (const lot of lots) {
      // Skip if already has variant_family
      if (lot.variant_family) {
        lotsSkipped++;
        continue;
      }
      
      // Derive from variant_normalised or variant_raw
      const derived = extractVariantFamily(lot.variant_normalised || lot.variant_raw);
      if (!derived) {
        lotsSkipped++;
        continue;
      }
      
      if (lot._rowIndex !== undefined) {
        try {
          const updatedLot: AuctionLot = {
            ...lot,
            variant_family: derived,
          };
          await callSheetsApi('update', SHEETS.LOTS, updatedLot, lot._rowIndex);
          lotsUpdated++;
          console.log(`Updated lot ${lot.lot_key || lot.listing_key} with variant_family: ${derived}`);
        } catch (err) {
          console.error(`Failed to update lot ${lot.lot_key || lot.listing_key}:`, err);
          lotsSkipped++;
        }
      } else {
        lotsSkipped++;
      }
    }
    
    console.log(`Backfill complete: ${fingerprintsUpdated} fingerprints, ${lotsUpdated} lots updated`);
    return { fingerprintsUpdated, fingerprintsSkipped, lotsUpdated, lotsSkipped };
  },

  // ========== SAVED SEARCHES ==========
  
  // Get all saved searches
  getSavedSearches: async (): Promise<SavedSearch[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.SAVED_SEARCHES);
      return response.data.map((row: any) => parseSavedSearch(row));
    } catch {
      return [];
    }
  },

  // Add a new saved search
  addSavedSearch: async (search: Omit<SavedSearch, 'search_id' | 'created_at' | '_rowIndex'>): Promise<SavedSearch> => {
    const newSearch: SavedSearch = {
      ...search,
      search_id: `SS-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    await callSheetsApi('append', SHEETS.SAVED_SEARCHES, newSearch);
    return newSearch;
  },

  // Update a saved search
  updateSavedSearch: async (search: SavedSearch): Promise<void> => {
    if (search._rowIndex === undefined) {
      throw new Error('Cannot update search without row index');
    }
    await callSheetsApi('update', SHEETS.SAVED_SEARCHES, search, search._rowIndex);
  },

  // Delete a saved search
  deleteSavedSearch: async (search: SavedSearch): Promise<void> => {
    if (search._rowIndex === undefined) {
      throw new Error('Cannot delete search without row index');
    }
    await callSheetsApi('delete', SHEETS.SAVED_SEARCHES, null, search._rowIndex);
  },

  // Update last_run_at for a saved search
  updateSavedSearchLastRun: async (searchId: string): Promise<void> => {
    const searches = await googleSheetsService.getSavedSearches();
    const search = searches.find(s => s.search_id === searchId);
    if (search && search._rowIndex !== undefined) {
      const updated = { ...search, last_run_at: new Date().toISOString() };
      await callSheetsApi('update', SHEETS.SAVED_SEARCHES, updated, search._rowIndex);
    }
  },

  // Update diagnostics for a saved search after run
  updateSavedSearchDiagnostics: async (searchId: string, diagnostics: {
    last_run_status: 'success' | 'failed';
    last_http_status: number;
    last_listings_found: number;
    last_listings_upserted: number;
    last_error_message: string;
  }): Promise<void> => {
    const searches = await googleSheetsService.getSavedSearches();
    const search = searches.find(s => s.search_id === searchId);
    if (search && search._rowIndex !== undefined) {
      const updated = { 
        ...search, 
        last_run_at: new Date().toISOString(),
        ...diagnostics,
      };
      await callSheetsApi('update', SHEETS.SAVED_SEARCHES, updated, search._rowIndex);
    }
  },

  // ========== DO NOT BUY PROTECTION ==========

  // Set do_not_buy on sales and deactivate related fingerprints
  setDoNotBuy: async (saleIds: string[], reason: string): Promise<{
    salesUpdated: number;
    fingerprintsDeactivated: number;
  }> => {
    const sales = await googleSheetsService.getSalesNormalised();
    const fingerprints = await googleSheetsService.getFingerprints();
    
    let salesUpdated = 0;
    let fingerprintsDeactivated = 0;
    
    for (const saleId of saleIds) {
      const sale = sales.find((s: SalesNormalised) => s.sale_id === saleId);
      if (!sale || sale._rowIndex === undefined) continue;
      
      // Update sale with do_not_buy flag
      await googleSheetsService.updateSalesNormalised({
        ...sale,
        do_not_buy: 'Y',
        do_not_buy_reason: reason,
      });
      salesUpdated++;
      
      // If there's a linked fingerprint, deactivate it
      if (sale.fingerprint_id) {
        const fp = fingerprints.find((f: SaleFingerprint) => f.fingerprint_id === sale.fingerprint_id);
        if (fp && fp._rowIndex !== undefined && fp.is_active === 'Y') {
          await callSheetsApi('update', SHEETS.FINGERPRINTS, {
            ...fp,
            is_active: 'N',
            do_not_buy: 'Y',
            do_not_buy_reason: reason,
          }, fp._rowIndex);
          fingerprintsDeactivated++;
        }
      }
    }
    
    return { salesUpdated, fingerprintsDeactivated };
  },

  // Clear do_not_buy flag
  clearDoNotBuy: async (saleIds: string[]): Promise<{ salesUpdated: number }> => {
    const sales = await googleSheetsService.getSalesNormalised();
    let salesUpdated = 0;
    
    for (const saleId of saleIds) {
      const sale = sales.find((s: SalesNormalised) => s.sale_id === saleId);
      if (!sale || sale._rowIndex === undefined) continue;
      
      await googleSheetsService.updateSalesNormalised({
        ...sale,
        do_not_buy: 'N',
        do_not_buy_reason: '',
      });
      salesUpdated++;
    }
    
    return { salesUpdated };
  },

  // Update fingerprint do_not_buy status
  updateFingerprintDoNotBuy: async (fingerprintId: string, doNotBuy: 'Y' | 'N', reason?: string): Promise<void> => {
    const fingerprints = await googleSheetsService.getFingerprints();
    const fp = fingerprints.find((f: SaleFingerprint) => f.fingerprint_id === fingerprintId);
    
    if (fp && fp._rowIndex !== undefined) {
      await callSheetsApi('update', SHEETS.FINGERPRINTS, {
        ...fp,
        do_not_buy: doNotBuy,
        do_not_buy_reason: reason || '',
        is_active: doNotBuy === 'Y' ? 'N' : fp.is_active, // Deactivate if do_not_buy
      }, fp._rowIndex);
    }
  },

  // Backfill Pickles status: normalize numeric status codes to string statuses
  backfillPicklesStatus: async (): Promise<{
    lotsUpdated: number;
    lotsSkipped: number;
  }> => {
    console.log('[backfillPicklesStatus] Starting backfill...');
    
    // Get all lots (raw, not parsed, to access _rowIndex)
    const response = await callSheetsApi('read', SHEETS.LOTS);
    const allLots = response.data || [];
    
    // Filter to Pickles lots only
    const picklesLots = allLots.filter((row: any) => {
      const auctionHouse = (row.auction_house || '').toLowerCase();
      const sourceName = (row.source_name || '').toLowerCase();
      return auctionHouse.includes('pickles') || sourceName.includes('pickles');
    });
    
    console.log(`[backfillPicklesStatus] Found ${picklesLots.length} Pickles lots`);
    
    let lotsUpdated = 0;
    let lotsSkipped = 0;
    const updates: Array<{ rowIndex: number; status: string; raw_status?: string }> = [];
    
    // Normalize Pickles numeric status codes to string statuses
    const normalizeStatus = (status: string | undefined): string | undefined => {
      if (!status) return undefined;
      const trimmed = status.trim();
      
      // Handle numeric status codes (from Pickles)
      if (trimmed === '0') return 'catalogue';
      if (trimmed === '1') return 'listed';
      if (trimmed === '2') return 'passed_in';
      if (trimmed === '3') return 'sold';
      if (trimmed === '4') return 'withdrawn';
      
      // Already a valid string status
      const lower = trimmed.toLowerCase();
      if (['catalogue', 'upcoming', 'listed', 'passed_in', 'sold', 'withdrawn'].includes(lower)) {
        return lower;
      }
      
      return undefined; // Unrecognized
    };
    
    for (const row of picklesLots) {
      const currentStatus = row.status;
      const normalizedStatus = normalizeStatus(currentStatus);
      
      // Skip if status is already normalized or unrecognizable
      if (!normalizedStatus || normalizedStatus === currentStatus) {
        lotsSkipped++;
        continue;
      }
      
      // Mark for update
      updates.push({
        rowIndex: row._rowIndex,
        status: normalizedStatus,
        raw_status: currentStatus, // Keep original for reference
      });
    }
    
    console.log(`[backfillPicklesStatus] ${updates.length} lots need status normalization`);
    
    // Apply updates
    for (const update of updates) {
      try {
        await callSheetsApi('update', SHEETS.LOTS, {
          status: update.status,
          raw_status: update.raw_status,
          updated_at: new Date().toISOString(),
        }, update.rowIndex);
        lotsUpdated++;
      } catch (error) {
        console.error(`[backfillPicklesStatus] Failed to update lot at row ${update.rowIndex}:`, error);
        lotsSkipped++;
      }
    }
    
    console.log(`[backfillPicklesStatus] Complete: ${lotsUpdated} updated, ${lotsSkipped} skipped`);
    
    return { lotsUpdated, lotsSkipped };
  },

  // Backfill make/model normalization for existing sales (resolve numeric IDs to text labels)
  backfillSalesMakeModel: async (): Promise<{
    salesUpdated: number;
    salesSkipped: number;
    unresolved: Array<{ saleId: string; make: string; model: string }>;
  }> => {
    // Dynamically import to avoid circular deps
    const { normalizeMakeModel, isNumericId } = await import('@/utils/dmsLookup');
    
    console.log('[backfillSalesMakeModel] Starting backfill...');
    
    // Get all normalised sales (raw rows to access _rowIndex)
    const response = await callSheetsApi('read', SHEETS.SALES_NORMALISED);
    const allSales = response.data || [];
    
    console.log(`[backfillSalesMakeModel] Found ${allSales.length} sales records`);
    
    let salesUpdated = 0;
    let salesSkipped = 0;
    const unresolved: Array<{ saleId: string; make: string; model: string }> = [];
    const updates: Array<{ rowIndex: number; data: any }> = [];
    
    for (const row of allSales) {
      const make = row.make || '';
      const model = row.model || '';
      const saleId = row.sale_id || '';
      
      // Check if either field is numeric
      if (!isNumericId(make) && !isNumericId(model)) {
        salesSkipped++;
        continue;
      }
      
      // Normalize
      const normalized = normalizeMakeModel(make, model);
      
      // Check if we actually resolved anything new
      const makeResolved = normalized.make !== make;
      const modelResolved = normalized.model !== model;
      
      if (!makeResolved && !modelResolved) {
        // Numeric ID but couldn't resolve
        if (isNumericId(make) || isNumericId(model)) {
          unresolved.push({ saleId, make, model });
        }
        salesSkipped++;
        continue;
      }
      
      // Prepare update
      const updateData: any = {
        ...row,
        make: normalized.make,
        model: normalized.model,
      };
      
      // Store original IDs if resolved
      if (normalized.make_id) {
        updateData.make_id = normalized.make_id;
      }
      if (normalized.model_id) {
        updateData.model_id = normalized.model_id;
      }
      
      updates.push({
        rowIndex: row._rowIndex,
        data: updateData,
      });
    }
    
    console.log(`[backfillSalesMakeModel] ${updates.length} sales need normalization, ${unresolved.length} unresolved`);
    
    // Apply updates
    for (const update of updates) {
      try {
        await callSheetsApi('update', SHEETS.SALES_NORMALISED, update.data, update.rowIndex);
        salesUpdated++;
      } catch (error) {
        console.error(`[backfillSalesMakeModel] Failed to update sale at row ${update.rowIndex}:`, error);
        salesSkipped++;
      }
    }
    
    // Also update Sales_Log for consistency
    try {
      const salesLogResponse = await callSheetsApi('read', SHEETS.SALES_LOG);
      const allSalesLog = salesLogResponse.data || [];
      
      for (const row of allSalesLog) {
        const make = row.make || '';
        const model = row.model || '';
        
        if (!isNumericId(make) && !isNumericId(model)) continue;
        
        const normalized = normalizeMakeModel(make, model);
        const makeResolved = normalized.make !== make;
        const modelResolved = normalized.model !== model;
        
        if (!makeResolved && !modelResolved) continue;
        
        await callSheetsApi('update', SHEETS.SALES_LOG, {
          ...row,
          make: normalized.make,
          model: normalized.model,
        }, row._rowIndex);
      }
    } catch (error) {
      console.error('[backfillSalesMakeModel] Error updating Sales_Log:', error);
    }
    
    console.log(`[backfillSalesMakeModel] Complete: ${salesUpdated} updated, ${salesSkipped} skipped`);
    
    return { salesUpdated, salesSkipped, unresolved };
  },

  // ========== NETWORK PROXY VALUATION ==========

  /**
   * Get network proxy valuation for a vehicle.
   * Uses anonymised sales data from the network when dealer has no internal sales.
   */
  getNetworkValuation: async (
    request: NetworkValuationRequest,
    isAdmin: boolean = false
  ): Promise<NetworkValuationResult> => {
    const MIN_SAMPLE_SIZE = 3; // Threshold for MEDIUM confidence
    const yearTolerance = request.year_tolerance ?? 2;

    // Step 1: Load all fingerprints with buy/sell prices
    const allFingerprints = await googleSheetsService.getFingerprints();
    
    // Step 2: Load sales normalised for profit data
    const allSales = await googleSheetsService.getSalesNormalised();
    
    // Create a map of fingerprint_id to sales data for enrichment
    const salesByFingerprintId = new Map<string, SalesNormalised>();
    for (const sale of allSales) {
      if (sale.fingerprint_id) {
        salesByFingerprintId.set(sale.fingerprint_id, sale);
      }
    }
    
    // Step 3: Filter fingerprints for matching criteria
    const matchingFingerprints = allFingerprints.filter(fp => {
      // Must be active
      if (fp.is_active !== 'Y') return false;
      
      // Not marked do_not_buy
      if (fp.do_not_buy === 'Y') return false;
      
      // Must match make/model (case-insensitive)
      if (fp.make.toLowerCase() !== request.make.toLowerCase()) return false;
      if (fp.model.toLowerCase() !== request.model.toLowerCase()) return false;
      
      // Year range check
      if (Math.abs(fp.year - request.year) > yearTolerance) return false;
      
      // Variant family matching (if provided)
      if (request.variant_family && fp.variant_family) {
        if (fp.variant_family.toUpperCase() !== request.variant_family.toUpperCase()) {
          return false;
        }
      }
      
      // Exclude manual fingerprints from profit analytics
      if (fp.is_manual === 'Y') return false;
      
      return true;
    });
    
    // Step 4: Split into internal vs network
    const internalFingerprints = matchingFingerprints.filter(
      fp => request.requesting_dealer && fp.dealer_name === request.requesting_dealer
    );
    
    const networkFingerprints = matchingFingerprints.filter(
      fp => !request.requesting_dealer || fp.dealer_name !== request.requesting_dealer
    );
    
    // Step 5: Determine data source
    // If dealer has internal comparables, use those (HIGH confidence)
    // Otherwise, use network data (MEDIUM/LOW based on sample size)
    const useInternal = internalFingerprints.length >= MIN_SAMPLE_SIZE;
    const sourceFingerprints = useInternal ? internalFingerprints : networkFingerprints;
    
    // Step 6: Aggregate metrics from source fingerprints
    const buyPrices: number[] = [];
    const sellPrices: number[] = [];
    const grossProfits: number[] = [];
    const daysToSell: number[] = [];
    const contributingIds: string[] = [];
    
    for (const fp of sourceFingerprints) {
      contributingIds.push(fp.fingerprint_id);
      
      // Try to get sales data for this fingerprint
      const sale = salesByFingerprintId.get(fp.fingerprint_id);
      
      if (sale) {
        if (sale.sale_price !== undefined && sale.sale_price > 0) {
          sellPrices.push(sale.sale_price);
        }
        if (sale.gross_profit !== undefined) {
          grossProfits.push(sale.gross_profit);
          // Infer buy price from sale_price - gross_profit
          if (sale.sale_price !== undefined && sale.sale_price > 0) {
            const inferredBuyPrice = sale.sale_price - sale.gross_profit;
            if (inferredBuyPrice > 0) {
              buyPrices.push(inferredBuyPrice);
            }
          }
        }
        if (sale.days_to_sell !== undefined && sale.days_to_sell > 0) {
          daysToSell.push(sale.days_to_sell);
        }
      }
      
      // Also check fingerprint-level buy/sell prices (if stored there)
      if (fp.buy_price && fp.buy_price > 0) {
        if (!buyPrices.includes(fp.buy_price)) {
          buyPrices.push(fp.buy_price);
        }
      }
      if (fp.sell_price && fp.sell_price > 0) {
        if (!sellPrices.includes(fp.sell_price)) {
          sellPrices.push(fp.sell_price);
        }
      }
    }
    
    // Step 7: Calculate aggregates
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const range = (arr: number[]) => arr.length > 0 ? { min: Math.min(...arr), max: Math.max(...arr) } : null;
    
    const sampleSize = sourceFingerprints.length;
    
    // Determine confidence level
    let confidence: ValuationConfidence;
    let confidenceReason: string;
    let dataSource: 'internal' | 'network' | 'none';
    
    if (sampleSize === 0) {
      confidence = 'LOW';
      confidenceReason = 'No comparable sales data available';
      dataSource = 'none';
    } else if (useInternal) {
      confidence = 'HIGH';
      confidenceReason = `Based on ${sampleSize} internal sales records`;
      dataSource = 'internal';
    } else if (sampleSize >= MIN_SAMPLE_SIZE) {
      confidence = 'MEDIUM';
      confidenceReason = `Based on anonymised network outcomes (n=${sampleSize})`;
      dataSource = 'network';
    } else {
      confidence = 'LOW';
      confidenceReason = `Insufficient network data (n=${sampleSize}, need ${MIN_SAMPLE_SIZE}+)`;
      dataSource = 'network';
    }
    
    const result: NetworkValuationResult = {
      avg_buy_price: avg(buyPrices),
      avg_sell_price: avg(sellPrices),
      buy_price_range: range(buyPrices),
      sell_price_range: range(sellPrices),
      avg_gross_profit: avg(grossProfits),
      avg_days_to_sell: avg(daysToSell),
      sample_size: sampleSize,
      confidence,
      confidence_reason: confidenceReason,
      data_source: dataSource,
      request,
    };
    
    // Admin only: include contributing fingerprint IDs
    if (isAdmin) {
      result.contributing_fingerprint_ids = contributingIds;
    }
    
    return result;
  },
  
  // ========== DEALER SALES HISTORY ==========
  
  async getDealerSalesHistory(filters?: { 
    dealerName?: string; 
    make?: string; 
    model?: string;
    yearMin?: number;
    yearMax?: number;
  }): Promise<DealerSalesHistory[]> {
    const response = await callSheetsApi('read', SHEETS.DEALER_SALES_HISTORY);
    let records = response.data.map(parseDealerSalesHistory);
    
    // Apply filters
    if (filters?.dealerName) {
      records = records.filter(r => r.dealer_name === filters.dealerName);
    }
    if (filters?.make) {
      records = records.filter(r => r.make.toLowerCase() === filters.make!.toLowerCase());
    }
    if (filters?.model) {
      records = records.filter(r => r.model.toLowerCase().includes(filters.model!.toLowerCase()));
    }
    if (filters?.yearMin) {
      records = records.filter(r => r.year >= filters.yearMin!);
    }
    if (filters?.yearMax) {
      records = records.filter(r => r.year <= filters.yearMax!);
    }
    
    return records;
  },
  
  async appendDealerSalesHistory(records: Omit<DealerSalesHistory, '_rowIndex'>[]): Promise<number> {
    if (records.length === 0) return 0;
    
    // Use batch_append for efficiency
    await callSheetsApi('batch_append', SHEETS.DEALER_SALES_HISTORY, records);
    return records.length;
  },
};

// Parse saved search from sheet row
function parseSavedSearch(row: any): SavedSearch {
  return {
    search_id: row.search_id || '',
    source_site: row.source_site || 'Other',
    label: row.label || '',
    search_url: row.search_url || '',
    refresh_frequency_hours: parseInt(row.refresh_frequency_hours) || 12,
    max_pages: parseInt(row.max_pages) || 2,
    enabled: row.enabled === 'Y' ? 'Y' : 'N',
    last_run_at: row.last_run_at || '',
    notes: row.notes || '',
    created_at: row.created_at || '',
    // Diagnostics
    last_run_status: row.last_run_status || undefined,
    last_http_status: row.last_http_status ? parseInt(row.last_http_status) : undefined,
    last_listings_found: row.last_listings_found ? parseInt(row.last_listings_found) : undefined,
    last_listings_upserted: row.last_listings_upserted ? parseInt(row.last_listings_upserted) : undefined,
    last_error_message: row.last_error_message || undefined,
    _rowIndex: row._rowIndex,
  };
}

// Parse dealer sales history from sheet row
function parseDealerSalesHistory(row: any): DealerSalesHistory {
  return {
    record_id: row.record_id || '',
    source: row.source || '',
    dealer_name: row.dealer_name || '',
    imported_at: row.imported_at || '',
    stock_no: row.stock_no || '',
    rego: row.rego || '',
    make: row.make || '',
    model: row.model || '',
    year: parseInt(row.year) || 0,
    variant: row.variant || '',
    body_type: row.body_type || '',
    transmission: row.transmission || '',
    drivetrain: row.drivetrain || '',
    engine: row.engine || '',
    sale_date: row.sale_date || '',
    days_in_stock: parseInt(row.days_in_stock) || 0,
    sell_price: parseFloat(row.sell_price) || 0,
    total_cost: parseFloat(row.total_cost) || 0,
    gross_profit: parseFloat(row.gross_profit) || 0,
    description_raw: row.description_raw || '',
    _rowIndex: row._rowIndex,
  };
}
