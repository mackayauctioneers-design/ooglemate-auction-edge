// Main data service - switches between mock and Google Sheets
// Set USE_GOOGLE_SHEETS to true when Google Sheets is configured

import { googleSheetsService } from './googleSheetsService';
import { dataService as mockDataService } from './mockData';
import { SaleFingerprint, Dealer, AlertLog, AuctionEvent, AuctionLot, SaleLog, SalesImportRaw, SalesNormalised } from '@/types';

// Toggle this to switch between mock data and Google Sheets
const USE_GOOGLE_SHEETS = true;

export const dataService = {
  // Get opportunities as filtered view of Auction_Lots
  getOpportunities: async (isAdmin: boolean, dealerFingerprints?: SaleFingerprint[]): Promise<AuctionLot[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getOpportunities(isAdmin, dealerFingerprints);
    }
    // Mock data not supported for new opportunities model
    return [];
  },

  getFingerprints: async (): Promise<SaleFingerprint[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getFingerprints();
    }
    return mockDataService.getFingerprints();
  },

  getDealerFingerprints: async (dealerName: string): Promise<SaleFingerprint[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getDealerFingerprints(dealerName);
    }
    return mockDataService.getDealerFingerprints(dealerName);
  },

  getDealers: async (): Promise<Dealer[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getDealers();
    }
    return mockDataService.getDealers();
  },

  getAlerts: async (): Promise<AlertLog[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getAlerts();
    }
    return mockDataService.getAlerts();
  },

  addFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'min_km' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.addFingerprint(fp);
    }
    return mockDataService.addFingerprint(fp);
  },

  // Upsert fingerprint - update if exists for same dealer + strict fields
  upsertFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'min_km' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.upsertFingerprint(fp);
    }
    throw new Error('Mock data does not support upserting fingerprints');
  },

  deactivateFingerprint: async (fingerprintId: string): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.deactivateFingerprint(fingerprintId);
    }
    return mockDataService.deactivateFingerprint(fingerprintId);
  },

  getFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[]; makes: string[] }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getFilterOptions();
    }
    return mockDataService.getFilterOptions();
  },

  getAuctionEvents: async (): Promise<AuctionEvent[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getAuctionEvents();
    }
    return [];
  },

  addAuctionEvent: async (event: Omit<AuctionEvent, 'event_id'>): Promise<AuctionEvent> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.addAuctionEvent(event);
    }
    throw new Error('Mock data does not support adding events');
  },

  updateAuctionEvent: async (event: AuctionEvent): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.updateAuctionEvent(event);
    }
    throw new Error('Mock data does not support updating events');
  },

  getEventFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[] }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getEventFilterOptions();
    }
    return { auction_houses: [], locations: [] };
  },

  // ========== AUCTION LOTS ==========

  getLots: async (isAdmin: boolean): Promise<AuctionLot[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getLots(isAdmin);
    }
    return [];
  },

  getLotFilterOptions: async (): Promise<{ 
    auction_houses: string[]; 
    locations: string[]; 
    makes: string[];
    source_types: string[];
    source_names: string[];
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getLotFilterOptions();
    }
    return { auction_houses: [], locations: [], makes: [], source_types: [], source_names: [] };
  },

  addLot: async (lot: Omit<AuctionLot, 'lot_id' | 'updated_at' | 'confidence_score' | 'action'>): Promise<AuctionLot> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.addLot(lot);
    }
    throw new Error('Mock data does not support adding lots');
  },

  updateLot: async (lot: AuctionLot): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.updateLot(lot);
    }
    throw new Error('Mock data does not support updating lots');
  },

  upsertLots: async (lots: Partial<AuctionLot>[]): Promise<{ added: number; updated: number }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.upsertLots(lots);
    }
    throw new Error('Mock data does not support upserting lots');
  },

  // ========== SALES LOG ==========

  getSalesLog: async (limit?: number): Promise<SaleLog[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getSalesLog(limit);
    }
    return [];
  },

  addSaleLog: async (sale: Omit<SaleLog, 'sale_id' | 'created_at'>): Promise<SaleLog> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.addSaleLog(sale);
    }
    throw new Error('Mock data does not support adding sales');
  },

  importSalesWithFingerprints: async (
    sales: Array<Omit<SaleLog, 'sale_id' | 'created_at'>>
  ): Promise<{ imported: number; fingerprintsUpdated: number; errors: Array<{ row: number; reason: string }> }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.importSalesWithFingerprints(sales);
    }
    throw new Error('Mock data does not support importing sales');
  },

  // ========== IN-APP ALERTS ==========

  getDealerAlerts: async (dealerName: string): Promise<AlertLog[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getDealerAlerts(dealerName);
    }
    return [];
  },

  getUnreadAlertCount: async (dealerName?: string): Promise<number> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getUnreadAlertCount(dealerName);
    }
    return 0;
  },

  getUnreadBuyAlerts: async (dealerName?: string): Promise<AlertLog[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getUnreadBuyAlerts(dealerName);
    }
    return [];
  },

  markAlertRead: async (alertId: string): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.markAlertRead(alertId);
    }
    throw new Error('Mock data does not support marking alerts read');
  },

  markAllBuyAlertsRead: async (dealerName?: string): Promise<number> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.markAllBuyAlertsRead(dealerName);
    }
    return 0;
  },

  acknowledgeAlert: async (alertId: string): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.acknowledgeAlert(alertId);
    }
    throw new Error('Mock data does not support acknowledging alerts');
  },

  // ========== SETTINGS ==========

  getSetting: async (key: string): Promise<string | null> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getSetting(key);
    }
    return null;
  },

  upsertSetting: async (key: string, value: string): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.upsertSetting(key, value);
    }
    throw new Error('Mock data does not support settings');
  },

  // ========== SALES IMPORTS (Audit Trail) ==========

  appendSalesImportsRaw: async (rows: SalesImportRaw[]): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.appendSalesImportsRaw(rows);
    }
    throw new Error('Mock data does not support sales imports');
  },

  getSalesImportsRaw: async (importId?: string): Promise<SalesImportRaw[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getSalesImportsRaw(importId);
    }
    return [];
  },

  appendSalesNormalised: async (rows: SalesNormalised[]): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.appendSalesNormalised(rows);
    }
    throw new Error('Mock data does not support sales normalised');
  },

  getSalesNormalised: async (filters?: {
    importId?: string;
    dealerName?: string;
    qualityFlag?: string;
    make?: string;
    model?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<SalesNormalised[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getSalesNormalised(filters);
    }
    return [];
  },

  getSalesNormalisedFilterOptions: async (): Promise<{
    importIds: string[];
    dealers: string[];
    makes: string[];
    models: string[];
    qualityFlags: string[];
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getSalesNormalisedFilterOptions();
    }
    return { importIds: [], dealers: [], makes: [], models: [], qualityFlags: [] };
  },

  updateSalesNormalised: async (sale: SalesNormalised): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.updateSalesNormalised(sale);
    }
    throw new Error('Mock data does not support updating sales normalised');
  },

  generateFingerprintsFromNormalised: async (saleIds: string[]): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.generateFingerprintsFromNormalised(saleIds);
    }
    throw new Error('Mock data does not support generating fingerprints');
  },

  backfillFingerprintsFromActivated: async (): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.backfillFingerprintsFromActivated();
    }
    throw new Error('Mock data does not support backfilling fingerprints');
  },

  // Comprehensive sync with audit logging
  syncFingerprintsFromSales: async (options?: {
    dryRun?: boolean;
    defaultDealerName?: string;
    saleIds?: string[];
  }): Promise<{
    created: number;
    updated: number;
    skipped: number;
    eligible: number;
    scanned: number;
    skipReasons: Record<string, number>;
    errors: string[];
    syncLogId: string;
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.syncFingerprintsFromSales(options);
    }
    throw new Error('Mock data does not support fingerprint sync');
  },

  // Get sync logs
  getSyncLogs: async (limit?: number) => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getSyncLogs(limit);
    }
    return [];
  },

  // Bulk extract variants
  bulkExtractVariants: async (saleIds: string[]): Promise<{ updated: number; failed: number }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.bulkExtractVariants(saleIds);
    }
    throw new Error('Mock data does not support variant extraction');
  },

  // Extract variant helper (for single use)
  extractVariant: (text: string): string => {
    return googleSheetsService.extractVariant(text);
  },

  // Bulk reactivate fingerprints
  reactivateFingerprints: async (fingerprintIds: string[]): Promise<{ reactivated: number; failed: number }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.reactivateFingerprints(fingerprintIds);
    }
    throw new Error('Mock data does not support reactivating fingerprints');
  },

  // Backfill min_km for existing fingerprints
  backfillMinKm: async (): Promise<{ updated: number; skipped: number }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.backfillMinKm();
    }
    throw new Error('Mock data does not support backfilling min_km');
  },

  // Backfill variant_family for fingerprints and listings
  backfillVariantFamily: async (): Promise<{ 
    fingerprintsUpdated: number; 
    fingerprintsSkipped: number;
    lotsUpdated: number;
    lotsSkipped: number;
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.backfillVariantFamily();
    }
    throw new Error('Mock data does not support backfilling variant_family');
  },

  // Fix KM for spec-only fingerprints (clear placeholder values)
  fixSpecOnlyKm: async (): Promise<{
    fingerprintsFixed: number;
    fingerprintsSkipped: number;
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.fixSpecOnlyKm();
    }
    throw new Error('Mock data does not support fixing spec-only KM');
  },

  // ========== DO NOT BUY PROTECTION ==========

  setDoNotBuy: async (saleIds: string[], reason: string): Promise<{
    salesUpdated: number;
    fingerprintsDeactivated: number;
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.setDoNotBuy(saleIds, reason);
    }
    throw new Error('Mock data does not support Do Not Buy');
  },

  clearDoNotBuy: async (saleIds: string[]): Promise<{ salesUpdated: number }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.clearDoNotBuy(saleIds);
    }
    throw new Error('Mock data does not support Do Not Buy');
  },

  updateFingerprintDoNotBuy: async (fingerprintId: string, doNotBuy: 'Y' | 'N', reason?: string): Promise<void> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.updateFingerprintDoNotBuy(fingerprintId, doNotBuy, reason);
    }
    throw new Error('Mock data does not support Do Not Buy');
  },

  // Backfill Pickles status: normalize numeric status codes to string statuses
  backfillPicklesStatus: async (): Promise<{
    lotsUpdated: number;
    lotsSkipped: number;
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.backfillPicklesStatus();
    }
    throw new Error('Mock data does not support backfilling Pickles status');
  },

  // Backfill make/model normalization for existing sales (resolve numeric IDs to text labels)
  backfillSalesMakeModel: async (): Promise<{
    salesUpdated: number;
    salesSkipped: number;
    unresolved: Array<{ saleId: string; make: string; model: string }>;
  }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.backfillSalesMakeModel();
    }
    throw new Error('Mock data does not support backfilling sales make/model');
  },
};
