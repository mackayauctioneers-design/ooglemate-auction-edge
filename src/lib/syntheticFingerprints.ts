// Synthetic fingerprints for dealers with no sales data
// These represent common profitable patterns in the AU used-car market

export interface SyntheticFingerprint {
  make: string;
  model: string;
  variant: string;
  km_low: number;
  km_high: number;
  avg_sale: number;
  avg_profit: number;
  days_to_sell: number;
}

export const SYNTHETIC_FINGERPRINTS: Record<string, SyntheticFingerprint[]> = {
  Toyota: [
    { make: "Toyota", model: "Prado", variant: "GXL Diesel", km_low: 40000, km_high: 90000, avg_sale: 63500, avg_profit: 4200, days_to_sell: 18 },
    { make: "Toyota", model: "Hilux", variant: "SR5 Auto", km_low: 30000, km_high: 80000, avg_sale: 52000, avg_profit: 3800, days_to_sell: 14 },
    { make: "Toyota", model: "LandCruiser", variant: "200 Series GXL", km_low: 60000, km_high: 120000, avg_sale: 85000, avg_profit: 5500, days_to_sell: 22 },
    { make: "Toyota", model: "RAV4", variant: "GXL Hybrid", km_low: 20000, km_high: 60000, avg_sale: 42000, avg_profit: 3200, days_to_sell: 12 },
    { make: "Toyota", model: "Corolla", variant: "Ascent Sport", km_low: 20000, km_high: 50000, avg_sale: 28000, avg_profit: 2400, days_to_sell: 10 },
  ],
  Ford: [
    { make: "Ford", model: "Ranger", variant: "Wildtrak", km_low: 30000, km_high: 80000, avg_sale: 55000, avg_profit: 4100, days_to_sell: 16 },
    { make: "Ford", model: "Everest", variant: "Trend", km_low: 40000, km_high: 90000, avg_sale: 52000, avg_profit: 3500, days_to_sell: 20 },
    { make: "Ford", model: "Ranger", variant: "XLT", km_low: 30000, km_high: 70000, avg_sale: 48000, avg_profit: 3600, days_to_sell: 15 },
  ],
  Isuzu: [
    { make: "Isuzu", model: "D-MAX", variant: "X-Terrain", km_low: 20000, km_high: 70000, avg_sale: 52000, avg_profit: 3900, days_to_sell: 17 },
    { make: "Isuzu", model: "MU-X", variant: "LS-T", km_low: 30000, km_high: 80000, avg_sale: 48000, avg_profit: 3400, days_to_sell: 19 },
  ],
  Mazda: [
    { make: "Mazda", model: "BT-50", variant: "GT", km_low: 30000, km_high: 70000, avg_sale: 48000, avg_profit: 3200, days_to_sell: 18 },
    { make: "Mazda", model: "CX-5", variant: "Touring", km_low: 20000, km_high: 60000, avg_sale: 35000, avg_profit: 2800, days_to_sell: 14 },
    { make: "Mazda", model: "CX-9", variant: "Azami", km_low: 30000, km_high: 70000, avg_sale: 45000, avg_profit: 3100, days_to_sell: 20 },
  ],
  Mixed: [
    { make: "Toyota", model: "Hilux", variant: "SR5 Auto", km_low: 30000, km_high: 80000, avg_sale: 52000, avg_profit: 3800, days_to_sell: 14 },
    { make: "Ford", model: "Ranger", variant: "Wildtrak", km_low: 30000, km_high: 80000, avg_sale: 55000, avg_profit: 4100, days_to_sell: 16 },
    { make: "Toyota", model: "Prado", variant: "GXL Diesel", km_low: 40000, km_high: 90000, avg_sale: 63500, avg_profit: 4200, days_to_sell: 18 },
    { make: "Mazda", model: "CX-5", variant: "Touring", km_low: 20000, km_high: 60000, avg_sale: 35000, avg_profit: 2800, days_to_sell: 14 },
    { make: "Isuzu", model: "D-MAX", variant: "X-Terrain", km_low: 20000, km_high: 70000, avg_sale: 52000, avg_profit: 3900, days_to_sell: 17 },
  ],
};

// Synthetic "missed opportunities" for FOMO step
export interface MissedOpportunity {
  title: string;
  listed_ago: string;
  price: number;
  market_price: number;
  missed_margin: number;
  source: string;
}

export const SYNTHETIC_MISSED: Record<string, MissedOpportunity[]> = {
  Toyota: [
    { title: "2022 Toyota Hilux SR5 Auto", listed_ago: "4 hours ago", price: 49500, market_price: 54800, missed_margin: 5300, source: "Pickles" },
    { title: "2021 Toyota Prado GXL Diesel", listed_ago: "Yesterday", price: 58900, market_price: 64200, missed_margin: 5300, source: "Manheim" },
  ],
  Ford: [
    { title: "2022 Ford Ranger Wildtrak", listed_ago: "6 hours ago", price: 50200, market_price: 55800, missed_margin: 5600, source: "GraysOnline" },
  ],
  Isuzu: [
    { title: "2023 Isuzu D-MAX X-Terrain", listed_ago: "3 hours ago", price: 48500, market_price: 53200, missed_margin: 4700, source: "Pickles" },
  ],
  Mazda: [
    { title: "2022 Mazda BT-50 GT", listed_ago: "5 hours ago", price: 44200, market_price: 48800, missed_margin: 4600, source: "Manheim" },
  ],
  Mixed: [
    { title: "2022 Toyota Hilux SR5 Auto", listed_ago: "4 hours ago", price: 49500, market_price: 54800, missed_margin: 5300, source: "Pickles" },
    { title: "2022 Ford Ranger Wildtrak", listed_ago: "6 hours ago", price: 50200, market_price: 55800, missed_margin: 5600, source: "GraysOnline" },
  ],
};

// Price range buckets
export const PRICE_RANGES = [
  { label: "$20–40k", min: 20000, max: 40000 },
  { label: "$40–60k", min: 40000, max: 60000 },
  { label: "$60–90k", min: 60000, max: 90000 },
] as const;

// Available makes
export const AVAILABLE_MAKES = ["Toyota", "Ford", "Isuzu", "Mazda", "Mixed"] as const;

// Top models per make
export const MODELS_BY_MAKE: Record<string, string[]> = {
  Toyota: ["Prado", "Hilux", "LandCruiser", "RAV4", "Corolla"],
  Ford: ["Ranger", "Everest"],
  Isuzu: ["D-MAX", "MU-X"],
  Mazda: ["BT-50", "CX-5", "CX-9"],
  Mixed: ["Hilux", "Ranger", "Prado", "CX-5", "D-MAX"],
};
