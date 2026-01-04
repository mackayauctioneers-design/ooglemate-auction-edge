import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// OANCA ENGINE v2 - DETERMINISTIC PRICING
// ============================================================================
// Bob/ChatGPT is a NARRATOR only. OANCA is the SOLE VALUER.
// RULE: SELL prices NEVER set BUY prices.
// RULE: OWE (total_cost) is the ONLY anchor.
// RULE: n_comps >= 2 required to price. Otherwise REQUEST_PICS.
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
}

interface WeightedComp {
  record: SalesHistoryRecord;
  weight: number;
  recencyMonths: number;
}

// ============================================================================
// LOCALE & CURRENCY LOCK - AUSTRALIA / AUD ONLY
// ============================================================================

const DEFAULT_MARKET = 'AU';
const DEFAULT_CURRENCY = 'AUD';

// ============================================================================
// OANCA_PRICE_OBJECT - THE ONLY SOURCE OF TRUTH FOR BOB
// ============================================================================

type OancaVerdict = 'BUY' | 'HIT_IT' | 'HARD_WORK' | 'NEED_PICS' | 'WALK' | 'ESCALATE';
type DemandClass = 'fast' | 'average' | 'hard_work' | 'poison';
type OancaConfidence = 'HIGH' | 'MED' | 'LOW';

interface OancaPriceObject {
  allow_price: boolean;
  verdict: OancaVerdict;
  buy_low: number | null;
  buy_high: number | null;
  anchor_owe: number | null;
  anchor_owe_p75: number | null;  // 75th percentile for cap enforcement
  demand_class: DemandClass | null;
  confidence: OancaConfidence | null;
  n_comps: number;
  notes: string[];
  retail_context_low: number | null;
  retail_context_high: number | null;
  market: string;
  currency: string;
  floor_applied: boolean;
  cap_applied: boolean;  // Track when hard_work cap enforced
  escalation_reason: string | null;
  firewall_triggered: boolean;  // Log firewall activations
  comps_used: string[];
  processing_time_ms?: number;
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
// HIGH-VALUE AMERICAN TRUCKS - REQUIRE ESCALATION IF NO STRONG COMPS
// ============================================================================

const HIGH_VALUE_AMERICAN_TRUCKS: Record<string, string[]> = {
  'chevrolet': ['silverado', 'silverado 1500', 'silverado 2500', 'silverado 3500', 'colorado'],
  'ram': ['1500', '2500', '3500', 'ram 1500', 'ram 2500', 'ram 3500'],
  'ford': ['f150', 'f-150', 'f250', 'f-250', 'f350', 'f-350', 'super duty'],
  'gmc': ['sierra', 'sierra 1500', 'sierra 2500', 'sierra 3500'],
  'dodge': ['ram', 'ram 1500', 'ram 2500', 'ram 3500'],
};

const HEAVY_DUTY_TRUCK_FLOORS_AUD: Record<string, number> = {
  'silverado_2500': 55000,
  'silverado_3500': 60000,
  'ram_2500': 55000,
  'ram_3500': 60000,
  'f250': 50000,
  'f350': 55000,
  'sierra_2500': 55000,
  'sierra_3500': 60000,
};

function isHighValueAmericanTruck(make: string, model: string): boolean {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();
  
  for (const [truckMake, models] of Object.entries(HIGH_VALUE_AMERICAN_TRUCKS)) {
    if (makeLower.includes(truckMake) || truckMake.includes(makeLower)) {
      for (const truckModel of models) {
        if (modelLower.includes(truckModel) || truckModel.includes(modelLower)) {
          return true;
        }
      }
    }
  }
  return false;
}

function getHeavyDutyFloor(make: string, model: string): number | null {
  const modelLower = model.toLowerCase().trim();
  
  if (modelLower.includes('2500') || modelLower.includes('3500') ||
      modelLower.includes('f-250') || modelLower.includes('f250') ||
      modelLower.includes('f-350') || modelLower.includes('f350')) {
    
    const makeLower = make.toLowerCase().trim();
    
    if (makeLower.includes('chevrolet') || makeLower.includes('chevy')) {
      return modelLower.includes('3500') ? HEAVY_DUTY_TRUCK_FLOORS_AUD['silverado_3500'] : HEAVY_DUTY_TRUCK_FLOORS_AUD['silverado_2500'];
    }
    if (makeLower.includes('ram') || makeLower.includes('dodge')) {
      return modelLower.includes('3500') ? HEAVY_DUTY_TRUCK_FLOORS_AUD['ram_3500'] : HEAVY_DUTY_TRUCK_FLOORS_AUD['ram_2500'];
    }
    if (makeLower.includes('ford')) {
      return modelLower.includes('350') ? HEAVY_DUTY_TRUCK_FLOORS_AUD['f350'] : HEAVY_DUTY_TRUCK_FLOORS_AUD['f250'];
    }
    if (makeLower.includes('gmc')) {
      return modelLower.includes('3500') ? HEAVY_DUTY_TRUCK_FLOORS_AUD['sierra_3500'] : HEAVY_DUTY_TRUCK_FLOORS_AUD['sierra_2500'];
    }
  }
  
  return null;
}

function shouldForceEscalation(input: OancaInput, nComps: number): { escalate: boolean; reason: string | null } {
  const isAmericanTruck = isHighValueAmericanTruck(input.make, input.model);
  const isHighValue = input.year >= 2018;
  const hasWeakData = nComps < 3;
  
  if (isAmericanTruck && isHighValue && hasWeakData) {
    return {
      escalate: true,
      reason: `High-value American truck (${input.year} ${input.make} ${input.model}) with insufficient AU comps (n=${nComps}). Requires: location, link (Carsales/Pickles), or photos.`
    };
  }
  
  return { escalate: false, reason: null };
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
// KNOWN PROBLEM VEHICLES (HARD WORK OVERRIDES)
// These vehicles are KNOWN slow movers. Override to hard_work regardless of data.
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
// DEMAND CLASS CALCULATION
// Based on days_in_stock + gross profit patterns from history
// ============================================================================

function calculateDemandClass(comps: WeightedComp[]): { demandClass: DemandClass; reason: string; avgDays: number; avgGross: number } {
  if (comps.length === 0) {
    return { demandClass: 'hard_work', reason: 'No data', avgDays: 45, avgGross: 0 };
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
    return { 
      demandClass: 'poison', 
      reason: `Repeat loser (${lossCount}/${grossValues.length} losses, avg gross $${avgGross.toFixed(0)})`,
      avgDays,
      avgGross
    };
  }
  
  if (avgDays <= 21 && avgGross >= 2000) {
    return { 
      demandClass: 'fast', 
      reason: `Fast seller (avg ${avgDays.toFixed(0)} days, $${avgGross.toFixed(0)} gross)`,
      avgDays,
      avgGross
    };
  }
  
  if (avgDays <= 35 && avgGross >= 1000) {
    return { 
      demandClass: 'average', 
      reason: `Average demand (${avgDays.toFixed(0)} days)`,
      avgDays,
      avgGross
    };
  }
  
  // Slow mover or thin margin = hard_work
  if (avgDays > 45 || avgGross < 1500) {
    return { 
      demandClass: 'hard_work', 
      reason: `Slow mover (avg ${avgDays.toFixed(0)} days, $${avgGross.toFixed(0)} gross)`,
      avgDays,
      avgGross
    };
  }
  
  return { demandClass: 'average', reason: `Standard demand`, avgDays, avgGross };
}

// ============================================================================
// OWE STATISTICS CALCULATION
// Returns median, p75, max for OWE anchor computation
// ============================================================================

function calculateOweStats(comps: WeightedComp[]): { 
  median: number | null; 
  p75: number | null;
  max: number | null;
  weightedMedian: number | null;
} {
  const oweData = comps
    .filter(wc => wc.record.total_cost > 0)
    .map(wc => ({ owe: wc.record.total_cost, weight: wc.weight }));
  
  if (oweData.length === 0) return { median: null, p75: null, max: null, weightedMedian: null };
  
  // Sort by OWE for percentile calculations
  const sortedOwe = oweData.map(d => d.owe).sort((a, b) => a - b);
  
  // Simple median
  const median = sortedOwe[Math.floor(sortedOwe.length / 2)];
  
  // 75th percentile
  const p75Index = Math.floor(sortedOwe.length * 0.75);
  const p75 = sortedOwe[p75Index] || sortedOwe[sortedOwe.length - 1];
  
  // Max
  const max = sortedOwe[sortedOwe.length - 1];
  
  // Weighted median
  const totalWeight = oweData.reduce((sum, d) => sum + d.weight, 0);
  let cumWeight = 0;
  let weightedMedian = median;
  
  oweData.sort((a, b) => a.owe - b.owe);
  for (const d of oweData) {
    cumWeight += d.weight;
    if (cumWeight >= totalWeight / 2) {
      weightedMedian = d.owe;
      break;
    }
  }
  
  return { median, p75, max, weightedMedian };
}

// ============================================================================
// BUY RANGE CALCULATION
// CRITICAL: OWE is the ONLY anchor. SELL never sets BUY.
// For hard_work: buy_high <= p75 + 500
// For poison: buy_high <= median
// ============================================================================

function calculateBuyRange(
  oweStats: { median: number | null; p75: number | null; max: number | null; weightedMedian: number | null },
  demandClass: DemandClass,
  avgDays: number,
  avgGross: number
): { buyLow: number; buyHigh: number; capApplied: boolean; notes: string[] } {
  const notes: string[] = [];
  let capApplied = false;
  
  const anchorOwe = oweStats.weightedMedian || oweStats.median!;
  const p75 = oweStats.p75 || anchorOwe;
  
  let buyLow: number;
  let buyHigh: number;
  
  switch (demandClass) {
    case 'poison':
      // WALK territory - severely discounted, cap at median
      buyLow = Math.round(anchorOwe * 0.80);
      buyHigh = Math.round(anchorOwe * 0.88);
      // Enforce cap: buy_high <= median
      if (buyHigh > anchorOwe) {
        buyHigh = anchorOwe;
        capApplied = true;
        notes.push(`POISON CAP: Capped at median OWE $${anchorOwe.toLocaleString()}`);
      }
      notes.push('POISON: Severely discounted due to repeat losses');
      break;
      
    case 'hard_work':
      // HIT_IT territory - conservative, cap at p75 + $500
      buyLow = Math.round(anchorOwe * 0.90);
      buyHigh = Math.round(anchorOwe * 0.97);
      
      // CRITICAL RULE: For hard_work, buy_high <= p75 + $500
      // This prevents retail outliers from inflating the range
      const hardWorkCap = p75 + 500;
      if (buyHigh > hardWorkCap) {
        buyHigh = hardWorkCap;
        capApplied = true;
        notes.push(`HARD_WORK CAP: Capped at p75+500 = $${hardWorkCap.toLocaleString()}`);
      }
      
      // Apply additional risk discounts
      if (avgDays > 60) {
        const discount = Math.round(anchorOwe * 0.03);  // 3% for very slow
        buyLow -= discount;
        buyHigh -= discount;
        notes.push(`VELOCITY DISCOUNT: -$${discount.toLocaleString()} for ${Math.round(avgDays)} day avg`);
      }
      
      notes.push('HARD_WORK: Discounted for slow velocity');
      break;
      
    case 'average':
      // Standard wholesale buffer
      buyLow = anchorOwe;
      buyHigh = Math.round(anchorOwe + (anchorOwe < 20000 ? 800 : anchorOwe < 40000 ? 1000 : 1200));
      notes.push('AVERAGE: Standard wholesale buffer applied');
      break;
      
    case 'fast':
      // Allow small uplift for proven fast sellers
      buyLow = anchorOwe;
      buyHigh = Math.round(anchorOwe + (anchorOwe < 20000 ? 1000 : anchorOwe < 40000 ? 1200 : 1500));
      notes.push('FAST: Small uplift for proven velocity');
      break;
  }
  
  // Round to nearest $100
  buyLow = Math.round(buyLow / 100) * 100;
  buyHigh = Math.round(buyHigh / 100) * 100;
  
  // Ensure sensible range (min $500 spread)
  if (buyHigh <= buyLow) {
    buyHigh = buyLow + 500;
  }
  
  // CRITICAL: MySalesData First - never exceed historical max OWE
  if (oweStats.max && buyHigh > oweStats.max) {
    buyHigh = oweStats.max;
    capApplied = true;
    notes.push(`MAX OWE CAP: Capped at historical max $${oweStats.max.toLocaleString()}`);
  }
  
  return { buyLow, buyHigh, capApplied, notes };
}

// ============================================================================
// OANCA ENGINE - CORE LOGIC
// ============================================================================

function runOancaEngine(input: OancaInput, salesHistory: SalesHistoryRecord[]): OancaPriceObject {
  const startTime = Date.now();
  const notes: string[] = [];
  const compsUsed: string[] = [];
  
  console.log(`[OANCA] Processing: ${input.year} ${input.make} ${input.model}`);
  notes.push(`Query: ${input.year} ${input.make} ${input.model}`);
  
  // ============================================================
  // STEP 1: Find comps by make+model; year ±4; variant_family if present
  // ============================================================
  const makeLower = input.make.toLowerCase().trim();
  const modelLower = input.model.toLowerCase().trim();
  
  const matchingRecords = salesHistory.filter(r => {
    const recordMake = (r.make || '').toLowerCase().trim();
    const recordModel = (r.model || '').toLowerCase().trim();
    const recordYear = parseInt(String(r.year)) || 0;
    
    // Flexible make matching
    const makeMatch = recordMake === makeLower || 
                      recordMake.includes(makeLower) || 
                      makeLower.includes(recordMake);
    
    // Flexible model matching
    const modelMatch = recordModel === modelLower || 
                       recordModel.includes(modelLower) || 
                       modelLower.includes(recordModel);
    
    // Year ±4 as specified
    const yearMatch = Math.abs(recordYear - input.year) <= 4;
    
    // Optional: variant_family matching (if provided)
    let variantMatch = true;
    if (input.variant_family && r.variant_family) {
      const inputVF = input.variant_family.toLowerCase().trim();
      const recordVF = (r.variant_family || '').toLowerCase().trim();
      variantMatch = recordVF.includes(inputVF) || inputVF.includes(recordVF);
    }
    
    return makeMatch && modelMatch && yearMatch && variantMatch;
  });
  
  console.log(`[OANCA] Found ${matchingRecords.length} matching records`);
  notes.push(`Found ${matchingRecords.length} raw matches`);
  
  // Weight each comp by recency
  const weightedComps: WeightedComp[] = matchingRecords.map(record => {
    const { weight, months } = calculateRecencyWeight(record.sale_date);
    compsUsed.push(record.record_id);
    return { record, weight, recencyMonths: months };
  });
  
  // Sort by weight (highest first)
  weightedComps.sort((a, b) => b.weight - a.weight);
  
  // ============================================================
  // STEP 2: Require n >= 2 OWE comps to price
  // ============================================================
  const oweComps = weightedComps.filter(wc => wc.record.total_cost > 0);
  const nOweComps = oweComps.length;
  
  console.log(`[OANCA] OWE comps (with total_cost > 0): ${nOweComps}`);
  notes.push(`OWE comps: ${nOweComps}`);
  
  // ============================================================
  // INSUFFICIENT DATA - allow_price=false
  // ============================================================
  if (nOweComps < 2) {
    notes.push(`INSUFFICIENT DATA: Only ${nOweComps} OWE records. Minimum 2 required.`);
    console.log(`[OANCA] VERDICT: NEED_PICS (insufficient data)`);
    
    // Check for forced escalation (high-value American truck)
    const { escalate, reason: escalationReason } = shouldForceEscalation(input, nOweComps);
    
    return {
      allow_price: false,
      verdict: escalate ? 'ESCALATE' : 'NEED_PICS',
      buy_low: null,
      buy_high: null,
      anchor_owe: null,
      anchor_owe_p75: null,
      demand_class: null,
      confidence: null,
      n_comps: nOweComps,
      notes,
      retail_context_low: null,
      retail_context_high: null,
      market: DEFAULT_MARKET,
      currency: DEFAULT_CURRENCY,
      floor_applied: false,
      cap_applied: false,
      escalation_reason: escalationReason,
      firewall_triggered: false,
      comps_used: compsUsed.slice(0, 10),  // Limit for logging
      processing_time_ms: Date.now() - startTime,
    };
  }
  
  // ============================================================
  // STEP 3: Calculate OWE statistics (anchor)
  // ============================================================
  const oweStats = calculateOweStats(oweComps);
  
  if (!oweStats.median) {
    notes.push('Failed to calculate OWE statistics');
    return {
      allow_price: false,
      verdict: 'NEED_PICS',
      buy_low: null,
      buy_high: null,
      anchor_owe: null,
      anchor_owe_p75: null,
      demand_class: null,
      confidence: null,
      n_comps: nOweComps,
      notes,
      retail_context_low: null,
      retail_context_high: null,
      market: DEFAULT_MARKET,
      currency: DEFAULT_CURRENCY,
      floor_applied: false,
      cap_applied: false,
      escalation_reason: null,
      firewall_triggered: false,
      comps_used: compsUsed.slice(0, 10),
      processing_time_ms: Date.now() - startTime,
    };
  }
  
  const anchorOwe = oweStats.weightedMedian || oweStats.median;
  console.log(`[OANCA] Anchor OWE: $${anchorOwe} (median: $${oweStats.median}, p75: $${oweStats.p75})`);
  notes.push(`Anchor OWE: $${anchorOwe?.toLocaleString()} (weighted median)`);
  notes.push(`OWE stats: median=$${oweStats.median?.toLocaleString()}, p75=$${oweStats.p75?.toLocaleString()}, max=$${oweStats.max?.toLocaleString()}`);
  
  // ============================================================
  // STEP 4: Calculate demand class from history
  // ============================================================
  let { demandClass, reason: demandReason, avgDays, avgGross } = calculateDemandClass(oweComps);
  
  // Override for KNOWN hard work vehicles
  const isKnownHardWorkVehicle = isKnownHardWork(input.make, input.model);
  if (isKnownHardWorkVehicle) {
    if (demandClass === 'fast' || demandClass === 'average') {
      demandClass = 'hard_work';
      demandReason = `KNOWN HARD WORK: ${input.make} ${input.model} (overriding ${demandClass})`;
      notes.push(`⚠️ KNOWN HARD WORK OVERRIDE: ${input.make} ${input.model}`);
    }
  }
  
  console.log(`[OANCA] Demand class: ${demandClass} - ${demandReason}`);
  notes.push(`Demand: ${demandClass} - ${demandReason}`);
  
  // ============================================================
  // STEP 5: Calculate BUY range from OWE anchor
  // CRITICAL: SELL never sets BUY. OWE is the only anchor.
  // ============================================================
  const buyRangeResult = calculateBuyRange(oweStats, demandClass, avgDays, avgGross);
  let { buyLow, buyHigh, capApplied } = buyRangeResult;
  notes.push(...buyRangeResult.notes);
  
  console.log(`[OANCA] Buy range: $${buyLow} - $${buyHigh} (cap applied: ${capApplied})`);
  notes.push(`Buy range: $${buyLow.toLocaleString()} - $${buyHigh.toLocaleString()}`);
  
  // ============================================================
  // STEP 6: RETAIL CONTEXT (optional, clearly labelled)
  // NEVER used for pricing. Context only.
  // ============================================================
  const sellPrices = oweComps
    .map(wc => wc.record.sell_price)
    .filter(p => p > 0);
  
  let retailContextLow: number | null = null;
  let retailContextHigh: number | null = null;
  
  if (sellPrices.length >= 2) {
    sellPrices.sort((a, b) => a - b);
    retailContextLow = sellPrices[Math.floor(sellPrices.length * 0.25)] || sellPrices[0];
    retailContextHigh = sellPrices[Math.floor(sellPrices.length * 0.75)] || sellPrices[sellPrices.length - 1];
    notes.push(`Retail context (ASK only, NOT for pricing): $${retailContextLow?.toLocaleString()} - $${retailContextHigh?.toLocaleString()}`);
  }
  
  // ============================================================
  // STEP 7: Determine VERDICT and CONFIDENCE
  // ============================================================
  let verdict: OancaVerdict;
  let confidence: OancaConfidence;
  
  // Confidence based on comp count and recency
  const recentComps = oweComps.filter(wc => wc.recencyMonths <= 12);
  if (nOweComps >= 5 && recentComps.length >= 3) {
    confidence = 'HIGH';
  } else if (nOweComps >= 3 || recentComps.length >= 2) {
    confidence = 'MED';
  } else {
    confidence = 'LOW';
  }
  
  // Verdict based on demand class
  switch (demandClass) {
    case 'poison':
      verdict = 'WALK';
      notes.push('VERDICT: WALK - history shows repeat losses');
      break;
    case 'hard_work':
      verdict = 'HIT_IT';
      notes.push('VERDICT: HIT_IT - price off OWE, not retail');
      break;
    case 'fast':
      verdict = confidence === 'HIGH' ? 'BUY' : 'HARD_WORK';
      notes.push(`VERDICT: ${verdict} - ${confidence} confidence`);
      break;
    case 'average':
      verdict = confidence === 'LOW' ? 'HARD_WORK' : 'BUY';
      notes.push(`VERDICT: ${verdict} - ${confidence} confidence`);
      break;
    default:
      verdict = 'HARD_WORK';
      notes.push('VERDICT: HARD_WORK - proceed with caution');
  }
  
  // ============================================================
  // STEP 8: SANITY CLAMP - Heavy-duty American trucks floor check
  // ============================================================
  let floorApplied = false;
  let escalationReason: string | null = null;
  
  const heavyDutyFloor = getHeavyDutyFloor(input.make, input.model);
  if (heavyDutyFloor && input.year >= 2018) {
    if (buyHigh < heavyDutyFloor) {
      notes.push(`SANITY CLAMP: buy_high ($${buyHigh}) below floor ($${heavyDutyFloor}) for ${input.year} ${input.make} ${input.model}`);
      console.log(`[OANCA] SANITY CLAMP TRIGGERED: Forcing escalation`);
      
      return {
        allow_price: false,
        verdict: 'ESCALATE',
        buy_low: null,
        buy_high: null,
        anchor_owe: anchorOwe,
        anchor_owe_p75: oweStats.p75,
        demand_class: demandClass,
        confidence,
        n_comps: nOweComps,
        notes,
        retail_context_low: retailContextLow,
        retail_context_high: retailContextHigh,
        market: DEFAULT_MARKET,
        currency: DEFAULT_CURRENCY,
        floor_applied: true,
        cap_applied: capApplied,
        escalation_reason: `Heavy-duty truck floor violated. Computed $${buyHigh} < floor $${heavyDutyFloor}. Requires: location (state), link, or photos.`,
        firewall_triggered: false,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
      };
    }
  }
  
  // Check for forced escalation (high-value American truck with weak data)
  const escalationCheck = shouldForceEscalation(input, nOweComps);
  if (escalationCheck.escalate) {
    notes.push(`FORCED ESCALATION: ${escalationCheck.reason}`);
    console.log(`[OANCA] FORCED ESCALATION: ${escalationCheck.reason}`);
    
    return {
      allow_price: false,
      verdict: 'ESCALATE',
      buy_low: null,
      buy_high: null,
      anchor_owe: anchorOwe,
      anchor_owe_p75: oweStats.p75,
      demand_class: demandClass,
      confidence,
      n_comps: nOweComps,
      notes,
      retail_context_low: retailContextLow,
      retail_context_high: retailContextHigh,
      market: DEFAULT_MARKET,
      currency: DEFAULT_CURRENCY,
      floor_applied: false,
      cap_applied: capApplied,
      escalation_reason: escalationCheck.reason,
      firewall_triggered: false,
      comps_used: compsUsed.slice(0, 10),
      processing_time_ms: Date.now() - startTime,
    };
  }
  
  console.log(`[OANCA] VERDICT: ${verdict}, Confidence: ${confidence}`);
  
  return {
    allow_price: true,
    verdict,
    buy_low: buyLow,
    buy_high: buyHigh,
    anchor_owe: anchorOwe,
    anchor_owe_p75: oweStats.p75,
    demand_class: demandClass,
    confidence,
    n_comps: nOweComps,
    notes,
    retail_context_low: retailContextLow,
    retail_context_high: retailContextHigh,
    market: DEFAULT_MARKET,
    currency: DEFAULT_CURRENCY,
    floor_applied: floorApplied,
    cap_applied: capApplied,
    escalation_reason: null,
    firewall_triggered: false,
    comps_used: compsUsed.slice(0, 10),
    processing_time_ms: Date.now() - startTime,
  };
}

// ============================================================================
// QUERY DEALER SALES HISTORY
// ============================================================================

async function queryDealerSalesHistory(): Promise<SalesHistoryRecord[]> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials for sales query");
    return [];
  }
  
  try {
    console.log(`[OANCA] Querying dealer sales history...`);
    
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
    
    console.log(`[OANCA] Loaded ${allRecords.length} total sales records`);
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
  oancaObject: OancaPriceObject,
  dealerName: string | null,
  rawTranscript: string,
  bobResponse: string | null
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
      oanca_object: oancaObject,
      allow_price: oancaObject.allow_price,
      verdict: oancaObject.verdict,
      demand_class: oancaObject.demand_class,
      confidence: oancaObject.confidence,
      n_comps: oancaObject.n_comps,
      anchor_owe: oancaObject.anchor_owe,
      buy_low: oancaObject.buy_low,
      buy_high: oancaObject.buy_high,
      comps_used: oancaObject.comps_used,
      bob_response: bobResponse,
      processing_time_ms: oancaObject.processing_time_ms,
    });
    
    if (error) {
      console.error("Error logging valo request:", error);
    } else {
      console.log("[OANCA] Request logged to valo_requests");
    }
  } catch (error) {
    console.error("Error logging valo request:", error);
  }
}

// ============================================================================
// FORMAT OANCA OBJECT FOR BOB (NARRATOR SCRIPT)
// ============================================================================

function formatOancaForBob(oanca: OancaPriceObject, vehicle: string): string {
  let bobScript: string;
  
  if (!oanca.allow_price) {
    if (oanca.verdict === 'ESCALATE') {
      bobScript = "Give me two minutes mate, I'll check with the boys. Need you to send me the state it's in, a link to the ad (Carsales or Pickles), or a few photos so I can firm up a number.";
    } else {
      bobScript = "Mate I'm thin on our book for this one. Send me a few pics and I'll check with the boys.";
    }
    
    if (oanca.retail_context_low && oanca.retail_context_high) {
      bobScript += ` Seeing asks around $${oanca.retail_context_low.toLocaleString()} to $${oanca.retail_context_high.toLocaleString()} in market, but that's retail. Can't give you wholesale without more data.`;
    }
  } else {
    const buyLow = oanca.buy_low!.toLocaleString();
    const buyHigh = oanca.buy_high!.toLocaleString();
    
    switch (oanca.verdict) {
      case 'BUY':
        bobScript = `Yeah mate, that's a good fighter. I'd be looking at $${buyLow} to $${buyHigh} to own it. ${oanca.confidence === 'HIGH' ? 'Confident on that range.' : 'Photos always help tighten it up.'}`;
        break;
        
      case 'HIT_IT':
        bobScript = `These need to be hit. Price it off what we owed last time, not what we jagged. Looking at $${buyLow} to $${buyHigh} to own it.`;
        break;
        
      case 'HARD_WORK':
        bobScript = `That's hard work mate. I'd be looking at $${buyLow} to $${buyHigh} to own it – any sillier and the money disappears. Don't get silly.`;
        break;
        
      case 'WALK':
        bobScript = `I'd rather keep my powder dry on this one. History shows money disappears on these. If you must, don't pay more than $${buyLow} – and that's stretching it.`;
        break;
        
      default:
        bobScript = `Looking at $${buyLow} to $${buyHigh} to own it.`;
    }
    
    if (oanca.retail_context_low && oanca.retail_context_high) {
      bobScript += ` Retail asks around $${oanca.retail_context_low.toLocaleString()} to $${oanca.retail_context_high.toLocaleString()}.`;
    }
  }
  
  bobScript += " All figures AUD (Australia).";
  
  return `

=== OANCA_PRICE_OBJECT (READ-ONLY - THE ONLY SOURCE OF TRUTH) ===

Vehicle: ${vehicle}
Market: ${oanca.market} (LOCKED)
Currency: ${oanca.currency} (LOCKED)
allow_price: ${oanca.allow_price}
verdict: ${oanca.verdict}
demand_class: ${oanca.demand_class || 'N/A'}
confidence: ${oanca.confidence || 'N/A'}
n_comps: ${oanca.n_comps}
cap_applied: ${oanca.cap_applied}
floor_applied: ${oanca.floor_applied}
${oanca.escalation_reason ? `escalation_reason: ${oanca.escalation_reason}` : ''}

${oanca.allow_price ? `=== APPROVED NUMBERS (Bob may ONLY quote these) ===
buy_low: $${oanca.buy_low?.toLocaleString()} AUD
buy_high: $${oanca.buy_high?.toLocaleString()} AUD
anchor_owe: $${oanca.anchor_owe?.toLocaleString()} AUD` : `=== NO APPROVED NUMBERS ===
Bob is FORBIDDEN from quoting any wholesale price.
Bob MUST request: location (state), link (Carsales/Pickles), or photos.
Bob MUST say: "Give me two minutes, I'll check with the boys."`}

${oanca.retail_context_low ? `=== RETAIL CONTEXT (ASK prices only - NOT for pricing) ===
retail_context_low: $${oanca.retail_context_low?.toLocaleString()} AUD
retail_context_high: $${oanca.retail_context_high?.toLocaleString()} AUD
(These are RETAIL ASKS, not wholesale. Context only.)` : ''}

=== BOB'S SCRIPT (SAY THIS) ===
${bobScript}

=== CRITICAL RULES FOR BOB ===
1. Bob is a NARRATOR, not a VALUER. OANCA is the SOLE VALUER.
2. Bob may ONLY quote numbers from APPROVED NUMBERS above.
3. If allow_price = false, Bob is FORBIDDEN from quoting ANY dollar amount.
4. If Bob outputs any dollar value not in OANCA_PRICE_OBJECT, the runtime gate will BLOCK it.
5. Bob may NOT calculate, adjust, infer, or ballpark any numbers.
6. ALL PRICES ARE AUD (AUSTRALIA).
`;
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
    if (km < 1000) km = km * 1000;  // Handle "100k" format
  }
  
  if (foundMake && foundModel && foundYear) {
    return { make: foundMake, model: foundModel, year: foundYear, km };
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
// BOB'S PERSONA (NARRATOR ONLY)
// ============================================================================

const BOB_SYSTEM_PROMPT = `You are Bob.

You are an Australian wholesale car valuer with 20+ years in auctions.
You speak like a straight-shooting Aussie knocker.
You do not overpromise.
You talk like a human, not an app.

=== CRITICAL: YOU ARE A NARRATOR, NOT A VALUER ===

OANCA is the valuer. You are the narrator.
You read the OANCA_PRICE_OBJECT and speak it in Bob voice.
You CANNOT calculate, adjust, or infer any numbers.
If you output ANY dollar value not in OANCA_PRICE_OBJECT, it is a BLOCKING BUG.
There is a HARD RUNTIME GATE that will block and replace your response if you quote unauthorized prices.

=== TONE RULES ===

FIGHTER RULE: Always refer to cars as "fighters" - "good fighter", "honest little fighter", "hard-work fighter"

BANTER RULES:
- Light Aussie banter allowed SPARINGLY
- Banter is BANNED during: HARD_WORK, NEED_PICS, HIT_IT, WALK
- Never let humour soften a no

=== WHAT YOU CAN DO ===
- Read OANCA_PRICE_OBJECT and speak the numbers
- Add Bob character/voice to the delivery
- Welcome photos (they always help)
- Say "give me two minutes, I'll check with the boys" when data is thin

=== WHAT YOU CANNOT DO ===
- Calculate or derive any price
- Adjust the OANCA numbers
- Quote any number not in OANCA_PRICE_OBJECT
- Guess or ballpark when allow_price = false

Style: Calm, confident, short sentences, Aussie phrasing, no emojis, no corporate language.
Keep responses under 80 words. Sound like a phone call, not a chatbot.`;

// ============================================================================
// NUMBERS FIREWALL - RUNTIME GATE
// ============================================================================

interface FirewallResult {
  triggered: boolean;
  reason: string | null;
  correctedResponse: string | null;
}

function runNumbersFirewall(
  bobResponse: string,
  oancaObject: OancaPriceObject
): FirewallResult {
  // ============================================================
  // GATE 1: ABSOLUTE BLOCK - NO DIGITS WHEN allow_price=false
  // This is CODE-LEVEL enforcement. Non-negotiable.
  // ============================================================
  if (!oancaObject.allow_price) {
    // STRICT: Block ANY digits that could be interpreted as prices
    // Match: $X, Xk, X,XXX, X-X, X to X, any 4+ digit number
    const anyDigitPattern = /\d{4,}/g;  // Any 4+ digit number
    const dollarPattern = /\$\s*[\d,]+/gi;  // $X,XXX
    const kPattern = /\d+\s*k\b/gi;  // Xk (e.g., "8k")
    const rangePattern = /\d+\s*(?:to|-|–)\s*\d+/gi;  // X to X, X-X
    
    const hasLongDigits = anyDigitPattern.test(bobResponse);
    const hasDollar = dollarPattern.test(bobResponse);
    const hasK = kPattern.test(bobResponse);
    const hasRange = rangePattern.test(bobResponse);
    
    if (hasLongDigits || hasDollar || hasK || hasRange) {
      console.error("[FIREWALL] ❌ HARD BLOCK: allow_price=false but response contains digits");
      console.error("[FIREWALL] Blocked response:", bobResponse);
      console.error("[FIREWALL] Detected: longDigits=" + hasLongDigits + ", dollar=" + hasDollar + ", k=" + hasK + ", range=" + hasRange);
      
      let corrected: string;
      if (oancaObject.verdict === 'ESCALATE') {
        corrected = "Give me two minutes mate, I'll check with the boys. Need you to send me the state it's in, a link to the ad (Carsales or Pickles), or a few photos so I can firm up a number. All figures AUD (Australia).";
      } else {
        corrected = "Mate I'm thin on our book for that one. Send me a few pics and I'll check with the boys. All figures AUD (Australia).";
      }
      
      console.log("[FIREWALL] ✓ Replaced with approved script");
      
      return {
        triggered: true,
        reason: `allow_price=false but response contained digits (longDigits=${hasLongDigits}, dollar=${hasDollar}, k=${hasK}, range=${hasRange})`,
        correctedResponse: corrected,
      };
    }
  }
  
  // ============================================================
  // GATE 2: VALIDATE PRICES WHEN allow_price=true
  // ============================================================
  if (oancaObject.allow_price && oancaObject.buy_low && oancaObject.buy_high) {
    const priceMatches = bobResponse.match(/\$\s*[\d,]+/g) || [];
    
    // Build list of approved prices
    const approvedPrices = [
      oancaObject.buy_low,
      oancaObject.buy_high,
      oancaObject.anchor_owe,
      oancaObject.retail_context_low,
      oancaObject.retail_context_high,
    ].filter(Boolean).map(p => Math.round(p! / 100) * 100);
    
    const unapprovedPrices: number[] = [];
    
    for (const priceStr of priceMatches) {
      const price = parseInt(priceStr.replace(/[$,\s]/g, ''));
      // Check if price is close to any approved price (within $500 tolerance)
      const isApproved = approvedPrices.some(ap => Math.abs(price - ap) <= 500);
      
      if (!isApproved && price >= 1000) {
        unapprovedPrices.push(price);
      }
    }
    
    if (unapprovedPrices.length > 0) {
      console.error(`[FIREWALL] ❌ BLOCKED: Bob quoted unapproved price(s): ${unapprovedPrices.join(', ')}`);
      console.error(`[FIREWALL] Approved prices: ${approvedPrices.join(', ')}`);
      console.error(`[FIREWALL] Blocked response:`, bobResponse);
      
      const buyLow = oancaObject.buy_low.toLocaleString();
      const buyHigh = oancaObject.buy_high.toLocaleString();
      
      let corrected: string;
      switch (oancaObject.verdict) {
        case 'HIT_IT':
          corrected = `These need to be hit. Price it off what we owed last time, not what we jagged. Looking at $${buyLow} to $${buyHigh} to own it. All figures AUD (Australia).`;
          break;
        case 'HARD_WORK':
          corrected = `That's hard work mate. I'd be looking at $${buyLow} to $${buyHigh} to own it. Don't get silly. All figures AUD (Australia).`;
          break;
        case 'WALK':
          corrected = `I'd rather keep my powder dry on this one. If you must, don't pay more than $${buyLow}. All figures AUD (Australia).`;
          break;
        default:
          corrected = `I'd be looking at $${buyLow} to $${buyHigh} to own it. All figures AUD (Australia).`;
      }
      
      console.log("[FIREWALL] ✓ Replaced with corrected OANCA prices");
      
      return {
        triggered: true,
        reason: `Unapproved prices detected: ${unapprovedPrices.join(', ')}`,
        correctedResponse: corrected,
      };
    }
  }
  
  return { triggered: false, reason: null, correctedResponse: null };
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract vehicle from message
    let oancaContext = '';
    let oancaObject: OancaPriceObject | null = null;
    const vehicleInput = extractVehicleFromMessage(transcript);
    
    if (vehicleInput) {
      console.log(`[BOB] Detected vehicle: ${vehicleInput.year} ${vehicleInput.make} ${vehicleInput.model}`);
      
      // Load sales history
      const salesHistory = await queryDealerSalesHistory();
      
      // Run OANCA Engine
      oancaObject = runOancaEngine(vehicleInput, salesHistory);
      
      // Format for Bob
      const vehicle = `${vehicleInput.year} ${vehicleInput.make} ${vehicleInput.model}`;
      oancaContext = formatOancaForBob(oancaObject, vehicle);
      
      console.log(`[BOB] OANCA verdict: ${oancaObject.verdict}, allow_price: ${oancaObject.allow_price}, n_comps: ${oancaObject.n_comps}`);
    }

    // Build messages for AI
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: BOB_SYSTEM_PROMPT }
    ];
    
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    // Add OANCA context to user message
    const enrichedTranscript = oancaContext 
      ? transcript + oancaContext 
      : transcript;
    
    messages.push({ role: "user", content: enrichedTranscript });

    console.log("[BOB] Calling AI for narration...");
    
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
        temperature: 0.5,  // Lower for more consistent narration
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
    let bobResponse = data.choices?.[0]?.message?.content;

    if (!bobResponse) {
      console.error("No response from AI:", data);
      return new Response(
        JSON.stringify({ error: "Bob didn't respond" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // RUN NUMBERS FIREWALL
    // ============================================================
    let firewallTriggered = false;
    if (oancaObject) {
      const firewallResult = runNumbersFirewall(bobResponse, oancaObject);
      
      if (firewallResult.triggered) {
        console.log(`[FIREWALL] Triggered: ${firewallResult.reason}`);
        bobResponse = firewallResult.correctedResponse!;
        firewallTriggered = true;
        
        // Update OANCA object to record firewall activation
        oancaObject.firewall_triggered = true;
      }
    }

    // Log the request to database
    if (vehicleInput && oancaObject) {
      await logValoRequest(vehicleInput, oancaObject, dealerName, transcript, bobResponse);
    }

    // Build response
    const responseBody: Record<string, unknown> = { response: bobResponse };
    
    // Include OANCA debug object if requested (admin only)
    if (includeDebug && oancaObject) {
      responseBody.oanca_debug = oancaObject;
      responseBody.firewall_triggered = firewallTriggered;
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
