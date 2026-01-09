import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// OOGLEMATE PRICING ENGINE v4 - COMPARABLE ADJUSTMENT ENGINE
// ============================================================================
// Bob is NOT a valuer. Bob is a voice narrator.
// All pricing logic lives HERE. Bob receives a DECISION OBJECT only.
// Adjustments for km, year, trim are computed HERE, not by Bob/LLM.
// ============================================================================

// Types for sales history
interface SalesHistoryRecord {
  record_id: string;
  source: string;
  dealer_name: string;
  imported_at: string;
  stock_no: string;
  make: string;
  model: string;
  year: number;
  variant: string;
  variant_family?: string;
  body_type: string;
  transmission: string;
  drivetrain: string;
  engine: string;
  sale_date: string;
  days_in_stock: number;
  sell_price: number;
  total_cost: number;  // OWE - THE PRIMARY ANCHOR
  gross_profit: number;
  km?: number;
}

interface WeightedComp {
  record: SalesHistoryRecord;
  weight: number;
  recencyMonths: number;
  tier: 'A' | 'B' | 'C';  // A=variant_family, B=model, C=platform
}

// ============================================================================
// DECISION OBJECT - THE ONLY THING BOB RECEIVES
// ============================================================================

type BobDecision = 'PRICE_AVAILABLE' | 'SOFT_OWN' | 'NEED_PICS' | 'DNR';
type VehicleClass = 'FAST_MOVER' | 'AVERAGE' | 'HARD_WORK' | 'POISON';
type DataSource = 'OWN_SALES';
type Confidence = 'HIGH' | 'MED' | 'LOW';

// Adjustment record for narration
interface AdjustmentApplied {
  type: 'km' | 'year' | 'trim' | 'demand';
  description: string;
  amount: number;
}

interface DecisionObject {
  decision: BobDecision;
  buy_price: number | null;        // SINGLE rounded price (31, 32 not 31800)
  buy_low?: number | null;         // For soft_own range
  buy_high?: number | null;        // For soft_own range
  vehicle_class: VehicleClass | null;
  data_source: DataSource | null;
  confidence: Confidence | null;
  reason?: string;
  instruction?: string;
  adjustments_applied?: AdjustmentApplied[];  // For Bob narration
}

// Internal engine state (never sent to Bob)
interface EngineState {
  n_comps: number;
  comp_tier: 'A' | 'B' | 'C' | null;
  anchor_owe: number | null;
  owe_base: number | null;
  avg_days: number;
  avg_gross: number;
  notes: string[];
  comps_used: string[];
  processing_time_ms?: number;
  adjustments: {
    km_adj: number;
    year_adj: number;
    trim_adj: number;
    demand_adj: number;
  };
}

interface OancaInput {
  make: string;
  model: string;
  year: number;
  variant_family?: string;
  km?: number;
  transmission?: string;
  engine?: string;
  location?: string;
}

// ============================================================================
// ADJUSTMENT CONSTANTS (BOUNDED)
// ============================================================================

const ADJUSTMENT_CONFIG = {
  // KM adjustment: slope per 1000km
  km_slope_per_1000: -80,  // -$80 per 1000km over median
  km_cap: 2500,            // Max ±$2500
  
  // Year adjustment: step per year difference
  year_step: 1200,         // $1200 per year newer
  year_cap: 6000,          // Max ±$6000
  
  // Trim adjustment: ladder step
  trim_step: 1000,         // $1000 per trim level
  trim_cap: 3500,          // Max ±$3500
  
  // Demand adjustment
  hard_work_penalty: -1500,
  fast_mover_bonus: 800,
};

// ============================================================================
// PLATFORM FAMILIES (for Tier C matching)
// ============================================================================

const PLATFORM_FAMILIES: Record<string, string[]> = {
  'dual_cab_ute': ['hilux', 'ranger', 'd-max', 'dmax', 'triton', 'bt-50', 'bt50', 'navara', 'colorado', 'amarok'],
  'full_size_suv': ['landcruiser', 'patrol', 'prado', 'pajero', 'fortuner', 'everest', 'mu-x', 'mux'],
  'mid_suv': ['rav4', 'cx-5', 'cx5', 'tucson', 'sportage', 'forester', 'x-trail', 'xtrail', 'outlander', 'kluger'],
  'compact_suv': ['cx-3', 'cx3', 'kona', 'seltos', 'venue', 'asx', 'juke', 'qashqai'],
  'small_hatch': ['corolla', 'mazda3', 'i30', 'cerato', 'golf', 'cruze', 'astra', 'focus'],
  'mid_sedan': ['camry', 'mazda6', 'accord', 'passat', 'commodore'],
};

function getPlatformFamily(model: string): string | null {
  const modelLower = model.toLowerCase().trim();
  for (const [family, models] of Object.entries(PLATFORM_FAMILIES)) {
    for (const m of models) {
      if (modelLower.includes(m) || m.includes(modelLower)) {
        return family;
      }
    }
  }
  return null;
}

// ============================================================================
// STRONG MARKET VEHICLES (OK to price with 1 comp)
// ============================================================================

const STRONG_MARKET_VEHICLES: Record<string, string[]> = {
  'toyota': ['hilux', 'landcruiser', 'prado', 'lc70', 'lc79', 'lc200', 'lc300', '70 series', '79 series', '200 series', '300 series', 'rav4', 'fortuner', 'kluger'],
  'ford': ['ranger', 'everest', 'raptor', 'f150', 'f-150', 'f250', 'f-250'],
  'isuzu': ['d-max', 'dmax', 'mu-x', 'mux'],
  'nissan': ['navara', 'patrol', 'y61', 'y62'],
  'mazda': ['bt-50', 'bt50', 'cx-5', 'cx5', 'cx-9', 'cx9'],
  'mitsubishi': ['triton', 'pajero', 'pajero sport'],
  'ram': ['1500', '2500', '3500'],
  'chevrolet': ['silverado'],
};

function isStrongMarket(make: string, model: string): boolean {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  for (const [smMake, models] of Object.entries(STRONG_MARKET_VEHICLES)) {
    if (makeLower.includes(smMake) || smMake.includes(makeLower)) {
      for (const smModel of models) {
        if (modelLower.includes(smModel) || smModel.includes(modelLower)) {
          return true;
        }
      }
    }
  }
  return false;
}

// ============================================================================
// EUROPEAN CAR HARD RULE - NON-NEGOTIABLE REFUSAL
// ============================================================================

const EUROPEAN_MAKES_REFUSE = [
  'bmw', 'mercedes', 'mercedes-benz', 'audi', 'volkswagen', 'vw', 
  'porsche', 'volvo', 'jaguar', 'land rover', 'landrover',
  'alfa romeo', 'alfa', 'peugeot', 'renault'
];

// Rotating refusal phrases for European cars (safe, blunt, funny)
const EURO_REFUSAL_PHRASES = [
  "Mate, I'd rather eat glass than price that.",
  "European? Yeah nah. I'm not touching that headache.",
  "Yeah nah. That's someone else's problem.",
  "That's a brave way to lose money.",
  "I'll talk to Macka and get back to you.",
];

let euroRefusalIndex = 0;

// STRONG pricing intent keywords - these ALWAYS trigger pricing intent
const STRONG_PRICING_KEYWORDS = [
  'worth', 'buy', 'price', 'value it', 'put a number', 'get out'
];

// General pricing intent keywords
const PRICING_INTENT_KEYWORDS = [
  'pricing', 'valuation', 'buying', 'pay', 'paying', 'offer', 'cost',
  'owe', 'own', 'ownership', 'what would', 'what should', 'how much',
  'give me a', 'quote', 'reckon', 'think its worth', 'think it\'s worth',
  'steer', 'number'
];

// EXPLICIT trend keywords only - location words do NOT override pricing
const TREND_INTENT_KEYWORDS = [
  'trend', 'trending', 'moving', 'selling', 'hot', 'cooling', 'demand',
  'clearance', 'days to sell', 'days to clear'
];

function detectPricingIntent(message: string): boolean {
  const text = message.toLowerCase();
  
  // STRONG pricing keywords ALWAYS trigger pricing intent (no override)
  const hasStrongPricing = STRONG_PRICING_KEYWORDS.some(k => text.includes(k));
  if (hasStrongPricing) return true;
  
  // Check for explicit trend intent (only these specific words)
  const hasTrendIntent = TREND_INTENT_KEYWORDS.some(k => text.includes(k));
  if (hasTrendIntent) return false;
  
  // Check for general pricing intent
  return PRICING_INTENT_KEYWORDS.some(k => text.includes(k));
}

function isEuropeanMake(make: string): boolean {
  const makeLower = make.toLowerCase().trim();
  return EUROPEAN_MAKES_REFUSE.some(m => makeLower.includes(m) || makeLower === m);
}

function getEuropeanRefusalPhrase(): string {
  const phrase = EURO_REFUSAL_PHRASES[euroRefusalIndex];
  euroRefusalIndex = (euroRefusalIndex + 1) % EURO_REFUSAL_PHRASES.length;
  return phrase;
}

// ============================================================================
// KNOWN PROBLEM VEHICLES (DNR or HARD_WORK)
// ============================================================================

const KNOWN_HARD_WORK_VEHICLES: Record<string, string[]> = {
  'holden': ['cruze', 'captiva', 'barina', 'trax', 'astra'],
  'peugeot': ['206', '207', '208', '306', '307', '308', '3008', '2008', '508', '5008', '406', '407'],
  'citroen': ['c3', 'c4', 'c5', 'ds3', 'ds4', 'ds5'],
  'renault': ['megane', 'clio', 'captur', 'koleos', 'laguna', 'scenic'],
  'fiat': ['500', 'punto', 'tipo', 'panda'],
  'alfa romeo': ['giulietta', 'mito', '159', '147', '156'],
  'volkswagen': ['golf', 'polo', 'jetta', 'beetle', 'up'],
  'mini': ['cooper', 'one', 'countryman', 'paceman', 'clubman'],
};

function isKnownHardWork(make: string, model: string): boolean {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  for (const [hwMake, models] of Object.entries(KNOWN_HARD_WORK_VEHICLES)) {
    if (makeLower.includes(hwMake) || hwMake.includes(makeLower)) {
      for (const hwModel of models) {
        if (modelLower.includes(hwModel) || hwModel.includes(modelLower)) {
          return true;
        }
      }
    }
  }
  return false;
}

// ============================================================================
// RECENCY WEIGHTS
// 0–6m: 1.0 | 6–12m: 0.85 | 12–24m: 0.65 | 24–36m: 0.4 | 36m+: 0.2
// ============================================================================

function calculateRecencyWeight(saleDateStr: string): { weight: number; months: number } {
  if (!saleDateStr) return { weight: 0.2, months: 99 };
  
  const saleDate = new Date(saleDateStr);
  const now = new Date();
  const monthsDiff = Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  
  if (monthsDiff <= 6) return { weight: 1.0, months: monthsDiff };
  if (monthsDiff <= 12) return { weight: 0.85, months: monthsDiff };
  if (monthsDiff <= 24) return { weight: 0.65, months: monthsDiff };
  if (monthsDiff <= 36) return { weight: 0.4, months: monthsDiff };
  return { weight: 0.2, months: monthsDiff };
}

// ============================================================================
// TIERED COMP SELECTION
// Tier A: make + model + variant_family (±4 years)
// Tier B: make + model (±4 years)
// Tier C: platform family (±6 years)
// ============================================================================

function selectComps(
  input: OancaInput, 
  salesHistory: SalesHistoryRecord[]
): { comps: WeightedComp[]; tier: 'A' | 'B' | 'C' | null } {
  const makeLower = input.make.toLowerCase().trim();
  const modelLower = input.model.toLowerCase().trim();
  const variantFamily = input.variant_family?.toLowerCase().trim() || '';
  const subjectYear = input.year;
  const subjectPlatform = getPlatformFamily(input.model);
  
  // Tier A: make + model + variant_family (±4 years)
  const tierAComps: WeightedComp[] = [];
  if (variantFamily) {
    for (const r of salesHistory) {
      const rMake = (r.make || '').toLowerCase().trim();
      const rModel = (r.model || '').toLowerCase().trim();
      const rVariant = (r.variant_family || r.variant || '').toLowerCase().trim();
      const rYear = parseInt(String(r.year)) || 0;
      
      const makeMatch = rMake === makeLower || rMake.includes(makeLower) || makeLower.includes(rMake);
      const modelMatch = rModel === modelLower || rModel.includes(modelLower) || modelLower.includes(rModel);
      const variantMatch = rVariant.includes(variantFamily) || variantFamily.includes(rVariant);
      const yearMatch = Math.abs(rYear - subjectYear) <= 4;
      
      if (makeMatch && modelMatch && variantMatch && yearMatch && r.total_cost > 0) {
        const { weight, months } = calculateRecencyWeight(r.sale_date);
        tierAComps.push({ record: r, weight, recencyMonths: months, tier: 'A' });
      }
    }
  }
  
  if (tierAComps.length >= 2) {
    console.log(`[ENGINE] Tier A match: ${tierAComps.length} comps (variant_family)`);
    return { comps: tierAComps.sort((a, b) => b.weight - a.weight), tier: 'A' };
  }
  
  // Tier B: make + model (±4 years)
  const tierBComps: WeightedComp[] = [];
  for (const r of salesHistory) {
    const rMake = (r.make || '').toLowerCase().trim();
    const rModel = (r.model || '').toLowerCase().trim();
    const rYear = parseInt(String(r.year)) || 0;
    
    const makeMatch = rMake === makeLower || rMake.includes(makeLower) || makeLower.includes(rMake);
    const modelMatch = rModel === modelLower || rModel.includes(modelLower) || modelLower.includes(rModel);
    const yearMatch = Math.abs(rYear - subjectYear) <= 4;
    
    if (makeMatch && modelMatch && yearMatch && r.total_cost > 0) {
      const { weight, months } = calculateRecencyWeight(r.sale_date);
      tierBComps.push({ record: r, weight, recencyMonths: months, tier: 'B' });
    }
  }
  
  if (tierBComps.length >= 1) {
    console.log(`[ENGINE] Tier B match: ${tierBComps.length} comps (make+model)`);
    return { comps: tierBComps.sort((a, b) => b.weight - a.weight), tier: 'B' };
  }
  
  // Tier C: platform family (±6 years)
  if (subjectPlatform) {
    const tierCComps: WeightedComp[] = [];
    for (const r of salesHistory) {
      const rPlatform = getPlatformFamily(r.model || '');
      const rYear = parseInt(String(r.year)) || 0;
      
      const platformMatch = rPlatform === subjectPlatform;
      const yearMatch = Math.abs(rYear - subjectYear) <= 6;
      
      if (platformMatch && yearMatch && r.total_cost > 0) {
        const { weight, months } = calculateRecencyWeight(r.sale_date);
        tierCComps.push({ record: r, weight, recencyMonths: months, tier: 'C' });
      }
    }
    
    if (tierCComps.length >= 2) {
      console.log(`[ENGINE] Tier C match: ${tierCComps.length} comps (platform: ${subjectPlatform})`);
      return { comps: tierCComps.sort((a, b) => b.weight - a.weight), tier: 'C' };
    }
  }
  
  console.log(`[ENGINE] No tier matched, returning best available`);
  // Return Tier A if has 1, else Tier B if has any, else empty
  if (tierAComps.length > 0) return { comps: tierAComps, tier: 'A' };
  if (tierBComps.length > 0) return { comps: tierBComps, tier: 'B' };
  return { comps: [], tier: null };
}

// ============================================================================
// RECENCY-WEIGHTED MEDIAN OWE (Baseline)
// ============================================================================

function calculateWeightedMedianOwe(comps: WeightedComp[]): number | null {
  const oweData = comps
    .filter(wc => wc.record.total_cost > 0)
    .map(wc => ({ owe: wc.record.total_cost, weight: wc.weight }));
  
  if (oweData.length === 0) return null;
  
  // Sort by OWE
  oweData.sort((a, b) => a.owe - b.owe);
  
  const totalWeight = oweData.reduce((sum, d) => sum + d.weight, 0);
  let cumWeight = 0;
  
  for (const d of oweData) {
    cumWeight += d.weight;
    if (cumWeight >= totalWeight / 2) {
      return d.owe;
    }
  }
  
  return oweData[0].owe;
}

// ============================================================================
// ADJUSTMENT CALCULATIONS (BOUNDED)
// ============================================================================

function calculateAdjustments(
  input: OancaInput,
  comps: WeightedComp[],
  vehicleClass: VehicleClass
): { adjustments: EngineState['adjustments']; applied: AdjustmentApplied[] } {
  const applied: AdjustmentApplied[] = [];
  
  // Calculate comp medians
  const compKms = comps
    .map(wc => wc.record.km || 0)
    .filter(km => km > 0);
  const medianKm = compKms.length > 0 
    ? compKms.sort((a, b) => a - b)[Math.floor(compKms.length / 2)] 
    : 0;
  
  const compYears = comps.map(wc => parseInt(String(wc.record.year)) || 0);
  const medianYear = compYears.length > 0 
    ? compYears.sort((a, b) => a - b)[Math.floor(compYears.length / 2)] 
    : input.year;
  
  // 1. KM Adjustment
  let km_adj = 0;
  if (input.km && medianKm > 0) {
    const kmDiff = input.km - medianKm;
    km_adj = Math.round((kmDiff / 1000) * ADJUSTMENT_CONFIG.km_slope_per_1000);
    // Cap
    km_adj = Math.max(-ADJUSTMENT_CONFIG.km_cap, Math.min(ADJUSTMENT_CONFIG.km_cap, km_adj));
    
    if (km_adj !== 0) {
      const direction = km_adj > 0 ? 'lower km' : 'higher km';
      applied.push({
        type: 'km',
        description: `${direction} than book`,
        amount: km_adj
      });
    }
  }
  
  // 2. Year Adjustment
  let year_adj = 0;
  const yearDiff = input.year - medianYear;
  if (yearDiff !== 0) {
    year_adj = yearDiff * ADJUSTMENT_CONFIG.year_step;
    // Cap
    year_adj = Math.max(-ADJUSTMENT_CONFIG.year_cap, Math.min(ADJUSTMENT_CONFIG.year_cap, year_adj));
    
    if (year_adj !== 0) {
      const direction = year_adj > 0 ? 'newer' : 'older';
      applied.push({
        type: 'year',
        description: `${Math.abs(yearDiff)} year ${direction}`,
        amount: year_adj
      });
    }
  }
  
  // 3. Trim Adjustment (placeholder - would need variant ladder data)
  const trim_adj = 0;
  
  // 4. Demand Adjustment
  let demand_adj = 0;
  if (vehicleClass === 'HARD_WORK') {
    demand_adj = ADJUSTMENT_CONFIG.hard_work_penalty;
    applied.push({
      type: 'demand',
      description: 'slow seller',
      amount: demand_adj
    });
  } else if (vehicleClass === 'FAST_MOVER') {
    demand_adj = ADJUSTMENT_CONFIG.fast_mover_bonus;
    applied.push({
      type: 'demand',
      description: 'strong seller',
      amount: demand_adj
    });
  }
  
  return {
    adjustments: { km_adj, year_adj, trim_adj, demand_adj },
    applied
  };
}

// ============================================================================
// DEMAND CLASS CALCULATION
// ============================================================================

function calculateVehicleClass(comps: WeightedComp[], make: string, model: string): { 
  vehicleClass: VehicleClass; 
  avgDays: number; 
  avgGross: number 
} {
  // Override for known hard work
  if (isKnownHardWork(make, model)) {
    return { vehicleClass: 'HARD_WORK', avgDays: 60, avgGross: 500 };
  }
  
  if (comps.length === 0) {
    return { vehicleClass: 'AVERAGE', avgDays: 45, avgGross: 0 };
  }
  
  const daysValues = comps
    .map(wc => parseInt(String(wc.record.days_in_stock)) || 0)
    .filter(d => d > 0);
  
  const grossValues = comps
    .map(wc => parseFloat(String(wc.record.gross_profit)) || 0);
  
  const avgDays = daysValues.length > 0 
    ? daysValues.reduce((a, b) => a + b, 0) / daysValues.length 
    : 45;
    
  const avgGross = grossValues.length > 0 
    ? grossValues.reduce((a, b) => a + b, 0) / grossValues.length 
    : 0;
  
  // Check for repeat losses (poison)
  const lossCount = grossValues.filter(g => g <= 0).length;
  const lossRatio = grossValues.length > 0 ? lossCount / grossValues.length : 0;
  
  if (lossRatio >= 0.5 || avgGross < -500) {
    return { vehicleClass: 'POISON', avgDays, avgGross };
  }
  
  if (avgDays <= 21 && avgGross >= 2000) {
    return { vehicleClass: 'FAST_MOVER', avgDays, avgGross };
  }
  
  if (avgDays <= 35 && avgGross >= 1000) {
    return { vehicleClass: 'AVERAGE', avgDays, avgGross };
  }
  
  if (avgDays > 45 || avgGross < 1500) {
    return { vehicleClass: 'HARD_WORK', avgDays, avgGross };
  }
  
  return { vehicleClass: 'AVERAGE', avgDays, avgGross };
}

// ============================================================================
// ROUND TO CLEAN FIGURE ($500 increments for "31" or "32" style)
// ============================================================================

function roundToCleanFigure(price: number): number {
  // Round to nearest $500 for clean narration
  // e.g., 31800 -> 32000, 31200 -> 31000
  return Math.round(price / 500) * 500;
}

// ============================================================================
// PRICING ENGINE - PRODUCES DECISION OBJECT
// ============================================================================

function runPricingEngine(input: OancaInput, salesHistory: SalesHistoryRecord[]): { 
  decision: DecisionObject; 
  engineState: EngineState 
} {
  const startTime = Date.now();
  const notes: string[] = [];
  const compsUsed: string[] = [];
  
  console.log(`[ENGINE] Processing: ${input.year} ${input.make} ${input.model}${input.km ? ` @ ${input.km}km` : ''}`);
  
  // STEP 1: Select comps using tiered matching
  const { comps, tier } = selectComps(input, salesHistory);
  
  // Collect comp IDs
  comps.forEach(wc => compsUsed.push(wc.record.record_id));
  
  const nOweComps = comps.length;
  console.log(`[ENGINE] Found ${nOweComps} comps (tier: ${tier || 'none'})`);
  
  // Classify the vehicle
  const isHardWork = isKnownHardWork(input.make, input.model);
  const isStrong = isStrongMarket(input.make, input.model);
  
  console.log(`[ENGINE] Vehicle classification: isStrong=${isStrong}, isHardWork=${isHardWork}`);
  
  // ================================================================
  // ZERO COMPS = Always NEED_PICS
  // ================================================================
  if (nOweComps === 0) {
    notes.push(`Zero comps: NEED_PICS`);
    
    return {
      decision: {
        decision: 'NEED_PICS',
        buy_price: null,
        vehicle_class: null,
        data_source: null,
        confidence: null,
        reason: 'NO_COMPS',
        instruction: 'REQUEST_PHOTOS',
      },
      engineState: {
        n_comps: 0,
        comp_tier: null,
        anchor_owe: null,
        owe_base: null,
        avg_days: 0,
        avg_gross: 0,
        notes,
        comps_used: [],
        processing_time_ms: Date.now() - startTime,
        adjustments: { km_adj: 0, year_adj: 0, trim_adj: 0, demand_adj: 0 },
      }
    };
  }
  
  // ================================================================
  // HARD_WORK vehicles with < 2 comps = NEED_PICS (too risky)
  // ================================================================
  if (isHardWork && nOweComps < 2) {
    notes.push(`Hard work vehicle with only ${nOweComps} comp(s): NEED_PICS`);
    
    return {
      decision: {
        decision: 'NEED_PICS',
        buy_price: null,
        vehicle_class: 'HARD_WORK',
        data_source: null,
        confidence: null,
        reason: 'THIN_DATA',
        instruction: 'REQUEST_PHOTOS',
      },
      engineState: {
        n_comps: nOweComps,
        comp_tier: tier,
        anchor_owe: null,
        owe_base: null,
        avg_days: 0,
        avg_gross: 0,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
        adjustments: { km_adj: 0, year_adj: 0, trim_adj: 0, demand_adj: 0 },
      }
    };
  }
  
  // STEP 2: Calculate OWE baseline (weighted median)
  const oweBase = calculateWeightedMedianOwe(comps);
  
  if (!oweBase) {
    notes.push('Failed to calculate OWE baseline');
    return {
      decision: {
        decision: 'NEED_PICS',
        buy_price: null,
        vehicle_class: null,
        data_source: null,
        confidence: null,
        reason: 'NO_COMPS',
        instruction: 'REQUEST_PHOTOS',
      },
      engineState: {
        n_comps: nOweComps,
        comp_tier: tier,
        anchor_owe: null,
        owe_base: null,
        avg_days: 0,
        avg_gross: 0,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
        adjustments: { km_adj: 0, year_adj: 0, trim_adj: 0, demand_adj: 0 },
      }
    };
  }
  
  // STEP 3: Determine vehicle class
  const { vehicleClass, avgDays, avgGross } = calculateVehicleClass(comps, input.make, input.model);
  
  console.log(`[ENGINE] Vehicle class: ${vehicleClass}, OWE base: $${oweBase}`);
  notes.push(`Class: ${vehicleClass}, OWE base: $${oweBase}`);
  
  // ================================================================
  // DNR CHECK - POISON vehicles
  // ================================================================
  if (vehicleClass === 'POISON') {
    notes.push('POISON: Repeat loser, recommending DNR');
    
    return {
      decision: {
        decision: 'DNR',
        buy_price: null,
        vehicle_class: 'POISON',
        data_source: 'OWN_SALES',
        confidence: null,
      },
      engineState: {
        n_comps: nOweComps,
        comp_tier: tier,
        anchor_owe: oweBase,
        owe_base: oweBase,
        avg_days: avgDays,
        avg_gross: avgGross,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
        adjustments: { km_adj: 0, year_adj: 0, trim_adj: 0, demand_adj: 0 },
      }
    };
  }
  
  // STEP 4: Calculate adjustments
  const { adjustments, applied } = calculateAdjustments(input, comps, vehicleClass);
  
  const totalAdjustment = adjustments.km_adj + adjustments.year_adj + adjustments.trim_adj + adjustments.demand_adj;
  
  // STEP 5: Calculate buy price
  let buyPrice = oweBase + totalAdjustment;
  
  // Sanity checks
  const maxOwe = Math.max(...comps.map(wc => wc.record.total_cost));
  const minOwe = Math.min(...comps.map(wc => wc.record.total_cost));
  
  // Cap HARD_WORK vehicles at max OWE
  if (vehicleClass === 'HARD_WORK' && buyPrice > maxOwe) {
    notes.push(`SANITY: Capped at max OWE $${maxOwe} (was $${buyPrice})`);
    buyPrice = maxOwe;
  }
  
  // Don't go below min OWE for any vehicle (floor protection)
  if (buyPrice < minOwe * 0.85) {
    notes.push(`SANITY: Floor at 85% min OWE $${Math.round(minOwe * 0.85)}`);
    buyPrice = Math.round(minOwe * 0.85);
  }
  
  // Round to clean figure ($500 increments)
  buyPrice = roundToCleanFigure(buyPrice);
  
  console.log(`[ENGINE] Adjustments: km=${adjustments.km_adj}, year=${adjustments.year_adj}, demand=${adjustments.demand_adj}`);
  console.log(`[ENGINE] Buy price: $${buyPrice} (base: $${oweBase}, adj: $${totalAdjustment})`);
  notes.push(`Buy: $${buyPrice} (base: $${oweBase} + adj: $${totalAdjustment})`);
  
  // STEP 6: Determine confidence
  const recentComps = comps.filter(wc => wc.recencyMonths <= 12);
  let confidence: Confidence;
  
  if (nOweComps >= 5 && recentComps.length >= 3) {
    confidence = 'HIGH';
  } else if (nOweComps >= 3 || recentComps.length >= 2) {
    confidence = 'MED';
  } else {
    confidence = 'LOW';
  }
  
  // STEP 7: Determine decision
  let finalDecision: BobDecision;
  
  // Check for price anomaly (>20% deviation from base)
  const deviation = Math.abs(buyPrice - oweBase) / oweBase;
  const forceSoftOwn = deviation > 0.2 && !isStrong;
  
  if (forceSoftOwn) {
    finalDecision = 'SOFT_OWN';
    notes.push('SANITY: >20% deviation, forcing SOFT_OWN');
  } else if (isStrong) {
    // Strong market vehicles - give firm price with even 1 comp
    finalDecision = 'PRICE_AVAILABLE';
    notes.push('STRONG_MARKET: Firm price');
  } else if (vehicleClass === 'HARD_WORK') {
    // Hard work with >= 2 comps = SOFT_OWN
    finalDecision = 'SOFT_OWN';
    notes.push('HARD_WORK: SOFT_OWN with tight cap');
  } else if (nOweComps === 1) {
    // Single comp on standard vehicle = SOFT_OWN
    finalDecision = 'SOFT_OWN';
    notes.push('Thin data (1 comp): SOFT_OWN');
  } else {
    // >= 2 comps on standard vehicle = PRICE_AVAILABLE
    finalDecision = 'PRICE_AVAILABLE';
  }
  
  return {
    decision: {
      decision: finalDecision,
      buy_price: buyPrice,
      vehicle_class: vehicleClass,
      data_source: 'OWN_SALES',
      confidence: confidence,
      adjustments_applied: applied.length > 0 ? applied : undefined,
    },
    engineState: {
      n_comps: nOweComps,
      comp_tier: tier,
      anchor_owe: oweBase,
      owe_base: oweBase,
      avg_days: avgDays,
      avg_gross: avgGross,
      notes,
      comps_used: compsUsed.slice(0, 10),
      processing_time_ms: Date.now() - startTime,
      adjustments,
    }
  };
}

// ============================================================================
// BOB'S LOCKED PHRASES - THE ONLY THINGS BOB CAN SAY
// ============================================================================

function formatPriceForSpeech(price: number): string {
  // Convert to "31" or "32" style for speech
  // $31,500 -> "31 and a half", $32,000 -> "32"
  const thousands = price / 1000;
  const whole = Math.floor(thousands);
  const remainder = thousands - whole;
  
  if (remainder >= 0.4 && remainder <= 0.6) {
    return `${whole} and a half`;
  }
  return whole.toString();
}

function generateBobScript(decision: DecisionObject): string {
  const priceStr = decision.buy_price ? formatPriceForSpeech(decision.buy_price) : '';
  
  switch (decision.decision) {
    case 'PRICE_AVAILABLE':
      // Firm buy - confident language
      if (decision.vehicle_class === 'FAST_MOVER') {
        return `Yeah mate, this one's an honest little fighter. Based on our book, I'd be about ${priceStr} buy, and I'd be happy to own it there.`;
      }
      return `Yeah mate, I'd be about ${priceStr} buy. Honest unit, happy to own it there.`;
      
    case 'SOFT_OWN':
      // Guarded buy - gives number but with caution, pics optional
      if (decision.vehicle_class === 'HARD_WORK') {
        return `Bit thin on our book for that one, mate. I'd be around ${priceStr} buy, and I wouldn't be stretching past it. If you want it nailed, flick a couple of pics.`;
      }
      return `Bit thin on our book, mate, but I can give you a steer. I'd be around ${priceStr} buy, and I wouldn't be stretching past it. If you want it nailed, flick a couple of pics.`;
      
    case 'NEED_PICS':
      // No price - escalate to photos
      return "Yeah nah, that one's hard work, shagger. I don't want to guess on it — flick me a few pics and I'll check with the boys.";
      
    case 'DNR':
      // Do not retail
      return "Wouldn't touch that, mate. That's hard work you let someone else own.";
      
    default:
      // Default fallback = SOFT_OWN behaviour (momentum > perfection)
      return "Bit of an oddball that one. Flick me a few pics and I'll have a proper squiz.";
  }
}

// ============================================================================
// NAME LOCK - Replace "Marker" with "Macka" globally
// ============================================================================

function applyNameLock(text: string): string {
  return text.replace(/\bMarker\b/gi, 'Macka');
}

// ============================================================================
// ACCENT GUARDRAIL - Prevent American tone drift
// ============================================================================

function applyAccentGuardrail(text: string): string {
  // TIGHT guardrail: Only replace a small list of obvious Americanisms
  // Avoid broad replacements that change meaning
  const replacements: [RegExp, string][] = [
    [/\bawesome\b/gi, "not bad"],
    [/\bgreat opportunity\b/gi, "if you're feeling lucky"],
    [/\blet's take a look\b/gi, "we can have a squiz"],
    [/\bno problem\b/gi, "no worries"],
  ];
  
  let result = text;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  
  return result;
}

// ============================================================================
// POST-PROCESSING PIPELINE - Apply all persona rules
// ============================================================================

function postProcessBobResponse(text: string): string {
  let result = text;
  result = applyNameLock(result);
  result = applyAccentGuardrail(result);
  return result;
}

// ============================================================================
// QUERY SALES DATA FROM Sales_Normalised
// ============================================================================

async function queryDealerSalesHistory(): Promise<SalesHistoryRecord[]> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials for sales query");
    return [];
  }
  
  try {
    console.log(`[ENGINE] Querying Sales_Normalised...`);
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/google-sheets`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "read",
        sheet: "Sales_Normalised"
      }),
    });
    
    if (!response.ok) {
      console.error("Failed to query sales history:", await response.text());
      return [];
    }
    
    const data = await response.json();
    const rawRecords = data.data || [];
    
    // Transform Sales_Normalised to SalesHistoryRecord format
    // OWE (total_cost) = sale_price - gross_profit
    const allRecords: SalesHistoryRecord[] = rawRecords.map((r: any) => {
      const salePrice = parseFloat(r.sale_price) || 0;
      const grossProfit = parseFloat(r.gross_profit) || 0;
      const totalCost = salePrice - grossProfit; // OWE = what we paid
      
      return {
        record_id: r.sale_id || r._rowIndex?.toString() || '',
        source: 'Sales_Normalised',
        dealer_name: r.dealer_name || '',
        imported_at: r.sale_date || '',
        stock_no: '',
        make: r.make || '',
        model: r.model || '',
        year: parseInt(r.year) || 0,
        variant: r.variant_normalised || r.variant_raw || '',
        variant_family: r.variant_family || '',
        body_type: '',
        transmission: r.transmission || '',
        drivetrain: r.drivetrain || '',
        engine: r.engine || '',
        sale_date: r.sale_date || '',
        days_in_stock: parseInt(r.days_to_sell) || 30,
        sell_price: salePrice,
        total_cost: totalCost, // OWE anchor
        gross_profit: grossProfit,
        km: parseInt(r.km) || undefined,
      };
    });
    
    console.log(`[ENGINE] Loaded ${allRecords.length} sales records from Sales_Normalised`);
    return allRecords;
    
  } catch (error) {
    console.error("Error querying sales history:", error);
    return [];
  }
}

// ============================================================================
// LOG VALO REQUEST TO DATABASE
// ============================================================================

async function logValoRequest(
  input: OancaInput,
  decision: DecisionObject,
  engineState: EngineState,
  dealerName: string | null,
  rawTranscript: string,
  bobResponse: string
): Promise<void> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials for logging");
    return;
  }
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { error } = await supabase.from('valo_requests').insert({
      dealer_name: dealerName,
      make: input.make,
      model: input.model,
      year: input.year,
      variant_family: input.variant_family || null,
      km: input.km || null,
      transmission: input.transmission || null,
      engine: input.engine || null,
      location: input.location || null,
      raw_transcript: rawTranscript,
      oanca_object: { decision, engineState },
      allow_price: decision.decision === 'PRICE_AVAILABLE' || decision.decision === 'SOFT_OWN',
      verdict: decision.decision,
      demand_class: decision.vehicle_class,
      confidence: decision.confidence,
      n_comps: engineState.n_comps,
      anchor_owe: engineState.anchor_owe,
      buy_low: decision.buy_price,
      buy_high: decision.buy_price,
      comps_used: engineState.comps_used,
      bob_response: bobResponse,
      processing_time_ms: engineState.processing_time_ms,
    });
    
    if (error) {
      console.error("Error logging valo request:", error);
    } else {
      console.log("[ENGINE] Request logged to valo_requests");
    }
  } catch (error) {
    console.error("Error logging valo request:", error);
  }
}

// ============================================================================
// EXTRACT VEHICLE FROM MESSAGE
// ============================================================================

function extractVehicleFromMessage(message: string): OancaInput | null {
  const text = message.toLowerCase();
  
  const makes = ['toyota', 'ford', 'holden', 'nissan', 'mazda', 'hyundai', 'kia', 'mitsubishi', 
                 'subaru', 'volkswagen', 'bmw', 'mercedes', 'audi', 'isuzu', 'land rover', 'jeep',
                 'honda', 'suzuki', 'lexus', 'porsche', 'volvo', 'ram', 'ldv', 'gwm', 'haval', 'mg',
                 'peugeot', 'citroen', 'renault', 'fiat', 'alfa romeo', 'mini', 'great wall', 'chery',
                 'chevrolet', 'chevy', 'gmc', 'dodge', 'cadillac'];
  
  let foundMake = '';
  for (const make of makes) {
    if (text.includes(make)) {
      if (make === 'chevy') {
        foundMake = 'Chevrolet';
      } else {
        foundMake = make.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
      break;
    }
  }
  
  const modelPatterns: Record<string, string[]> = {
    'Toyota': ['hilux', 'landcruiser', 'prado', 'rav4', 'corolla', 'camry', 'kluger', 'fortuner', 'hiace', '86', 'supra', 'chr', 'c-hr', 'yaris'],
    'Ford': ['ranger', 'everest', 'mustang', 'falcon', 'territory', 'focus', 'fiesta', 'escape', 'bronco', 'f150', 'f-150', 'f250', 'f-250', 'f350', 'f-350', 'raptor', 'super duty'],
    'Nissan': ['navara', 'patrol', 'pathfinder', 'x-trail', 'xtrail', 'qashqai', 'juke', 'pulsar', 'dualis', '370z', 'gtr'],
    'Mazda': ['bt-50', 'bt50', 'cx-5', 'cx5', 'cx-9', 'cx9', 'cx-3', 'cx3', 'mazda3', 'mazda6', 'mx-5', 'mx5'],
    'Holden': ['colorado', 'commodore', 'captiva', 'cruze', 'trax', 'astra', 'barina', 'ute', 'calais'],
    'Isuzu': ['d-max', 'dmax', 'mu-x', 'mux'],
    'Mitsubishi': ['triton', 'pajero', 'outlander', 'asx', 'eclipse', 'lancer', 'challenger'],
    'Hyundai': ['tucson', 'santa fe', 'santafe', 'i30', 'kona', 'venue', 'palisade', 'iload', 'accent', 'getz'],
    'Kia': ['sportage', 'sorento', 'cerato', 'seltos', 'carnival', 'stonic', 'rio', 'picanto'],
    'Volkswagen': ['amarok', 'tiguan', 'golf', 'polo', 'passat', 'transporter', 'crafter', 't-roc'],
    'Subaru': ['outback', 'forester', 'xv', 'wrx', 'brz', 'impreza', 'liberty', 'levorg'],
    'Peugeot': ['206', '207', '208', '306', '307', '308', '3008', '2008', '508', '5008'],
    'Renault': ['megane', 'clio', 'captur', 'koleos'],
    'Fiat': ['500', 'punto', 'tipo'],
    'Chevrolet': ['silverado', 'silverado 1500', 'silverado 2500', 'silverado 3500', 'colorado', 'camaro', 'corvette', 'tahoe', 'suburban'],
    'Ram': ['1500', '2500', '3500', 'ram 1500', 'ram 2500', 'ram 3500'],
    'Gmc': ['sierra', 'sierra 1500', 'sierra 2500', 'sierra 3500', 'yukon', 'canyon'],
    'Dodge': ['ram', 'challenger', 'charger', 'durango'],
    // European makes (add models so extraction works for Euro refusal)
    'Bmw': ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', '1 series', '2 series', '3 series', '4 series', '5 series', '6 series', '7 series', '8 series', 'm3', 'm4', 'm5', 'z4', 'i3', 'i4', 'i8', 'ix'],
    'Mercedes': ['a-class', 'a class', 'b-class', 'c-class', 'c class', 'e-class', 'e class', 's-class', 's class', 'cla', 'cls', 'gla', 'glb', 'glc', 'gle', 'gls', 'amg', 'sprinter', 'vito'],
    'Audi': ['a1', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'q2', 'q3', 'q5', 'q7', 'q8', 'tt', 'r8', 'rs3', 'rs4', 'rs5', 'rs6', 's3', 's4', 's5', 'e-tron', 'etron'],
    'Porsche': ['cayenne', 'macan', 'panamera', '911', 'carrera', 'boxster', 'cayman', 'taycan'],
    'Volvo': ['xc40', 'xc60', 'xc90', 's60', 's90', 'v40', 'v60', 'v90', 'c40'],
    'Land Rover': ['discovery', 'defender', 'range rover', 'evoque', 'velar', 'sport', 'freelander'],
    'Jaguar': ['f-pace', 'e-pace', 'i-pace', 'f-type', 'xe', 'xf', 'xj', 'x-type', 's-type'],
    'Alfa Romeo': ['giulia', 'stelvio', 'giulietta', 'mito', '159', '147', '156'],
  };
  
  let foundModel = '';
  for (const [make, models] of Object.entries(modelPatterns)) {
    for (const model of models) {
      if (text.includes(model)) {
        if (!foundMake) foundMake = make;
        foundModel = model.charAt(0).toUpperCase() + model.slice(1);
        break;
      }
    }
    if (foundModel) break;
  }
  
  const yearMatch = text.match(/\b(20[0-2]\d|199\d)\b/);
  const foundYear = yearMatch ? parseInt(yearMatch[1]) : 0;
  
  // Extract km if mentioned
  let km: number | undefined;
  const kmMatch = text.match(/(\d{2,3})[,\s]?(\d{3})?\s*(?:k|km|kms|kays)/i);
  if (kmMatch) {
    const kmStr = kmMatch[1] + (kmMatch[2] || '');
    km = parseInt(kmStr);
    if (km < 1000) km = km * 1000;
  }
  
  if (foundMake && foundModel && foundYear) {
    return { make: foundMake, model: foundModel, year: foundYear, km };
  }
  
  // If we have make + year but no model, use "Unknown" model
  // (Important: This allows Euro refusal to trigger even without specific model)
  if (foundMake && foundYear && !foundModel) {
    return { make: foundMake, model: 'Unknown', year: foundYear, km };
  }
  
  if (foundModel && foundYear) {
    for (const [make, models] of Object.entries(modelPatterns)) {
      if (models.some(m => foundModel.toLowerCase().includes(m))) {
        return { make, model: foundModel, year: foundYear, km };
      }
    }
  }
  
  return null;
}

// ============================================================================
// NUMBERS FIREWALL - HARD RUNTIME GATE
// ============================================================================

function runNumbersFirewall(
  bobResponse: string,
  decision: DecisionObject
): { blocked: boolean; correctedResponse: string } {
  // PRICE ALLOWED: PRICE_AVAILABLE or SOFT_OWN
  const priceAllowed = decision.decision === 'PRICE_AVAILABLE' || decision.decision === 'SOFT_OWN';
  
  // GATE 1: NO DIGITS WHEN NO PRICE
  if (!priceAllowed) {
    const dollarPattern = /\$\s*[\d,]+/gi;
    const kPattern = /\d+\s*k\b/gi;
    const anyDigitPattern = /\d{4,}/g;
    
    if (dollarPattern.test(bobResponse) || kPattern.test(bobResponse) || anyDigitPattern.test(bobResponse)) {
      console.error("[FIREWALL] BLOCKED: No price allowed but response contains digits");
      
      if (decision.decision === 'DNR') {
        return {
          blocked: true,
          correctedResponse: "Wouldn't touch that, mate. That's one you let someone else own.",
        };
      }
      
      return {
        blocked: true,
        correctedResponse: "Nah mate, I'm blind on that one. Flick me a couple of pics and I'll check with the boys.",
      };
    }
  }
  
  return { blocked: false, correctedResponse: bobResponse };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, conversationHistory, dealerName, includeDebug } = await req.json();
    
    if (!transcript || typeof transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract vehicle from message
    const vehicleInput = extractVehicleFromMessage(transcript);
    let decision: DecisionObject | null = null;
    let engineState: EngineState | null = null;
    let bobScript = '';
    
    if (vehicleInput) {
      console.log(`[BOB] Detected vehicle: ${vehicleInput.year} ${vehicleInput.make} ${vehicleInput.model}${vehicleInput.km ? ` @ ${vehicleInput.km}km` : ''}`);
      
      // ================================================================
      // EUROPEAN CAR HARD RULE - Check BEFORE pricing engine
      // Triggers ONLY when: European make AND pricing/valuation intent
      // Does NOT trigger for market trend questions
      // ================================================================
      const isEuro = isEuropeanMake(vehicleInput.make);
      const hasPricingIntent = detectPricingIntent(transcript);
      
      if (isEuro && hasPricingIntent) {
        console.log(`[BOB] EURO REFUSAL: ${vehicleInput.make} with pricing intent - automatic refusal`);
        
        bobScript = getEuropeanRefusalPhrase();
        
        // Create a mock decision for logging
        decision = {
          decision: 'DNR',
          buy_price: null,
          vehicle_class: 'POISON',
          data_source: null,
          confidence: null,
          reason: 'EURO_REFUSAL',
        };
        engineState = {
          n_comps: 0,
          comp_tier: null,
          anchor_owe: null,
          owe_base: null,
          avg_days: 0,
          avg_gross: 0,
          notes: ['EURO_REFUSAL: Automatic refusal for European make with pricing intent'],
          comps_used: [],
          processing_time_ms: 0,
          adjustments: { km_adj: 0, year_adj: 0, trim_adj: 0, demand_adj: 0 },
        };
      } else {
        // Load sales history
        const salesHistory = await queryDealerSalesHistory();
        
        // Run pricing engine
        const result = runPricingEngine(vehicleInput, salesHistory);
        decision = result.decision;
        engineState = result.engineState;
        
        // Generate Bob's locked phrase
        bobScript = generateBobScript(decision);
        
        console.log(`[BOB] Decision: ${decision.decision}, buy_price: ${decision.buy_price}, tier: ${engineState.comp_tier}`);
      }
    } else {
      // No vehicle detected - just chat
      bobScript = "Yeah mate, what've you got for me?";
    }

    // Run firewall
    let finalResponse = bobScript;
    if (decision) {
      const firewallResult = runNumbersFirewall(bobScript, decision);
      if (firewallResult.blocked) {
        console.log("[FIREWALL] Response blocked and corrected");
        finalResponse = firewallResult.correctedResponse;
      }
    }
    
    // ================================================================
    // POST-PROCESSING PIPELINE - Apply persona rules
    // ================================================================
    finalResponse = postProcessBobResponse(finalResponse);

    // Log the request
    if (vehicleInput && decision && engineState) {
      await logValoRequest(vehicleInput, decision, engineState, dealerName, transcript, finalResponse);
    }

    // Build response
    const responseBody: Record<string, unknown> = { 
      response: finalResponse,
      script: finalResponse,  // Explicit script field for Voice Bob
    };
    
    // Include debug info if requested (admin only)
    if (includeDebug && decision) {
      responseBody.decision = decision;
      responseBody.engineState = engineState;
    }

    console.log("[BOB] Response sent");

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Bob edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Something went wrong" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
