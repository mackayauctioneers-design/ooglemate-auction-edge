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
  priority_domains?: string[];
}

interface DealOpportunity {
  title: string;
  year: number;
  km: number;
  offRoadPrice: number;
  marginPct: number;
  source: string;
  link: string;
  dealerUrl: string | null;
  fallbackSearchQuery: string;
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
    const { model, yearMin, yearMax, maxKm, maxPrice, location = 'Australia-wide', priority_domains = [] } = body;

    console.log('[grok-deal-hunter] Request:', { model, yearMin, yearMax, maxKm, maxPrice, location, priority_domains_count: priority_domains.length });

    // Validate inputs
    if (!model || !yearMin || !yearMax || !maxKm || !maxPrice) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: model, yearMin, yearMax, maxKm, maxPrice' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentYear = new Date().getFullYear();
    
    // Build priority domains section if provided
    const priorityDomainsSection = priority_domains.length > 0 
      ? `
### PRIORITY DEALER SITES (Check these FIRST - user-curated sources)
${priority_domains.map(d => `- ${d}`).join('\n')}
These are verified dealer sites from the user's queue. Search these first before falling back to general sources.
`
      : '';

    const systemPrompt = `You are a ruthless Australian car arbitrage agent (Carbitrage). Your job is to identify undervalued used cars for profitable flip.

## CORE CARBITRAGE HUNT RULES (Australia-wide, always)
${priorityDomainsSection}
### SOURCE PRIORITY ORDER (reliability-first - CRITICAL)
1. **PRIMARY (stable links)**: Gumtree.com.au, Facebook Marketplace, Carma.com.au${priority_domains.length > 0 ? ', PLUS all priority dealer sites above' : ''}
2. **SECONDARY**: Drive.com.au classifieds, private seller ads/forums, dealer direct websites
3. **CARSALES-DISCOVERY MODE ONLY**: Use carsales.com.au for DATA EXTRACTION only—NEVER as primary link

### CARSALES-SAFE DISCOVERY MODE (CRITICAL)
When sourcing from carsales.com.au:
- **NEVER** use direct carsales listing URL as the primary link
- Use carsales ONLY for data extraction: price, km, year, dealer name, dealer license, suburb/postcode
- For EVERY carsales hit:
  1. Extract dealer name + license + suburb from the listing
  2. Derive stable dealerUrl: Search "dealer name + license number + website Australia" → use top dealer site result
  3. If no dealer site found, fall back to carsales dealer profile page
  4. Use the derived dealer site as the PRIMARY link
  5. Store original carsales URL in verificationSource (for reference only)
- Mark source as "carsales-discovery" (NOT "carsales")

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
- Flag ALL red flags (flood damage, odometer rollback, accident history, poor resale regions, potential sold/expired)

### Recent Wins/Benchmarks
- 2024 Hyundai i30 N Line Premium, ~10k km, $30,990 off-road (strong private buy)
- 2025 MY25 i30 upgrade ~9k km at $37,990 off-road (if delta justified)

---

## GEOGRAPHIC INTELLIGENCE (GEO LAYER) - CRITICAL

### Purpose
Consider geographic context to understand where vehicles move, where they clear fastest, and where mispricing is most likely to occur. This prevents metro bias and unlocks regional arbitrage.

### Regional Liquidity Awareness
Track clearance velocity by region, not just nationally:
- Some models clear faster in QLD regional than Sydney metro
- Utes / 4WDs have stronger demand in WA / NT / FNQ
- Metro pricing can be misleading for regional exits
- Score vehicles differently based on WHERE they are located AND WHERE they likely exit

### Geo Price Dislocation Detection
Identify regional price mismatches:
- Cheap regional listings for vehicles that exit strongly in metro = GEO-ARBITRAGE OPPORTUNITY
- Metro listings overpriced relative to nearby regions = AVOID
- Dealers consistently underpricing in certain postcodes = TARGET

### Freight Cost Modelling
Location is NOT a hard exclusion—it's a cost modifier:
- NSW ↔ QLD ↔ VIC: ~$1,000 freight
- Tasmania: ~$1,300 freight
- WA / NT: ~$1,800-2,500 freight

Factor freight into margin calculation.

### Geo Questions to Answer for Every Opportunity
1. Is this "cheap" because of weak exit region or genuine underpricing?
2. What's the regional clearance velocity for this model?
3. Does the listing location match known strong exit regions?
4. What's the freight cost to a strong exit region?

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
      "source": "gumtree|facebook|carma|drive|dealer-direct|carsales-discovery",
      "link": "https://www.dealersite.com.au/stock/12345 (STABLE dealer URL, NEVER direct carsales)",
      "verificationSource": "https://www.carsales.com.au/... (if discovered there) or null",
      "dealerName": "Sydney Auto Hub" or null,
      "dealerLicense": "MD12345" or null,
      "fallbackSearchQuery": "2024 Hyundai i30 N Line Premium Sydney low km",
      "sellerType": "private|dealer|certified",
      "location": "Sydney NSW",
      "state": "NSW",
      "postcode": "2000",
      "geoExitStrength": "HIGH|MEDIUM|LOW|UNKNOWN",
      "geoNotes": "Sydney metro strong exit for i30; no freight needed",
      "estimatedFreightCost": 0,
      "risks": "Check service history, any accident damage",
      "notes": "Geo context applied. For carsales-discovery: 'Data verified from carsales but linked to dealer site for reliability.'",
      "comparisonToWins": "Matches benchmark perfectly"
    }
  ],
  "summary": "Prioritized stable sources; carsales used for discovery only with dealer site links. Geo context: [regional insights]."
}

Return 3-5 ranked opportunities (best first). Be specific and actionable. Use Australian market knowledge.`;

    const userPrompt = `Hunt undervalued ${model} cars matching: ${yearMin}-${yearMax}, under ${maxKm.toLocaleString()}km, max $${maxPrice.toLocaleString()} off-road, in ${location}. Return JSON with opportunities. PRIORITIZE Gumtree/Facebook/Carma over carsales.`;

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
