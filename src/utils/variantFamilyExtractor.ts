/**
 * Deterministic Variant Family Extraction
 * Uses regex patterns and model-specific ladders, NOT AI
 */

// Variant family definitions by make/model
// Each family is a normalized key with patterns to match
export const VARIANT_FAMILIES: Record<string, Record<string, string[]>> = {
  // ========== TOYOTA ==========
  'toyota': {
    // LandCruiser 70/79 Series
    'landcruiser': ['GX', 'GXL', 'VX', 'SAHARA', 'KAKADU'],
    'prado': ['GX', 'GXL', 'VX', 'KAKADU', 'ALTITUDE', 'INVINCIBLE'],
    'hilux': ['WORKMATE', 'SR', 'SR5', 'ROGUE', 'RUGGED', 'RUGGED X', 'RUGGED-X'],
    'corolla': ['ASCENT', 'ASCENT SPORT', 'SX', 'ZR', 'HYBRID', 'GR', 'CROSS'],
    'camry': ['ASCENT', 'ASCENT SPORT', 'SX', 'SL', 'HYBRID', 'ATARA'],
    'rav4': ['GX', 'GXL', 'CRUISER', 'EDGE', 'HYBRID'],
    'kluger': ['GX', 'GXL', 'GRANDE', 'HYBRID'],
    'fortuner': ['GX', 'GXL', 'CRUSADE'],
    'yaris': ['ASCENT', 'SX', 'ZR', 'CROSS', 'GR'],
  },
  
  // ========== FORD ==========
  'ford': {
    'ranger': ['XL', 'XLS', 'XLT', 'WILDTRAK', 'RAPTOR', 'SPORT', 'FX4'],
    'everest': ['AMBIENTE', 'TREND', 'SPORT', 'TITANIUM', 'PLATINUM', 'WILDTRAK'],
    'mustang': ['GT', 'ECOBOOST', 'MACH 1', 'DARK HORSE'],
    'territory': ['TX', 'TS', 'TITANIUM', 'GHIA'],
    'falcon': ['XT', 'XR6', 'XR8', 'G6', 'G6E', 'FPV'],
  },
  
  // ========== ISUZU ==========
  'isuzu': {
    'd-max': ['SX', 'LS-M', 'LS-U', 'X-TERRAIN', 'LS', 'EX'],
    'mu-x': ['LS-M', 'LS-U', 'LS-T', 'LS'],
  },
  
  // ========== MITSUBISHI ==========
  'mitsubishi': {
    'triton': ['GLX', 'GLX+', 'GLS', 'GSR', 'EXCEED', 'BLACKLINE'],
    'pajero': ['GLX', 'GLS', 'EXCEED', 'SPORT'],
    'outlander': ['ES', 'LS', 'EXCEED', 'ASPIRE', 'GSR', 'PHEV'],
    'asx': ['ES', 'LS', 'EXCEED', 'GSR'],
  },
  
  // ========== MAZDA ==========
  'mazda': {
    'bt-50': ['XT', 'XTR', 'GT', 'SP', 'THUNDER'],
    'cx-5': ['MAXX', 'MAXX SPORT', 'TOURING', 'GT', 'AKERA'],
    'cx-9': ['SPORT', 'TOURING', 'GT', 'AZAMI'],
    'mazda3': ['PURE', 'EVOLVE', 'TOURING', 'GT', 'SP'],
  },
  
  // ========== NISSAN ==========
  'nissan': {
    'navara': ['SL', 'ST', 'ST-X', 'PRO-4X', 'N-TREK', 'WARRIOR'],
    'patrol': ['TI', 'TI-L', 'WARRIOR'],
    'x-trail': ['ST', 'ST-L', 'TI', 'TI-L', 'N-TREK'],
    'pathfinder': ['ST', 'ST-L', 'TI', 'TI-L'],
  },
  
  // ========== VOLKSWAGEN ==========
  'volkswagen': {
    'amarok': ['CORE', 'LIFE', 'STYLE', 'PANAMERICANA', 'AVENTURA', 'HIGHLINE', 'TRENDLINE', 'V6'],
    'golf': ['TRENDLINE', 'COMFORTLINE', 'HIGHLINE', 'R', 'GTI', 'R-LINE'],
    'tiguan': ['TRENDLINE', 'COMFORTLINE', 'HIGHLINE', 'R-LINE', 'ALLSPACE'],
  },
  
  // ========== HOLDEN ==========
  'holden': {
    'colorado': ['LS', 'LT', 'LTZ', 'Z71', 'STORM'],
    'commodore': ['EVOKE', 'SV6', 'SS', 'SSV', 'VXR', 'CALAIS'],
    'captiva': ['5', '7', 'LT', 'LTZ'],
    'trailblazer': ['LT', 'LTZ', 'Z71', 'STORM'],
  },
  
  // ========== HYUNDAI ==========
  'hyundai': {
    'tucson': ['ACTIVE', 'ELITE', 'HIGHLANDER', 'N-LINE'],
    'santa fe': ['ACTIVE', 'ELITE', 'HIGHLANDER', 'CALLIGRAPHY'],
    'i30': ['ACTIVE', 'ELITE', 'N-LINE', 'N', 'SEDAN'],
    'kona': ['ACTIVE', 'ELITE', 'HIGHLANDER', 'N-LINE', 'ELECTRIC'],
  },
  
  // ========== KIA ==========
  'kia': {
    'sportage': ['S', 'SX', 'GT-LINE', 'GT'],
    'sorento': ['S', 'SI', 'SLI', 'GT-LINE', 'GT'],
    'cerato': ['S', 'SPORT', 'SPORT+', 'GT'],
    'carnival': ['S', 'SI', 'SLI', 'PLATINUM'],
  },
  
  // ========== SUBARU ==========
  'subaru': {
    'outback': ['AWD', 'PREMIUM', 'TOURING', 'XT'],
    'forester': ['2.5I', '2.5I-L', '2.5I-S', '2.5I-PREMIUM', 'XT'],
    'wrx': ['AWD', 'PREMIUM', 'RS', 'STI'],
    'brz': ['COUPE', 'S', 'TS'],
  },
};

// Noise words to filter out when matching
const NOISE_WORDS = [
  'AUTO', 'AUTOMATIC', 'MANUAL', 'CVT', 'DCT', 'MT', 'AT',
  'DUAL CAB', 'DUALCAB', 'DOUBLE CAB', 'SINGLE CAB', 'EXTRA CAB', 'SPACE CAB', 'CREW CAB',
  '4X4', '4X2', '4WD', '2WD', 'AWD', 'RWD', 'FWD',
  'DIESEL', 'PETROL', 'TURBO', 'TD', 'TDCI', 'HDI', 'TDI',
  'UTE', 'UTILITY', 'WAGON', 'SEDAN', 'HATCH', 'COUPE', 'SUV', 'VAN',
  'MY', 'SERIES',
  'L', 'LTR', 'LITRE',
];

/**
 * Check if a token is a noise word (should be ignored)
 */
function isNoiseWord(token: string): boolean {
  const upper = token.toUpperCase().trim();
  // Check exact match
  if (NOISE_WORDS.includes(upper)) return true;
  // Check if it's a year (4 digits starting with 19 or 20)
  if (/^(19|20)\d{2}$/.test(upper)) return true;
  // Check if it's a numeric engine size like \"2.8\", \"3.0\"
  if (/^\d+\.?\d*$/.test(upper)) return true;
  return false;
}

/**
 * Get variant families for a given make/model
 */
function getModelFamilies(make: string, model: string): string[] {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  const makeData = VARIANT_FAMILIES[makeLower];
  if (!makeData) return [];
  
  // Try exact model match first
  if (makeData[modelLower]) {
    return makeData[modelLower];
  }
  
  // Try partial model match (e.g., \"Ranger\" matches \"ranger\")
  for (const [modelKey, families] of Object.entries(makeData)) {
    if (modelLower.includes(modelKey) || modelKey.includes(modelLower)) {
      return families;
    }
  }
  
  return [];
}

/**
 * Extract variant family from text using model-specific patterns
 * Returns the matched family or null if not found
 */
export function extractVariantFamily(
  make: string,
  model: string,
  variantRaw: string | null | undefined,
  descriptionText?: string
): string | null {
  if (!make || !model) return null;
  
  // Combine all text sources for searching
  const textSources = [variantRaw, descriptionText].filter(Boolean).join(' ');
  if (!textSources.trim()) return null;
  
  // Normalize and tokenize
  const upper = textSources.toUpperCase();
  
  // Get families for this make/model
  const families = getModelFamilies(make, model);
  
  // If no model-specific families, try generic pattern matching
  if (families.length === 0) {
    return extractGenericVariantFamily(upper);
  }
  
  // Sort families by length descending to match longer patterns first
  // (e.g., \"ASCENT SPORT\" before \"ASCENT\")
  const sortedFamilies = [...families].sort((a, b) => b.length - a.length);
  
  for (const family of sortedFamilies) {
    // Use word boundary matching to avoid false positives
    const pattern = new RegExp(`\\b${family.replace(/[+-]/g, '[+-]?')}\\b`, 'i');
    if (pattern.test(upper)) {
      return family.toUpperCase();
    }
  }
  
  return null;
}

/**
 * Generic variant family extraction for unknown models
 * Uses a common list of Australian variant patterns
 */
function extractGenericVariantFamily(text: string): string | null {
  // Generic AU variant families (in priority order, longest first)
  const genericFamilies = [
    // Toyota-style
    'ASCENT SPORT', 'RUGGED X', 'RUGGED-X',
    'SR5', 'GXL', 'GX', 'VX', 'SAHARA', 'KAKADU', 'ROGUE', 'RUGGED', 'WORKMATE',
    // Ford-style
    'WILDTRAK', 'RAPTOR', 'XLT', 'XLS', 'XL', 'TITANIUM', 'PLATINUM', 'AMBIENTE', 'TREND',
    // Isuzu-style
    'X-TERRAIN', 'LS-U', 'LS-M', 'LS-T',
    // Holden-style
    'LTZ', 'LT', 'Z71', 'ZR2', 'STORM',
    // Nissan-style
    'ST-X', 'PRO-4X', 'N-TREK', 'WARRIOR', 'ST-L', 'TI-L',
    // Hyundai/Kia-style
    'HIGHLANDER', 'GT-LINE', 'N-LINE', 'ELITE', 'ACTIVE',
    // General
    'GT', 'GR', 'RS', 'SS', 'SSV', 'SV6', 'XR6', 'XR8',
    'SPORT', 'PREMIUM', 'LUXURY', 'EXECUTIVE',
  ];
  
  for (const family of genericFamilies) {
    const pattern = new RegExp(`\\b${family.replace(/[+-]/g, '[+-]?')}\\b`, 'i');
    if (pattern.test(text)) {
      return family.toUpperCase();
    }
  }
  
  return null;
}

/**
 * Check if a lot is from Pickles source
 */
export function isPicklesSource(sourceName?: string, auctionHouse?: string): boolean {
  const source = (sourceName || '').toLowerCase();
  const ah = (auctionHouse || '').toLowerCase();
  return source.includes('pickles') || ah.includes('pickles') || ah === 'pickles';
}

/**
 * Check if KM should be enforced for this listing
 * Returns false for Pickles (KM optional)
 */
export function shouldEnforceKm(sourceName?: string, auctionHouse?: string): boolean {
  // Pickles: KM is optional, never enforce
  if (isPicklesSource(sourceName, auctionHouse)) {
    return false;
  }
  // Other sources: KM required for Tier-1
  return true;
}

/**
 * Get the KM status for a listing
 */
export function getKmStatus(km: number | null | undefined, sourceName?: string, auctionHouse?: string): 'CONFIRMED' | 'UNKNOWN' {
  // If KM is present and valid (> 0 and < 900000), it's confirmed
  if (km && km > 0 && km < 900000) {
    return 'CONFIRMED';
  }
  // Otherwise unknown
  return 'UNKNOWN';
}
