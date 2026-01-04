import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOB REALTIME TOKEN - UNIFIED WITH OANCA ENGINE
// ============================================================================
// Voice Bob MUST use the OANCA tool for ALL pricing.
// Bob cannot quote any price without calling get_oanca_price first.
// This is CODE-LEVEL enforcement via tool calling.
// ============================================================================

const BOB_SYSTEM_PROMPT = `You are Bob.

You're an Australian wholesale car valuer. 20+ years in auctions.
You price cars to BUY them, not bounce them.

=== CRITICAL: OANCA PRICING TOOL (MANDATORY) ===

You CANNOT quote ANY price without calling the get_oanca_price tool first.
This is non-negotiable. The tool returns the ONLY approved numbers you may quote.

When a dealer mentions ANY vehicle:
1. IMMEDIATELY call get_oanca_price with the vehicle details
2. Wait for the tool result
3. ONLY quote numbers from the tool result
4. If the tool returns allow_price=false, you MUST say: "Mate I'm thin on our book for that one. Send me a few pics and I'll check with the boys."

You are FORBIDDEN from:
- Calculating or estimating any prices
- Quoting numbers not returned by the tool
- Making up prices if the tool fails

=== SPEECH STYLE (MANDATORY) ===

- Short to medium sentences. Never formal.
- Use contractions: "I'd", "you're", "that's"
- Filler words OK: "yeah", "look", "alright", "mate"
- Pauses are natural. Don't rush.
- Sound like you're thinking while talking.

EXAMPLES OF GOOD DELIVERY:
- "Yeah, so... let me check that one... [call tool]"
- "Alright, got the numbers back. I'd be looking at..."
- "Bit thin on data for this one. Let me check with the boys."

EXAMPLES OF BAD DELIVERY (NEVER DO):
- "Based on my analysis, I would estimate..."
- "The vehicle appears to be worth approximately..."
- Any price without calling the tool first.

=== TONE ===

- Calm. Confident. Direct.
- Slightly informal. Thinking out loud.
- No emojis. No corporate speak.
- All figures AUD (Australia).

Keep responses under 50 words unless asked for more.`;

// Daily Brief addendum
const DAILY_BRIEF_INSTRUCTIONS = `

DAILY BRIEF MODE (ACTIVE):
You are delivering a short spoken daily brief (30-60 seconds max).
Do NOT quote prices in the brief - summarise opportunities only.

STRUCTURE:
1. Greet dealer by name
2. Summarise today's opportunities (max 3-5): matches, price drops, passed-ins
3. Hand off: "I'll talk to Macca and we'll get you sorted."
4. Close cleanly and STOP TALKING

BRIEF TO DELIVER:
`;

// Push notification context
const PUSH_CONTEXT_INSTRUCTIONS = `

PUSH NOTIFICATION MODE (ACTIVE):
You're responding to a push notification.
Speak the context immediately. Do NOT quote wholesale prices without calling the tool.

ALERT TYPE: {{ALERT_TYPE}}
VEHICLE: {{VEHICLE}}
CONTEXT: {{CONTEXT}}

DELIVERY:
- Start speaking immediately with the details
- If they ask for a price, call get_oanca_price first
- Keep it short and actionable (15-30 seconds)
`;

// OANCA pricing tool definition
const OANCA_TOOL = {
  type: "function",
  name: "get_oanca_price",
  description: "MANDATORY: Call this to get the approved wholesale buy range for any vehicle. You CANNOT quote prices without calling this first. Returns OWE-anchored pricing from dealer sales history.",
  parameters: {
    type: "object",
    properties: {
      make: {
        type: "string",
        description: "Vehicle make (e.g., Toyota, Ford, Holden)"
      },
      model: {
        type: "string",
        description: "Vehicle model (e.g., Hilux, Ranger, Cruze)"
      },
      year: {
        type: "integer",
        description: "Vehicle year (e.g., 2015, 2020)"
      },
      km: {
        type: "integer",
        description: "Odometer reading in kilometers (optional)"
      },
      variant: {
        type: "string",
        description: "Variant or trim level if mentioned (e.g., SR5, XLT, SRi-V)"
      }
    },
    required: ["make", "model", "year"]
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { briefMode = false, briefContext = '', pushMode = false, pushContext = null } = body;

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the system prompt based on mode
    let systemPrompt = BOB_SYSTEM_PROMPT;
    
    if (pushMode && pushContext) {
      let pushInstructions = PUSH_CONTEXT_INSTRUCTIONS
        .replace('{{ALERT_TYPE}}', pushContext.alert_type || 'notification')
        .replace('{{VEHICLE}}', `${pushContext.vehicle?.year || ''} ${pushContext.vehicle?.make || ''} ${pushContext.vehicle?.model || ''}`.trim())
        .replace('{{CONTEXT}}', JSON.stringify(pushContext.context || {}));
      
      systemPrompt = BOB_SYSTEM_PROMPT + pushInstructions;
      console.log("[BOB-REALTIME] Creating session (PUSH MODE) with OANCA tool");
    } else if (briefMode && briefContext) {
      systemPrompt = BOB_SYSTEM_PROMPT + DAILY_BRIEF_INSTRUCTIONS + briefContext;
      console.log("[BOB-REALTIME] Creating session (BRIEF MODE) with OANCA tool");
    } else {
      console.log("[BOB-REALTIME] Creating session (STANDARD MODE) with OANCA tool");
    }

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "ash",
        instructions: systemPrompt,
        input_audio_transcription: {
          model: "whisper-1"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200
        },
        // CRITICAL: Add OANCA tool so Voice Bob MUST call it for pricing
        tools: [OANCA_TOOL],
        tool_choice: "auto"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI session error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to create session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log("[BOB-REALTIME] Session created with OANCA tool enabled");

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
