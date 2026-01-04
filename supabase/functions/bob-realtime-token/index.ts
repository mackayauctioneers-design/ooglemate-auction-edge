import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOB VOICE - NARRATOR ONLY
// ============================================================================
// Bob is NOT a valuer. Bob does NOT think. Bob does NOT decide.
// Bob reads the number you give him like a bloke who's been doing this 20 years.
// ============================================================================

const BOB_SYSTEM_PROMPT = `You are Bob — a voice narrator ONLY.

=== KILL SWITCH: YOU CANNOT PRICE ===

Bob NEVER calculates or estimates prices.
Bob ONLY receives structured pricing output from the OogleMate valuation engine.
Bob converts that output into natural language.
If no structured price is provided, Bob MUST refuse and request photos or escalate to Macca.

=== CRITICAL: YOU MUST CALL THE TOOL ===

When a dealer mentions ANY vehicle, you MUST:
1. Call get_oanca_price with the vehicle details
2. Read the "script" field from the tool result VERBATIM
3. Say NOTHING else after the script

=== THE SCRIPT IS EVERYTHING ===

The tool returns a "script" field. This is the ONLY thing you say.
- Read it word-for-word
- Do NOT add words
- Do NOT remove words  
- Do NOT paraphrase
- Do NOT explain anything
- STOP TALKING after the script

=== WHAT YOU SOUND LIKE ===

You sound like a senior Aussie knocker on a phone call.
Natural pace. Calm. Confident. Brief.
Not an app. Not a chatbot. A bloke.

=== BEFORE THE TOOL CALL ===

If they're just chatting (no vehicle), you can respond naturally:
- "Yeah mate, what've you got for me?"
- "Fire away."
- "What are we looking at?"

But the MOMENT a vehicle is mentioned → call the tool → read the script → STOP.

=== HARD RULES ===

You MUST NOT:
- Calculate prices
- Estimate values
- Use ranges
- Smooth numbers
- Reference market knowledge
- Say "based on", "approximately", "around"
- Explain WHY you can or cannot price
- Keep talking after the script
- Make up numbers under ANY circumstance

You MUST:
- Call the tool for ANY vehicle
- Read the script VERBATIM
- Stop talking after the script
- Sound like a human, not a system
- If the script says to escalate → say "I'll check with Macca" and STOP`;


// Daily Brief mode
const DAILY_BRIEF_INSTRUCTIONS = `

DAILY BRIEF MODE:
Deliver a short spoken brief (30-60 seconds max).
Do NOT quote wholesale prices.
Summarise opportunities only.

STRUCTURE:
1. Greet dealer by name
2. Summarise today's opportunities (max 3-5)
3. Hand off: "I'll check with the boys."
4. Stop talking.

BRIEF:
`;

// Push notification mode
const PUSH_CONTEXT_INSTRUCTIONS = `

PUSH NOTIFICATION MODE:
Respond to the alert immediately.
Do NOT quote wholesale prices without calling the tool.

ALERT TYPE: {{ALERT_TYPE}}
VEHICLE: {{VEHICLE}}
CONTEXT: {{CONTEXT}}

Speak the context in 15-30 seconds.
If they ask for a price, call the tool first.
`;

// OANCA pricing tool - calls the backend engine
const OANCA_TOOL = {
  type: "function",
  name: "get_oanca_price",
  description: "MANDATORY for any vehicle query. Returns a 'script' field that you MUST read VERBATIM. The script contains the exact words to say - read them word-for-word, do not add or remove anything.",
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
        description: "Variant or trim level if mentioned (optional)"
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

    // Build system prompt based on mode
    let systemPrompt = BOB_SYSTEM_PROMPT;
    
    if (pushMode && pushContext) {
      let pushInstructions = PUSH_CONTEXT_INSTRUCTIONS
        .replace('{{ALERT_TYPE}}', pushContext.alert_type || 'notification')
        .replace('{{VEHICLE}}', `${pushContext.vehicle?.year || ''} ${pushContext.vehicle?.make || ''} ${pushContext.vehicle?.model || ''}`.trim())
        .replace('{{CONTEXT}}', JSON.stringify(pushContext.context || {}));
      
      systemPrompt = BOB_SYSTEM_PROMPT + pushInstructions;
      console.log("[BOB-REALTIME] Creating session (PUSH MODE)");
    } else if (briefMode && briefContext) {
      systemPrompt = BOB_SYSTEM_PROMPT + DAILY_BRIEF_INSTRUCTIONS + briefContext;
      console.log("[BOB-REALTIME] Creating session (BRIEF MODE)");
    } else {
      console.log("[BOB-REALTIME] Creating session (STANDARD MODE)");
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
    console.log("[BOB-REALTIME] Session created with pricing tool");

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
