import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// OANCA ENGINE - THE SOLE VALUER
// ============================================================================
// Bob/ChatGPT is a NARRATOR only. OANCA is the VALUER.
// If Bob outputs any dollar value not in OANCA_PRICE_OBJECT → blocking bug.
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
// OANCA_PRICE_OBJECT - THE ONLY SOURCE OF TRUTH FOR BOB
// ============================================================================
// Bob MUST read from this object. If allow_price = false, he refuses.
// If ChatGPT outputs ANY number not in this object, it is a BLOCKING BUG.
// ============================================================================

type OancaVerdict = 'BUY' | 'HIT_IT' | 'HARD_WORK' | 'NEED_PICS' | 'WALK';
type DemandClass = 'fast' | 'average' | 'hard_work' | 'poison';
type OancaConfidence = 'HIGH' | 'MED' | 'LOW';

interface OancaPriceObject {
  allow_price: boolean;
  verdict: OancaVerdict;
  buy_low: number | null;
  buy_high: number | null;
  anchor_owe: number | null;
  demand_class: DemandClass | null;
  confidence: OancaConfidence | null;
  n_comps: number;
  notes: string[];
  retail_context_low: number | null;  // Optional, clearly labelled context only
  retail_context_high: number | null; // Optional, clearly labelled context only
  
  // Audit fields
  comps_used: string[];  // record_ids
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
// RECENCY WEIGHTS (as specified)
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
// DEMAND CLASS LOGIC
// Based on days_in_stock + repeat loss patterns
// ============================================================================

function calculateDemandClass(comps: WeightedComp[]): { demandClass: DemandClass; reason: string } {
  if (comps.length === 0) {
    return { demandClass: 'hard_work', reason: 'No data' };
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
    return { demandClass: 'poison', reason: `Repeat loser (${lossCount}/${grossValues.length} losses, avg gross $${avgGross.toFixed(0)})` };
  }
  
  if (avgDays <= 21 && avgGross >= 2000) {
    return { demandClass: 'fast', reason: `Fast seller (avg ${avgDays.toFixed(0)} days, $${avgGross.toFixed(0)} gross)` };
  }
  
  if (avgDays <= 35 && avgGross >= 1000) {
    return { demandClass: 'average', reason: `Average demand (${avgDays.toFixed(0)} days)` };
  }
  
  if (avgDays > 45 || avgGross < 1500) {
    return { demandClass: 'hard_work', reason: `Slow mover (avg ${avgDays.toFixed(0)} days, $${avgGross.toFixed(0)} gross)` };
  }
  
  return { demandClass: 'average', reason: `Standard demand` };
}

// ============================================================================
// WEIGHTED MEDIAN OWE CALCULATION
// ============================================================================

function calculateWeightedMedianOwe(comps: WeightedComp[]): number | null {
  const oweData = comps
    .filter(wc => wc.record.total_cost > 0)
    .map(wc => ({ owe: wc.record.total_cost, weight: wc.weight }));
  
  if (oweData.length === 0) return null;
  
  // Sort by OWE
  oweData.sort((a, b) => a.owe - b.owe);
  
  // Calculate weighted median
  const totalWeight = oweData.reduce((sum, d) => sum + d.weight, 0);
  let cumWeight = 0;
  
  for (const d of oweData) {
    cumWeight += d.weight;
    if (cumWeight >= totalWeight / 2) {
      return d.owe;
    }
  }
  
  return oweData[Math.floor(oweData.length / 2)].owe;
}

// ============================================================================
// BUFFER BANDS - Small wholesale buffer based on price
// ============================================================================

function getOweBuffer(oweMedian: number): { low: number; high: number } {
  if (oweMedian < 15000) return { low: 400, high: 800 };
  if (oweMedian < 30000) return { low: 500, high: 1000 };
  if (oweMedian < 60000) return { low: 600, high: 1200 };
  return { low: 800, high: 1500 };
}

// ============================================================================
// KNOWN PROBLEM VEHICLES (for demand class override)
// ============================================================================

const KNOWN_HARD_WORK_VEHICLES: Record<string, string[]> = {
  'holden': ['cruze', 'captiva', 'barina', 'trax', 'astra'],
  'peugeot': ['208', '308', '3008', '2008', '508'],
  'citroen': ['c3', 'c4', 'c5', 'ds3', 'ds4'],
  'renault': ['megane', 'clio', 'captur', 'koleos'],
  'fiat': ['500', 'punto', 'tipo'],
  'alfa romeo': ['giulietta', 'mito', '159'],
  'volkswagen': ['golf', 'polo', 'jetta', 'beetle'],
  'mini': ['cooper', 'one', 'countryman'],
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
// OANCA ENGINE - CORE LOGIC
// ============================================================================

function runOancaEngine(input: OancaInput, salesHistory: SalesHistoryRecord[]): OancaPriceObject {
  const startTime = Date.now();
  const notes: string[] = [];
  const compsUsed: string[] = [];
  
  console.log(`[OANCA] Processing: ${input.year} ${input.make} ${input.model}`);
  
  // ============================================================
  // STEP 1: Find comps by make+model; year ±4; variant_family if present
  // ============================================================
  const makeLower = input.make.toLowerCase().trim();
  const modelLower = input.model.toLowerCase().trim();
  
  const matchingRecords = salesHistory.filter(r => {
    const recordMake = (r.make || '').toLowerCase().trim();
    const recordModel = (r.model || '').toLowerCase().trim();
    const recordYear = parseInt(String(r.year)) || 0;
    
    const makeMatch = recordMake === makeLower || recordMake.includes(makeLower) || makeLower.includes(recordMake);
    const modelMatch = recordModel === modelLower || recordModel.includes(modelLower) || modelLower.includes(recordModel);
    const yearMatch = Math.abs(recordYear - input.year) <= 4;  // Year ±4 as specified
    
    // Optional: variant_family matching
    let variantMatch = true;
    if (input.variant_family && r.variant_family) {
      const inputVF = input.variant_family.toLowerCase().trim();
      const recordVF = (r.variant_family || '').toLowerCase().trim();
      variantMatch = recordVF.includes(inputVF) || inputVF.includes(recordVF);
    }
    
    return makeMatch && modelMatch && yearMatch && variantMatch;
  });
  
  console.log(`[OANCA] Found ${matchingRecords.length} matching records`);
  
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
  
  console.log(`[OANCA] OWE comps: ${nOweComps}`);
  
  if (nOweComps < 2) {
    // NO COMPS - allow_price=false, verdict=NEED_PICS
    notes.push(`Insufficient OWE data: only ${nOweComps} records`);
    console.log(`[OANCA] VERDICT: NEED_PICS (insufficient data)`);
    
    return {
      allow_price: false,
      verdict: 'NEED_PICS',
      buy_low: null,
      buy_high: null,
      anchor_owe: null,
      demand_class: null,
      confidence: null,
      n_comps: nOweComps,
      notes,
      retail_context_low: null,
      retail_context_high: null,
      comps_used: compsUsed,
      processing_time_ms: Date.now() - startTime,
    };
  }
  
  // ============================================================
  // STEP 3: Anchor = weighted median OWE
  // ============================================================
  const anchorOwe = calculateWeightedMedianOwe(oweComps);
  
  if (!anchorOwe) {
    notes.push('Failed to calculate OWE anchor');
    return {
      allow_price: false,
      verdict: 'NEED_PICS',
      buy_low: null,
      buy_high: null,
      anchor_owe: null,
      demand_class: null,
      confidence: null,
      n_comps: nOweComps,
      notes,
      retail_context_low: null,
      retail_context_high: null,
      comps_used: compsUsed,
      processing_time_ms: Date.now() - startTime,
    };
  }
  
  console.log(`[OANCA] Anchor OWE: $${anchorOwe}`);
  notes.push(`Anchor OWE: $${anchorOwe.toLocaleString()} (weighted median of ${nOweComps} comps)`);
  
  // ============================================================
  // STEP 4: Demand class from history
  // ============================================================
  let { demandClass, reason: demandReason } = calculateDemandClass(oweComps);
  
  // Override for known hard work vehicles
  if (isKnownHardWork(input.make, input.model)) {
    if (demandClass === 'fast' || demandClass === 'average') {
      demandClass = 'hard_work';
      demandReason = `Known slow mover (${input.make} ${input.model})`;
    }
  }
  
  console.log(`[OANCA] Demand class: ${demandClass} - ${demandReason}`);
  notes.push(`Demand: ${demandClass} - ${demandReason}`);
  
  // ============================================================
  // STEP 5: BUY range derived from OWE anchor + small buffer
  // Never from retail asks
  // ============================================================
  const buffer = getOweBuffer(anchorOwe);
  let buyLow = anchorOwe + buffer.low;
  let buyHigh = anchorOwe + buffer.high;
  
  // Apply demand class adjustments
  if (demandClass === 'poison') {
    // WALK territory - but we still provide a number (very conservative)
    buyLow = Math.round(anchorOwe * 0.85);
    buyHigh = Math.round(anchorOwe * 0.92);
    notes.push('POISON: Severely discounted due to repeat losses');
  } else if (demandClass === 'hard_work') {
    // HIT_IT territory - conservative
    buyLow = Math.round(anchorOwe * 0.92);
    buyHigh = Math.round(anchorOwe * 0.98);
    notes.push('HARD_WORK: Discounted for slow velocity');
  } else if (demandClass === 'fast') {
    // Allow small uplift for proven fast sellers
    buyLow = anchorOwe + buffer.low;
    buyHigh = anchorOwe + Math.round(buffer.high * 1.1);  // 10% more buffer room
    notes.push('FAST: Small uplift for proven velocity');
  }
  
  // Round to nearest $100
  buyLow = Math.round(buyLow / 100) * 100;
  buyHigh = Math.round(buyHigh / 100) * 100;
  
  // Ensure sensible range
  if (buyHigh <= buyLow) {
    buyHigh = buyLow + 500;
  }
  
  console.log(`[OANCA] Buy range: $${buyLow} - $${buyHigh}`);
  
  // ============================================================
  // STEP 6: SELL/retail is context only (optional)
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
    notes.push(`Retail context (ASK only): $${retailContextLow?.toLocaleString()} - $${retailContextHigh?.toLocaleString()}`);
  }
  
  // ============================================================
  // DETERMINE VERDICT AND CONFIDENCE
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
  
  // Verdict based on demand class and confidence
  if (demandClass === 'poison') {
    verdict = 'WALK';
    notes.push('VERDICT: WALK - history shows repeat losses');
  } else if (demandClass === 'hard_work') {
    verdict = 'HIT_IT';
    notes.push('VERDICT: HIT_IT - needs aggressive pricing');
  } else if (demandClass === 'fast' && confidence === 'HIGH') {
    verdict = 'BUY';
    notes.push('VERDICT: BUY - good fighter, proven velocity');
  } else if (demandClass === 'average' || demandClass === 'fast') {
    verdict = confidence === 'LOW' ? 'HARD_WORK' : 'BUY';
    notes.push(`VERDICT: ${verdict} - ${confidence} confidence`);
  } else {
    verdict = 'HARD_WORK';
    notes.push('VERDICT: HARD_WORK - proceed with caution');
  }
  
  console.log(`[OANCA] VERDICT: ${verdict}, Confidence: ${confidence}`);
  
  return {
    allow_price: true,
    verdict,
    buy_low: buyLow,
    buy_high: buyHigh,
    anchor_owe: anchorOwe,
    demand_class: demandClass,
    confidence,
    n_comps: nOweComps,
    notes,
    retail_context_low: retailContextLow,
    retail_context_high: retailContextHigh,
    comps_used: compsUsed,
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
    console.log(`Querying dealer sales history...`);
    
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
    
    console.log(`Loaded ${allRecords.length} total sales records`);
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
  // ============================================================
  // Bob reads OANCA_PRICE_OBJECT only.
  // Bob cannot invent/ballpark.
  // Bob must speak in Bob voice, but numbers must come from OANCA.
  // ============================================================
  
  let bobScript: string;
  
  if (!oanca.allow_price) {
    // NO COMPS - Bob must say this exact script
    bobScript = "Mate I'm thin on our book. Send pics and I'll check with the boys.";
    
    // Add retail context if available (as "asks", not wholesale)
    if (oanca.retail_context_low && oanca.retail_context_high) {
      bobScript += ` Seeing asks around $${oanca.retail_context_low.toLocaleString()} to $${oanca.retail_context_high.toLocaleString()} in market, but that's retail. Can't give you wholesale without more data.`;
    }
  } else {
    // PRICED - Bob narrates the OANCA numbers
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
    
    // Add retail context if available
    if (oanca.retail_context_low && oanca.retail_context_high) {
      bobScript += ` Retail asks around $${oanca.retail_context_low.toLocaleString()} to $${oanca.retail_context_high.toLocaleString()}.`;
    }
  }
  
  // ============================================================
  // BUILD CONTEXT FOR AI (BOB CAN ONLY USE THESE NUMBERS)
  // ============================================================
  
  return `

=== OANCA_PRICE_OBJECT (READ-ONLY - THE ONLY SOURCE OF TRUTH) ===

Vehicle: ${vehicle}
allow_price: ${oanca.allow_price}
verdict: ${oanca.verdict}
demand_class: ${oanca.demand_class || 'N/A'}
confidence: ${oanca.confidence || 'N/A'}
n_comps: ${oanca.n_comps}

${oanca.allow_price ? `=== APPROVED NUMBERS (Bob may ONLY quote these) ===
buy_low: $${oanca.buy_low?.toLocaleString()}
buy_high: $${oanca.buy_high?.toLocaleString()}
anchor_owe: $${oanca.anchor_owe?.toLocaleString()}` : `=== NO APPROVED NUMBERS ===
Bob is FORBIDDEN from quoting any wholesale price.
Bob MUST request photos and escalate.`}

${oanca.retail_context_low ? `=== RETAIL CONTEXT (ASK prices only - NOT for pricing) ===
retail_context_low: $${oanca.retail_context_low?.toLocaleString()}
retail_context_high: $${oanca.retail_context_high?.toLocaleString()}
(These are RETAIL ASKS, not wholesale. Context only.)` : ''}

=== NOTES ===
${oanca.notes.map(n => `- ${n}`).join('\n')}

=== BOB'S SCRIPT (SAY THIS) ===
${bobScript}

=== CRITICAL RULES FOR BOB ===
1. Bob is a NARRATOR, not a VALUER. OANCA is the VALUER.
2. Bob may ONLY quote numbers that appear in APPROVED NUMBERS above.
3. If allow_price = false, Bob is FORBIDDEN from quoting ANY dollar amount for wholesale.
4. If Bob outputs any dollar value not in OANCA_PRICE_OBJECT, it is a BLOCKING BUG.
5. Bob may NOT calculate, adjust, infer, or ballpark any numbers.
6. Bob speaks in Bob voice (Aussie knocker), but numbers MUST come from OANCA.
7. Photos always welcome - they help tighten the range.

=== AUDIT ===
Processing time: ${oanca.processing_time_ms}ms
Comps used: ${oanca.comps_used.length} records
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
                 'peugeot', 'citroen', 'renault', 'fiat', 'alfa romeo', 'mini', 'great wall', 'chery'];
  
  let foundMake = '';
  for (const make of makes) {
    if (text.includes(make)) {
      foundMake = make.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }
  
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
    'Peugeot': ['208', '308', '3008', '2008', '508', '5008'],
    'Renault': ['megane', 'clio', 'captur', 'koleos'],
    'Fiat': ['500', 'punto', 'tipo'],
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
  
  if (foundMake && foundModel && foundYear) {
    return { make: foundMake, model: foundModel, year: foundYear };
  }
  
  if (foundModel && foundYear) {
    for (const [make, models] of Object.entries(modelPatterns)) {
      if (models.some(m => foundModel.toLowerCase().includes(m))) {
        return { make, model: foundModel, year: foundYear };
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
- Say "give me two minutes, I'll talk to the boys" when data is thin

=== WHAT YOU CANNOT DO ===
- Calculate or derive any price
- Adjust the OANCA numbers
- Quote any number not in OANCA_PRICE_OBJECT
- Guess or ballpark when allow_price = false

Style: Calm, confident, short sentences, Aussie phrasing, no emojis, no corporate language.
Keep responses under 80 words. Sound like a phone call, not a chatbot.`;

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
      
      console.log(`[BOB] OANCA verdict: ${oancaObject.verdict}, allow_price: ${oancaObject.allow_price}`);
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
        temperature: 0.7,  // Slightly lower for more consistent narration
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

    // Log the request to database
    if (vehicleInput && oancaObject) {
      await logValoRequest(vehicleInput, oancaObject, dealerName, transcript, bobResponse);
    }

    // Build response
    const responseBody: Record<string, unknown> = { response: bobResponse };
    
    // Include OANCA debug object if requested (admin only)
    if (includeDebug && oancaObject) {
      responseBody.oanca_debug = oancaObject;
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
