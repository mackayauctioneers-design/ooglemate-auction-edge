import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GrokRequest {
  model: string;
  yearMin: number;
  yearMax: number;
  maxKm: number;
  maxPrice: number;
  location?: string;
}

interface DealOpportunity {
  title: string;
  year: number;
  km: number;
  offRoadPrice: number;
  marginPct: number;
  link: string;
  risks: string;
  notes: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const XAI_API_KEY = Deno.env.get('XAI_API_KEY');
    if (!XAI_API_KEY) {
      console.error('[grok-deal-hunter] XAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'xAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: GrokRequest = await req.json();
    const { model, yearMin, yearMax, maxKm, maxPrice, location = 'Australia-wide' } = body;

    console.log('[grok-deal-hunter] Request:', { model, yearMin, yearMax, maxKm, maxPrice, location });

    // Validate inputs
    if (!model || !yearMin || !yearMax || !maxKm || !maxPrice) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: model, yearMin, yearMax, maxKm, maxPrice' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentYear = new Date().getFullYear();
    const systemPrompt = `You are a ruthless Australian car arbitrage agent (Carbitrage). Your job is to identify undervalued used cars for profitable flip.

## CORE CARBITRAGE HUNT RULES (Australia-wide, always)

### Source Coverage
Search EVERY available platform: carsales.com.au, gumtree.com.au, Facebook Marketplace, Carma.com.au, Drive.com.au, private seller ads, dealer listings, forums, auctions.
Do NOT ignore dealers—include certified pre-owned with full history/service records if they meet criteria.

### Pricing Rules
- ALWAYS use off-road/drive-away price EXCLUDING govt charges/on-roads/stamp duty (focus on advertised price before extras)
- All prices in output are "off-road" AUD

### Model Year Priority
- Prefer newer (e.g., ${currentYear}/${currentYear + 1} MY) if price delta ≤ +$8k off-road compared to similar older equivalent

### Mileage Priority
- Strongly prioritize <50,000 km total (ideally much lower for value)

### Body Type
- Prioritize hatchbacks and sedans
- Avoid SUVs/crossovers unless exceptional deal (e.g., off-road price steal under $25k with low km/history)

### Seller Type
- Heavily favor private/motivated sellers (distressed sales, quick flips)
- Include dealers ONLY if certified pre-owned + full service history + competitive pricing

### Metrics & Honesty
- Calculate $/km (lower = better)
- Be BRUTALLY HONEST—no weak/sideways options
- Flag ALL red flags (flood damage, odometer rollback, accident history, poor resale regions)

### Recent Wins/Benchmarks
- 2024 Hyundai i30 N Line Premium, ~10k km, $30,990 off-road (strong private buy)
- 2025 MY25 i30 upgrade ~9k km at $37,990 off-road (if delta justified)

---

## CURRENT HUNT SPEC

- Model: ${model}
- Year range: ${yearMin}-${yearMax}
- Max odometer: ${maxKm.toLocaleString()} km
- Max off-road price: $${maxPrice.toLocaleString()}
- Location: ${location}

Return a JSON object with this EXACT structure:
{
  "opportunities": [
    {
      "title": "2024 Hyundai i30 N Line Premium",
      "year": 2024,
      "km": 10000,
      "offRoadPrice": 30990,
      "dollarsPerKm": 3.10,
      "marginPct": 12,
      "link": "Search 'i30 N Line 2024 under 15k km' on Carsales/Gumtree/Pickles",
      "sellerType": "private",
      "risks": "Check service history, any accident damage",
      "notes": "Strong retail demand. Benchmark: recent win at $30,990.",
      "comparisonToWins": "Matches benchmark perfectly"
    }
  ],
  "summary": "Market overview and top recommendation"
}

Return 3-5 ranked opportunities (best first). Be specific and actionable. Use Australian market knowledge.`;

    const userPrompt = `Hunt undervalued ${model} cars matching: ${yearMin}-${yearMax}, under ${maxKm.toLocaleString()}km, max $${maxPrice.toLocaleString()} off-road, in ${location}. Return JSON with opportunities.`;

    console.log('[grok-deal-hunter] Calling xAI API...');

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[grok-deal-hunter] xAI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'Invalid xAI API key' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: `xAI API error: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('[grok-deal-hunter] xAI response received');

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[grok-deal-hunter] No content in response');
      return new Response(
        JSON.stringify({ error: 'No response from Grok' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse JSON from response (handle markdown code blocks)
    let parsedContent: { opportunities: DealOpportunity[] };
    try {
      // Remove markdown code blocks if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();
      
      parsedContent = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[grok-deal-hunter] Failed to parse JSON:', parseError, 'Content:', content);
      // Return raw content if parsing fails
      return new Response(
        JSON.stringify({ 
          opportunities: [],
          rawResponse: content,
          error: 'Could not parse structured response'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[grok-deal-hunter] Found', parsedContent.opportunities?.length || 0, 'opportunities');

    return new Response(
      JSON.stringify(parsedContent),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[grok-deal-hunter] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
