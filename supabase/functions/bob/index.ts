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
}

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
  // Fast movers (< 14 days) = no penalty
  if (daysInStock <= 14) return 1.0;
  // Normal (14-30 days) = slight penalty
  if (daysInStock <= 30) return 0.95;
  // Slow (30-60 days) = moderate penalty
  if (daysInStock <= 60) return 0.85;
  // Very slow (60-90 days) = significant penalty
  if (daysInStock <= 90) return 0.7;
  // Problem stock (90+ days) = heavy penalty
  return 0.5;
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
function calculateValuation(comps: SalesHistoryRecord[], requestedYear: number): ValuationData {
  if (comps.length === 0) {
    return {
      comps: [],
      confidence: 'LOW',
      avgBuyPrice: null,
      avgSellPrice: null,
      avgGrossProfit: null,
      avgDaysInStock: null,
      priceRange: null,
      confidenceReason: 'No comparable sales data found'
    };
  }
  
  // Weight each comp
  const weightedComps: WeightedComp[] = comps.map(record => {
    const { weight: recencyWeight, days: recencyDays } = calculateRecencyWeight(record.sale_date);
    const liquidityPenalty = calculateLiquidityPenalty(record.days_in_stock || 0);
    
    // Combined weight
    const weight = recencyWeight * liquidityPenalty;
    
    return {
      record,
      weight,
      recencyDays,
      liquidityPenalty
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
      confidenceReason: 'No valid price data in comparables'
    };
  }
  
  const avgBuyPrice = Math.round(weightedBuySum / totalWeight);
  const avgSellPrice = Math.round(weightedSellSum / totalWeight);
  const avgGrossProfit = Math.round(weightedGrossSum / totalWeight);
  const avgDaysInStock = Math.round(weightedDaysSum / totalWeight);
  
  const minPrice = Math.min(...validBuyPrices);
  const maxPrice = Math.max(...validBuyPrices);
  
  // Determine confidence
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
  
  return {
    comps: weightedComps,
    confidence,
    avgBuyPrice,
    avgSellPrice,
    avgGrossProfit,
    avgDaysInStock,
    priceRange: { min: minPrice, max: maxPrice },
    confidenceReason
  };
}

// Format valuation data for Bob's context
function formatValuationContext(valuation: ValuationData, make: string, model: string, year: number): string {
  if (valuation.comps.length === 0) {
    return `\n\n[VALUATION DATA: No comparable sales found for ${year} ${make} ${model}. Confidence: LOW. Ask for photos and defer to the team.]\n`;
  }
  
  const compsCount = valuation.comps.length;
  const recentComps = valuation.comps.filter(wc => wc.recencyDays <= 90).length;
  
  let context = `\n\n[VALUATION DATA for ${year} ${make} ${model}]
Confidence: ${valuation.confidence}
Reason: ${valuation.confidenceReason}
Sample size: ${compsCount} comparable sales

`;

  if (valuation.avgBuyPrice) {
    context += `Average BUY price (weighted): $${valuation.avgBuyPrice.toLocaleString()}
`;
  }
  if (valuation.priceRange) {
    context += `Buy price range: $${valuation.priceRange.min.toLocaleString()} - $${valuation.priceRange.max.toLocaleString()}
`;
  }
  if (valuation.avgSellPrice) {
    context += `Average SELL price: $${valuation.avgSellPrice.toLocaleString()}
`;
  }
  if (valuation.avgGrossProfit) {
    context += `Average gross profit: $${valuation.avgGrossProfit.toLocaleString()}
`;
  }
  if (valuation.avgDaysInStock) {
    context += `Average days to sell: ${valuation.avgDaysInStock} days
`;
  }
  
  // Add top 3 recent comps as examples
  context += `\nRecent sales examples:\n`;
  const topComps = valuation.comps.slice(0, 3);
  for (const wc of topComps) {
    const r = wc.record;
    context += `- ${r.year} ${r.make} ${r.model} ${r.variant || ''}: Bought $${parseInt(String(r.total_cost)).toLocaleString()}, Sold $${parseInt(String(r.sell_price)).toLocaleString()}, ${r.days_in_stock} days, ${wc.recencyDays} days ago\n`;
  }
  
  // Add guidance based on confidence
  if (valuation.confidence === 'LOW' || compsCount < 2) {
    context += `\n[INSTRUCTION: Data is thin. Say "Mate, I'm light on data for this one. Give me two minutes, let me check with one of the boys." Ask for 4-5 photos to get a proper read.]\n`;
  } else if (valuation.confidence === 'MEDIUM') {
    context += `\n[INSTRUCTION: Provide a buy range, but caveat with "based on what I'm seeing". Suggest photos for tighter pricing.]\n`;
  } else {
    context += `\n[INSTRUCTION: Confident pricing. Give a firm wholesale buy range based on the data.]\n`;
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

VALUATION RULES (MANDATORY):
- NEVER invent prices. All numbers must come from the [VALUATION DATA] provided.
- If [VALUATION DATA] is provided, USE THOSE EXACT NUMBERS for your valuation.
- If confidence is LOW or sample size < 2, you MUST ask for photos and defer.
- ALWAYS provide: Wholesale BUY range (what we'd own it for)
- Apply wholesale margin discipline: aim for 8-12% gross on sub-$30k stock, 6-8% on $30-60k, 5-6% on $60k+

CONFIDENCE HANDLING:
- HIGH confidence: Give a firm buy range, be decisive
- MEDIUM confidence: Give a range with caveats, suggest photos for tighter pricing
- LOW confidence (or <2 comps): Say "Mate, I'm light on data for this one. Give me two minutes, let me check with one of the boys." Ask for 4-5 photos.

You:
- Use real sales data when available - never make up numbers
- Give wholesale BUY money first, always
- Account for days-in-stock (slow movers = be cautious)
- Admit uncertainty when data is thin
- Ask for photos when confidence is not HIGH
- Say "give me two minutes, I'll check with the boys" when data is thin

You are not absolute.
Dealers use you as guidance, not gospel.

Tone:
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
      const valuation = calculateValuation(comps, vehicleDetails.year);
      
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
