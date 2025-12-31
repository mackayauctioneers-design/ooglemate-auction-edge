// Mock Data Service - Simulates Google Sheets data
// To be replaced with actual Google Sheets API integration

import { 
  AuctionOpportunity, 
  SaleFingerprint, 
  Dealer, 
  AlertLog,
  calculateConfidenceScore,
  determineAction
} from '@/types';

// Sample Dealers
export const mockDealers: Dealer[] = [
  {
    dealer_name: 'Dave',
    whatsapp: '+61400000001',
    role: 'admin',
    enabled: 'Y',
  },
  {
    dealer_name: 'John Smith Motors',
    whatsapp: '+61400000002',
    role: 'dealer',
    enabled: 'Y',
  },
  {
    dealer_name: 'City Auto Traders',
    whatsapp: '+61400000003',
    role: 'dealer',
    enabled: 'Y',
  },
];

// Sample Auction Opportunities
const baseOpportunities: Omit<AuctionOpportunity, 'confidence_score' | 'action'>[] = [
  {
    lot_id: 'MAN-2024-001',
    auction_house: 'Manheim',
    listing_url: 'https://manheim.com.au/lot/001',
    location: 'Melbourne',
    scan_date: '2024-01-15',
    make: 'Toyota',
    model: 'Hilux',
    variant_raw: 'SR5 4x4 Double Cab',
    variant_normalised: 'SR5',
    year: 2021,
    km: 45000,
    engine: 'Diesel',
    drivetrain: '4WD',
    transmission: 'Automatic',
    reserve: 42000,
    highest_bid: 39500,
    status: 'passed_in',
    pass_count: 3,
    description_score: 2,
    estimated_get_out: 44500,
    estimated_margin: 3500,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T09:30:00Z',
    previous_reserve: 45000,
  },
  {
    lot_id: 'GRV-2024-102',
    auction_house: 'Grays',
    listing_url: 'https://grays.com/lot/102',
    location: 'Sydney',
    scan_date: '2024-01-15',
    make: 'Ford',
    model: 'Ranger',
    variant_raw: 'Wildtrak Bi-Turbo',
    variant_normalised: 'Wildtrak',
    year: 2022,
    km: 28000,
    engine: 'Diesel',
    drivetrain: '4WD',
    transmission: 'Automatic',
    reserve: 55000,
    highest_bid: 52000,
    status: 'passed_in',
    pass_count: 2,
    description_score: 3,
    estimated_get_out: 57000,
    estimated_margin: 4500,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T10:15:00Z',
  },
  {
    lot_id: 'MAN-2024-045',
    auction_house: 'Manheim',
    listing_url: 'https://manheim.com.au/lot/045',
    location: 'Brisbane',
    scan_date: '2024-01-15',
    make: 'Mazda',
    model: 'CX-5',
    variant_raw: 'GT Turbo AWD',
    variant_normalised: 'GT',
    year: 2020,
    km: 62000,
    engine: 'Petrol Turbo',
    drivetrain: 'AWD',
    transmission: 'Automatic',
    reserve: 28000,
    highest_bid: 25500,
    status: 'passed_in',
    pass_count: 4,
    description_score: 1,
    estimated_get_out: 30000,
    estimated_margin: 2800,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T11:00:00Z',
    previous_reserve: 31000,
  },
  {
    lot_id: 'PKR-2024-078',
    auction_house: 'Pickles',
    listing_url: 'https://pickles.com.au/lot/078',
    location: 'Perth',
    scan_date: '2024-01-15',
    make: 'Hyundai',
    model: 'Tucson',
    variant_raw: 'Highlander CRDi',
    variant_normalised: 'Highlander',
    year: 2021,
    km: 38000,
    engine: 'Diesel',
    drivetrain: 'AWD',
    transmission: 'Automatic',
    reserve: 32000,
    highest_bid: 30000,
    status: 'listed',
    pass_count: 0,
    description_score: 4,
    estimated_get_out: 34000,
    estimated_margin: 1200,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T08:00:00Z',
  },
  {
    lot_id: 'GRV-2024-156',
    auction_house: 'Grays',
    listing_url: 'https://grays.com/lot/156',
    location: 'Adelaide',
    scan_date: '2024-01-15',
    make: 'Toyota',
    model: 'LandCruiser',
    variant_raw: 'GXL Turbo Diesel',
    variant_normalised: 'GXL',
    year: 2019,
    km: 95000,
    engine: 'Diesel',
    drivetrain: '4WD',
    transmission: 'Automatic',
    reserve: 72000,
    highest_bid: 68000,
    status: 'passed_in',
    pass_count: 2,
    description_score: 2,
    estimated_get_out: 75000,
    estimated_margin: 8000,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T14:30:00Z',
  },
  {
    lot_id: 'MAN-2024-089',
    auction_house: 'Manheim',
    listing_url: 'https://manheim.com.au/lot/089',
    location: 'Melbourne',
    scan_date: '2024-01-15',
    make: 'Kia',
    model: 'Sportage',
    variant_raw: 'GT-Line AWD',
    variant_normalised: 'GT-Line',
    year: 2022,
    km: 22000,
    engine: 'Petrol',
    drivetrain: 'AWD',
    transmission: 'Automatic',
    reserve: 38000,
    highest_bid: 35000,
    status: 'passed_in',
    pass_count: 3,
    description_score: 1,
    estimated_get_out: 40000,
    estimated_margin: 2200,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T12:45:00Z',
    previous_reserve: 42000,
  },
  {
    lot_id: 'PKR-2024-034',
    auction_house: 'Pickles',
    listing_url: 'https://pickles.com.au/lot/034',
    location: 'Sydney',
    scan_date: '2024-01-15',
    make: 'Volkswagen',
    model: 'Amarok',
    variant_raw: 'TDI580 Highline',
    variant_normalised: 'Highline',
    year: 2020,
    km: 78000,
    engine: 'Diesel',
    drivetrain: '4WD',
    transmission: 'Automatic',
    reserve: 48000,
    highest_bid: 44000,
    status: 'passed_in',
    pass_count: 2,
    description_score: 3,
    estimated_get_out: 50000,
    estimated_margin: 1800,
    visible_to_dealers: 'N',
    last_action: 'Watch',
    updated_at: '2024-01-15T13:20:00Z',
  },
  {
    lot_id: 'GRV-2024-201',
    auction_house: 'Grays',
    listing_url: 'https://grays.com/lot/201',
    location: 'Brisbane',
    scan_date: '2024-01-15',
    make: 'Mitsubishi',
    model: 'Triton',
    variant_raw: 'GLS Premium',
    variant_normalised: 'GLS',
    year: 2021,
    km: 55000,
    engine: 'Diesel',
    drivetrain: '4WD',
    transmission: 'Automatic',
    reserve: 36000,
    highest_bid: 33000,
    status: 'passed_in',
    pass_count: 1,
    description_score: 2,
    estimated_get_out: 38000,
    estimated_margin: 900,
    visible_to_dealers: 'Y',
    last_action: 'Watch',
    updated_at: '2024-01-15T15:00:00Z',
  },
];

// Process opportunities with calculated fields
export const mockOpportunities: AuctionOpportunity[] = baseOpportunities.map(opp => {
  const withConfidence = { ...opp, confidence_score: 0, action: 'Watch' as const };
  const confidence = calculateConfidenceScore(withConfidence as AuctionOpportunity);
  return {
    ...opp,
    confidence_score: confidence,
    action: determineAction(confidence),
  };
});

// Sample Sale Fingerprints
export const mockFingerprints: SaleFingerprint[] = [
  {
    fingerprint_id: 'FP-2024-001',
    dealer_name: 'John Smith Motors',
    dealer_whatsapp: '+61400000002',
    sale_date: '2024-01-10',
    expires_at: '2024-05-10',
    make: 'Toyota',
    model: 'Hilux',
    variant_normalised: 'SR5',
    year: 2021,
    sale_km: 40000,
    max_km: 55000,
    engine: 'Diesel',
    drivetrain: '4WD',
    transmission: 'Automatic',
    shared_opt_in: 'Y',
    is_active: 'Y',
  },
  {
    fingerprint_id: 'FP-2024-002',
    dealer_name: 'City Auto Traders',
    dealer_whatsapp: '+61400000003',
    sale_date: '2024-01-05',
    expires_at: '2024-05-05',
    make: 'Mazda',
    model: 'CX-5',
    variant_normalised: 'GT',
    year: 2020,
    sale_km: 50000,
    max_km: 65000,
    engine: 'Petrol Turbo',
    drivetrain: 'AWD',
    transmission: 'Automatic',
    shared_opt_in: 'N',
    is_active: 'Y',
  },
];

// Sample Alert Log
export const mockAlerts: AlertLog[] = [
  {
    alert_id: 'ALT-2024-001',
    sent_at: '2024-01-15T10:30:00Z',
    recipient_whatsapp: '+61400000002',
    lot_id: 'MAN-2024-001',
    fingerprint_id: 'FP-2024-001',
    dealer_name: 'Smith Motors',
    previous_action: 'Watch',
    new_action: 'Buy',
    action_change: 'Watch→Buy',
    message_text: 'OogleMate BUY NOW: 2021 Toyota Hilux SR5. Passed-in: 3. Est margin: $3,500. Link: https://manheim.com.au/lot/001',
    status: 'sent',
  },
];

// Data access functions (simulating API calls)
export const dataService = {
  // Get all opportunities with optional filters
  getOpportunities: async (isAdmin: boolean, dealerFingerprints?: SaleFingerprint[]): Promise<AuctionOpportunity[]> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    return mockOpportunities.filter(opp => {
      // Margin threshold
      if (opp.estimated_margin < 1000) return false;
      
      // Admin sees all visible_to_dealers rows
      if (isAdmin) return true;
      
      // Dealers only see visible_to_dealers = Y AND matching fingerprints
      if (opp.visible_to_dealers !== 'Y') return false;
      
      // Check if matches any dealer fingerprint
      if (dealerFingerprints && dealerFingerprints.length > 0) {
        const hasMatch = dealerFingerprints.some(fp => {
          if (fp.is_active !== 'Y') return false;
          
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
    await new Promise(resolve => setTimeout(resolve, 200));
    return [...mockFingerprints];
  },

  // Get dealer's fingerprints
  getDealerFingerprints: async (dealerName: string): Promise<SaleFingerprint[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return mockFingerprints.filter(fp => fp.dealer_name === dealerName);
  },

  // Get all dealers
  getDealers: async (): Promise<Dealer[]> => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return [...mockDealers];
  },

  // Get alerts
  getAlerts: async (): Promise<AlertLog[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return [...mockAlerts];
  },

  // Add a new sale fingerprint
  addFingerprint: async (fp: Omit<SaleFingerprint, 'fingerprint_id' | 'expires_at' | 'max_km' | 'is_active'>): Promise<SaleFingerprint> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    
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
    
    mockFingerprints.push(newFingerprint);
    return newFingerprint;
  },

  // Deactivate a fingerprint
  deactivateFingerprint: async (fingerprintId: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const fp = mockFingerprints.find(f => f.fingerprint_id === fingerprintId);
    if (fp) {
      fp.is_active = 'N';
    }
  },

  // Get unique filter values
  getFilterOptions: async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      auction_houses: [...new Set(mockOpportunities.map(o => o.auction_house))],
      locations: [...new Set(mockOpportunities.map(o => o.location))],
      makes: [...new Set(mockOpportunities.map(o => o.make))],
    };
  },
};
