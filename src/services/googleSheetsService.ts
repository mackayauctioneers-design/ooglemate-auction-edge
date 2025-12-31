import { supabase } from '@/integrations/supabase/client';
import { 
  AuctionOpportunity, 
  SaleFingerprint, 
  Dealer, 
  AlertLog,
  AuctionEvent,
  AuctionLot,
  calculateConfidenceScore,
  determineAction,
  calculateLotConfidenceScore,
  determineLotAction
} from '@/types';

const SHEETS = {
  OPPORTUNITIES: 'Auction_Opportunities',
  FINGERPRINTS: 'Sale_Fingerprints',
  DEALERS: 'Dealers',
  ALERTS: 'Alert_Log',
  EVENTS: 'Auction_Events',
  LOTS: 'Auction_Lots',
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
    _rowIndex: row._rowIndex,
  };
}

function parseDealer(row: any): Dealer {
  return {
    dealer_name: row.dealer_name || '',
    whatsapp: row.whatsapp || '',
    role: row.role || 'dealer',
    enabled: row.enabled || 'Y',
    _rowIndex: row._rowIndex,
  };
}

function parseAlert(row: any): AlertLog {
  return {
    alert_id: row.alert_id || '',
    sent_at: row.sent_at || '',
    recipient_whatsapp: row.recipient_whatsapp || '',
    lot_id: row.lot_id || '',
    fingerprint_id: row.fingerprint_id || '',
    action_change: row.action_change || '',
    message_text: row.message_text || '',
    status: row.status || 'queued',
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
  const sheetAction = row.action?.toString().trim();
  const hasValidSheetAction = sheetAction === 'Buy' || sheetAction === 'Watch';
  
  const lot: AuctionLot = {
    lot_id: row.lot_id || '',
    event_id: row.event_id || '',
    auction_house: row.auction_house || '',
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
    updated_at: row.updated_at || new Date().toISOString(),
    _rowIndex: row._rowIndex,
  };

  // Calculate confidence score if blank
  const sheetConfidence = parseInt(row.confidence_score);
  if (!isNaN(sheetConfidence) && sheetConfidence > 0) {
    lot.confidence_score = sheetConfidence;
  } else {
    lot.confidence_score = calculateLotConfidenceScore(lot);
  }
  
  // Use sheet action if valid, otherwise calculate
  lot.action = hasValidSheetAction ? sheetAction : determineLotAction(lot.confidence_score);

  return lot;
}

const LOT_HEADERS = [
  'lot_id', 'event_id', 'auction_house', 'location', 'auction_datetime', 'listing_url',
  'make', 'model', 'variant_raw', 'variant_normalised', 'year', 'km', 'fuel', 'drivetrain',
  'transmission', 'reserve', 'highest_bid', 'status', 'pass_count', 'description_score',
  'estimated_get_out', 'estimated_margin', 'confidence_score', 'action', 'visible_to_dealers', 'updated_at'
];

export const googleSheetsService = {
  // Get all opportunities with optional filters
  getOpportunities: async (isAdmin: boolean, dealerFingerprints?: SaleFingerprint[]): Promise<AuctionOpportunity[]> => {
    const response = await callSheetsApi('read', SHEETS.OPPORTUNITIES);
    const opportunities = response.data.map(parseOpportunity);
    
    return opportunities.filter((opp: AuctionOpportunity) => {
      // Margin threshold
      if (opp.estimated_margin < 1000) return false;
      
      // Admin sees all visible_to_dealers rows
      if (isAdmin) return true;
      
      // Dealers only see visible_to_dealers = Y AND matching fingerprints
      if (opp.visible_to_dealers !== 'Y') return false;
      
      // Check if matches any dealer fingerprint
      if (dealerFingerprints && dealerFingerprints.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const hasMatch = dealerFingerprints.some((fp: SaleFingerprint) => {
          if (fp.is_active !== 'Y') return false;
          if (fp.expires_at < today) return false;
          
          return (
            opp.make === fp.make &&
            opp.model === fp.model &&
            opp.variant_normalised === fp.variant_normalised &&
            opp.engine === fp.engine &&
            opp.drivetrain === fp.drivetrain &&
            opp.transmission === fp.transmission &&
            Math.abs(opp.year - fp.year) <= 1 &&
            opp.km <= fp.max_km
          );
        });
        return hasMatch;
      }
      
      return false;
    });
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

  // Get unique filter values
  getFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[]; makes: string[] }> => {
    const response = await callSheetsApi('read', SHEETS.OPPORTUNITIES);
    const opportunities = response.data.map(parseOpportunity);
    
    return {
      auction_houses: [...new Set(opportunities.map((o: AuctionOpportunity) => o.auction_house))].filter(Boolean) as string[],
      locations: [...new Set(opportunities.map((o: AuctionOpportunity) => o.location))].filter(Boolean) as string[],
      makes: [...new Set(opportunities.map((o: AuctionOpportunity) => o.make))].filter(Boolean) as string[],
    };
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

  // Get lot filter options
  getLotFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[]; makes: string[] }> => {
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

  // Add a new lot
  addLot: async (lot: Omit<AuctionLot, 'lot_id' | 'updated_at' | 'confidence_score' | 'action'>): Promise<AuctionLot> => {
    const confidenceScore = calculateLotConfidenceScore(lot as AuctionLot);
    const action = determineLotAction(confidenceScore);
    
    const newLot: AuctionLot = {
      ...lot,
      lot_id: `LOT-${Date.now()}`,
      confidence_score: confidenceScore,
      action: action,
      updated_at: new Date().toISOString(),
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

  // Upsert lots (for CSV import)
  upsertLots: async (newLots: Partial<AuctionLot>[]): Promise<{ added: number; updated: number }> => {
    // Read existing lots
    let existingLots: AuctionLot[] = [];
    let headers: string[] = LOT_HEADERS;
    
    try {
      const response = await callSheetsApi('read', SHEETS.LOTS);
      existingLots = response.data.map(parseAuctionLot);
      headers = response.headers || LOT_HEADERS;
    } catch {
      // Create sheet if it doesn't exist
      await callSheetsApi('create', SHEETS.LOTS, { headers: LOT_HEADERS });
    }

    let added = 0;
    let updated = 0;

    for (const newLot of newLots) {
      if (!newLot.lot_id) continue;
      
      const existingIndex = existingLots.findIndex(l => l.lot_id === newLot.lot_id);
      
      if (existingIndex >= 0) {
        // Update existing lot
        const existing = existingLots[existingIndex];
        
        // Handle pass_count increment for passed_in status
        let passCount = existing.pass_count;
        if (newLot.status === 'passed_in' && existing.status !== 'passed_in') {
          passCount = existing.pass_count + 1;
        } else if (newLot.pass_count !== undefined) {
          passCount = newLot.pass_count;
        }
        
        const mergedLot: AuctionLot = {
          ...existing,
          ...newLot,
          pass_count: passCount,
          updated_at: new Date().toISOString(),
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
        const confidenceScore = newLot.confidence_score || calculateLotConfidenceScore(newLot as AuctionLot);
        const action = newLot.action || determineLotAction(confidenceScore);
        
        const fullLot: AuctionLot = {
          lot_id: newLot.lot_id,
          event_id: newLot.event_id || '',
          auction_house: newLot.auction_house || '',
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
          status: newLot.status || 'listed',
          pass_count: newLot.pass_count || 0,
          description_score: newLot.description_score || 0,
          estimated_get_out: newLot.estimated_get_out || 0,
          estimated_margin: newLot.estimated_margin || 0,
          confidence_score: confidenceScore,
          action: action,
          visible_to_dealers: newLot.visible_to_dealers || 'N',
          updated_at: new Date().toISOString(),
        };
        
        await callSheetsApi('append', SHEETS.LOTS, fullLot);
        added++;
      }
    }

    return { added, updated };
  },
};
