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

    const systemPrompt = `You are a ruthless Australian car arbitrage agent. Your job is to identify undervalued used cars that can be flipped for profit.

CRITICAL RULES:
- All prices are "off-road" prices (excluding government charges, stamp duty, rego, CTP)
- Focus on dealer, private, and auction patterns across Australia
- Estimate margin % based on typical retail vs wholesale spread for this segment
- Provide actionable search phrases or direct platform hints
- Be realistic about risks (flood damage, odometer rollback, accident history, poor resale regions)

User spec:
- Model: ${model}
- Year range: ${yearMin}-${yearMax}
- Max odometer: ${maxKm.toLocaleString()} km
- Max off-road price: $${maxPrice.toLocaleString()}
- Location: ${location}

Return a JSON object with this exact structure:
{
  "opportunities": [
    {
      "title": "2019 Toyota Hilux SR5 4x4",
      "year": 2019,
      "km": 85000,
      "offRoadPrice": 42000,
      "marginPct": 12,
      "link": "Search 'Hilux SR5 2019 under 90k' on Carsales/Gumtree/Pickles",
      "risks": "Check for mining use, tow capacity abuse",
      "notes": "Strong retail demand in regional NSW/QLD. Auction clearance typically $38-42k."
    }
  ]
}

Return 3-5 ranked opportunities. Be specific and actionable. Use Australian market knowledge.`;

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
