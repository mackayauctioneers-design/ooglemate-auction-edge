// Main data service - switches between mock and Google Sheets
// Set USE_GOOGLE_SHEETS to true when Google Sheets is configured

import { googleSheetsService } from './googleSheetsService';
import { dataService as mockDataService } from './mockData';
import { AuctionOpportunity, SaleFingerprint, Dealer, AlertLog, AuctionEvent, AuctionLot } from '@/types';

// Toggle this to switch between mock data and Google Sheets
const USE_GOOGLE_SHEETS = true;

export const dataService = {
  getOpportunities: async (isAdmin: boolean, dealerFingerprints?: SaleFingerprint[]): Promise<AuctionOpportunity[]> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getOpportunities(isAdmin, dealerFingerprints);
    }
    return mockDataService.getOpportunities(isAdmin, dealerFingerprints);
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

  addFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.addFingerprint(fp);
    }
    return mockDataService.addFingerprint(fp);
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

  getLotFilterOptions: async (): Promise<{ auction_houses: string[]; locations: string[]; makes: string[] }> => {
    if (USE_GOOGLE_SHEETS) {
      return googleSheetsService.getLotFilterOptions();
    }
    return { auction_houses: [], locations: [], makes: [] };
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
};
