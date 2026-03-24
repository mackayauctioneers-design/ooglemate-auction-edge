/**
 * Badge extraction from variant_raw strings.
 * Used by all retail ingest edge functions.
 * 
 * Extracts canonical badge, fuel_type, drivetrain, body_type, and engine_type
 * from variant_raw text. Engine extraction delegated to extractEngine module.
 */
import { extractEngine, type EngineExtraction } from "./extractEngine.ts";

// Variant families by make/model — longest patterns first per model
const VARIANT_FAMILIES: Record<string, Record<string, string[]>> = {
  'TOYOTA': {
    'LANDCRUISER': ['SAHARA', 'KAKADU', 'VX', 'GXL', 'GX', 'WORKMATE'],
    'PRADO': ['KAKADU', 'INVINCIBLE', 'ALTITUDE', 'VX', 'GXL', 'GX'],
    'HILUX': ['RUGGED X', 'RUGGED-X', 'ROGUE', 'RUGGED', 'SR5', 'SR', 'GR SPORT', 'WORKMATE'],
    'COROLLA': ['ASCENT SPORT', 'CROSS', 'ZR', 'SX', 'ASCENT', 'GR', 'HYBRID'],
    'CAMRY': ['ASCENT SPORT', 'ATARA', 'SL', 'SX', 'ASCENT'],
    'RAV4': ['EDGE', 'CRUISER', 'GXL', 'GX'],
    'KLUGER': ['GRANDE', 'GXL', 'GX'],
    'FORTUNER': ['CRUSADE', 'GXL', 'GX'],
    'YARIS': ['CROSS', 'ZR', 'SX', 'ASCENT', 'GR'],
    'HIACE': ['COMMUTER', 'SUPER GL', 'GL', 'DX'],
  },
  'FORD': {
    'RANGER': ['WILDTRAK', 'RAPTOR', 'FX4', 'SPORT', 'XLT', 'XLS', 'XL'],
    'EVEREST': ['PLATINUM', 'WILDTRAK', 'TITANIUM', 'SPORT', 'TREND', 'AMBIENTE'],
    'MUSTANG': ['DARK HORSE', 'MACH 1', 'GT', 'ECOBOOST'],
    'TERRITORY': ['TITANIUM', 'GHIA', 'TS', 'TX'],
    'FALCON': ['G6E', 'G6', 'XR8', 'XR6', 'XT'],
    'ESCAPE': ['TITANIUM', 'TREND', 'AMBIENTE'],
    'FOCUS': ['TITANIUM', 'TREND', 'AMBIENTE', 'ST-LINE', 'ST'],
  },
  'ISUZU': {
    'D-MAX': ['X-TERRAIN', 'LS-U+', 'LS-U', 'LS-M', 'LS', 'SX', 'EX'],
    'MU-X': ['LS-T', 'LS-U', 'LS-M', 'LS'],
  },
  'MITSUBISHI': {
    'TRITON': ['EXCEED TOURER', 'BLACKLINE', 'EXCEED', 'GSR', 'GLS', 'GLX+', 'GLX'],
    'PAJERO': ['EXCEED', 'GLS', 'GLX', 'SPORT'],
    'OUTLANDER': ['ASPIRE', 'GSR', 'EXCEED', 'LS', 'ES', 'PHEV'],
    'ASX': ['GSR', 'EXCEED', 'LS', 'ES'],
  },
  'MAZDA': {
    'BT-50': ['THUNDER', 'SP', 'GT', 'XTR', 'XT'],
    'CX-5': ['AKERA', 'GT', 'TOURING', 'MAXX SPORT', 'MAXX'],
    'CX-9': ['AZAMI', 'GT', 'TOURING', 'SPORT'],
    'CX-30': ['ASTINA', 'G25 TOURING', 'G20 TOURING', 'G20 EVOLVE', 'G20 PURE'],
    'MAZDA3': ['SP', 'GT', 'TOURING', 'EVOLVE', 'PURE', 'G25 ASTINA', 'G25 GT'],
    'CX-60': ['AZAMI', 'GT', 'EVOLVE'],
  },
  'NISSAN': {
    'NAVARA': ['PRO-4X', 'WARRIOR', 'N-TREK', 'ST-X', 'ST', 'SL', 'DX'],
    'PATROL': ['TI-L', 'TI', 'WARRIOR'],
    'X-TRAIL': ['TI-L', 'TI', 'N-TREK', 'ST-L', 'ST'],
    'PATHFINDER': ['TI-L', 'TI', 'ST-L', 'ST'],
    'QASHQAI': ['TI', 'N-SPORT', 'ST-L', 'ST'],
  },
  'VOLKSWAGEN': {
    'AMAROK': ['AVENTURA', 'PANAMERICANA', 'STYLE', 'LIFE', 'CORE', 'TDI580', 'TDI550', 'TDI420', 'HIGHLINE', 'TRENDLINE'],
    'GOLF': ['R', 'GTI', 'R-LINE', 'HIGHLINE', 'COMFORTLINE', 'TRENDLINE'],
    'TIGUAN': ['R-LINE', 'HIGHLINE', 'COMFORTLINE', 'TRENDLINE', 'ALLSPACE'],
  },
  'HOLDEN': {
    'COLORADO': ['Z71', 'STORM', 'LTZ', 'LT', 'LS'],
    'COMMODORE': ['SSV', 'SS', 'SV6', 'VXR', 'CALAIS', 'EVOKE'],
    'TRAILBLAZER': ['Z71', 'STORM', 'LTZ', 'LT'],
  },
  'HYUNDAI': {
    'TUCSON': ['N-LINE', 'HIGHLANDER', 'ELITE', 'ACTIVE'],
    'SANTA FE': ['CALLIGRAPHY', 'HIGHLANDER', 'ELITE', 'ACTIVE'],
    'I30': ['N', 'N-LINE', 'ELITE', 'ACTIVE'],
    'KONA': ['N-LINE', 'HIGHLANDER', 'ELITE', 'ACTIVE', 'ELECTRIC'],
    'IONIQ 5': ['TECHNIQ', 'EPIQ', 'DYNAMIQ'],
  },
  'KIA': {
    'SPORTAGE': ['GT', 'GT-LINE', 'SX+', 'SX', 'S'],
    'SORENTO': ['GT', 'GT-LINE', 'SLI', 'SI', 'S'],
    'CERATO': ['GT', 'SPORT+', 'SPORT', 'S'],
    'CARNIVAL': ['PLATINUM', 'SLI', 'SI', 'S'],
    'SELTOS': ['GT-LINE', 'SPORT+', 'SPORT', 'S'],
    'EV6': ['GT', 'GT-LINE', 'AIR'],
  },
  'SUBARU': {
    'OUTBACK': ['XT', 'TOURING', 'PREMIUM', 'AWD'],
    'FORESTER': ['XT', '2.5I-S', '2.5I-PREMIUM', '2.5I-L', '2.5I'],
    'WRX': ['STI', 'RS', 'PREMIUM', 'AWD'],
  },
  'HONDA': {
    'HR-V': ['VTI-LX', 'VTI-S', 'VTI', 'RS'],
    'CR-V': ['VTI-LX7', 'VTI-LX', 'VTI-X', 'VTI-S', 'VTI', 'RS'],
    'CIVIC': ['RS', 'VTI-LX', 'VTI-S', 'VTI-L', 'VTI'],
  },
  'BMW': {
    'X1': ['M SPORT', 'xDRIVE25i', 'xDRIVE20i', 'sDRIVE20i', 'sDRIVE18i', 'xDRIVE18d', 'M35i'],
    'X3': ['M COMPETITION', 'M SPORT', 'xDRIVE30i', 'xDRIVE30d', 'xDRIVE20i', 'xDRIVE20d', 'sDRIVE20i', 'M40i'],
    'X5': ['M COMPETITION', 'M SPORT', 'M50i', 'xDRIVE40i', 'xDRIVE30d', 'xDRIVE25d', 'M50d'],
    'X6': ['M COMPETITION', 'M SPORT', 'M50i', 'xDRIVE40i', 'xDRIVE30d'],
    '1 SERIES': ['M SPORT', 'M PERFORMANCE', '128ti', '120i', '118i', '118d', 'M135i'],
    '2 SERIES': ['M SPORT', 'M240i', '220i', '218i', '218d'],
    '3 SERIES': ['M SPORT', 'M340i', '330i', '330e', '320i', '320d', '318i'],
    '4 SERIES': ['M SPORT', 'M440i', '430i', '420i'],
    '5 SERIES': ['M SPORT', 'M550i', '540i', '530i', '530e', '520i', '520d'],
    'M2': ['COMPETITION', 'CS', 'PURE'],
    'M3': ['COMPETITION', 'CS', 'PURE'],
    'M4': ['COMPETITION', 'CS', 'CSL'],
    'M5': ['COMPETITION', 'CS'],
    'iX': ['M60', 'xDRIVE50', 'xDRIVE40'],
    'iX3': ['M SPORT', 'IMPRESSIVE'],
    'i4': ['M50', 'eDRIVE40', 'eDRIVE35'],
  },
  'MERCEDES-BENZ': {
    'A-CLASS': ['AMG LINE', 'AMG', 'A250', 'A200', 'A180', 'A35', 'A45'],
    'C-CLASS': ['AMG LINE', 'AMG', 'C300', 'C250', 'C220', 'C200', 'C180', 'C63'],
    'C300': ['AMG LINE', 'AMG'],
    'C250': ['AMG LINE', 'AMG'],
    'E-CLASS': ['AMG LINE', 'AMG', 'E300', 'E250', 'E220', 'E200', 'E63'],
    'GLA': ['AMG LINE', 'AMG', 'GLA250', 'GLA200', 'GLA180', 'GLA45'],
    'GLB': ['AMG LINE', 'AMG', 'GLB250', 'GLB200'],
    'GLC': ['AMG LINE', 'AMG', 'GLC300', 'GLC250', 'GLC220', 'GLC63', 'GLC43'],
    'GLE': ['AMG LINE', 'AMG', 'GLE450', 'GLE400', 'GLE350', 'GLE300', 'GLE63', 'GLE53'],
    'GLS': ['AMG', 'GLS450', 'GLS400', 'GLS63'],
    'CLA': ['AMG LINE', 'AMG', 'CLA250', 'CLA200', 'CLA45', 'CLA35'],
    'EQB': ['AMG LINE', 'EQB350', 'EQB300', 'EQB250'],
    'EQA': ['AMG LINE', 'EQA250'],
  },
  'MERCEDES-AMG': {
    'A35': ['4MATIC'],
    'A45': ['S 4MATIC+', '4MATIC+', 'S'],
    'C63': ['S', 'EDITION 1'],
    'E63S': ['4MATIC+'],
    'GLC63': ['S', 'S 4MATIC+'],
    'GLE63': ['S', 'S 4MATIC+'],
    'GT': ['R', 'S', 'C', 'BLACK SERIES'],
  },
  'AUDI': {
    'A1': ['S LINE', 'SPORT', 'SPORTBACK'],
    'A3': ['S LINE', 'SPORT', 'RS3'],
    'A4': ['S LINE', 'SPORT', 'AVANT', 'RS4'],
    'A5': ['S LINE', 'SPORT', 'SPORTBACK', 'RS5'],
    'Q3': ['S LINE', 'SPORT', 'SPORTBACK', 'RS Q3'],
    'Q5': ['S LINE', 'SPORT', 'SPORTBACK', 'SQ5'],
    'Q7': ['S LINE', 'SPORT', 'SQ7'],
    'Q8': ['S LINE', 'SPORT', 'SQ8', 'RSQ8', 'RS Q8'],
    'E-TRON': ['S LINE', 'SPORT', 'GT'],
  },
  'LAND ROVER': {
    'RANGE ROVER SPORT': ['AUTOBIOGRAPHY', 'HSE DYNAMIC', 'HSE', 'SE', 'SVR', 'P400', 'P530'],
    'RANGE ROVER EVOQUE': ['AUTOBIOGRAPHY', 'R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'HSE', 'SE', 'S'],
    'RANGE ROVER VELAR': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'HSE', 'SE', 'S'],
    'DEFENDER': ['X', 'V8', 'HSE', 'SE', 'S', '110', '90', '130'],
    'DISCOVERY': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'HSE', 'SE', 'S'],
    'DISCOVERY SPORT': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'HSE', 'SE', 'S'],
  },
  'RANGE ROVER': {
    'EVOQUE': ['AUTOBIOGRAPHY', 'R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'HSE', 'SE', 'S'],
    'SPORT': ['AUTOBIOGRAPHY', 'HSE DYNAMIC', 'HSE', 'SE', 'SVR'],
    'VELAR': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'HSE', 'SE', 'S'],
  },
  'JAGUAR': {
    'F-PACE': ['SVR', 'R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'PORTFOLIO', 'HSE', 'SE', 'S'],
    'E-PACE': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'HSE', 'SE', 'S'],
    'F-TYPE': ['SVR', 'R-DYNAMIC', 'R', 'P380', 'P300'],
    'XE': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'PORTFOLIO', 'HSE', 'SE', 'S'],
    'XF': ['R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC', 'PORTFOLIO', 'HSE', 'SE', 'S'],
  },
  'VOLVO': {
    'XC40': ['ULTIMATE', 'PLUS', 'CORE', 'MOMENTUM', 'INSCRIPTION', 'R-DESIGN'],
    'XC60': ['ULTIMATE', 'PLUS', 'CORE', 'MOMENTUM', 'INSCRIPTION', 'R-DESIGN', 'POLESTAR'],
    'XC90': ['ULTIMATE', 'PLUS', 'CORE', 'MOMENTUM', 'INSCRIPTION', 'R-DESIGN'],
    'S60': ['POLESTAR', 'INSCRIPTION', 'R-DESIGN', 'MOMENTUM'],
    'V60': ['POLESTAR', 'INSCRIPTION', 'R-DESIGN', 'CROSS COUNTRY'],
  },
  'MINI': {
    '5D HATCH': ['JCW', 'COOPER S', 'COOPER', 'ONE'],
    '3D HATCH': ['JCW', 'COOPER S', 'COOPER', 'ONE'],
    'COUNTRYMAN': ['JCW', 'COOPER S', 'COOPER', 'ONE'],
    'CLUBMAN': ['JCW', 'COOPER S', 'COOPER', 'ONE'],
    'CONVERTIBLE': ['JCW', 'COOPER S', 'COOPER'],
  },
  'PORSCHE': {
    'CAYENNE': ['TURBO GT', 'TURBO S', 'TURBO', 'GTS', 'S', 'E-HYBRID'],
    'MACAN': ['GTS', 'TURBO', 'S', 'T'],
    '911': ['TURBO S', 'TURBO', 'GT3 RS', 'GT3', 'GTS', 'TARGA', 'CARRERA S', 'CARRERA'],
    'TAYCAN': ['TURBO S', 'TURBO', 'GTS', '4S', '4 CROSS TURISMO'],
  },
  'RENAULT': {
    'KOLEOS': ['INTENS', 'ZEN', 'LIFE', 'FORMULA EDITION'],
    'MEGANE': ['RS', 'GT', 'INTENS', 'ZEN', 'LIFE'],
    'CAPTUR': ['INTENS', 'ZEN', 'LIFE'],
  },
  'SUZUKI': {
    'JIMNY': ['GLX', 'GL'],
    'SWIFT': ['SPORT', 'GLX TURBO', 'GLX', 'GL'],
    'VITARA': ['TURBO', 'GLX', 'GL'],
  },
};

// Generic fallback patterns (longest first)
const GENERIC_BADGES = [
  'ASCENT SPORT', 'RUGGED X', 'RUGGED-X', 'GR SPORT', 'EXCEED TOURER',
  'MAXX SPORT', 'GT-LINE', 'N-LINE', 'N-TREK', 'ST-X', 'ST-L', 'TI-L',
  'PRO-4X', 'X-TERRAIN', 'LS-U+', 'LS-U', 'LS-M', 'LS-T', 'R-LINE',
  'DARK HORSE', 'MACH 1', 'F SPORT',
  'WILDTRAK', 'RAPTOR', 'SAHARA', 'KAKADU', 'HIGHLANDER', 'CALLIGRAPHY',
  'PANAMERICANA', 'AVENTURA', 'PLATINUM', 'TITANIUM',
  'SR5', 'GXL', 'GX', 'VX', 'XLT', 'XLS', 'XL', 'GLX+', 'GLX',
  'GLS', 'GSR', 'WORKMATE', 'ROGUE', 'RUGGED',
  'LTZ', 'LT', 'Z71', 'STORM',
  'AKERA', 'AZAMI', 'TOURING', 'WARRIOR',
  'ELITE', 'ACTIVE', 'EXCEED', 'ASPIRE',
  'AMBIENTE', 'TREND', 'SPORT', 'PREMIUM', 'LUXURY',
  'GT', 'GR', 'RS', 'SS', 'SSV', 'SV6', 'XR6', 'XR8',
  'S', 'SI', 'SLI', 'SX', 'ST',
  // Honda
  'VTI-LX7', 'VTI-LX', 'VTI-X', 'VTI-S', 'VTI-L', 'VTI',
  // European generics (longest first)
  'M COMPETITION', 'M PERFORMANCE', 'M SPORT', 'AMG LINE', 'S LINE',
  'R-DYNAMIC HSE', 'R-DYNAMIC SE', 'R-DYNAMIC S', 'R-DYNAMIC',
  'HSE DYNAMIC', 'AUTOBIOGRAPHY', 'INSCRIPTION', 'R-DESIGN',
  'COOPER S', 'TURBO GT', 'TURBO S',
  'COMPETITION', 'PORTFOLIO', 'POLESTAR',
  'ULTIMATE', 'HSE', 'SE', 'AMG', 'JCW', 'COOPER',
  'INTENS', 'ZEN',
];

export interface BadgeExtraction {
  badge: string | null;
  fuel_type: string | null;
  drivetrain: string | null;
  body_type: string | null;
  engine_type: string | null;
  engine_confidence: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Extract canonical badge from variant_raw text
 */
export function extractBadge(
  make: string,
  model: string,
  variantRaw: string | null | undefined,
  titleText?: string | null,
): BadgeExtraction {
  const result: BadgeExtraction = {
    badge: null,
    fuel_type: null,
    drivetrain: null,
    body_type: null,
    engine_type: null,
    engine_confidence: "LOW",
  };

  const text = [variantRaw, titleText].filter(Boolean).join(' ').toUpperCase();
  if (!text.trim()) return result;

  const makeUpper = (make || '').toUpperCase().trim();
  const modelUpper = (model || '').toUpperCase().trim();

  // --- Extract engine (first-class attribute) ---
  const eng = extractEngine(make, model, variantRaw, titleText);
  result.engine_type = eng.engine_type;
  result.engine_confidence = eng.engine_confidence;
  if (eng.fuel_type_hint && !result.fuel_type) {
    result.fuel_type = eng.fuel_type_hint;
  }

  // --- Extract fuel type ---
  if (/\bHYBRID\b/i.test(text) || /\bPHEV\b/i.test(text) || /\bHEV\b/i.test(text)) {
    result.fuel_type = 'HYBRID';
  } else if (/\bELECTRIC\b/i.test(text) || /\bEV\b/i.test(text) || /\bBEV\b/i.test(text)) {
    result.fuel_type = 'ELECTRIC';
  } else if (/\bDIESEL\b/i.test(text) || /\bTD\b/i.test(text) || /\bTDI\b/i.test(text) || /\bCRD\b/i.test(text)) {
    result.fuel_type = 'DIESEL';
  }

  // --- Extract drivetrain ---
  if (/\b4[Xx×]4\b/.test(text) || /\b4WD\b/i.test(text) || /\bAWD\b/i.test(text) || /\b4MOTION\b/i.test(text) || /\bQUATTRO\b/i.test(text) || /\bXDRIVE\b/i.test(text)) {
    result.drivetrain = '4WD';
  } else if (/\b4[Xx×]2\b/.test(text) || /\b2WD\b/i.test(text) || /\bFWD\b/i.test(text) || /\bRWD\b/i.test(text)) {
    result.drivetrain = '2WD';
  }

  // --- Extract body type ---
  if (/\bDUAL\s*CAB\b/i.test(text) || /\bDOUBLE\s*CAB\b/i.test(text) || /\bCREW\s*CAB\b/i.test(text)) {
    result.body_type = 'DUAL_CAB';
  } else if (/\bSINGLE\s*CAB\b/i.test(text) || /\bSCAB\b/i.test(text)) {
    result.body_type = 'SINGLE_CAB';
  } else if (/\bEXTRA\s*CAB\b/i.test(text) || /\bSPACE\s*CAB\b/i.test(text) || /\bFREESTYLE\b/i.test(text)) {
    result.body_type = 'EXTRA_CAB';
  } else if (/\bWAGON\b/i.test(text)) {
    result.body_type = 'WAGON';
  } else if (/\bSEDAN\b/i.test(text)) {
    result.body_type = 'SEDAN';
  } else if (/\bHATCH/i.test(text)) {
    result.body_type = 'HATCH';
  } else if (/\bSUV\b/i.test(text)) {
    result.body_type = 'SUV';
  } else if (/\bVAN\b/i.test(text) || /\bCOMMUTER\b/i.test(text)) {
    result.body_type = 'VAN';
  } else if (/\bCOUPE\b/i.test(text)) {
    result.body_type = 'COUPE';
  } else if (/\bCONVERTIBLE\b/i.test(text) || /\bCABRIOLET\b/i.test(text)) {
    result.body_type = 'CONVERTIBLE';
  }

  // --- Extract badge ---
  // Try make/model specific families first
  const modelFamilies = VARIANT_FAMILIES[makeUpper]?.[modelUpper];
  if (modelFamilies) {
    for (const badge of modelFamilies) {
      const escaped = badge.replace(/[+]/g, '\\+').replace(/[-]/g, '[\\-]?');
      const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
      if (pattern.test(text)) {
        result.badge = badge.toUpperCase();
        return result;
      }
    }
  }

  // Fall back to generic badge list
  for (const badge of GENERIC_BADGES) {
    const escaped = badge.replace(/[+]/g, '\\+').replace(/[-]/g, '[\\-]?');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (pattern.test(text)) {
      result.badge = badge.toUpperCase();
      return result;
    }
  }

  return result;
}
