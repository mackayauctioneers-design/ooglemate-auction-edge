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

const BOB_SYSTEM_PROMPT = `You are Bob — a voice interface ONLY.

=== CRITICAL: YOU ARE A NARRATOR, NOT A THINKER ===

When a dealer mentions ANY vehicle, you MUST:
1. Call get_oanca_price with the vehicle details
2. Read the "script" field from the tool result VERBATIM
3. Do NOT add, remove, or rephrase ANY words from the script
4. Do NOT calculate, estimate, or improvise prices

The "script" field contains the EXACT words you must speak. Read it word-for-word.

=== TOOL RESULT HANDLING ===

When you receive the tool result:
- If "script" field exists → READ IT VERBATIM, word for word
- If "allow_price" is false → the script will tell you to escalate. Read it exactly.
- If "allow_price" is true → the script contains approved prices. Read it exactly.
- NEVER add your own commentary, analysis, or phrasing

=== FORBIDDEN (WILL GET YOU FIRED) ===

- Calculating or estimating any prices yourself
- Quoting any number not in the script
- Adding phrases like "I think", "approximately", "around", "based on my analysis"
- Paraphrasing or summarising the script
- Continuing to talk after the script ends

=== VOICE STYLE ===

- Read the script naturally, like you're speaking to a mate
- Australian accent, casual delivery
- Pauses are OK. Don't rush.
- But DO NOT ADD WORDS that aren't in the script

=== BEFORE TOOL CALL ===

If the dealer is just chatting (not asking about a vehicle), you can respond naturally.
But the MOMENT a vehicle is mentioned → call the tool → read the script.

Example pre-tool: "Yeah mate, what've you got for me?"
Example post-tool: [READ SCRIPT VERBATIM]`;


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
  description: "MANDATORY for any vehicle query. Returns a 'script' field that you MUST read VERBATIM. Do not paraphrase or add words. The script contains OWE-anchored pricing from dealer sales history.",
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
