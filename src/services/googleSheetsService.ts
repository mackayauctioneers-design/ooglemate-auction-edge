import { supabase } from '@/integrations/supabase/client';
import { 
  AuctionOpportunity, 
  SaleFingerprint, 
  Dealer, 
  AlertLog,
  AuctionEvent,
  calculateConfidenceScore,
  determineAction
} from '@/types';

const SHEETS = {
  OPPORTUNITIES: 'Auction_Opportunities',
  FINGERPRINTS: 'Sale_Fingerprints',
  DEALERS: 'Dealers',
  ALERTS: 'Alert_Log',
  EVENTS: 'Auction_Events',
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
};
