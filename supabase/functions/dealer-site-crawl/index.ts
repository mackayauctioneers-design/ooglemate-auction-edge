import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================================================
// DEALER CONFIGURATION - HARDENED WITH PARSER MODES
// =============================================================================

type ParserMode = 'digitaldealer' | 'adtorque' | 'jsonld_detail' | 'unknown';
type DealerPriority = 'high' | 'normal' | 'low';

interface DealerConfig {
  name: string;
  slug: string;              // Used for source_name: "dealer_site:{slug}"
  inventory_url: string;     // Direct inventory page URL
  suburb: string;            // Dealer suburb
  state: string;             // Dealer state
  postcode: string;          // Dealer postcode
  region: string;            // Geo-liquidity region bucket
  parser_mode: ParserMode;   // REQUIRED: which parser to use
  enabled: boolean;          // Whether to include in cron runs
  anchor_dealer: boolean;    // Primary dealer for this region
  priority: DealerPriority;  // Crawl priority (high = always first, stricter monitoring)
}

// Central Coast NSW dealers - Data Density Phase (40+ dealers)
const DEALERS: DealerConfig[] = [
  // ==========================================================================
  // ANCHOR DEALER (High Priority)
  // ==========================================================================
  {
    name: "Brian Hilton Toyota",
    slug: "brian-hilton-toyota",
    inventory_url: "https://brianhiltontoyota.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: true,
    priority: 'high',
  },

  // ==========================================================================
  // BRIAN HILTON GROUP (same platform - 7 dealers)
  // ==========================================================================
  {
    name: "Brian Hilton Kia",
    slug: "brian-hilton-kia",
    inventory_url: "https://brianhiltonkia.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Brian Hilton Honda",
    slug: "brian-hilton-honda",
    inventory_url: "https://brianhiltonhonda.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Brian Hilton Suzuki",
    slug: "brian-hilton-suzuki",
    inventory_url: "https://brianhiltonsuzuki.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Brian Hilton Renault",
    slug: "brian-hilton-renault",
    inventory_url: "https://brianhiltonrenault.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Brian Hilton GWM Haval",
    slug: "brian-hilton-gwm",
    inventory_url: "https://brianhiltongwmhaval.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Brian Hilton Skoda",
    slug: "brian-hilton-skoda",
    inventory_url: "https://brianhiltonskoda.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Brian Hilton LDV",
    slug: "brian-hilton-ldv",
    inventory_url: "https://brianhiltonldv.com.au/used-cars/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // CENTRAL COAST MOTOR GROUP (ccmg.com.au - 7 dealers) - AdTorque platform
  // ==========================================================================
  {
    name: "Central Coast Motor Group",
    slug: "ccmg",
    inventory_url: "https://www.ccmg.com.au/stock?condition=Used",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Gosford Mazda",
    slug: "gosford-mazda",
    inventory_url: "https://gosfordmazda.com.au/stock?condition=Used",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Coast Subaru",
    slug: "central-coast-subaru",
    inventory_url: "https://www.ccsubaru.com.au/stock?condition=Used",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Coast Volkswagen",
    slug: "central-coast-vw",
    inventory_url: "https://www.ccvolkswagen.com.au/stock?condition=Used",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Coast Isuzu UTE",
    slug: "central-coast-isuzu",
    inventory_url: "https://www.ccisuzuute.com.au/stock?condition=Used",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Chery Gosford",
    slug: "chery-gosford",
    inventory_url: "https://www.cherygosford.com.au/stock?condition=Used",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Mercedes-Benz Gosford",
    slug: "mercedes-gosford",
    inventory_url: "https://www.mbgosford.com.au/vehicles/used/",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'adtorque',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // CENTRAL AUTO GROUP (5 dealers)
  // ==========================================================================
  {
    name: "Central Auto Mazda",
    slug: "central-auto-mazda",
    inventory_url: "https://www.centralautogroup.com.au/our-stock/",
    suburb: "Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Auto Hyundai",
    slug: "central-auto-hyundai",
    inventory_url: "https://www.centralcoasthyundai.com.au/our-stock/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Auto Mitsubishi",
    slug: "central-auto-mitsubishi",
    inventory_url: "https://www.centralcoastmitsubishi.com.au/our-stock/",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Auto Ford",
    slug: "central-auto-ford",
    inventory_url: "https://www.centralcoastford.com.au/stock/",
    suburb: "North Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // COAST FORD GROUP
  // ==========================================================================
  {
    name: "Coast Ford",
    slug: "coast-ford",
    inventory_url: "https://www.coastford.com.au/stock/",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // CENTRAL COAST AUTOMOTIVE GROUP
  // ==========================================================================
  {
    name: "Central Coast Hyundai",
    slug: "central-coast-hyundai",
    inventory_url: "https://www.ccauto.com.au/all-stock/",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Central Coast Nissan",
    slug: "central-coast-nissan",
    inventory_url: "https://www.centralcoastnissan.com.au/used-vehicles/",
    suburb: "West Gosford",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // TUGGERAH AUTO GROUP (4 dealers)
  // ==========================================================================
  {
    name: "Tuggerah Hyundai",
    slug: "tuggerah-hyundai",
    inventory_url: "https://www.tuggerahhyundai.com.au/our-stock/",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2259",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Tuggerah Mitsubishi",
    slug: "tuggerah-mitsubishi",
    inventory_url: "https://www.tuggerahmitsubishi.com.au/our-stock/",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2259",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Tuggerah Auto Group",
    slug: "tuggerah-auto-group",
    inventory_url: "https://www.tuggerahautogroup.com.au/our-stock/used-cars-for-sale-in-tuggerah/",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2259",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // TUGGERAH INDEPENDENTS
  // ==========================================================================
  {
    name: "Coastwide Cars",
    slug: "coastwide-cars",
    inventory_url: "https://www.coastwidecars.com.au/used-cars-tuggerah/",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2259",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Coastal Quality Cars",
    slug: "coastal-quality-cars",
    inventory_url: "https://www.coastalqualitycars.com.au/used-cars/",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2259",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Surfside Motors",
    slug: "surfside-motors",
    inventory_url: "https://www.surfsidemotors.com.au/our-stock/",
    suburb: "Tuggerah",
    state: "NSW",
    postcode: "2258",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // WYONG DEALERS
  // ==========================================================================
  {
    name: "Wyong Motor Group",
    slug: "wyong-motor-group",
    inventory_url: "https://www.wyongmotorgroup.com.au/used-vehicles/",
    suburb: "Wyong",
    state: "NSW",
    postcode: "2259",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // ERINA / WOY WOY DEALERS
  // ==========================================================================
  {
    name: "Phil Gilbert Toyota Erina",
    slug: "phil-gilbert-toyota-erina",
    inventory_url: "https://www.philgilberttoyotaerina.com.au/used-cars/",
    suburb: "Erina",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Carrs Cars Erina",
    slug: "carrs-cars-erina",
    inventory_url: "https://www.carrscars.com.au/stock-all/",
    suburb: "Erina",
    state: "NSW",
    postcode: "2250",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // CARDIFF/CHARLESTOWN (Hunter adjacent but services CC)
  // ==========================================================================
  {
    name: "Cardiff Motor Group",
    slug: "cardiff-motor-group",
    inventory_url: "https://cardiffmotorgroup.com.au/all-stock/",
    suburb: "Cardiff",
    state: "NSW",
    postcode: "2285",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Cardiff Ford",
    slug: "cardiff-ford",
    inventory_url: "https://www.cardiffford.com.au/stock/",
    suburb: "Cardiff",
    state: "NSW",
    postcode: "2285",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Cardiff Hyundai",
    slug: "cardiff-hyundai",
    inventory_url: "https://www.cardiffhyundai.com.au/our-stock/",
    suburb: "Cardiff",
    state: "NSW",
    postcode: "2285",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Cardiff Nissan",
    slug: "cardiff-nissan",
    inventory_url: "https://www.cardiffnissan.com.au/our-stock/",
    suburb: "Cardiff",
    state: "NSW",
    postcode: "2285",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Cardiff Honda",
    slug: "cardiff-honda",
    inventory_url: "https://www.cardiffhonda.com.au/our-stock/",
    suburb: "Cardiff",
    state: "NSW",
    postcode: "2285",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },

  // ==========================================================================
  // ADDITIONAL CENTRAL COAST DEALERS
  // ==========================================================================
  {
    name: "Brian Hilton Woy Woy",
    slug: "brian-hilton-woy-woy",
    inventory_url: "https://brianhiltonwoywoy.com.au/used-cars/",
    suburb: "Woy Woy",
    state: "NSW",
    postcode: "2256",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'normal',
  },
  {
    name: "Newcastle Toyota",
    slug: "newcastle-toyota",
    inventory_url: "https://www.newcastletoyota.com.au/used-cars/",
    suburb: "Hamilton",
    state: "NSW",
    postcode: "2303",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'low',
  },
  {
    name: "Hunter Honda",
    slug: "hunter-honda",
    inventory_url: "https://www.hunterhonda.com.au/used-cars/",
    suburb: "Lambton",
    state: "NSW",
    postcode: "2299",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'low',
  },
  {
    name: "Hunter Mazda",
    slug: "hunter-mazda",
    inventory_url: "https://www.huntermazda.com.au/stock?condition=Used",
    suburb: "Lambton",
    state: "NSW",
    postcode: "2299",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'low',
  },
  {
    name: "Kloster Ford",
    slug: "kloster-ford",
    inventory_url: "https://www.klosterford.com.au/stock/",
    suburb: "Hamilton",
    state: "NSW",
    postcode: "2303",
    region: "CENTRAL_COAST_NSW",
    parser_mode: 'digitaldealer',
    enabled: true,
    anchor_dealer: false,
    priority: 'low',
  },
];

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_YEAR = 2016;  // Year focus for dealer-grade
const MIN_PRICE = 3000;
const MAX_PRICE = 150000;

// =============================================================================
// VEHICLE PARSING FROM SCRAPED DATA
// =============================================================================

interface ScrapedVehicle {
  source_listing_id: string;
  make: string;
  model: string;
  year: number;
  variant_raw?: string;
  km?: number;
  price?: number;
  transmission?: string;
  fuel?: string;
  listing_url: string;
  suburb: string;
  state: string;
  postcode: string;
  seller_hints: {
    seller_badge: 'dealer';
    seller_name: string;
    has_abn: boolean;
    has_dealer_keywords: boolean;
  };
}

interface QualityGateResult {
  passed: ScrapedVehicle[];
  dropped: number;
  dropReasons: Record<string, number>;
}

/**
 * Generate a stable hash from a string (for URL-based IDs)
 */
function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if source_listing_id looks like a VIN or stable stock number
 * VINs are 17 chars, stock numbers are typically 4-24 chars alphanumeric with hyphens
 */
function isStableId(id: string): boolean {
  if (!id || id.length < 4) return false;
  // VIN (17 chars, alphanumeric, no I/O/Q)
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(id)) return true;
  // VIN-based ID (vin-XXXXXXXX)
  if (/^vin-[A-HJ-NPR-Z0-9]{6,}$/i.test(id)) return true;
  // Stock number with hyphens (e.g., U002398-1731084) - 4-24 chars alphanumeric with hyphens
  if (/^[A-Z0-9][A-Z0-9\-]{3,23}$/i.test(id)) return true;
  // Numeric stock number
  if (/^\d{4,10}$/.test(id)) return true;
  return false;
}

/**
 * Pre-ingest quality gate - enforces STRICT requirements for NSW_SYDNEY_METRO ramp
 */
function applyQualityGate(vehicles: ScrapedVehicle[]): QualityGateResult {
  const passed: ScrapedVehicle[] = [];
  const dropReasons: Record<string, number> = {};
  
  const addDropReason = (reason: string) => {
    dropReasons[reason] = (dropReasons[reason] || 0) + 1;
  };

  for (const v of vehicles) {
    // GATE 1: Must have source_listing_id
    if (!v.source_listing_id || v.source_listing_id.trim() === '') {
      addDropReason('missing_source_listing_id');
      continue;
    }
    
    // GATE 2: Require VIN or stable stock number (stricter for Sydney ramp)
    if (!isStableId(v.source_listing_id)) {
      addDropReason('unstable_source_id');
      continue;
    }
    
    // GATE 3: Must have listing_url (detail page)
    if (!v.listing_url || v.listing_url.trim() === '') {
      addDropReason('missing_listing_url');
      continue;
    }
    
    // GATE 4: Classifieds REQUIRE price
    if (v.price === undefined || v.price === null || v.price <= 0) {
      addDropReason('missing_price');
      continue;
    }
    
    // GATE 5: Price must be in range ($3k-$150k)
    if (v.price < MIN_PRICE || v.price > MAX_PRICE) {
      addDropReason('price_out_of_range');
      continue;
    }
    
    // GATE 6: Year must be 2016+ for dealer-grade focus
    if (v.year < MIN_YEAR) {
      addDropReason('year_below_2016');
      continue;
    }
    
    // GATE 7: Basic make/model validation
    if (!v.make || !v.model || v.make.length < 2 || v.model.length < 1) {
      addDropReason('invalid_make_model');
      continue;
    }
    
    // GATE 8: Model must NOT equal make (strict validation)
    if (v.make.toLowerCase() === v.model.toLowerCase()) {
      addDropReason('model_equals_make');
      continue;
    }
    
    passed.push(v);
  }
  
  return {
    passed,
    dropped: vehicles.length - passed.length,
    dropReasons,
  };
}

/**
 * Parse vehicles from HTML using data attributes (DigitalDealer platform pattern)
 */
function parseVehiclesFromDigitalDealer(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  const stockItemPattern = /<div[^>]+class="[^"]*stockListItemView[^"]*"[^>]+data-stocknumber="([^"]+)"[^>]+data-stockid="([^"]+)"[^>]*data-stockprice="([^"]*)"[^>]*data-stockyear="([^"]+)"[^>]*data-stockmake="([^"]+)"[^>]*data-stockmodel="([^"]+)"[^>]*/gi;
  
  let match;
  const processedStockNumbers = new Set<string>();
  
  while ((match = stockItemPattern.exec(html)) !== null) {
    const stockNumber = match[1];
    const stockId = match[2];
    const priceStr = match[3];
    const yearStr = match[4];
    const make = match[5];
    const model = match[6];
    
    if (processedStockNumbers.has(stockNumber)) continue;
    processedStockNumbers.add(stockNumber);
    
    const year = parseInt(yearStr);
    const price = priceStr ? parseInt(priceStr) : undefined;
    
    if (!make || !model || !year || year < 1990 || year > 2030) continue;
    
    // Find detail URL
    const urlPattern = new RegExp(`href="([^"]+${stockNumber.toLowerCase()}-${stockId}[^"]+)"`, 'i');
    const urlMatch = urlPattern.exec(html);
    
    if (!urlMatch) {
      console.log(`[dealer-site-crawl] Skipping ${stockNumber}: no detail URL found`);
      continue;
    }
    
    let detailUrl = urlMatch[1];
    if (detailUrl.startsWith('/')) {
      const baseUrl = new URL(dealer.inventory_url);
      detailUrl = `${baseUrl.origin}${detailUrl}`;
    }
    
    vehicles.push({
      source_listing_id: stockNumber,
      make,
      model,
      year,
      price,
      listing_url: detailUrl,
      suburb: dealer.suburb,
      state: dealer.state,
      postcode: dealer.postcode,
      seller_hints: {
        seller_badge: 'dealer',
        seller_name: dealer.name,
        has_abn: true,
        has_dealer_keywords: true,
      }
    });
  }
  
  console.log(`[dealer-site-crawl] Parsed ${vehicles.length} vehicles from DigitalDealer HTML`);
  return vehicles;
}

/**
 * Parse vehicles from AdTorque Edge platform HTML
 * Used by CCMG dealers (Gosford Mazda, Central Coast Subaru, etc.)
 * 
 * AdTorque HTML structure:
 * <div class="stock-item" data-stockno="68046" data-vin="...">
 *   <a href="/stock/details/...">
 *     <div class="si-title">
 *       <span class="year">2021</span>
 *       <span class="make">Mazda</span>
 *       <span class="model">CX-5</span>
 *       <span class="badge">Touring</span>
 *     </div>
 *     <div class="si-details">
 *       <span class="odometer">47,016 km</span>
 *       <span class="transmission">Automatic</span>
 *       <span class="fuel">2.5L Petrol</span>
 *     </div>
 *     <span class="price-value">$58,990</span>
 *   </a>
 * </div>
 */
function parseVehiclesFromAdTorque(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  const processedIds = new Set<string>();
  
  // Debug: Check if we have stock-item at all
  const hasStockItem = html.includes('stock-item');
  const hasDataStockno = html.includes('data-stockno');
  console.log(`[dealer-site-crawl] AdTorque debug: hasStockItem=${hasStockItem}, hasDataStockno=${hasDataStockno}, htmlLen=${html.length}`);
  
  // Pattern: Match stock-item div with data-stockno
  // The class might come before or after other attributes
  // Try multiple patterns
  let matches: Array<{stockNumber: string, index: number}> = [];
  
  // Pattern 1: class before data-stockno
  const pattern1 = /<div[^>]+class="[^"]*stock-item[^"]*"[^>]*data-stockno="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = pattern1.exec(html)) !== null) {
    matches.push({ stockNumber: match[1], index: match.index });
  }
  
  // Pattern 2: data-stockno before class (some sites order differently)
  if (matches.length === 0) {
    const pattern2 = /<div[^>]+data-stockno="([^"]+)"[^>]*class="[^"]*stock-item[^"]*"[^>]*>/gi;
    while ((match = pattern2.exec(html)) !== null) {
      matches.push({ stockNumber: match[1], index: match.index });
    }
  }
  
  // Pattern 3: Just look for data-stockno on any div
  if (matches.length === 0) {
    const pattern3 = /<div[^>]+data-stockno="([^"]+)"[^>]*>/gi;
    while ((match = pattern3.exec(html)) !== null) {
      matches.push({ stockNumber: match[1], index: match.index });
    }
  }
  
  console.log(`[dealer-site-crawl] AdTorque found ${matches.length} stock items`);
  
  for (const m of matches) {
    const stockNumber = m.stockNumber;
    const startIdx = m.index;
    // Increase window to 8000 chars to capture price section which is further down
    const itemHtml = html.slice(startIdx, startIdx + 8000);
    
    // Try to find data-vin within the opening tag
    const vinMatch = /data-vin="([^"]+)"/.exec(itemHtml.slice(0, 300));
    const vin = vinMatch ? vinMatch[1] : '';
    
    // Use VIN if long enough, otherwise stockno
    const sourceId = vin && vin.length > 10 ? vin : stockNumber;
    if (processedIds.has(sourceId)) continue;
    processedIds.add(sourceId);
    
    const vehicle = parseAdTorqueItem(itemHtml, sourceId, dealer);
    if (vehicle) vehicles.push(vehicle);
  }
  
  console.log(`[dealer-site-crawl] Parsed ${vehicles.length} vehicles from AdTorque HTML`);
  return vehicles;
}

/**
 * Extract vehicle data from a single AdTorque item HTML window
 */
/**
 * Sanity checks for parsed vehicle data
 */
function isValidYear(year: number): boolean {
  return year >= 2016 && year <= 2030;
}

function isValidMake(make: string): boolean {
  if (!make || make.length < 2) return false;
  // Must be mostly alphabetic (allow spaces, hyphens for e.g. "Land Rover")
  return /^[a-zA-Z][a-zA-Z\s\-]*$/.test(make);
}

function isValidModel(model: string): boolean {
  // Model can have numbers (e.g. CX-5, 3 Series, 86)
  return !!model && model.length >= 1 && model.length <= 50;
}

function makeNotEqualsModel(make: string, model: string): boolean {
  return make.toLowerCase() !== model.toLowerCase();
}

/**
 * Extract vehicle data from a single AdTorque item HTML window
 * Uses ORDERED span extraction from title container
 * 
 * Expected AdTorque HTML structure:
 * <div class="si-title">
 *   <span class="year">2021</span>
 *   <span class="make">Mazda</span>
 *   <span class="model">CX-5</span>
 *   <span class="badge">Touring</span>  <!-- optional -->
 * </div>
 */
function parseAdTorqueItem(itemHtml: string, sourceId: string, dealer: DealerConfig): ScrapedVehicle | null {
  let year: number | undefined;
  let make: string | undefined;
  let model: string | undefined;
  let variant: string | undefined;
  
  // =========================================================================
  // STRATEGY 1: Find si-title container and extract ORDERED spans by class
  // =========================================================================
  // Look for the title container (si-title, vehicle-title, stock-title)
  const titleContainerPatterns = [
    /<(?:div|a)[^>]*class="[^"]*si-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a)>/i,
    /<(?:div|a)[^>]*class="[^"]*vehicle-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a)>/i,
    /<(?:div|a)[^>]*class="[^"]*stock-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a)>/i,
  ];
  
  for (const pattern of titleContainerPatterns) {
    const containerMatch = pattern.exec(itemHtml);
    if (containerMatch) {
      const containerHtml = containerMatch[1];
      
      // Extract spans by their specific classes (NOT generic matching)
      const yearMatch = /<span[^>]*class="[^"]*year[^"]*"[^>]*>(\d{4})<\/span>/i.exec(containerHtml);
      const makeMatch = /<span[^>]*class="[^"]*make[^"]*"[^>]*>([^<]+)<\/span>/i.exec(containerHtml);
      const modelMatch = /<span[^>]*class="[^"]*model[^"]*"[^>]*>([^<]+)<\/span>/i.exec(containerHtml);
      const badgeMatch = /<span[^>]*class="[^"]*badge[^"]*"[^>]*>([^<]+)<\/span>/i.exec(containerHtml);
      
      if (yearMatch) year = parseInt(yearMatch[1]);
      if (makeMatch) make = makeMatch[1].trim();
      if (modelMatch) model = modelMatch[1].trim();
      if (badgeMatch) variant = badgeMatch[1].trim();
      
      // If we got year, make, and model from the container, stop looking
      if (year && make && model) break;
    }
  }
  
  // =========================================================================
  // STRATEGY 2: Extract from si-title link's title attribute
  // HTML: <a class="si-title" href="..." title="2022 Jeep Wrangler Rubicon Auto 4x4 MY22">
  // =========================================================================
  if (!year || !make || !model) {
    const titleAttrMatch = /class="[^"]*si-title[^"]*"[^>]+title="(\d{4})\s+([A-Za-z][A-Za-z\-\s]*)\s+(\S+)([^"]*)"/i.exec(itemHtml);
    if (titleAttrMatch) {
      const parsedYear = parseInt(titleAttrMatch[1]);
      const parsedMake = titleAttrMatch[2].trim();
      const parsedModel = titleAttrMatch[3].trim();
      const parsedVariant = titleAttrMatch[4]?.trim() || undefined;
      
      // Apply sanity checks before accepting
      if (!year && isValidYear(parsedYear)) year = parsedYear;
      if (!make && isValidMake(parsedMake)) make = parsedMake;
      if (!model && isValidModel(parsedModel)) model = parsedModel;
      if (!variant && parsedVariant) variant = parsedVariant;
    }
  }
  
  // =========================================================================
  // STRATEGY 3: Parse from image alt text
  // HTML: <img ... alt="2022 Jeep Wrangler Rubicon Auto 4x4 MY22" ...>
  // =========================================================================
  if (!year || !make || !model) {
    const altMatch = /alt="(\d{4})\s+([A-Za-z][A-Za-z\-\s]*)\s+(\S+)([^"]*)"/i.exec(itemHtml);
    if (altMatch) {
      const parsedYear = parseInt(altMatch[1]);
      const parsedMake = altMatch[2].trim();
      const parsedModel = altMatch[3].trim();
      const parsedVariant = altMatch[4]?.trim() || undefined;
      
      if (!year && isValidYear(parsedYear)) year = parsedYear;
      if (!make && isValidMake(parsedMake)) make = parsedMake;
      if (!model && isValidModel(parsedModel)) model = parsedModel;
      if (!variant && parsedVariant) variant = parsedVariant;
    }
  }
  
  // =========================================================================
  // SANITY CHECKS - reject if invalid
  // =========================================================================
  if (!year || !make || !model) {
    console.log(`[dealer-site-crawl] ${sourceId}: parse failed - missing required fields year=${year} make=${make} model=${model}`);
    return null;
  }
  
  if (!isValidYear(year)) {
    console.log(`[dealer-site-crawl] ${sourceId}: parse failed - year ${year} out of range 2016-2030`);
    return null;
  }
  
  if (!isValidMake(make)) {
    console.log(`[dealer-site-crawl] ${sourceId}: parse failed - make '${make}' not alphabetic`);
    return null;
  }
  
  if (!isValidModel(model)) {
    console.log(`[dealer-site-crawl] ${sourceId}: parse failed - model '${model}' invalid`);
    return null;
  }
  
  if (!makeNotEqualsModel(make, model)) {
    console.log(`[dealer-site-crawl] ${sourceId}: parse failed - make '${make}' equals model`);
    return null;
  }
  
  // =========================================================================
  // EXTRACT PRICE - multiple patterns for flexibility
  // =========================================================================
  let price: number | undefined;
  const pricePatterns = [
    /<span[^>]*class="[^"]*price-value[^"]*"[^>]*>\s*\$?([\d,]+)/i,
    /class="[^"]*price[^"]*"[^>]*>\s*\$?([\d,]+)/i,
    /\$\s*([\d,]{5,})/,  // Any $ followed by 5+ digit/comma chars (e.g. $58,990)
  ];
  for (const pattern of pricePatterns) {
    const m = pattern.exec(itemHtml);
    if (m) {
      price = parseInt(m[1].replace(/,/g, ''));
      if (price > 0) break;
    }
  }
  
  // =========================================================================
  // EXTRACT ODOMETER
  // =========================================================================
  let km: number | undefined;
  const kmPatterns = [
    /<span[^>]*class="[^"]*odometer[^"]*"[^>]*>([\d,]+)\s*km/i,
    /class="[^"]*odometer[^"]*"[^>]*>([\d,]+)/i,
    /([\d,]+)\s*km\s*</i,
  ];
  for (const pattern of kmPatterns) {
    const m = pattern.exec(itemHtml);
    if (m) {
      km = parseInt(m[1].replace(/,/g, ''));
      if (km > 0 && km < 1000000) break;
    }
  }
  
  // =========================================================================
  // EXTRACT FUEL TYPE
  // =========================================================================
  const fuelMatch = /<span[^>]*class="[^"]*fuel[^"]*"[^>]*>([^<]+)<\/span>/i.exec(itemHtml);
  const fuel = fuelMatch ? fuelMatch[1].trim() : undefined;
  
  // =========================================================================
  // EXTRACT DETAIL URL
  // =========================================================================
  let detailUrl: string | undefined;
  const urlPatterns = [
    /href="([^"]+\/stock\/details\/[^"]+)"/i,
    /href="([^"]+\/vehicle\/[^"]+)"/i,
    /href="([^"]+\/used(?:-cars)?\/[^"]+)"/i,
  ];
  for (const pattern of urlPatterns) {
    const m = pattern.exec(itemHtml);
    if (m) {
      detailUrl = m[1];
      break;
    }
  }
  
  if (!detailUrl) {
    console.log(`[dealer-site-crawl] Skipping ${sourceId}: no detail URL found`);
    return null;
  }
  
  // Normalize URL
  if (detailUrl.startsWith('/')) {
    try {
      const baseUrl = new URL(dealer.inventory_url);
      detailUrl = `${baseUrl.origin}${detailUrl}`;
    } catch {
      return null;
    }
  }
  
  console.log(`[dealer-site-crawl] ${sourceId}: parsed ${year} ${make} ${model} @ $${price || 'N/A'}`);
  
  return {
    source_listing_id: sourceId,
    make,
    model,
    year,
    variant_raw: variant,
    km,
    price,
    fuel,
    listing_url: detailUrl,
    suburb: dealer.suburb,
    state: dealer.state,
    postcode: dealer.postcode,
    seller_hints: {
      seller_badge: 'dealer',
      seller_name: dealer.name,
      has_abn: true,
      has_dealer_keywords: true,
    }
  };
}

/**
 * Parse vehicles from JSON-LD structured data
 */
function parseVehiclesFromJsonLd(html: string, dealer: DealerConfig): ScrapedVehicle[] {
  const vehicles: ScrapedVehicle[] = [];
  
  const jsonLdPattern = /<script\s+type\s*=\s*["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim();
      if (!jsonContent) continue;
      
      const data = JSON.parse(jsonContent);
      const items = Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        if (item['@type'] === 'Vehicle' || item['@type'] === 'Car' || item['@type'] === 'Product') {
          const vehicle = parseSchemaOrgVehicle(item, dealer);
          if (vehicle) vehicles.push(vehicle);
        }
        
        if (item['@type'] === 'ItemList' && item.itemListElement) {
          for (const listItem of item.itemListElement) {
            const vehicle = parseSchemaOrgVehicle(listItem.item || listItem, dealer);
            if (vehicle) vehicles.push(vehicle);
          }
        }
        
        if (item['@graph'] && Array.isArray(item['@graph'])) {
          for (const graphItem of item['@graph']) {
            if (graphItem['@type'] === 'Vehicle' || graphItem['@type'] === 'Car' || graphItem['@type'] === 'Product') {
              const vehicle = parseSchemaOrgVehicle(graphItem, dealer);
              if (vehicle) vehicles.push(vehicle);
            }
          }
        }
      }
    } catch (e) {
      console.log(`[dealer-site-crawl] JSON-LD parse error: ${e}`);
    }
  }
  
  return vehicles;
}

function parseSchemaOrgVehicle(data: Record<string, unknown>, dealer: DealerConfig): ScrapedVehicle | null {
  try {
    const name = String(data.name || '');
    const nameMatch = name.match(/(\d{4})\s+(\w+)\s+(.+)/);
    if (!nameMatch) return null;
    
    const year = parseInt(nameMatch[1]);
    const make = nameMatch[2];
    const modelVariant = nameMatch[3];
    
    const detailUrl = String(data.url || data.mainEntityOfPage || '');
    
    let sourceId: string | null = null;
    if (data.sku && String(data.sku).trim()) {
      sourceId = String(data.sku).trim();
    } else if (data.productID && String(data.productID).trim()) {
      sourceId = String(data.productID).trim();
    } else if (data.mpn && String(data.mpn).trim()) {
      sourceId = String(data.mpn).trim();
    } else if (data.vehicleIdentificationNumber && String(data.vehicleIdentificationNumber).trim()) {
      const vin = String(data.vehicleIdentificationNumber).trim();
      sourceId = `vin-${vin.slice(-8)}`;
    } else if (detailUrl) {
      sourceId = `url-${stableHash(detailUrl)}`;
    }
    
    if (!sourceId || !detailUrl) return null;
    
    let price: number | undefined;
    const offers = data.offers as Record<string, unknown> | undefined;
    if (offers?.price) {
      price = parseInt(String(offers.price).replace(/[^\d]/g, ''));
    }
    
    let km: number | undefined;
    const mileage = data.mileageFromOdometer as Record<string, unknown> | undefined;
    if (mileage?.value) {
      km = parseInt(String(mileage.value).replace(/[^\d]/g, ''));
    }
    
    return {
      source_listing_id: sourceId,
      make: make,
      model: modelVariant.split(' ')[0],
      year: year,
      variant_raw: modelVariant,
      km: km,
      price: price,
      transmission: data.vehicleTransmission ? String(data.vehicleTransmission) : undefined,
      fuel: data.fuelType ? String(data.fuelType) : undefined,
      listing_url: detailUrl,
      suburb: dealer.suburb,
      state: dealer.state,
      postcode: dealer.postcode,
      seller_hints: {
        seller_badge: 'dealer',
        seller_name: dealer.name,
        has_abn: true,
        has_dealer_keywords: true,
      }
    };
  } catch {
    return null;
  }
}

// =============================================================================
// FIRECRAWL INTEGRATION
// =============================================================================

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<FirecrawlResponse> {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['html'],
      waitFor: 3000,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[dealer-site-crawl] Firecrawl error for ${url}: ${response.status} ${errorText}`);
    return { success: false, error: `HTTP ${response.status}: ${errorText}` };
  }
  
  return await response.json();
}

// =============================================================================
// HEALTH METRICS - Enhanced for anchor dealers
// =============================================================================

interface HealthCheckResult {
  alert: boolean;
  alertType: 'none' | 'zero_found' | 'drop_50pct' | 'errors';
  avgLast7Days: number | null;
  message: string | null;
}

async function checkHealthAndAlert(
  supabaseUrl: string,
  supabaseKey: string,
  dealer: DealerConfig,
  currentFound: number,
  errorCount: number
): Promise<HealthCheckResult> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const isAnchor = dealer.anchor_dealer;
  const isHighPriority = dealer.priority === 'high';
  
  // ALERT 1: Errors > 0 (for anchor/high priority dealers)
  if ((isAnchor || isHighPriority) && errorCount > 0) {
    const msg = `[ANCHOR ALERT] ${dealer.name}: ${errorCount} errors during crawl`;
    console.error(msg);
    return { alert: true, alertType: 'errors', avgLast7Days: null, message: msg };
  }
  
  // ALERT 2: Zero vehicles found (critical for anchor dealers)
  if (isAnchor && currentFound === 0) {
    const msg = `[ANCHOR ALERT] ${dealer.name}: 0 vehicles found - possible site change or scrape failure`;
    console.error(msg);
    return { alert: true, alertType: 'zero_found', avgLast7Days: null, message: msg };
  }
  
  // ALERT 3: >50% drop vs 7-day average
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: recentRuns } = await supabase
    .from('dealer_crawl_runs')
    .select('vehicles_found')
    .eq('dealer_slug', dealer.slug)
    .gte('run_date', sevenDaysAgo)
    .order('run_date', { ascending: false })
    .limit(7);
  
  if (!recentRuns || recentRuns.length < 3) {
    return { alert: false, alertType: 'none', avgLast7Days: null, message: null };
  }
  
  const runs = recentRuns as { vehicles_found: number }[];
  const avgLast7Days = runs.reduce((sum, r) => sum + r.vehicles_found, 0) / runs.length;
  
  const dropThreshold = 0.5;
  const hasDropped = avgLast7Days > 0 && currentFound < avgLast7Days * (1 - dropThreshold);
  
  if (hasDropped) {
    const msg = `[${isAnchor ? 'ANCHOR ALERT' : 'HEALTH ALERT'}] ${dealer.name}: found ${currentFound} vehicles, 7-day avg is ${avgLast7Days.toFixed(1)} (>50% drop)`;
    console.error(msg);
    return { alert: true, alertType: 'drop_50pct', avgLast7Days, message: msg };
  }
  
  return { alert: false, alertType: 'none', avgLast7Days, message: null };
}

// =============================================================================
// DATABASE-DRIVEN ROOFTOP LOADING
// =============================================================================

interface DbRooftop {
  id: string;
  dealer_slug: string;
  dealer_name: string;
  inventory_url: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  region_id: string;
  parser_mode: string;
  enabled: boolean;
  priority: string;
  anchor_dealer: boolean;
  validation_status: string;
  validation_runs: number;
  consecutive_failures: number;
  successful_validation_runs: number;
}

function dbRooftopToDealerConfig(r: DbRooftop): DealerConfig {
  return {
    name: r.dealer_name,
    slug: r.dealer_slug,
    inventory_url: r.inventory_url,
    suburb: r.suburb || '',
    state: r.state || 'NSW',
    postcode: r.postcode || '',
    region: r.region_id,
    parser_mode: (r.parser_mode as ParserMode) || 'unknown',
    enabled: r.enabled,
    anchor_dealer: r.anchor_dealer,
    priority: (r.priority as DealerPriority) || 'normal',
  };
}

// deno-lint-ignore no-explicit-any
async function loadRooftopsFromDb(supabase: any, options: {
  slugs?: string[];
  enabledOnly?: boolean;
  validatedOnly?: boolean;
  limit?: number;
}): Promise<DbRooftop[]> {
  let query = supabase
    .from('dealer_rooftops')
    .select('*');
  
  if (options.slugs && options.slugs.length > 0) {
    query = query.in('dealer_slug', options.slugs);
  }
  
  if (options.enabledOnly) {
    query = query.eq('enabled', true);
  }
  
  if (options.validatedOnly) {
    query = query.eq('validation_status', 'passed');
  }
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  // Order: anchor dealers first, then by priority
  query = query.order('anchor_dealer', { ascending: false })
               .order('priority', { ascending: true });
  
  const { data, error } = await query;
  
  if (error) {
    console.error('[dealer-site-crawl] Error loading rooftops:', error);
    return [];
  }
  
  return (data || []) as DbRooftop[];
}

// Auto-disable threshold: 3 consecutive failures
const MAX_CONSECUTIVE_FAILURES = 3;

// deno-lint-ignore no-explicit-any
async function updateRooftopValidation(
  supabase: any,
  slug: string,
  vehiclesFound: number,
  hasError: boolean
): Promise<void> {
  // Get current rooftop
  const { data: rooftop } = await supabase
    .from('dealer_rooftops')
    .select('validation_status, validation_runs, consecutive_failures, successful_validation_runs, enabled')
    .eq('dealer_slug', slug)
    .single();
  
  if (!rooftop) return;
  
  // Type assertion for the rooftop data
  const r = rooftop as { 
    validation_status: string; 
    validation_runs: number; 
    consecutive_failures: number;
    successful_validation_runs: number;
    enabled: boolean;
  };
  
  const currentRuns = r.validation_runs || 0;
  const newRuns = currentRuns + 1;
  const currentFailures = r.consecutive_failures || 0;
  const currentSuccessRuns = r.successful_validation_runs || 0;
  
  let newStatus = r.validation_status;
  let shouldEnable = false;
  let shouldDisable = false;
  let newFailures = currentFailures;
  let newSuccessRuns = currentSuccessRuns;
  let disableReason: string | null = null;
  
  if (hasError || vehiclesFound === 0) {
    // Failed run - increment consecutive failures, DO NOT increment successful_validation_runs
    newStatus = 'failed';
    newFailures = currentFailures + 1;
    // Note: newSuccessRuns stays the same - don't increment on failure
    
    // AUTO-DISABLE: 3+ consecutive failures
    if (newFailures >= MAX_CONSECUTIVE_FAILURES && r.enabled) {
      shouldDisable = true;
      disableReason = `Auto-disabled after ${newFailures} consecutive failures`;
      console.log(`[dealer-site-crawl] AUTO-DISABLE: ${slug} - ${disableReason}`);
    }
  } else {
    // Successful run - reset failure count, increment successful_validation_runs
    newFailures = 0;
    newSuccessRuns = currentSuccessRuns + 1;
    
    // Enable only when: successful_validation_runs >= 2 AND consecutive_failures == 0
    if (newSuccessRuns >= 2 && newFailures === 0 && r.validation_status !== 'passed') {
      newStatus = 'passed';
      shouldEnable = true;
    } else if (newSuccessRuns === 1) {
      // First successful run, needs second
      newStatus = 'pending';
    }
  }
  
  const updateData: Record<string, unknown> = {
    validation_status: newStatus,
    validation_runs: newRuns,
    consecutive_failures: newFailures,
    successful_validation_runs: newSuccessRuns,
    last_validated_at: new Date().toISOString(),
    last_crawl_at: new Date().toISOString(),
    last_vehicles_found: vehiclesFound,
  };
  
  if (shouldEnable) {
    updateData.enabled = true;
    updateData.validation_notes = `Auto-enabled after ${newSuccessRuns} successful validation runs`;
  }
  
  if (shouldDisable) {
    updateData.enabled = false;
    updateData.auto_disabled_at = new Date().toISOString();
    updateData.auto_disabled_reason = disableReason;
    updateData.validation_notes = disableReason;
  }
  
  await supabase
    .from('dealer_rooftops')
    .update(updateData)
    .eq('dealer_slug', slug);
  
  console.log(`[dealer-site-crawl] Updated ${slug}: status=${newStatus}, runs=${newRuns}, successRuns=${newSuccessRuns}, failures=${newFailures}, enabled=${shouldEnable}`);
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse request body
    let mode: 'cron' | 'validate' | 'manual' = 'manual';
    let targetSlugs: string[] = [];
    let batchLimit = 10;
    
    try {
      const body = await req.json();
      
      if (body.cron === true) {
        mode = 'cron';
        batchLimit = body.batch_limit || 10;
      } else if (body.validate === true) {
        mode = 'validate';
        targetSlugs = body.dealer_slugs || [];
        batchLimit = body.batch_limit || 10;
      } else if (body.dealer_slugs && Array.isArray(body.dealer_slugs)) {
        mode = 'manual';
        targetSlugs = body.dealer_slugs;
      }
    } catch {
      // No body - use default (enabled dealers)
    }
    
    // Load dealers based on mode
    let dbRooftops: DbRooftop[] = [];
    
    if (mode === 'cron') {
      // Cron: only enabled + validated rooftops
      dbRooftops = await loadRooftopsFromDb(supabase, {
        enabledOnly: true,
        validatedOnly: true,
        limit: batchLimit,
      });
    } else if (mode === 'validate') {
      // Validate: pending rooftops that need validation runs
      if (targetSlugs.length > 0) {
        dbRooftops = await loadRooftopsFromDb(supabase, { slugs: targetSlugs });
      } else {
        // Get pending rooftops
        const { data } = await supabase
          .from('dealer_rooftops')
          .select('*')
          .in('validation_status', ['pending', 'failed'])
          .lt('validation_runs', 2)
          .limit(batchLimit);
        dbRooftops = (data || []) as DbRooftop[];
      }
    } else {
      // Manual: specific slugs or fallback to hardcoded DEALERS
      if (targetSlugs.length > 0) {
        dbRooftops = await loadRooftopsFromDb(supabase, { slugs: targetSlugs });
      }
    }
    
    // Convert to DealerConfig or use hardcoded fallback
    let targetDealers: DealerConfig[] = [];
    
    if (dbRooftops.length > 0) {
      targetDealers = dbRooftops.map(dbRooftopToDealerConfig);
    } else if (targetSlugs.length > 0) {
      // Fallback to hardcoded DEALERS for specific slugs
      targetDealers = DEALERS.filter(d => targetSlugs.includes(d.slug));
    } else if (mode === 'cron') {
      // Fallback for cron if no DB rooftops
      targetDealers = DEALERS.filter(d => d.enabled).slice(0, batchLimit);
    } else {
      targetDealers = DEALERS.filter(d => d.enabled);
    }
    
    const isCronRun = mode === 'cron';
    const isValidationRun = mode === 'validate';
    
    console.log(`[dealer-site-crawl] Starting ${mode} crawl of ${targetDealers.length} dealers`);
    
    const runDate = new Date().toISOString().split('T')[0];
    const results: Array<{
      dealer: string;
      slug: string;
      parserMode: ParserMode;
      vehiclesFound: number;
      vehiclesIngested: number;
      vehiclesDropped: number;
      dropReasons: Record<string, number>;
      healthAlert: boolean;
      healthAlertType?: string;
      validationStatus?: string;
      error?: string;
    }> = [];
    
    // Supported platforms for NSW ramp (platform policy)
    const SUPPORTED_PARSERS = ['digitaldealer', 'adtorque'];
    
    for (const dealer of targetDealers) {
      const runStartedAt = new Date().toISOString();
      
      // PLATFORM POLICY: Only support digitaldealer + adtorque for NSW ramp
      if (!SUPPORTED_PARSERS.includes(dealer.parser_mode)) {
        console.log(`[dealer-site-crawl] Skipping ${dealer.name}: parser_mode=${dealer.parser_mode} not supported (only ${SUPPORTED_PARSERS.join(', ')})`);
        
        // Log as unsupported but don't count as error
        await supabase.from('dealer_crawl_runs').upsert({
          run_date: runDate,
          dealer_slug: dealer.slug,
          dealer_name: dealer.name,
          parser_mode: dealer.parser_mode,
          vehicles_found: 0,
          vehicles_ingested: 0,
          vehicles_dropped: 0,
          error: `Unsupported parser_mode: ${dealer.parser_mode}`,
          run_started_at: runStartedAt,
          run_completed_at: new Date().toISOString(),
        }, { onConflict: 'run_date,dealer_slug' });
        
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: 0,
          vehiclesIngested: 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
          error: `Unsupported parser: ${dealer.parser_mode}`,
        });
        continue;
      }
      
      console.log(`[dealer-site-crawl] Scraping ${dealer.name} (${dealer.parser_mode}): ${dealer.inventory_url}`);
      
      try {
        const scrapeResult = await scrapeWithFirecrawl(dealer.inventory_url, firecrawlKey);
        
        if (!scrapeResult.success || !scrapeResult.data?.html) {
          const error = scrapeResult.error || 'No HTML returned';
          console.error(`[dealer-site-crawl] Failed to scrape ${dealer.name}: ${error}`);
          
          // Record failed run
          await supabase.from('dealer_crawl_runs').upsert({
            run_date: runDate,
            dealer_slug: dealer.slug,
            dealer_name: dealer.name,
            parser_mode: dealer.parser_mode,
            vehicles_found: 0,
            vehicles_ingested: 0,
            vehicles_dropped: 0,
            error: error,
            run_started_at: runStartedAt,
            run_completed_at: new Date().toISOString(),
          }, { onConflict: 'run_date,dealer_slug' });
          
          // Update validation status
          if (isValidationRun || dbRooftops.length > 0) {
            await updateRooftopValidation(supabase, dealer.slug, 0, true);
          }
          
          results.push({
            dealer: dealer.name,
            slug: dealer.slug,
            parserMode: dealer.parser_mode,
            vehiclesFound: 0,
            vehiclesIngested: 0,
            vehiclesDropped: 0,
            dropReasons: {},
            healthAlert: false,
            validationStatus: 'failed',
            error,
          });
          continue;
        }
        
        // Parse based on mode
        let rawVehicles: ScrapedVehicle[] = [];
        if (dealer.parser_mode === 'digitaldealer') {
          rawVehicles = parseVehiclesFromDigitalDealer(scrapeResult.data.html, dealer);
        } else if (dealer.parser_mode === 'adtorque') {
          rawVehicles = parseVehiclesFromAdTorque(scrapeResult.data.html, dealer);
        } else if (dealer.parser_mode === 'jsonld_detail') {
          rawVehicles = parseVehiclesFromJsonLd(scrapeResult.data.html, dealer);
        }
        
        console.log(`[dealer-site-crawl] ${dealer.name}: Found ${rawVehicles.length} raw vehicles`);
        
        // Apply quality gate
        const { passed, dropped, dropReasons } = applyQualityGate(rawVehicles);
        console.log(`[dealer-site-crawl] ${dealer.name}: ${passed.length} passed quality gate, ${dropped} dropped`);
        if (Object.keys(dropReasons).length > 0) {
          console.log(`[dealer-site-crawl] ${dealer.name}: Drop reasons:`, dropReasons);
        }
        
        // Check health metrics (track errors for anchor dealers)
        let errorCount = 0;
        const healthCheck = await checkHealthAndAlert(supabaseUrl, supabaseKey, dealer, passed.length, errorCount);
        
        let vehiclesIngested = 0;
        
        if (passed.length > 0) {
          // Build payload with metadata
          const sourceName = `dealer_site:${dealer.slug}`;
          const ingestPayload = {
            source_name: sourceName,
            source_group: 'dealer_site',
            dealer_slug: dealer.slug,
            listings: passed.map(v => ({
              source_listing_id: v.source_listing_id,
              make: v.make,
              model: v.model,
              year: v.year,
              variant_raw: v.variant_raw,
              km: v.km,
              price: v.price,
              transmission: v.transmission,
              fuel: v.fuel,
              listing_url: v.listing_url,
              suburb: v.suburb,
              state: v.state,
              postcode: v.postcode,
              seller_hints: v.seller_hints,
            })),
          };
          
          const ingestResponse = await fetch(`${supabaseUrl}/functions/v1/classifieds-ingest`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(ingestPayload),
          });
          
          if (ingestResponse.ok) {
            const ingestResult = await ingestResponse.json();
            vehiclesIngested = (ingestResult.created || 0) + (ingestResult.updated || 0);
            console.log(`[dealer-site-crawl] ${dealer.name}: Ingested ${vehiclesIngested} vehicles`);
          } else {
            const errorText = await ingestResponse.text();
            console.error(`[dealer-site-crawl] Ingest failed for ${dealer.name}: ${errorText}`);
          }
        }
        
        // Record successful run
        await supabase.from('dealer_crawl_runs').upsert({
          run_date: runDate,
          dealer_slug: dealer.slug,
          dealer_name: dealer.name,
          parser_mode: dealer.parser_mode,
          vehicles_found: passed.length,
          vehicles_ingested: vehiclesIngested,
          vehicles_dropped: dropped,
          drop_reasons: dropReasons,
          error: null,
          run_started_at: runStartedAt,
          run_completed_at: new Date().toISOString(),
        }, { onConflict: 'run_date,dealer_slug' });
        
        // Update validation status
        let validationStatus: string | undefined;
        if (isValidationRun || dbRooftops.length > 0) {
          await updateRooftopValidation(supabase, dealer.slug, passed.length, false);
          // Get updated status
          const { data: updated } = await supabase
            .from('dealer_rooftops')
            .select('validation_status')
            .eq('dealer_slug', dealer.slug)
            .single();
          validationStatus = updated?.validation_status;
        }
        
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: passed.length,
          vehiclesIngested,
          vehiclesDropped: dropped,
          dropReasons,
          healthAlert: healthCheck.alert,
          healthAlertType: healthCheck.alertType,
          validationStatus,
        });
        
        if (healthCheck.alert && healthCheck.message) {
          console.error(`[dealer-site-crawl] ${healthCheck.message}`);
        }
        
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[dealer-site-crawl] Error processing ${dealer.name}: ${errorMsg}`);
        
        await supabase.from('dealer_crawl_runs').upsert({
          run_date: runDate,
          dealer_slug: dealer.slug,
          dealer_name: dealer.name,
          parser_mode: dealer.parser_mode,
          vehicles_found: 0,
          vehicles_ingested: 0,
          vehicles_dropped: 0,
          error: errorMsg,
          run_started_at: runStartedAt,
          run_completed_at: new Date().toISOString(),
        }, { onConflict: 'run_date,dealer_slug' });
        
        // Update validation status
        if (isValidationRun || dbRooftops.length > 0) {
          await updateRooftopValidation(supabase, dealer.slug, 0, true);
        }
        
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: 0,
          vehiclesIngested: 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
          validationStatus: 'failed',
          error: errorMsg,
        });
      }
      
      // Rate limit between dealers
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    const totalFound = results.reduce((sum, r) => sum + r.vehiclesFound, 0);
    const totalIngested = results.reduce((sum, r) => sum + r.vehiclesIngested, 0);
    const totalDropped = results.reduce((sum, r) => sum + r.vehiclesDropped, 0);
    const dealersWithErrors = results.filter(r => r.error).length;
    const dealersWithHealthAlerts = results.filter(r => r.healthAlert).length;
    const dealersValidated = results.filter(r => r.validationStatus === 'passed').length;
    
    console.log(`[dealer-site-crawl] Complete: ${totalFound} found, ${totalIngested} ingested, ${totalDropped} dropped, ${dealersWithErrors} errors, ${dealersWithHealthAlerts} health alerts, ${dealersValidated} validated`);
    
    return new Response(
      JSON.stringify({
        success: true,
        mode,
        isCronRun,
        isValidationRun,
        summary: {
          dealersProcessed: results.length,
          totalVehiclesFound: totalFound,
          totalVehiclesIngested: totalIngested,
          totalVehiclesDropped: totalDropped,
          dealersWithErrors,
          dealersWithHealthAlerts,
          dealersValidated,
        },
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[dealer-site-crawl] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
