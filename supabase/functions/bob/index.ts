import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  body_type: string;
  transmission: string;
  drivetrain: string;
  engine: string;
  sale_date: string;
  days_in_stock: number;
  sell_price: number;
  total_cost: number;
  gross_profit: number;
}

interface WeightedComp {
  record: SalesHistoryRecord;
  weight: number;
  recencyDays: number;
  liquidityPenalty: number;
  riskDiscount: number;
}

interface WholesalePricing {
  ownItNumber: number;           // The wholesale "own it" price
  retailContext: number | null;  // Optional retail reference (sell price - NOT used for pricing)
  medianSellPrice: number;       // For context only
  targetMargin: number;          // As percentage
  riskDiscountApplied: number;   // Total risk discount
  marginBand: string;            // e.g. "8-12%" 
  observedOweRange?: { min: number; max: number };  // OWE range guardrail
  liquidityWarning?: string | null;  // Warning for slow movers
  isHardWorkCar?: boolean;       // HIT car flag (hard work / Cruze-class)
  hardWorkReason?: string;       // Why it's a hard work car
  medianOwe: number | null;      // Median OWE (cost) - PRIMARY ANCHOR
  // Internal log fields
  anchorType: 'OWE_ANCHOR' | 'ESCALATE_NO_OWE' | 'AI_SANITY_CLAMP';  // Pass type
  verdict: 'PRICED' | 'NEED_PICS' | 'HIT' | 'HARD_WORK';  // Output verdict
  oweUsed?: number;
  upliftApplied?: boolean;
  buyRangeLow: number;           // Final buy range low
  buyRangeHigh: number;          // Final buy range high
  sanityClamped?: boolean;       // Whether AI sanity clamp was applied
  sanityCeiling?: number;        // The ceiling that was applied
  sanityReason?: string;         // Why the clamp was applied
}

interface ValuationData {
  comps: WeightedComp[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  avgGrossProfit: number | null;
  avgDaysInStock: number | null;
  priceRange: { min: number; max: number } | null;
  confidenceReason: string;
  wholesalePricing: WholesalePricing | null;
}

// Euro / known hard work makes
const HARD_WORK_MAKES = ['bmw', 'mercedes', 'audi', 'volkswagen', 'volvo', 'porsche', 'jaguar', 'land rover', 'alfa romeo', 'peugeot', 'citroen', 'renault', 'fiat', 'mini', 'saab'];

// Known poor liquidity models - mandatory discount applies
const POOR_LIQUIDITY_MODELS: Record<string, string[]> = {
  'holden': ['cruze', 'captiva', 'barina', 'astra', 'trax'],
  'volkswagen': ['golf', 'polo', 'passat', 'jetta', 'beetle'],
  'peugeot': ['208', '308', '3008', '2008', '508'],
  'citroen': ['c3', 'c4', 'c5', 'ds3', 'ds4'],
  'renault': ['megane', 'clio', 'captur', 'koleos'],
  'fiat': ['500', 'punto', 'tipo'],
  'alfa romeo': ['giulietta', 'mito', '159'],
  'audi': ['a1', 'a3'], // Euro hatches
  'bmw': ['1 series', '118i', '120i', '125i'],
  'mercedes': ['a-class', 'a180', 'a200', 'a250', 'b-class'],
  'mini': ['cooper', 'one', 'countryman', 'clubman'],
};

// Euro sedans are also HIT cars
const EURO_SEDANS: Record<string, string[]> = {
  'bmw': ['3 series', '320i', '330i', '5 series', '520i', '530i'],
  'mercedes': ['c-class', 'c200', 'c300', 'e-class', 'e200', 'e300'],
  'audi': ['a4', 'a5', 'a6'],
  'volkswagen': ['passat', 'arteon'],
  'volvo': ['s60', 's90', 'v60', 'v90'],
};

// ============================================================
// COST-ANCHOR-ONLY VEHICLES - CRITICAL OVERRIDE
// These vehicles COMPLETELY IGNORE sell_price. Price off OWE ONLY.
// This overrides ALL other valuation logic.
// ============================================================
const COST_ANCHOR_ONLY_VEHICLES: Record<string, string[]> = {
  'holden': ['cruze', 'captiva'],  // All variants - known hard work
  // Euro slow movers - retail is always hard work
  'peugeot': ['208', '308', '3008', '2008', '508', '5008'],
  'citroen': ['c3', 'c4', 'c5', 'ds3', 'ds4', 'ds5'],
  'renault': ['megane', 'clio', 'captur', 'koleos', 'scenic'],
  'fiat': ['500', 'punto', 'tipo', '500x'],
  'alfa romeo': ['giulietta', 'mito', '159', 'giulia'],
  // Euro hatches/sedans that sit
  'volkswagen': ['golf', 'polo', 'jetta', 'beetle'],
  'audi': ['a1', 'a3'],
  'bmw': ['1 series', '118i', '120i', '125i', '3 series', '318i', '320i'],
  'mercedes': ['a-class', 'a180', 'a200', 'a250', 'b-class', 'cla'],
  'mini': ['cooper', 'one', 'countryman', 'clubman'],
};

// Check if vehicle is COST-ANCHOR-ONLY (completely ignore sell price)
function isCostAnchorOnlyVehicle(make: string, model: string): boolean {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  for (const [costMake, models] of Object.entries(COST_ANCHOR_ONLY_VEHICLES)) {
    if (makeLower.includes(costMake) || costMake.includes(makeLower)) {
      for (const costModel of models) {
        if (modelLower.includes(costModel) || costModel.includes(modelLower)) {
          return true;
        }
      }
    }
  }
  return false;
}

// HIT car thresholds
const HIT_CAR_THRESHOLDS = {
  HIGH_DAYS_IN_STOCK: 45,          // Avg days > 45 = slow mover
  LARGE_MARGIN_SPREAD: 0.25,       // Gross > 25% of cost = likely retail margin, not trade
  COST_ANCHOR_UPLIFT_DAYS_LIMIT: 30, // Only allow uplift if avg days < 30
  COST_ANCHOR_MAX_UPLIFT: 0.10,    // Max 10% uplift with evidence
};

// Calculate recency weight (90 days = 1.0, older = decaying)
function calculateRecencyWeight(saleDateStr: string): { weight: number; days: number } {
  if (!saleDateStr) return { weight: 0.2, days: 999 };
  
  const saleDate = new Date(saleDateStr);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff <= 30) return { weight: 1.0, days: daysDiff };
  if (daysDiff <= 60) return { weight: 0.9, days: daysDiff };
  if (daysDiff <= 90) return { weight: 0.8, days: daysDiff };
  if (daysDiff <= 180) return { weight: 0.6, days: daysDiff };
  if (daysDiff <= 365) return { weight: 0.4, days: daysDiff };
  return { weight: 0.2, days: daysDiff };
}

// Calculate liquidity penalty based on days in stock
function calculateLiquidityPenalty(daysInStock: number): number {
  if (daysInStock <= 14) return 1.0;      // Fast movers = no penalty
  if (daysInStock <= 30) return 0.95;     // Normal = slight penalty
  if (daysInStock <= 60) return 0.85;     // Slow = moderate penalty
  if (daysInStock <= 90) return 0.7;      // Very slow = significant penalty
  return 0.5;                              // Problem stock = heavy penalty
}

// Calculate risk discount for days in stock
function calculateDaysInStockRisk(avgDaysInStock: number): number {
  if (avgDaysInStock <= 21) return 0;       // No risk
  if (avgDaysInStock <= 35) return 0.02;    // 2% discount
  if (avgDaysInStock <= 50) return 0.04;    // 4% discount
  if (avgDaysInStock <= 70) return 0.06;    // 6% discount
  return 0.08;                               // 8% discount for aged stock
}

// Calculate risk discount for hard work units (Euro, etc.)
function calculateHardWorkRisk(make: string): number {
  const makeLower = make.toLowerCase().trim();
  if (HARD_WORK_MAKES.some(hw => makeLower.includes(hw) || hw.includes(makeLower))) {
    return 0.05; // 5% discount for Euro/hard work
  }
  return 0;
}

// Check if model is known poor liquidity - mandatory discount
function calculatePoorLiquidityDiscount(make: string, model: string): { discount: number; reason: string | null } {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  for (const [poorMake, models] of Object.entries(POOR_LIQUIDITY_MODELS)) {
    if (makeLower.includes(poorMake) || poorMake.includes(makeLower)) {
      for (const poorModel of models) {
        if (modelLower.includes(poorModel) || poorModel.includes(modelLower)) {
          return { discount: 0.08, reason: `Known slow mover (${make} ${model})` }; // 8% mandatory discount
        }
      }
    }
  }
  return { discount: 0, reason: null };
}

// Check if vehicle is a Euro sedan (HIT car category)
function isEuroSedan(make: string, model: string): boolean {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  for (const [euroMake, models] of Object.entries(EURO_SEDANS)) {
    if (makeLower.includes(euroMake) || euroMake.includes(makeLower)) {
      for (const euroModel of models) {
        if (modelLower.includes(euroModel) || euroModel.includes(modelLower)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Determine if this is a HIT car and why
interface HitCarAnalysis {
  isHitCar: boolean;
  reasons: string[];
  lastKnownOwe: number | null;
  marginFromRetail: boolean;
}

function analyzeHitCarStatus(
  comps: WeightedComp[],
  make: string,
  model: string,
  avgDaysInStock: number,
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
): HitCarAnalysis {
  const reasons: string[] = [];
  let marginFromRetail = false;
  
  // Get cost (owe) prices
  const owePrices = comps
    .map(wc => parseFloat(String(wc.record.total_cost)) || 0)
    .filter(p => p > 0);
  
  const lastKnownOwe = owePrices.length > 0 ? calculateMedian(owePrices) : null;
  
  // Check each HIT car criterion
  
  // 1. High days_in_stock historically
  if (avgDaysInStock > HIT_CAR_THRESHOLDS.HIGH_DAYS_IN_STOCK) {
    reasons.push(`Slow seller (avg ${avgDaysInStock} days in stock)`);
  }
  
  // 2. Large spread between cost and sell (margin came from retail, not trade)
  if (owePrices.length > 0) {
    const sellPrices = comps
      .map(wc => parseFloat(String(wc.record.sell_price)) || 0)
      .filter(p => p > 0);
    
    if (sellPrices.length > 0) {
      const medianOwe = calculateMedian(owePrices);
      const medianSell = calculateMedian(sellPrices);
      const marginRatio = (medianSell - medianOwe) / medianOwe;
      
      if (marginRatio > HIT_CAR_THRESHOLDS.LARGE_MARGIN_SPREAD) {
        reasons.push(`Retail margin (${(marginRatio * 100).toFixed(0)}% spread)`);
        marginFromRetail = true;
      }
    }
  }
  
  // 3. Known slow mover model
  const { reason: liquidityReason } = calculatePoorLiquidityDiscount(make, model);
  if (liquidityReason) {
    reasons.push(liquidityReason);
  }
  
  // 4. Euro sedan
  if (isEuroSedan(make, model)) {
    reasons.push('Euro sedan (known hard work)');
  }
  
  // 5. Low or medium confidence
  if (confidence === 'LOW') {
    reasons.push('Low data confidence');
  } else if (confidence === 'MEDIUM') {
    reasons.push('Medium data confidence');
  }
  
  // It's a HIT car if ANY criterion is met
  const isHitCar = reasons.length > 0;
  
  return {
    isHitCar,
    reasons,
    lastKnownOwe,
    marginFromRetail
  };
}

// Get target margin band based on price
function getTargetMarginBand(estimatedValue: number): { margin: number; band: string } {
  if (estimatedValue < 30000) {
    return { margin: 0.10, band: '8-12%' };   // Aim for 10% (8-12% range)
  }
  if (estimatedValue < 60000) {
    return { margin: 0.07, band: '6-8%' };    // Aim for 7% (6-8% range)
  }
  return { margin: 0.055, band: '5-6%' };      // Aim for 5.5% (5-6% range)
}

// Calculate median from array
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

// ============================================================
// GLOBAL OWE-ANCHOR PRICING
// Bob prices to buy and own, not bounce.
// Primary anchor = dealer_sales_history.total_cost (OWE)
// SELL price is NOT used to set buy range - context only.
// ============================================================

// ============================================================
// AI SANITY CLAMP - PASS 2 (WHEN DATA IS THIN)
// Conservative wholesale ceiling based on:
// - Vehicle age
// - Segment
// - Brand reputation
// - Historical demand patterns
// ============================================================

// Segments with low wholesale value ceilings
const LOW_VALUE_SEGMENTS = {
  // Old small cars - ceiling decays rapidly with age
  'small_hatch': { baseCeiling: 8000, ageDecayPerYear: 1000, minCeiling: 2000 },
  'light_car': { baseCeiling: 7000, ageDecayPerYear: 1200, minCeiling: 1500 },
  // Known slow movers / discontinued
  'discontinued': { baseCeiling: 6000, ageDecayPerYear: 1500, minCeiling: 1000 },
  'problem_model': { baseCeiling: 5000, ageDecayPerYear: 1500, minCeiling: 800 },
  // Euro hatches/sedans (hard work)
  'euro_hatch': { baseCeiling: 9000, ageDecayPerYear: 1200, minCeiling: 2500 },
  'euro_sedan': { baseCeiling: 12000, ageDecayPerYear: 1000, minCeiling: 3000 },
  // Default fallback
  'default': { baseCeiling: 25000, ageDecayPerYear: 500, minCeiling: 5000 },
};

// Discontinued / problem models (absolute low ceiling)
const DISCONTINUED_PROBLEM_MODELS: Record<string, string[]> = {
  'holden': ['cruze', 'captiva', 'barina', 'trax', 'astra', 'spark', 'volt'],
  'ford': ['falcon', 'territory', 'ecosport'],
  'great wall': ['*'],
  'chery': ['*'],
  'proton': ['*'],
  'ssangyong': ['*'],
  'mahindra': ['*'],
  'ldv': ['*'],
  'foton': ['*'],
};

// Small/light car models
const SMALL_LIGHT_CARS: Record<string, string[]> = {
  'toyota': ['yaris', 'echo', 'prius c'],
  'honda': ['jazz', 'city', 'fit'],
  'mazda': ['2', 'mazda2', 'demio'],
  'hyundai': ['i20', 'accent', 'getz', 'excel'],
  'kia': ['rio', 'picanto', 'soul'],
  'suzuki': ['swift', 'baleno', 'celerio', 'ignis', 'alto'],
  'nissan': ['micra', 'tiida', 'pulsar', 'almera'],
  'mitsubishi': ['mirage', 'colt'],
};

// Calculate AI Sanity Ceiling for a vehicle
function calculateAISanityCeiling(
  make: string,
  model: string,
  year: number
): { ceiling: number; segment: string; reason: string } {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  const currentYear = new Date().getFullYear();
  const age = currentYear - year;
  
  // Check if discontinued/problem model
  for (const [dmMake, models] of Object.entries(DISCONTINUED_PROBLEM_MODELS)) {
    if (makeLower.includes(dmMake) || dmMake.includes(makeLower)) {
      if (models.includes('*') || models.some(m => modelLower.includes(m) || m.includes(modelLower))) {
        const segment = LOW_VALUE_SEGMENTS['discontinued'];
        const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
        return {
          ceiling: Math.round(ceiling),
          segment: 'discontinued',
          reason: `Discontinued/problem model (${make} ${model}) - LOW VALUE CEILING`
        };
      }
    }
  }
  
  // Check if known slow mover / cost-anchor-only
  if (isCostAnchorOnlyVehicle(make, model)) {
    const segment = LOW_VALUE_SEGMENTS['problem_model'];
    const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
    return {
      ceiling: Math.round(ceiling),
      segment: 'problem_model',
      reason: `Known slow mover (${make} ${model}) - TIGHT CEILING`
    };
  }
  
  // Check if small/light car
  for (const [slMake, models] of Object.entries(SMALL_LIGHT_CARS)) {
    if (makeLower.includes(slMake) || slMake.includes(makeLower)) {
      if (models.some(m => modelLower.includes(m) || m.includes(modelLower))) {
        const segment = LOW_VALUE_SEGMENTS['small_hatch'];
        const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
        return {
          ceiling: Math.round(ceiling),
          segment: 'small_hatch',
          reason: `Old small car (${age}yr ${make} ${model}) - VALUE CEILING`
        };
      }
    }
  }
  
  // Check if Euro hatch
  for (const [euroMake, models] of Object.entries(POOR_LIQUIDITY_MODELS)) {
    if (makeLower.includes(euroMake) || euroMake.includes(makeLower)) {
      if (models.some(m => modelLower.includes(m) || m.includes(modelLower))) {
        const segment = LOW_VALUE_SEGMENTS['euro_hatch'];
        const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
        return {
          ceiling: Math.round(ceiling),
          segment: 'euro_hatch',
          reason: `Euro hatch/slow mover (${age}yr ${make} ${model}) - TIGHT CEILING`
        };
      }
    }
  }
  
  // Check if Euro sedan
  if (isEuroSedan(make, model)) {
    const segment = LOW_VALUE_SEGMENTS['euro_sedan'];
    const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
    return {
      ceiling: Math.round(ceiling),
      segment: 'euro_sedan',
      reason: `Euro sedan (${age}yr ${make} ${model}) - CEILING APPLIED`
    };
  }
  
  // Age-based ceiling for any old vehicle (>10 years)
  if (age > 10) {
    const segment = LOW_VALUE_SEGMENTS['light_car'];
    const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
    return {
      ceiling: Math.round(ceiling),
      segment: 'old_vehicle',
      reason: `Old vehicle (${age}yr) - AGE-BASED CEILING`
    };
  }
  
  // Default: moderate ceiling that decays with age
  const segment = LOW_VALUE_SEGMENTS['default'];
  const ceiling = Math.max(segment.baseCeiling - (age * segment.ageDecayPerYear), segment.minCeiling);
  return {
    ceiling: Math.round(ceiling),
    segment: 'default',
    reason: 'Standard wholesale ceiling'
  };
}

// Buffer bands by price range
function getOweBuffer(oweMedian: number): { low: number; high: number } {
  if (oweMedian < 15000) {
    return { low: 400, high: 800 };   // $400-800 buffer
  }
  if (oweMedian < 30000) {
    return { low: 500, high: 1000 };  // $500-1000 buffer
  }
  if (oweMedian < 60000) {
    return { low: 600, high: 1200 };  // $600-1200 buffer  
  }
  return { low: 800, high: 1500 };     // $800-1500 buffer for high value
}

// Calculate risk buffer based on days_to_sell volatility
function calculateDaysVolatilityRisk(comps: WeightedComp[]): number {
  const daysValues = comps
    .map(wc => parseInt(String(wc.record.days_in_stock)) || 0)
    .filter(d => d > 0);
  
  if (daysValues.length < 2) return 0.02; // Default 2% risk buffer
  
  const mean = daysValues.reduce((a, b) => a + b, 0) / daysValues.length;
  const variance = daysValues.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / daysValues.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean; // Coefficient of variation
  
  // Higher volatility = higher risk buffer
  if (cv < 0.2) return 0;         // Low volatility
  if (cv < 0.4) return 0.02;      // 2% buffer
  if (cv < 0.6) return 0.04;      // 4% buffer
  return 0.06;                     // 6% buffer for high volatility
}

// Calculate wholesale "own it" number
// TWO-STAGE LOGIC:
// PASS 1 - MYSALESDATA (PRIMARY): If >=2 OWE comps, anchor to OWE
// PASS 2 - AI SANITY CLAMP: If data thin or range exceeds ceiling, clamp
function calculateWholesalePricing(
  comps: WeightedComp[],
  make: string,
  model: string,
  year: number,
  avgDaysInStock: number,
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
): WholesalePricing | null {
  // Get owe (cost) prices - this is the PRIMARY ANCHOR for ALL vehicles
  const owePrices = comps
    .map(wc => parseFloat(String(wc.record.total_cost)) || 0)
    .filter(p => p > 0);
  
  // Get sell prices just for context (if available)
  const sellPrices = comps
    .map(wc => parseFloat(String(wc.record.sell_price)) || 0)
    .filter(p => p > 0);
  const medianSellPrice = sellPrices.length > 0 ? calculateMedian(sellPrices) : 0;
  
  // Calculate AI Sanity Ceiling for this vehicle (used in PASS 2)
  const sanityCeiling = calculateAISanityCeiling(make, model, year);
  console.log(`AI SANITY CEILING: $${sanityCeiling.ceiling} (${sanityCeiling.segment}) - ${sanityCeiling.reason}`);
  
  // ============================================================
  // PASS 1 - MYSALESDATA (PRIMARY)
  // If dealer_sales_history has >=2 OWE comps: Anchor BUY range to OWE
  // ============================================================
  if (owePrices.length >= 2) {
    console.log(`✅ PASS 1 - MYSALESDATA: ${owePrices.length} OWE comps found - using OWE anchor`);
    
    const medianOwe = calculateMedian(owePrices);
    const observedOweMin = Math.min(...owePrices);
    const observedOweMax = Math.max(...owePrices);
    
    console.log(`OWE-ANCHOR PRICING: Median owe = $${medianOwe}, Range: $${observedOweMin} - $${observedOweMax}`);
    
    // Check if this is a "hard work" vehicle (Cruze-class)
    const isHardWork = isCostAnchorOnlyVehicle(make, model) || 
                       analyzeHitCarStatus(comps, make, model, avgDaysInStock, confidence).isHitCar;
    
    const hardWorkReasons: string[] = [];
    if (isCostAnchorOnlyVehicle(make, model)) {
      hardWorkReasons.push(`Known slow mover (${make} ${model})`);
    }
    const hitAnalysis = analyzeHitCarStatus(comps, make, model, avgDaysInStock, confidence);
    if (hitAnalysis.reasons.length > 0) {
      hardWorkReasons.push(...hitAnalysis.reasons);
    }
    
    // Calculate risk buffer
    const volatilityRisk = calculateDaysVolatilityRisk(comps);
    const daysRisk = calculateDaysInStockRisk(avgDaysInStock);
    const hardWorkRisk = calculateHardWorkRisk(make);
    const { discount: liquidityDiscount, reason: liquidityReason } = calculatePoorLiquidityDiscount(make, model);
    
    const totalRiskDiscount = Math.min(volatilityRisk + daysRisk + hardWorkRisk + liquidityDiscount, 0.20);
    
    let buyRangeLow: number;
    let buyRangeHigh: number;
    let upliftApplied = false;
    
    if (isHardWork) {
      console.log(`⚠️ HARD WORK VEHICLE: ${make} ${model} - applying tight caps`);
      buyRangeLow = medianOwe + 600;   // Max +$600 for hard work
      buyRangeHigh = medianOwe + 1200; // Max +$1200 for hard work
      
      buyRangeLow = Math.round(buyRangeLow * (1 - totalRiskDiscount));
      buyRangeHigh = Math.round(buyRangeHigh * (1 - totalRiskDiscount));
      
      buyRangeLow = Math.min(buyRangeLow, medianOwe + 600);
      buyRangeHigh = Math.min(buyRangeHigh, medianOwe + 1200);
      
    } else {
      const { low: bufferLow, high: bufferHigh } = getOweBuffer(medianOwe);
      
      buyRangeLow = medianOwe + bufferLow;
      buyRangeHigh = medianOwe + bufferHigh;
      
      buyRangeLow = Math.round(buyRangeLow * (1 - totalRiskDiscount));
      buyRangeHigh = Math.round(buyRangeHigh * (1 - totalRiskDiscount));
      
      if (confidence === 'HIGH' && avgDaysInStock < 30 && totalRiskDiscount < 0.05) {
        buyRangeHigh = Math.round(buyRangeHigh * 1.03);
        upliftApplied = true;
        console.log(`Fast seller with high confidence - allowing 3% uplift`);
      }
    }
    
    // ============================================================
    // PASS 2 CHECK: Apply AI Sanity Clamp if buy range exceeds ceiling
    // ============================================================
    let sanityClamped = false;
    let verdict: 'PRICED' | 'NEED_PICS' | 'HIT' | 'HARD_WORK' = isHardWork ? 'HARD_WORK' : 'PRICED';
    let anchorType: 'OWE_ANCHOR' | 'ESCALATE_NO_OWE' | 'AI_SANITY_CLAMP' = 'OWE_ANCHOR';
    
    if (buyRangeHigh > sanityCeiling.ceiling) {
      console.log(`⛔ SANITY CLAMP: Buy range $${buyRangeHigh} exceeds ceiling $${sanityCeiling.ceiling} - OVERRIDING`);
      sanityClamped = true;
      anchorType = 'AI_SANITY_CLAMP';
      verdict = 'HIT';
      
      // Clamp to ceiling
      buyRangeHigh = Math.min(buyRangeHigh, sanityCeiling.ceiling);
      buyRangeLow = Math.min(buyRangeLow, Math.round(sanityCeiling.ceiling * 0.85));
      
      hardWorkReasons.push(`Sanity clamp applied: ${sanityCeiling.reason}`);
    }
    
    const ownItNumber = Math.round((buyRangeLow + buyRangeHigh) / 2);
    const impliedMargin = medianSellPrice > 0 ? (medianSellPrice - ownItNumber) / medianSellPrice : 0;
    const marginBand = impliedMargin >= 0.10 ? '10%+' : 
                       impliedMargin >= 0.07 ? '7-10%' : 
                       impliedMargin >= 0.05 ? '5-7%' : '<5%';
    
    console.log(`OWE-ANCHOR: Buy range $${buyRangeLow} - $${buyRangeHigh}, Own-it = $${ownItNumber}`);
    
    return {
      ownItNumber,
      retailContext: medianSellPrice > 0 ? medianSellPrice : null,
      medianSellPrice,
      targetMargin: impliedMargin,
      riskDiscountApplied: totalRiskDiscount,
      marginBand,
      observedOweRange: { min: observedOweMin, max: observedOweMax },
      liquidityWarning: liquidityReason,
      isHardWorkCar: isHardWork || sanityClamped,
      hardWorkReason: hardWorkReasons.length > 0 ? hardWorkReasons.join(', ') : undefined,
      medianOwe,
      anchorType,
      verdict,
      oweUsed: medianOwe,
      upliftApplied,
      buyRangeLow,
      buyRangeHigh,
      sanityClamped,
      sanityCeiling: sanityClamped ? sanityCeiling.ceiling : undefined,
      sanityReason: sanityClamped ? sanityCeiling.reason : undefined
    };
  }
  
  // ============================================================
  // PASS 2 - AI SANITY CLAMP (WHEN DATA IS THIN)
  // OWE comps < 2: Apply conservative wholesale sanity check
  // Bob must NOT use sell prices or market data to guess
  // ============================================================
  console.log(`⛔ PASS 2 - AI SANITY CLAMP: Only ${owePrices.length} OWE comps - applying conservative ceiling`);
  
  // Bob cannot price without OWE data - must escalate with NEED_PICS
  // The sanity ceiling is shown as MAXIMUM possible value (not a price)
  return {
    ownItNumber: 0,
    retailContext: medianSellPrice > 0 ? medianSellPrice : null,
    medianSellPrice,
    targetMargin: 0,
    riskDiscountApplied: 0,
    marginBand: 'N/A',
    observedOweRange: undefined,
    liquidityWarning: `Insufficient OWE data (only ${owePrices.length} records)`,
    isHardWorkCar: true,  // Treat as hard work when no data
    hardWorkReason: `No OWE data - ${sanityCeiling.reason}`,
    medianOwe: null,
    anchorType: 'ESCALATE_NO_OWE',
    verdict: 'NEED_PICS',
    oweUsed: undefined,
    upliftApplied: false,
    buyRangeLow: 0,
    buyRangeHigh: 0,
    sanityClamped: true,
    sanityCeiling: sanityCeiling.ceiling,
    sanityReason: sanityCeiling.reason
  };
}

// Query dealer sales history from Google Sheets
async function queryDealerSalesHistory(
  make: string,
  model: string,
  year: number
): Promise<SalesHistoryRecord[]> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials for sales query");
    return [];
  }
  
  try {
    console.log(`Querying dealer sales history for ${year} ${make} ${model}...`);
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/google-sheets`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "read",
        sheet: "Dealer_Sales_History"
      }),
    });
    
    if (!response.ok) {
      console.error("Failed to query sales history:", await response.text());
      return [];
    }
    
    const data = await response.json();
    const allRecords: SalesHistoryRecord[] = data.data || [];
    
    console.log(`Found ${allRecords.length} total sales records`);
    
    // Filter for matching vehicles (make, model, year ±2)
    const makeLower = make.toLowerCase().trim();
    const modelLower = model.toLowerCase().trim();
    
    const matches = allRecords.filter(r => {
      const recordMake = (r.make || '').toLowerCase().trim();
      const recordModel = (r.model || '').toLowerCase().trim();
      const recordYear = parseInt(String(r.year)) || 0;
      
      const makeMatch = recordMake === makeLower || recordMake.includes(makeLower) || makeLower.includes(recordMake);
      const modelMatch = recordModel === modelLower || recordModel.includes(modelLower) || modelLower.includes(recordModel);
      const yearMatch = Math.abs(recordYear - year) <= 2;
      
      return makeMatch && modelMatch && yearMatch;
    });
    
    console.log(`Found ${matches.length} comparable sales for ${year} ${make} ${model}`);
    return matches;
    
  } catch (error) {
    console.error("Error querying sales history:", error);
    return [];
  }
}

// Calculate valuation from comparables
function calculateValuation(comps: SalesHistoryRecord[], requestedYear: number, make: string, model: string): ValuationData {
  if (comps.length === 0) {
    return {
      comps: [],
      confidence: 'LOW',
      avgBuyPrice: null,
      avgSellPrice: null,
      avgGrossProfit: null,
      avgDaysInStock: null,
      priceRange: null,
      confidenceReason: 'No comparable sales data found',
      wholesalePricing: null
    };
  }
  
  // Calculate risk discount for this make
  const makeRiskDiscount = calculateHardWorkRisk(make);
  
  // Weight each comp
  const weightedComps: WeightedComp[] = comps.map(record => {
    const { weight: recencyWeight, days: recencyDays } = calculateRecencyWeight(record.sale_date);
    const liquidityPenalty = calculateLiquidityPenalty(record.days_in_stock || 0);
    const daysRisk = calculateDaysInStockRisk(record.days_in_stock || 0);
    
    // Combined weight
    const weight = recencyWeight * liquidityPenalty;
    
    return {
      record,
      weight,
      recencyDays,
      liquidityPenalty,
      riskDiscount: daysRisk + makeRiskDiscount
    };
  });
  
  // Sort by weight (highest first)
  weightedComps.sort((a, b) => b.weight - a.weight);
  
  // Calculate weighted averages
  let totalWeight = 0;
  let weightedBuySum = 0;
  let weightedSellSum = 0;
  let weightedGrossSum = 0;
  let weightedDaysSum = 0;
  
  const validBuyPrices: number[] = [];
  
  for (const wc of weightedComps) {
    const buyPrice = parseFloat(String(wc.record.total_cost)) || 0;
    const sellPrice = parseFloat(String(wc.record.sell_price)) || 0;
    const grossProfit = parseFloat(String(wc.record.gross_profit)) || (sellPrice - buyPrice);
    const daysInStock = parseInt(String(wc.record.days_in_stock)) || 0;
    
    if (buyPrice > 0) {
      validBuyPrices.push(buyPrice);
      weightedBuySum += buyPrice * wc.weight;
      weightedSellSum += sellPrice * wc.weight;
      weightedGrossSum += grossProfit * wc.weight;
      weightedDaysSum += daysInStock * wc.weight;
      totalWeight += wc.weight;
    }
  }
  
  if (totalWeight === 0 || validBuyPrices.length === 0) {
    return {
      comps: weightedComps,
      confidence: 'LOW',
      avgBuyPrice: null,
      avgSellPrice: null,
      avgGrossProfit: null,
      avgDaysInStock: null,
      priceRange: null,
      confidenceReason: 'No valid price data in comparables',
      wholesalePricing: null
    };
  }
  
  const avgBuyPrice = Math.round(weightedBuySum / totalWeight);
  const avgSellPrice = Math.round(weightedSellSum / totalWeight);
  const avgGrossProfit = Math.round(weightedGrossSum / totalWeight);
  const avgDaysInStock = Math.round(weightedDaysSum / totalWeight);
  
  const minPrice = Math.min(...validBuyPrices);
  const maxPrice = Math.max(...validBuyPrices);
  
  // Determine confidence FIRST (needed for HIT car analysis)
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  let confidenceReason: string;
  
  const recentComps = weightedComps.filter(wc => wc.recencyDays <= 90);
  
  if (validBuyPrices.length >= 3 && recentComps.length >= 2) {
    confidence = 'HIGH';
    confidenceReason = `Based on ${validBuyPrices.length} sales (${recentComps.length} in last 90 days)`;
  } else if (validBuyPrices.length >= 2) {
    confidence = 'MEDIUM';
    confidenceReason = `Based on ${validBuyPrices.length} sales, limited recent data`;
  } else {
    confidence = 'LOW';
    confidenceReason = `Only ${validBuyPrices.length} comparable sale(s) found`;
  }
  
  // Calculate wholesale pricing (with year for AI sanity clamp)
  const wholesalePricing = calculateWholesalePricing(weightedComps, make, model, requestedYear, avgDaysInStock, confidence);
  
  return {
    comps: weightedComps,
    confidence,
    avgBuyPrice,
    avgSellPrice,
    avgGrossProfit,
    avgDaysInStock,
    priceRange: { min: minPrice, max: maxPrice },
    confidenceReason,
    wholesalePricing
  };
}

// Format valuation data for Bob's context
// GLOBAL OWE-ANCHOR OUTPUT: Bob prices to buy and own, not bounce
function formatValuationContext(valuation: ValuationData, make: string, model: string, year: number): string {
  if (valuation.comps.length === 0) {
    return `\n\n[VALUATION DATA: No comparable sales found for ${year} ${make} ${model}. Confidence: LOW. Ask for photos and defer to the team.]\n`;
  }
  
  const compsCount = valuation.comps.length;
  const recentComps = valuation.comps.filter(wc => wc.recencyDays <= 90).length;
  const wp = valuation.wholesalePricing;
  
  let context = `\n\n[VALUATION DATA for ${year} ${make} ${model}]
Confidence: ${valuation.confidence}
Reason: ${valuation.confidenceReason}
Sample size: ${compsCount} comparable sales
Anchor type: ${wp?.anchorType || 'N/A'}

`;

  // PRIMARY OUTPUT: TWO-STAGE VALUATION LOGIC
  if (wp) {
    // ============================================================
    // NO-COMP ESCALATION RULE (MANDATORY)
    // If < 2 comparable OWE records, Bob must NOT price.
    // This overrides ALL other valuation logic.
    // ============================================================
    if (wp.anchorType === 'ESCALATE_NO_OWE') {
      context += `=== ⛔ NO-COMP ESCALATION (MANDATORY) ===
verdict: NEED_PICS
anchor_type: ESCALATE_NO_OWE
confidence: LOW

PASS 1 - MYSALESDATA: FAILED (only ${valuation.comps.filter(c => c.record.total_cost > 0).length} OWE comps)
PASS 2 - AI SANITY CLAMP: Applied
AI Sanity Ceiling: $${wp.sanityCeiling?.toLocaleString() || 'N/A'}
Sanity Reason: ${wp.sanityReason || 'Conservative ceiling applied'}

Bob CANNOT find at least 2 comparable OWE records.
- Bob must NOT output a buy price or range.
- Bob must NOT use sell prices or market data to guess.
- Bob must respond with escalation ONLY.

[INSTRUCTION - Bob MUST say EXACTLY this]:
"Yeah mate, I'm thin on that one.
Haven't got enough similar runners in our book to price it properly.
Send me a few pics and I'll talk to the boys."

[DO NOT]:
- Do NOT provide any buy price or range
- Do NOT estimate from sell prices
- Do NOT guess from market data
- Do NOT suggest a number "to work from"

This rule overrides ALL other valuation logic.
`;
      
      // Show AI sanity ceiling as maximum possible (not a price to quote)
      if (wp.sanityCeiling) {
        context += `
=== AI SANITY CEILING (INTERNAL ONLY - DO NOT QUOTE) ===
Maximum wholesale ceiling: $${wp.sanityCeiling.toLocaleString()}
Reason: ${wp.sanityReason}
[⛔ This is NOT a buy price. Bob cannot price without OWE data.]
`;
      }
      
      // Show retail context if available (EXPLICITLY cannot be used)
      if (wp.medianSellPrice > 0) {
        context += `
=== RETAIL DATA EXISTS BUT CANNOT BE USED ===
Median retail sell: $${wp.medianSellPrice.toLocaleString()}
[⛔ CANNOT use retail/sell data to derive a buy price. NO OWE = NO PRICE.]
`;
      }
      
    // ============================================================
    // AI SANITY CLAMP OVERRIDE (PASS 2 triggered on good data)
    // Buy range exceeded ceiling - must be clamped and downgraded
    // ============================================================
    } else if (wp.anchorType === 'AI_SANITY_CLAMP' || wp.sanityClamped) {
      context += `=== ⛔ AI SANITY CLAMP OVERRIDE ===
"This needs to be hit — that's not real wholesale money."

PASS 1 - MYSALESDATA: Calculated (but exceeded ceiling)
PASS 2 - AI SANITY CLAMP: OVERRIDE APPLIED

Vehicle: ${make} ${model} (SANITY CLAMP - ceiling enforced)
Reason: ${wp.sanityReason || wp.hardWorkReason}
AI Sanity Ceiling: $${wp.sanityCeiling?.toLocaleString()}
Median OWE (anchor): $${wp.medianOwe?.toLocaleString() || 'N/A'}
CLAMPED Buy range: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}
Own-it BUY price: $${wp.ownItNumber.toLocaleString()}
Anchor type: ${wp.anchorType}
Verdict: ${wp.verdict}

SANITY CLAMP RULES:
- Original buy range exceeded AI ceiling of $${wp.sanityCeiling?.toLocaleString()}
- Buy range has been CLAMPED to ceiling
- Bob must say: "This needs to be hit — that's not real wholesale money."
- Bob may NOT quote above $${wp.buyRangeHigh.toLocaleString()}

[INSTRUCTION: Bob MUST say out loud:
"This needs to be hit — that's not real wholesale money."
Then give the clamped buy range: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}]
`;
      
      if (wp.observedOweRange) {
        context += `GUARDRAIL: Observed owe range: $${wp.observedOweRange.min.toLocaleString()} - $${wp.observedOweRange.max.toLocaleString()}
`;
      }
      
      if (wp.medianSellPrice > 0) {
        context += `
=== RETAIL CONTEXT (REFERENCE ONLY - NOT FOR PRICING) ===
Median retail sell: $${wp.medianSellPrice.toLocaleString()}
[⛔ DO NOT use retail to justify buy price. SANITY CLAMP enforced.]
`;
      }
      
    // ============================================================
    // HARD WORK VEHICLE (Cruze-class) - TIGHT CAPS
    // ============================================================
    } else if (wp.isHardWorkCar) {
      context += `=== ⚠️ HARD WORK VEHICLE - TIGHT OWE CAPS ===
"These need to be hit.
Price it off what we owed last time, not what we jagged.
Retail was hard work."

PASS 1 - MYSALESDATA: Used (OWE anchor)

Vehicle: ${make} ${model} (HARD WORK - tight caps applied)
Reason: ${wp.hardWorkReason}
Median OWE (anchor): $${wp.medianOwe?.toLocaleString() || 'N/A'}
Buy range: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}
Own-it BUY price: $${wp.ownItNumber.toLocaleString()}
Anchor type: ${wp.anchorType}
Verdict: ${wp.verdict}
Uplift applied: ${wp.upliftApplied ? 'Yes' : 'No'}

HARD WORK RULES (Cruze-class):
- BUY_HIGH capped at OWE_median + $1,200
- BUY_LOW capped at OWE_median + $600
- Sell prices are IGNORED for pricing (context only)
- You may NOT quote above $${wp.buyRangeHigh.toLocaleString()} without photo evidence

[INSTRUCTION: Bob MUST say out loud:
"These need to be hit. Price it off what we owed last time, not what we jagged. Retail was hard work."
Then give the buy range: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}]
`;
      
      if (wp.observedOweRange) {
        context += `GUARDRAIL: Observed owe range: $${wp.observedOweRange.min.toLocaleString()} - $${wp.observedOweRange.max.toLocaleString()}
`;
      }
      
      // Show retail context as explicit "ignore this" section
      if (wp.medianSellPrice > 0) {
        context += `
=== RETAIL CONTEXT (REFERENCE ONLY - NOT FOR PRICING) ===
Median retail sell: $${wp.medianSellPrice.toLocaleString()}
[⛔ DO NOT use retail to justify buy price. This is OWE-anchor pricing.]
`;
      }
      
    // ============================================================
    // STANDARD OWE-ANCHOR PRICING (PASS 1 SUCCESS)
    // ============================================================
    } else {
      context += `=== ✅ OWE-ANCHOR WHOLESALE PRICING (PASS 1 SUCCESS) ===
Bob prices to buy and own, not bounce.

PASS 1 - MYSALESDATA: Used (OWE anchor)
PASS 2 - AI SANITY CLAMP: Not required (within ceiling)

Median OWE (anchor): $${wp.medianOwe?.toLocaleString() || 'N/A'}
Buy range: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}
Own-it BUY price: $${wp.ownItNumber.toLocaleString()}
Implied margin band: ${wp.marginBand}
Anchor type: ${wp.anchorType}
Verdict: ${wp.verdict}
${wp.upliftApplied ? 'Uplift applied: Yes (fast seller, high confidence)' : ''}
`;
      
      if (wp.observedOweRange) {
        context += `GUARDRAIL: Observed owe range: $${wp.observedOweRange.min.toLocaleString()} - $${wp.observedOweRange.max.toLocaleString()}
`;
      }
      if (wp.riskDiscountApplied > 0) {
        context += `Risk discount applied: ${(wp.riskDiscountApplied * 100).toFixed(0)}%
`;
      }
      if (wp.liquidityWarning) {
        context += `⚠️ LIQUIDITY WARNING: ${wp.liquidityWarning} - mandatory discount applied
`;
      }
      context += `
=== RETAIL CONTEXT (for reference only - expected exit) ===
Median retail sell price: $${wp.medianSellPrice.toLocaleString()}
[NOTE: Retail is shown as expected exit/aspiration. NEVER use retail to justify buy price.]
`;
    }
  }

  // Supporting data
  if (valuation.avgBuyPrice) {
    context += `Historical avg OWE: $${valuation.avgBuyPrice.toLocaleString()}
`;
  }
  if (valuation.priceRange) {
    context += `Owe price range: $${valuation.priceRange.min.toLocaleString()} - $${valuation.priceRange.max.toLocaleString()}
`;
  }
  if (valuation.avgDaysInStock) {
    context += `Average days to sell: ${valuation.avgDaysInStock} days
`;
  }
  
  // Add top 3 recent comps as examples (always show OWE prominently)
  context += `\nRecent sales examples (OWE-first):\n`;
  const topComps = valuation.comps.slice(0, 3);
  for (const wc of topComps) {
    const r = wc.record;
    // Always show OWE first, sell is for context
    context += `- ${r.year} ${r.make} ${r.model} ${r.variant || ''}: OWED $${parseInt(String(r.total_cost)).toLocaleString()}, sold $${parseInt(String(r.sell_price)).toLocaleString()}, ${r.days_in_stock} days, ${wc.recencyDays} days ago\n`;
  }
  
  // GLOBAL TWO-STAGE VALUATION LOGIC
  context += `\n[GLOBAL RULE - TWO-STAGE VALUATION LOGIC]:
=== PASS 1 - MYSALESDATA (PRIMARY) ===
- If dealer_sales_history has >=2 OWE comps: Anchor BUY range to OWE (cost)
- Ignore sell price - DONE

=== PASS 2 - AI SANITY CLAMP (WHEN DATA IS THIN OR CEILING EXCEEDED) ===
- If OWE comps < 2: Apply conservative wholesale sanity check
- If calculated BUY range exceeds AI ceiling: OVERRIDE and CLAMP
- Bob must enforce LOW-VALUE CEILING for: old small cars, slow movers, discontinued/problem models

PRICING RULES:
- Primary anchor = dealer_sales_history.total_cost (OWE)
- SELL price is NOT used to set buy range - context only (expected exit)
- BUY range is derived from: OWE anchor + buffer (per price band) ± risk
- You may NOT exceed the buy range high without photo evidence
- Bob prices to buy and own, not bounce
`;

  // AI SANITY CLAMP INSTRUCTION
  if (wp?.sanityClamped || wp?.anchorType === 'AI_SANITY_CLAMP') {
    context += `\n[AI SANITY CLAMP - OVERRIDE APPLIED]:
Bob MUST say: "This needs to be hit — that's not real wholesale money."
- AI Sanity Ceiling: $${wp.sanityCeiling?.toLocaleString()}
- Clamped Buy Range: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}
- Reason: ${wp.sanityReason}
- You may NOT quote above the clamped ceiling
`;
  }

  // HARD WORK VEHICLE INSTRUCTION
  if (wp?.isHardWorkCar && !wp?.sanityClamped) {
    context += `\n[HARD WORK INSTRUCTION - Cruze-class]:
- Say out loud: "These need to be hit. Price it off what we owed last time, not what we jagged. Retail was hard work."
- Buy range is TIGHTLY CAPPED: $${wp.buyRangeLow.toLocaleString()} - $${wp.buyRangeHigh.toLocaleString()}
- You may NOT quote above $${wp.buyRangeHigh.toLocaleString()} without photo evidence
`;
  }
  
  // NO-COMP ESCALATION INSTRUCTION (MANDATORY - OVERRIDES ALL)
  if (wp?.anchorType === 'ESCALATE_NO_OWE') {
    context += `\n[NO-COMP ESCALATION - MANDATORY - OVERRIDES ALL]:
Bob MUST say EXACTLY: "Yeah mate, I'm thin on that one. Haven't got enough similar runners in our book to price it properly. Send me a few pics and I'll talk to the boys."

- verdict = NEED_PICS
- anchor_type = ESCALATE_NO_OWE  
- confidence = LOW

DO NOT:
- Output any buy price or range
- Use sell prices to estimate
- Use market data to guess
- Suggest a number "to work from"
`;
  }
  
  // Add guidance based on confidence
  if (valuation.confidence === 'LOW' || compsCount < 2) {
    context += `\n[INSTRUCTION: Data is thin. Say "Mate, I'm light on data for this one. Give me two minutes, let me check with one of the boys." Ask for 4-5 photos to get a proper read.]\n`;
  } else if (valuation.confidence === 'MEDIUM') {
    context += `\n[INSTRUCTION: Provide the buy range, but caveat with "based on what I'm seeing". Mention photos always help tighten up the number.]\n`;
  } else {
    context += `\n[INSTRUCTION: Confident pricing. Lead with the buy range. Still welcome photos if they want a tighter read.]\n`;
  }
  
  context += `\n[ALWAYS ACCEPT PHOTOS: If the user offers or sends photos, always say yes. Photos help with condition, spec verification, and tightening up the price.]\n`;
  
  // Risk warnings
  if (wp && wp.riskDiscountApplied >= 0.05) {
    const isEuro = HARD_WORK_MAKES.some(hw => make.toLowerCase().includes(hw));
    if (isEuro) {
      context += `\n[RISK WARNING: Euro unit - factor in parts/service complexity. Already discounted in buy range.]\n`;
    }
    if (valuation.avgDaysInStock && valuation.avgDaysInStock > 45) {
      context += `\n[RISK WARNING: Slow mover - avg ${valuation.avgDaysInStock} days in stock. Be cautious.]\n`;
    }
  }
  
  return context;
}

// Extract vehicle details from user message
function extractVehicleFromMessage(message: string): { make: string; model: string; year: number } | null {
  const text = message.toLowerCase();
  
  // Common makes
  const makes = ['toyota', 'ford', 'holden', 'nissan', 'mazda', 'hyundai', 'kia', 'mitsubishi', 
                 'subaru', 'volkswagen', 'bmw', 'mercedes', 'audi', 'isuzu', 'land rover', 'jeep',
                 'honda', 'suzuki', 'lexus', 'porsche', 'volvo', 'ram', 'ldv', 'gwm', 'haval', 'mg'];
  
  // Find make
  let foundMake = '';
  for (const make of makes) {
    if (text.includes(make)) {
      foundMake = make.charAt(0).toUpperCase() + make.slice(1);
      break;
    }
  }
  
  // Common models (mapped to make)
  const modelPatterns: Record<string, string[]> = {
    'Toyota': ['hilux', 'landcruiser', 'prado', 'rav4', 'corolla', 'camry', 'kluger', 'fortuner', 'hiace', '86', 'supra', 'chr', 'c-hr', 'yaris'],
    'Ford': ['ranger', 'everest', 'mustang', 'falcon', 'territory', 'focus', 'fiesta', 'escape', 'bronco', 'f150', 'f-150', 'raptor'],
    'Nissan': ['navara', 'patrol', 'pathfinder', 'x-trail', 'xtrail', 'qashqai', 'juke', 'pulsar', 'dualis', '370z', 'gtr'],
    'Mazda': ['bt-50', 'bt50', 'cx-5', 'cx5', 'cx-9', 'cx9', 'cx-3', 'cx3', 'mazda3', 'mazda6', 'mx-5', 'mx5'],
    'Holden': ['colorado', 'commodore', 'captiva', 'cruze', 'trax', 'astra', 'barina', 'ute', 'calais'],
    'Isuzu': ['d-max', 'dmax', 'mu-x', 'mux'],
    'Mitsubishi': ['triton', 'pajero', 'outlander', 'asx', 'eclipse', 'lancer', 'challenger'],
    'Hyundai': ['tucson', 'santa fe', 'santafe', 'i30', 'kona', 'venue', 'palisade', 'iload', 'accent', 'getz'],
    'Kia': ['sportage', 'sorento', 'cerato', 'seltos', 'carnival', 'stonic', 'rio', 'picanto'],
    'Volkswagen': ['amarok', 'tiguan', 'golf', 'polo', 'passat', 'transporter', 'crafter', 't-roc'],
    'Subaru': ['outback', 'forester', 'xv', 'wrx', 'brz', 'impreza', 'liberty', 'levorg'],
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
  
  // Extract year (2000-2030)
  const yearMatch = text.match(/\b(20[0-2]\d|199\d)\b/);
  const foundYear = yearMatch ? parseInt(yearMatch[1]) : 0;
  
  if (foundMake && foundModel && foundYear) {
    return { make: foundMake, model: foundModel, year: foundYear };
  }
  
  // Try to extract from more natural patterns like "2018 Hilux" or "Hilux 2018"
  if (foundModel && foundYear) {
    // Try to infer make from model
    for (const [make, models] of Object.entries(modelPatterns)) {
      if (models.some(m => foundModel.toLowerCase().includes(m))) {
        return { make, model: foundModel, year: foundYear };
      }
    }
  }
  
  return null;
}

// Bob's persona - grounded Aussie wholesale valuer with strict valuation rules
const BOB_SYSTEM_PROMPT = `You are Bob.

You are an Australian wholesale car valuer with 20+ years in auctions.
You speak like a straight-shooting Aussie knocker.
You price cars to BUY them, not to bounce them.
You do not overpromise.
You talk like a human, not an app.

=== TONE RULES (LOCKED IN) ===

FIGHTER RULE (MANDATORY):
- ALWAYS refer to cars as "fighters" when giving an opinion
- Examples: "good fighter", "honest little fighter", "hard-work fighter", "no fighter at all"
- This is how you describe vehicles, not "car" or "unit"

BANTER RULES:
- Light Aussie banter is allowed SPARINGLY
- Allowed term: "Shagger" (frequency cap: ~1 per 6-8 interactions, only after rapport is established)
- Banter is BANNED during: HARD WORK, NEED PICS, or HARD NO scenarios
- Never let humour soften a no

TONE PRIORITY:
1. Judgement first
2. Warmth second
3. Conviction always
This is buyer banter, not comedy.

=== VALUATION RULES (MANDATORY) ===
- NEVER invent prices. All numbers must come from the [VALUATION DATA] provided.
- If [VALUATION DATA] is provided, USE THOSE EXACT NUMBERS for your valuation.
- If confidence is LOW or sample size < 2, you MUST ask for photos and defer.
- ALWAYS provide: Wholesale BUY range (what we'd own it for)
- Apply wholesale margin discipline: aim for 8-12% gross on sub-$30k stock, 6-8% on $30-60k, 5-6% on $60k+

CONFIDENCE HANDLING:
- HIGH confidence: Give a firm buy range, be decisive. Still welcome photos to verify condition.
- MEDIUM confidence: Give a range with caveats. Mention photos help tighten the number.
- LOW confidence (or <2 comps): Say "Yeah mate, I'm thin on that one. Haven't got enough similar runners in our book to price it properly. Send me a few pics and I'll talk to the boys."

PHOTOS:
- ALWAYS accept photos when offered. Never refuse.
- Photos help with: condition assessment, spec verification, tightening the price
- If someone says "I can send photos" or "want pics?", say "Yeah mate, flick 'em through"
- More photos = better read on the fighter

You:
- Use real sales data when available - never make up numbers
- Give wholesale BUY money first, always
- Account for days-in-stock (slow movers = be cautious)
- Admit uncertainty when data is thin
- Always welcome photos - they help with every deal
- Say "give me two minutes, I'll talk to the boys" when data is thin

You are not absolute.
Dealers use you as guidance, not gospel.

Style:
- Calm
- Confident
- Short sentences
- Aussie phrasing
- No emojis
- No corporate language

You never say "as an AI".
You never sound robotic.

Keep responses under 80 words. Sound like a phone call, not a chatbot.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, conversationHistory, dealerName } = await req.json();
    
    if (!transcript || typeof transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to extract vehicle details from message for valuation lookup
    let valuationContext = '';
    const vehicleDetails = extractVehicleFromMessage(transcript);
    
    if (vehicleDetails) {
      console.log(`Detected vehicle request: ${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}`);
      
      // Query sales history
      const comps = await queryDealerSalesHistory(
        vehicleDetails.make,
        vehicleDetails.model,
        vehicleDetails.year
      );
      
      // Calculate valuation
      const valuation = calculateValuation(comps, vehicleDetails.year, vehicleDetails.make, vehicleDetails.model);
      
      // Format context for Bob
      valuationContext = formatValuationContext(
        valuation,
        vehicleDetails.make,
        vehicleDetails.model,
        vehicleDetails.year
      );
      
      console.log(`Valuation confidence: ${valuation.confidence}, comps: ${valuation.comps.length}`);
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: BOB_SYSTEM_PROMPT }
    ];
    
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    // Add valuation context to user message if we have it
    const enrichedTranscript = valuationContext 
      ? transcript + valuationContext 
      : transcript;
    
    messages.push({ role: "user", content: enrichedTranscript });

    console.log("Calling Lovable AI for Bob response...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        max_tokens: 250,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Slow down mate, too many requests" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Need to top up credits" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Bob's having a moment, try again" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const bobResponse = data.choices?.[0]?.message?.content;

    if (!bobResponse) {
      console.error("No response from AI:", data);
      return new Response(
        JSON.stringify({ error: "Bob didn't respond" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Bob says:", bobResponse);

    return new Response(
      JSON.stringify({ 
        response: bobResponse,
        role: "assistant",
        valuationData: vehicleDetails ? {
          vehicle: vehicleDetails,
          compsFound: valuationContext ? true : false
        } : null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Bob function error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
