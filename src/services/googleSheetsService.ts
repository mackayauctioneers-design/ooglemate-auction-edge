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
  calculateConfidenceScore,
  determineAction,
  calculateLotConfidenceScore,
  determineLotAction,
  getLotFlagReasons
} from '@/types';

const SHEETS = {
  OPPORTUNITIES: 'Auction_Opportunities',
  FINGERPRINTS: 'Sale_Fingerprints',
  DEALERS: 'Dealers',
  ALERTS: 'Alert_Log',
  EVENTS: 'Auction_Events',
  LOTS: 'Auction_Lots',
  SALES_LOG: 'Sales_Log',
  SETTINGS: 'Settings',
  SALES_IMPORTS_RAW: 'Sales_Imports_Raw',
  SALES_NORMALISED: 'Sales_Normalised',
  FINGERPRINT_SYNC_LOG: 'Fingerprint_Sync_Log',
};

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
  
  // Use sheet action if valid, otherwise calculate from confidence score
  opp.action = hasValidSheetAction ? sheetAction : determineAction(opp.confidence_score);

  return opp;
}

function parseFingerprint(row: any): SaleFingerprint {
  return {
    fingerprint_id: row.fingerprint_id || '',
    dealer_name: row.dealer_name || '',
    dealer_whatsapp: row.dealer_whatsapp || '',
    sale_date: row.sale_date || '',
    expires_at: row.expires_at || '',
    make: row.make || '',
    model: row.model || '',
    variant_normalised: row.variant_normalised || '',
    year: parseInt(row.year) || 0,
    sale_km: parseInt(row.sale_km) || 0,
    max_km: parseInt(row.max_km) || 0,
    engine: row.engine || '',
    drivetrain: row.drivetrain || '',
    transmission: row.transmission || '',
    shared_opt_in: row.shared_opt_in || 'N',
    is_active: row.is_active || 'Y',
    fingerprint_type: row.fingerprint_type || 'full',
    source_sale_id: row.source_sale_id || undefined,
    source_import_id: row.source_import_id || undefined,
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

function parseAuctionLot(row: any): AuctionLot {
  // Compute lot_key from auction_house and lot_id
  const auctionHouse = row.auction_house || '';
  const lotId = row.lot_id || '';
  const lotKey = row.lot_key || (auctionHouse && lotId ? `${auctionHouse}:${lotId}` : '');
  
  // Multi-source fields with defaults
  const sourceType = row.source_type || 'auction';
  const sourceName = row.source_name || auctionHouse;
  const listingId = row.listing_id || '';
  
  // Compute listing_key
  let listingKey = row.listing_key || '';
  if (!listingKey && sourceName) {
    if (listingId) {
      listingKey = `${sourceName}:${listingId}`;
    } else if (row.listing_url) {
      listingKey = `${sourceName}:${simpleHash(row.listing_url)}`;
    }
  }
  
  // For auctions, price_current maps from reserve or highest_bid
  const reserve = parseFloat(row.reserve) || 0;
  const highestBid = parseFloat(row.highest_bid) || 0;
  const priceCurrent = parseFloat(row.price_current) || (sourceType === 'auction' ? (reserve || highestBid) : 0);
  
  // Parse override fields
  const overrideEnabled = row.override_enabled === 'Y' ? 'Y' : 'N';
  const manualConfidenceScore = row.manual_confidence_score ? parseInt(row.manual_confidence_score) : undefined;
  const manualAction = (row.manual_action === 'Buy' || row.manual_action === 'Watch') ? row.manual_action : undefined;
  
  const lot: AuctionLot = {
    lot_id: lotId,
    lot_key: lotKey,
    event_id: row.event_id || '',
    auction_house: auctionHouse,
    location: row.location || '',
    auction_datetime: row.auction_datetime || '',
    listing_url: row.listing_url || '',
    make: row.make || '',
    model: row.model || '',
    variant_raw: row.variant_raw || '',
    variant_normalised: row.variant_normalised || '',
    year: parseInt(row.year) || 0,
    km: parseInt(row.km) || 0,
    fuel: row.fuel || '',
    drivetrain: row.drivetrain || '',
    transmission: row.transmission || '',
    reserve: reserve,
    highest_bid: highestBid,
    status: row.status || 'listed',
    pass_count: parseInt(row.pass_count) || 0,
    description_score: parseInt(row.description_score) || 0,
    estimated_get_out: parseFloat(row.estimated_get_out) || 0,
    estimated_margin: parseFloat(row.estimated_margin) || 0,
    confidence_score: 0,
    action: 'Watch',
    visible_to_dealers: row.visible_to_dealers || 'N',
    updated_at: row.updated_at || new Date().toISOString(),
    last_status: row.last_status || '',
    last_seen_at: row.last_seen_at || '',
    relist_group_id: row.relist_group_id || '',
    // Multi-source fields
    source_type: sourceType,
    source_name: sourceName,
    listing_id: listingId,
    listing_key: listingKey,
    price_current: priceCurrent,
    price_prev: parseFloat(row.price_prev) || 0,
    price_drop_count: parseInt(row.price_drop_count) || 0,
    relist_count: parseInt(row.relist_count) || 0,
    first_seen_at: row.first_seen_at || '',
    // Override fields
    override_enabled: overrideEnabled,
    manual_confidence_score: manualConfidenceScore,
    manual_action: manualAction,
    _rowIndex: row._rowIndex,
  };

  // Calculate confidence score - use override if enabled, else auto-calculate
  if (overrideEnabled === 'Y' && manualConfidenceScore !== undefined) {
    lot.confidence_score = manualConfidenceScore;
  } else {
    const sheetConfidence = parseInt(row.confidence_score);
    if (!isNaN(sheetConfidence) && sheetConfidence > 0) {
      lot.confidence_score = sheetConfidence;
    } else {
      lot.confidence_score = calculateLotConfidenceScore(lot);
    }
  }
  
  // Determine action - use override if enabled, else auto-calculate
  if (overrideEnabled === 'Y' && manualAction) {
    lot.action = manualAction;
  } else {
    const sheetAction = row.action?.toString().trim();
    const hasValidSheetAction = sheetAction === 'Buy' || sheetAction === 'Watch';
    lot.action = hasValidSheetAction ? sheetAction : determineLotAction(lot.confidence_score);
  }

  return lot;
}

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

const LOT_HEADERS = [
  'lot_key', 'lot_id', 'event_id', 'auction_house', 'location', 'auction_datetime', 'listing_url',
  'make', 'model', 'variant_raw', 'variant_normalised', 'year', 'km', 'fuel', 'drivetrain',
  'transmission', 'reserve', 'highest_bid', 'status', 'pass_count', 'description_score',
  'estimated_get_out', 'estimated_margin', 'confidence_score', 'action', 'visible_to_dealers', 
  'updated_at', 'last_status', 'last_seen_at', 'relist_group_id',
  // Multi-source fields
  'source_type', 'source_name', 'listing_id', 'listing_key', 'price_current', 'price_prev',
  'price_drop_count', 'relist_count', 'first_seen_at',
  // Override fields
  'manual_confidence_score', 'manual_action', 'override_enabled'
];

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
  'transmission', 'fingerprint_generated', 'fingerprint_id', 'gross_profit', 'activate', 'do_not_replicate', 'tags'
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
  addFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    const saleDate = new Date(fp.sale_date);
    const expiresAt = new Date(saleDate);
    expiresAt.setDate(expiresAt.getDate() + 120);
    
    const newFingerprint: SaleFingerprint = {
      ...fp,
      fingerprint_id: `FP-${Date.now()}`,
      expires_at: expiresAt.toISOString().split('T')[0],
      max_km: fp.sale_km + 15000,
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

  // Get all lots (create sheet if needed)
  getLots: async (isAdmin: boolean): Promise<AuctionLot[]> => {
    try {
      const response = await callSheetsApi('read', SHEETS.LOTS);
      const lots = response.data.map(parseAuctionLot);
      
      // Filter by visibility for dealers
      if (!isAdmin) {
        return lots.filter((lot: AuctionLot) => lot.visible_to_dealers === 'Y');
      }
      return lots;
    } catch (error) {
      // Sheet might not exist, try to create it
      console.log('Lots sheet may not exist, attempting to create...');
      try {
        await callSheetsApi('create', SHEETS.LOTS, { headers: LOT_HEADERS });
        return [];
      } catch (createError) {
        console.error('Failed to create lots sheet:', createError);
        return [];
      }
    }
  },

  // Get lot filter options - extended for multi-source
  getLotFilterOptions: async (): Promise<{ 
    auction_houses: string[]; 
    locations: string[]; 
    makes: string[];
    source_types: string[];
    source_names: string[];
  }> => {
    try {
      const response = await callSheetsApi('read', SHEETS.LOTS);
      const lots = response.data.map(parseAuctionLot);
      
      return {
        auction_houses: [...new Set(lots.map((l: AuctionLot) => l.auction_house))].filter(Boolean) as string[],
        locations: [...new Set(lots.map((l: AuctionLot) => l.location))].filter(Boolean) as string[],
        makes: [...new Set(lots.map((l: AuctionLot) => l.make))].filter(Boolean) as string[],
        source_types: [...new Set(lots.map((l: AuctionLot) => l.source_type))].filter(Boolean) as string[],
        source_names: [...new Set(lots.map((l: AuctionLot) => l.source_name))].filter(Boolean) as string[],
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
        
        // AUCTION-SPECIFIC: Pass count rule (only for auctions)
        let passCount = existing.pass_count;
        if (isAuction && existing.status !== 'passed_in' && incomingStatus === 'passed_in') {
          passCount = existing.pass_count + 1;
        }
        
        // NON-AUCTION: Price drop detection
        let priceDropCount = existing.price_drop_count || 0;
        let pricePrev = existing.price_prev || 0;
        const oldPriceCurrent = existing.price_current || 0;
        const newPriceCurrent = newLot.price_current || 0;
        
        if (!isAuction && newPriceCurrent > 0 && oldPriceCurrent > 0 && newPriceCurrent < oldPriceCurrent) {
          priceDropCount++;
          pricePrev = oldPriceCurrent;
        }
        
        // NON-AUCTION: Relist detection (if last_seen_at > 7 days ago)
        let relistCount = existing.relist_count || 0;
        if (!isAuction && existing.last_seen_at) {
          const lastSeen = new Date(existing.last_seen_at);
          const daysSinceLastSeen = (new Date().getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceLastSeen > 7) {
            relistCount++;
          }
        }
        
        const mergedLot: AuctionLot = {
          ...existing,
          ...newLot,
          lot_key: incomingLotKey || existing.lot_key,
          listing_key: incomingListingKey || existing.listing_key,
          status: incomingStatus,
          pass_count: passCount,
          last_status: existing.status,
          last_seen_at: nowISO,
          updated_at: nowISO,
          // Non-auction lifecycle
          price_drop_count: priceDropCount,
          price_prev: pricePrev,
          relist_count: relistCount,
          // Preserve first_seen_at
          first_seen_at: existing.first_seen_at || nowISO,
        };
        
        // For auctions, sync price_current from reserve/highest_bid
        if (isAuction) {
          mergedLot.price_current = mergedLot.reserve || mergedLot.highest_bid || 0;
        }
        
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
        
        const fullLot: AuctionLot = {
          lot_key: incomingLotKey,
          lot_id: newLot.lot_id || '',
          event_id: newLot.event_id || '',
          auction_house: auctionHouse,
          location: newLot.location || '',
          auction_datetime: newLot.auction_datetime || '',
          listing_url: newLot.listing_url || '',
          make: newLot.make || '',
          model: newLot.model || '',
          variant_raw: newLot.variant_raw || '',
          variant_normalised: newLot.variant_normalised || '',
          year: newLot.year || 0,
          km: newLot.km || 0,
          fuel: newLot.fuel || '',
          drivetrain: newLot.drivetrain || '',
          transmission: newLot.transmission || '',
          reserve: newLot.reserve || 0,
          highest_bid: newLot.highest_bid || 0,
          status: incomingStatus,
          pass_count: passCount,
          description_score: newLot.description_score || 0,
          estimated_get_out: newLot.estimated_get_out || 0,
          estimated_margin: newLot.estimated_margin || 0,
          confidence_score: newLot.confidence_score || 0,
          action: newLot.action || 'Watch',
          visible_to_dealers: newLot.visible_to_dealers || 'N',
          updated_at: nowISO,
          last_status: '',
          last_seen_at: nowISO,
          relist_group_id: newLot.relist_group_id || '',
          // Multi-source fields
          source_type: sourceType,
          source_name: sourceName,
          listing_id: newLot.listing_id || '',
          listing_key: incomingListingKey,
          price_current: newLot.price_current || newLot.reserve || newLot.highest_bid || 0,
          price_prev: 0,
          price_drop_count: 0,
          relist_count: 0,
          first_seen_at: nowISO,
          // Override fields (defaults)
          override_enabled: 'N',
        };
        
        // Calculate confidence
        fullLot.confidence_score = calculateLotConfidenceScore(fullLot);
        fullLot.action = determineLotAction(fullLot.confidence_score);
        
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
  upsertFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    const depositDate = new Date(fp.sale_date);
    const expiresAt = new Date(depositDate);
    expiresAt.setDate(expiresAt.getDate() + 120);
    
    const newData = {
      sale_date: fp.sale_date,
      expires_at: expiresAt.toISOString().split('T')[0],
      max_km: fp.sale_km + 15000,
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

  // Get normalised sales with optional filters
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

      // CRITICAL: Only generate from activate=Y AND do_not_replicate!=Y
      if (sale.activate !== 'Y') {
        errors.push(`Sale ${sale.sale_id}: Not activated (set Activate=Y first)`);
        continue;
      }
      if (sale.do_not_replicate === 'Y') {
        errors.push(`Sale ${sale.sale_id}: Marked as Do Not Replicate`);
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
  upsertFingerprintFromSale: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'max_km' | 'is_active'> & { 
    fingerprint_type: 'full' | 'spec_only';
    source_sale_id: string;
    source_import_id: string;
  }): Promise<SaleFingerprint & { _isNew: boolean }> => {
    const existingFingerprints = await googleSheetsService.getFingerprints();
    
    // Check for existing fingerprint by source_sale_id first (idempotent)
    const existingBySource = existingFingerprints.find(
      (f: SaleFingerprint) => f.source_sale_id === fp.source_sale_id
    );

    const saleDate = new Date(fp.sale_date || new Date());
    const expiresAt = new Date(saleDate);
    expiresAt.setDate(expiresAt.getDate() + 120);
    
    // For spec_only, max_km is not meaningful but we still set it
    const maxKm = fp.fingerprint_type === 'spec_only' ? 999999 : fp.sale_km + 15000;

    if (existingBySource) {
      // Update existing fingerprint - just reactivate it
      const updatedFp: SaleFingerprint = {
        ...existingBySource,
        is_active: 'Y',
        expires_at: expiresAt.toISOString().split('T')[0],
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
    
    // Find rows that are activate=Y, do_not_replicate!=Y, and no fingerprint generated
    const needsFingerprint = sales.filter((s: SalesNormalised) => 
      s.activate === 'Y' && 
      s.do_not_replicate !== 'Y' && 
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
        const saleDate = new Date(sale.sale_date || new Date());
        const expiresAt = new Date(saleDate);
        expiresAt.setDate(expiresAt.getDate() + 120);
        const expiresAtStr = expiresAt.toISOString().split('T')[0];
        
        // Max km calculation
        const maxKm = fingerprintType === 'spec_only' ? 999999 : (sale.km || 0) + 15000;
        
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
            sale_km: sale.km || 0,
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
};
