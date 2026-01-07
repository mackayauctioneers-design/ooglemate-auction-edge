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
 * Pre-ingest quality gate - enforces strict requirements
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
    
    // GATE 2: Must have listing_url (detail page)
    if (!v.listing_url || v.listing_url.trim() === '') {
      addDropReason('missing_listing_url');
      continue;
    }
    
    // GATE 3: Classifieds REQUIRE price
    if (v.price === undefined || v.price === null || v.price <= 0) {
      addDropReason('missing_price');
      continue;
    }
    
    // GATE 4: Price must be in range
    if (v.price < MIN_PRICE || v.price > MAX_PRICE) {
      addDropReason('price_out_of_range');
      continue;
    }
    
    // GATE 5: Year must be 2016+ for dealer-grade focus
    if (v.year < MIN_YEAR) {
      addDropReason('year_below_2016');
      continue;
    }
    
    // GATE 6: Basic make/model validation
    if (!v.make || !v.model || v.make.length < 2 || v.model.length < 1) {
      addDropReason('invalid_make_model');
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
    const itemHtml = html.slice(startIdx, startIdx + 4000);
    
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
function parseAdTorqueItem(itemHtml: string, sourceId: string, dealer: DealerConfig): ScrapedVehicle | null {
  // Simple patterns - actual HTML is: <span class="year">2022</span>
  const yearMatch = /<span class="year">(\d{4})<\/span>/i.exec(itemHtml);
  const makeMatch = /<span class="make">([^<]+)<\/span>/i.exec(itemHtml);
  const modelMatch = /<span class="model">([^<]+)<\/span>/i.exec(itemHtml);
  const badgeMatch = /<span class="badge">([^<]+)<\/span>/i.exec(itemHtml);
  
  if (!yearMatch || !makeMatch || !modelMatch) {
    return null;
  }
  
  const year = parseInt(yearMatch[1]);
  const make = makeMatch[1].trim();
  const model = modelMatch[1].trim();
  const variant = badgeMatch ? badgeMatch[1].trim() : undefined;
  
  // Fallback: parse from combined title string (e.g., "2021 Mazda CX-5 Touring")
  if (!year || !make || !model) {
    const titlePattern = /<(?:h[1-6]|a|div)[^>]+class="[^"]*(?:si-title|vehicle-title|title)[^"]*"[^>]*>([^<]+)<|>(\d{4})\s+(\w+)\s+(\S+)/i;
    const titleMatch = titlePattern.exec(itemHtml);
    if (titleMatch) {
      const titleText = titleMatch[1] || `${titleMatch[2]} ${titleMatch[3]} ${titleMatch[4]}`;
      const parts = titleText.trim().split(/\s+/);
      if (parts.length >= 3) {
        const maybeYear = parseInt(parts[0]);
        if (maybeYear >= 1990 && maybeYear <= 2030) {
          if (!year) year = maybeYear;
          if (!make) make = parts[1];
          if (!model) model = parts[2];
        }
      }
    }
  }
  
  if (!year || !make || !model || year < 1990 || year > 2030) {
    return null;
  }
  
  // Extract price - multiple patterns
  let price: number | undefined;
  const pricePatterns = [
    /<span[^>]+class="[^"]*price-value[^"]*"[^>]*>\s*\$?([\d,]+)/i,
    /class="[^"]*price[^"]*"[^>]*>\s*\$?([\d,]+)/i,
    /data-price="(\d+)"/i,
    /\$\s*([\d,]+)\s*(?:drive away|driveaway)?/i,
  ];
  for (const pattern of pricePatterns) {
    const m = pattern.exec(itemHtml);
    if (m) {
      price = parseInt(m[1].replace(/,/g, ''));
      if (price > 0) break;
    }
  }
  
  // Extract odometer
  let km: number | undefined;
  const kmPatterns = [
    /<span[^>]+class="[^"]*odometer[^"]*"[^>]*>([\d,]+)\s*km/i,
    /class="[^"]*(?:km|kms|odometer)[^"]*"[^>]*>([\d,]+)/i,
    /([\d,]+)\s*km/i,
  ];
  for (const pattern of kmPatterns) {
    const m = pattern.exec(itemHtml);
    if (m) {
      km = parseInt(m[1].replace(/,/g, ''));
      if (km > 0 && km < 1000000) break;
    }
  }
  
  // Extract transmission
  let transmission: string | undefined;
  const transPatterns = [
    /<span[^>]+class="[^"]*transmission[^"]*"[^>]*>([^<]+)<\/span>/i,
    /\b(automatic|manual|auto|cvt)\b/i,
  ];
  for (const pattern of transPatterns) {
    const m = pattern.exec(itemHtml);
    if (m) { transmission = m[1].trim(); break; }
  }
  
  // Extract fuel
  let fuel: string | undefined;
  const fuelPatterns = [
    /<span[^>]+class="[^"]*fuel[^"]*"[^>]*>([^<]+)<\/span>/i,
    /\b(petrol|diesel|hybrid|electric|ev)\b/i,
  ];
  for (const pattern of fuelPatterns) {
    const m = pattern.exec(itemHtml);
    if (m) { fuel = m[1].trim(); break; }
  }
  
  // Extract detail URL
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
  
  return {
    source_listing_id: sourceId,
    make,
    model,
    year,
    variant_raw: variant,
    km,
    price,
    transmission,
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
    let targetDealers = DEALERS.filter(d => d.enabled);
    let isCronRun = false;
    
    try {
      const body = await req.json();
      if (body.dealer_slugs && Array.isArray(body.dealer_slugs)) {
        // Manual run with specific dealers
        targetDealers = DEALERS.filter(d => body.dealer_slugs.includes(d.slug));
      }
      if (body.cron === true) {
        isCronRun = true;
        // Cron only runs enabled dealers (max 10)
        targetDealers = DEALERS.filter(d => d.enabled).slice(0, 10);
      }
    } catch {
      // No body - use enabled dealers
    }
    
    console.log(`[dealer-site-crawl] Starting crawl of ${targetDealers.length} dealers (cron: ${isCronRun})`);
    
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
      error?: string;
    }> = [];
    
    for (const dealer of targetDealers) {
      const runStartedAt = new Date().toISOString();
      
      // Skip unknown parser mode
      if (dealer.parser_mode === 'unknown') {
        console.log(`[dealer-site-crawl] Skipping ${dealer.name}: parser_mode=unknown`);
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: 0,
          vehiclesIngested: 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
          error: 'Parser mode unknown - skipped',
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
          
          results.push({
            dealer: dealer.name,
            slug: dealer.slug,
            parserMode: dealer.parser_mode,
            vehiclesFound: 0,
            vehiclesIngested: 0,
            vehiclesDropped: 0,
            dropReasons: {},
            healthAlert: false,
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
        let errorCount = 0; // Will be updated if ingest fails
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
        
        results.push({
          dealer: dealer.name,
          slug: dealer.slug,
          parserMode: dealer.parser_mode,
          vehiclesFound: 0,
          vehiclesIngested: 0,
          vehiclesDropped: 0,
          dropReasons: {},
          healthAlert: false,
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
    
    console.log(`[dealer-site-crawl] Complete: ${totalFound} found, ${totalIngested} ingested, ${totalDropped} dropped, ${dealersWithErrors} errors, ${dealersWithHealthAlerts} health alerts`);
    
    return new Response(
      JSON.stringify({
        success: true,
        isCronRun,
        summary: {
          dealersProcessed: results.length,
          totalVehiclesFound: totalFound,
          totalVehiclesIngested: totalIngested,
          totalVehiclesDropped: totalDropped,
          dealersWithErrors,
          dealersWithHealthAlerts,
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
