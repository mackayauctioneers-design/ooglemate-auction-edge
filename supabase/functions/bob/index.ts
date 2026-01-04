import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// OOGLEMATE PRICING ENGINE v3
// ============================================================================
// Bob is NOT a valuer. Bob is a voice narrator.
// All pricing logic lives HERE. Bob receives a DECISION OBJECT only.
// If Bob cannot retrieve a final price decision object, he must not price.
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
// DECISION OBJECT - THE ONLY THING BOB RECEIVES
// ============================================================================

// DECISION STATES:
// 1. PRICE_AVAILABLE = firm price (strong data, >= 2 comps for common vehicles)
// 2. SOFT_OWN = guarded price (thin data or hard_work with comps, pics optional)
// 3. NEED_PICS = no pricing (zero comps or hard_work with <2 comps)
// 4. DNR = do not retail (poison vehicles)
type BobDecision = 'PRICE_AVAILABLE' | 'SOFT_OWN' | 'NEED_PICS' | 'DNR';
type VehicleClass = 'FAST_MOVER' | 'AVERAGE' | 'HARD_WORK' | 'POISON';
type DataSource = 'OWN_SALES';
type Confidence = 'HIGH' | 'MED' | 'LOW';

interface DecisionObject {
  decision: BobDecision;
  buy_price: number | null;        // SINGLE price, not range
  vehicle_class: VehicleClass | null;
  data_source: DataSource | null;
  confidence: Confidence | null;
  reason?: string;                 // Only for NEED_PICS: 'NO_COMPS' | 'THIN_DATA'
  instruction?: string;            // Only for NEED_PICS: 'REQUEST_PHOTOS'
}

// Internal engine state (never sent to Bob)
interface EngineState {
  n_comps: number;
  anchor_owe: number | null;
  avg_days: number;
  avg_gross: number;
  notes: string[];
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
// OWE ANCHOR CALCULATION
// Rule 1: Anchor to last OWE price. Ignore retail sold price.
// Rule 4: > 24 months = degrade
// ============================================================================

function calculateOweAnchor(comps: WeightedComp[]): number | null {
  const oweData = comps
    .filter(wc => wc.record.total_cost > 0)
    .map(wc => ({ owe: wc.record.total_cost, weight: wc.weight }));
  
  if (oweData.length === 0) return null;
  
  // Weighted median OWE
  const totalWeight = oweData.reduce((sum, d) => sum + d.weight, 0);
  let cumWeight = 0;
  
  oweData.sort((a, b) => a.owe - b.owe);
  for (const d of oweData) {
    cumWeight += d.weight;
    if (cumWeight >= totalWeight / 2) {
      return d.owe;
    }
  }
  
  return oweData[0].owe;
}

// ============================================================================
// BUY PRICE CALCULATION (SINGLE PRICE, NOT RANGE)
// ============================================================================

function calculateBuyPrice(
  anchorOwe: number,
  vehicleClass: VehicleClass,
  avgDays: number
): number {
  let buyPrice: number;
  
  switch (vehicleClass) {
    case 'POISON':
      // DNR territory - severely discounted
      buyPrice = Math.round(anchorOwe * 0.82);
      break;
      
    case 'HARD_WORK':
      // Hit it hard - conservative
      buyPrice = Math.round(anchorOwe * 0.92);
      // Additional discount for very slow movers
      if (avgDays > 60) {
        buyPrice = Math.round(buyPrice * 0.97);
      }
      break;
      
    case 'AVERAGE':
      // Standard wholesale
      buyPrice = anchorOwe;
      break;
      
    case 'FAST_MOVER':
      // Small uplift for proven fast sellers
      buyPrice = Math.round(anchorOwe + (anchorOwe < 20000 ? 500 : 800));
      break;
      
    default:
      buyPrice = anchorOwe;
  }
  
  // Round to nearest $100
  buyPrice = Math.round(buyPrice / 100) * 100;
  
  return buyPrice;
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
  
  console.log(`[ENGINE] Processing: ${input.year} ${input.make} ${input.model}`);
  
  // STEP 1: Find comps
  const makeLower = input.make.toLowerCase().trim();
  const modelLower = input.model.toLowerCase().trim();
  
  // DEBUG: Log sample records to verify data structure
  if (salesHistory.length > 0) {
    const sample = salesHistory.slice(0, 3).map(r => ({
      make: r.make,
      model: r.model,
      year: r.year,
      total_cost: r.total_cost
    }));
    console.log(`[ENGINE] Sample records:`, JSON.stringify(sample));
  }
  
  const matchingRecords = salesHistory.filter(r => {
    const recordMake = (r.make || '').toLowerCase().trim();
    const recordModel = (r.model || '').toLowerCase().trim();
    const recordYear = parseInt(String(r.year)) || 0;
    
    const makeMatch = recordMake === makeLower || 
                      recordMake.includes(makeLower) || 
                      makeLower.includes(recordMake);
    
    const modelMatch = recordModel === modelLower || 
                       recordModel.includes(modelLower) || 
                       modelLower.includes(recordModel);
    
    const yearMatch = Math.abs(recordYear - input.year) <= 4;
    
    return makeMatch && modelMatch && yearMatch;
  });
  
  console.log(`[ENGINE] Found ${matchingRecords.length} matching records (before OWE filter)`);
  
  // Weight by recency
  const weightedComps: WeightedComp[] = matchingRecords.map(record => {
    const { weight, months } = calculateRecencyWeight(record.sale_date);
    compsUsed.push(record.record_id);
    return { record, weight, recencyMonths: months };
  });
  
  weightedComps.sort((a, b) => b.weight - a.weight);
  
  // Filter to those with OWE data
  const oweComps = weightedComps.filter(wc => wc.record.total_cost > 0);
  const nOweComps = oweComps.length;
  
  // Debug: if we have matching records but no OWE, log why
  if (matchingRecords.length > 0 && nOweComps === 0) {
    console.log(`[ENGINE] WARNING: ${matchingRecords.length} matches but 0 have OWE > 0`);
    const sample = matchingRecords.slice(0, 3).map(r => ({
      make: r.make,
      model: r.model,
      total_cost: r.total_cost
    }));
    console.log(`[ENGINE] Sample match costs:`, JSON.stringify(sample));
  }
  
  console.log(`[ENGINE] Found ${nOweComps} comps with OWE data`);
  
  // ================================================================
  // DECISION LOGIC: SOFT_OWN vs PRICE_AVAILABLE vs NEED_PICS
  // ================================================================
  
  // Check if this is a hard_work vehicle FIRST (before comp check)
  const isHardWork = isKnownHardWork(input.make, input.model);
  
  // ZERO COMPS = Always NEED_PICS
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
        n_comps: nOweComps,
        anchor_owe: null,
        avg_days: 0,
        avg_gross: 0,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
      }
    };
  }
  
  // HARD_WORK vehicles with < 2 comps = NEED_PICS (too risky)
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
        anchor_owe: null,
        avg_days: 0,
        avg_gross: 0,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
      }
    };
  }
  
  // STEP 2: Calculate OWE anchor
  const anchorOwe = calculateOweAnchor(oweComps);
  
  if (!anchorOwe) {
    notes.push('Failed to calculate OWE anchor');
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
        anchor_owe: null,
        avg_days: 0,
        avg_gross: 0,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
      }
    };
  }
  
  // STEP 3: Determine vehicle class
  const { vehicleClass, avgDays, avgGross } = calculateVehicleClass(oweComps, input.make, input.model);
  
  console.log(`[ENGINE] Vehicle class: ${vehicleClass}, anchor OWE: $${anchorOwe}`);
  notes.push(`Class: ${vehicleClass}, OWE: $${anchorOwe}`);
  
  // ================================================================
  // DNR CHECK - History shows repeat losses
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
        anchor_owe: anchorOwe,
        avg_days: avgDays,
        avg_gross: avgGross,
        notes,
        comps_used: compsUsed.slice(0, 10),
        processing_time_ms: Date.now() - startTime,
      }
    };
  }
  
  // STEP 4: Calculate buy price
  const buyPrice = calculateBuyPrice(anchorOwe, vehicleClass, avgDays);
  
  // STEP 5: Determine confidence
  const recentComps = oweComps.filter(wc => wc.recencyMonths <= 12);
  let confidence: Confidence;
  
  if (nOweComps >= 5 && recentComps.length >= 3) {
    confidence = 'HIGH';
  } else if (nOweComps >= 3 || recentComps.length >= 2) {
    confidence = 'MED';
  } else {
    confidence = 'LOW';
  }
  
  console.log(`[ENGINE] Buy price: $${buyPrice}, confidence: ${confidence}`);
  notes.push(`Buy: $${buyPrice}, confidence: ${confidence}`);
  
  // ================================================================
  // DECISION: PRICE_AVAILABLE vs SOFT_OWN
  // ================================================================
  
  // Strong vehicles (not hard_work):
  //   >= 2 comps = PRICE_AVAILABLE
  //   == 1 comp = SOFT_OWN (guarded pricing)
  // Hard_work vehicles:
  //   >= 2 comps = SOFT_OWN (never firm on these)
  //   < 2 comps = already caught above as NEED_PICS
  
  let finalDecision: BobDecision;
  
  if (vehicleClass === 'HARD_WORK') {
    // Hard work with >= 2 comps = SOFT_OWN (tight cap, guarded)
    finalDecision = 'SOFT_OWN';
    notes.push('HARD_WORK: Using SOFT_OWN with tight cap');
  } else if (nOweComps === 1) {
    // Single comp on standard vehicle = SOFT_OWN
    finalDecision = 'SOFT_OWN';
    notes.push('Thin data (1 comp): Using SOFT_OWN');
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
    },
    engineState: {
      n_comps: nOweComps,
      anchor_owe: anchorOwe,
      avg_days: avgDays,
      avg_gross: avgGross,
      notes,
      comps_used: compsUsed.slice(0, 10),
      processing_time_ms: Date.now() - startTime,
    }
  };
}

// ============================================================================
// BOB'S LOCKED PHRASES - THE ONLY THINGS BOB CAN SAY
// ============================================================================

function generateBobScript(decision: DecisionObject): string {
  switch (decision.decision) {
    case 'PRICE_AVAILABLE':
      if (decision.vehicle_class === 'FAST_MOVER') {
        return `Yeah mate, I'd be about ${decision.buy_price?.toLocaleString()}. Good little fighter.`;
      }
      return `Yeah mate, I'd be about ${decision.buy_price?.toLocaleString()}.`;
      
    case 'SOFT_OWN':
      // Guarded pricing - thin on our book, pics optional
      if (decision.vehicle_class === 'HARD_WORK') {
        return `Look, we're a bit thin on that one, but based on what we've got I'd be around ${decision.buy_price?.toLocaleString()}. Hit it tight though — could send through a pic if you want a second look.`;
      }
      return `We're a bit thin on our book for that one. I'd be around ${decision.buy_price?.toLocaleString()}, but flick us a pic if you want me to double check.`;
      
    case 'NEED_PICS':
      return "Nah mate, I'm blind on that one. Flick me a couple of pics and I'll check with the boys.";
      
    case 'DNR':
      return "Wouldn't touch that, mate. That's one you let someone else own.";
      
    default:
      return "Nah mate, I'm blind on that one. Flick me a couple of pics and I'll check with the boys.";
  }
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
        variant_family: '',
        body_type: '',
        transmission: r.transmission || '',
        drivetrain: r.drivetrain || '',
        engine: r.engine || '',
        sale_date: r.sale_date || '',
        days_in_stock: parseInt(r.days_to_sell) || 30,
        sell_price: salePrice,
        total_cost: totalCost, // OWE anchor
        gross_profit: grossProfit,
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
      buy_low: decision.buy_price,  // Single price now
      buy_high: decision.buy_price, // Same as buy_low
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
  
  // GATE 2: VALIDATE PRICE WHEN ALLOWED
  if (priceAllowed && decision.buy_price) {
    const priceMatches = bobResponse.match(/\$\s*[\d,]+/g) || [];
    
    for (const priceStr of priceMatches) {
      const price = parseInt(priceStr.replace(/[$,\s]/g, ''));
      // Check if price is close to approved price (within $500 tolerance)
      if (Math.abs(price - decision.buy_price) > 500 && price >= 1000) {
        console.error(`[FIREWALL] BLOCKED: Unapproved price $${price}, approved: $${decision.buy_price}`);
        
        return {
          blocked: true,
          correctedResponse: generateBobScript(decision),
        };
      }
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
      console.log(`[BOB] Detected vehicle: ${vehicleInput.year} ${vehicleInput.make} ${vehicleInput.model}`);
      
      // Load sales history
      const salesHistory = await queryDealerSalesHistory();
      
      // Run pricing engine
      const result = runPricingEngine(vehicleInput, salesHistory);
      decision = result.decision;
      engineState = result.engineState;
      
      // Generate Bob's locked phrase
      bobScript = generateBobScript(decision);
      
      console.log(`[BOB] Decision: ${decision.decision}, buy_price: ${decision.buy_price}`);
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
