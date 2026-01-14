import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOB VOICE - SITE-AWARE DEALER ASSISTANT
// ============================================================================
// Bob can now answer questions about opportunities, auctions, and watchlists
// using real-time data from the system via tools.
// ============================================================================

const BOB_SYSTEM_PROMPT = `You are Macka — a site-aware dealer assistant. You're Australian through and through.

=== WHO YOU ARE ===

You're a senior knocker from regional NSW who's been in the trade 20 years.
You sound natural, calm, confident, brief — proper Aussie dealer, not American.
Not an app. Not a chatbot. A bloke who knows his stuff.

=== ACCENT RULES (CRITICAL) ===

You MUST sound Australian. Use these patterns:
- "Righto" not "Alright" or "Okay"
- "Yeah nah" or "Nah yeah" for nuance
- "Reckon" not "think" or "believe"
- "Not bad" not "awesome" or "great"
- "She'll be right" for reassurance
- "Mate" sparingly but naturally
- "A bit dear" for expensive, "cheap as chips" for bargains
- Numbers: "twenty-three grand" not "twenty-three thousand dollars"
- Avoid American phrases: "awesome", "super", "totally", "absolutely", "definitely"

=== YOUR CAPABILITIES ===

You have access to these tools:
1. get_oanca_price - Get pricing for a specific vehicle (ALWAYS use for pricing questions)
2. get_today_opportunities - Find buying opportunities based on dealer profile
3. get_upcoming_auctions - List upcoming auctions with heat ratings
4. get_watchlist - Show what the dealer is currently watching
5. explain_lot - Explain why a specific lot is recommended

=== WHEN TO USE TOOLS ===

PRICING QUESTIONS (e.g. "what's a 2020 Hilux worth"):
→ Call get_oanca_price with vehicle details
→ Read the "script" field VERBATIM - word for word, nothing added

OPPORTUNITY QUESTIONS (e.g. "what should I buy today", "any deals"):
→ Call get_today_opportunities
→ Summarise the top 3-5 items naturally
→ Mention the auction house and location
→ Keep it brief - 30 seconds max

AUCTION QUESTIONS (e.g. "what auctions are coming up", "anything hot"):
→ Call get_upcoming_auctions  
→ Highlight the hottest ones first
→ Mention relevant lot counts

WATCHLIST QUESTIONS (e.g. "what am I watching", "my list"):
→ Call get_watchlist
→ Summarise what they're tracking

EXPLANATION QUESTIONS (e.g. "why is this here", "why this one"):
→ Call explain_lot with the lot_id from context
→ Explain the match logic naturally

=== RESPONSE STYLE ===

For PRICING: Read the script EXACTLY. Don't add or change words.

For EVERYTHING ELSE: Be natural and conversational.
- "Righto, looking at your opportunities..."
- "Yeah, you've got a few things coming up..."
- "Your watchlist's got..."
- Keep responses under 45 seconds
- Be specific - mention actual numbers, locations, makes/models
- If something's hot, say so: "This one's worth a look"

=== HARD RULES ===

1. NEVER make up prices - always call get_oanca_price
2. NEVER give generic advice - always call a tool first
3. If a tool returns no data, say "Nothing matching right now" and move on
4. Sound human, not robotic
5. Keep it brief - dealers are busy`;


// Daily Brief mode
const DAILY_BRIEF_INSTRUCTIONS = `

DAILY BRIEF MODE:
Deliver a short spoken brief (30-60 seconds max).
Call get_today_opportunities first, then summarise.

STRUCTURE:
1. Greet dealer
2. Summarise today's opportunities (max 3-5)
3. Mention any hot auctions
4. Hand off naturally
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
If they ask for a price, call get_oanca_price first.
`;

// OANCA pricing tool
const OANCA_TOOL = {
  type: "function",
  name: "get_oanca_price",
  description: "Get wholesale pricing for a vehicle. Returns a 'script' field that you MUST read VERBATIM.",
  parameters: {
    type: "object",
    properties: {
      make: { type: "string", description: "Vehicle make (e.g., Toyota, Ford)" },
      model: { type: "string", description: "Vehicle model (e.g., Hilux, Ranger)" },
      year: { type: "integer", description: "Vehicle year" },
      km: { type: "integer", description: "Odometer in km (optional)" },
      variant: { type: "string", description: "Variant/trim (optional)" }
    },
    required: ["make", "model", "year"]
  }
};

// Site-aware tools
const OPPORTUNITIES_TOOL = {
  type: "function",
  name: "get_today_opportunities",
  description: "Find buying opportunities matching the dealer's profile. Call this when asked about deals, what to buy, or opportunities.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Max results (default 5)" }
    },
    required: []
  }
};

const AUCTIONS_TOOL = {
  type: "function",
  name: "get_upcoming_auctions",
  description: "List upcoming auctions with heat ratings showing how many relevant lots. Call this for auction schedule questions.",
  parameters: {
    type: "object",
    properties: {
      days_ahead: { type: "integer", description: "Days to look ahead (default 7)" }
    },
    required: []
  }
};

const WATCHLIST_TOOL = {
  type: "function",
  name: "get_watchlist",
  description: "Get the dealer's current watchlist. Call this when they ask what they're watching or tracking.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

const EXPLAIN_LOT_TOOL = {
  type: "function",
  name: "explain_lot",
  description: "Explain why a specific lot is recommended. Use when dealer asks 'why is this here' or 'why this one'.",
  parameters: {
    type: "object",
    properties: {
      lot_id: { type: "string", description: "The lot ID to explain" }
    },
    required: ["lot_id"]
  }
};

const ALL_TOOLS = [OANCA_TOOL, OPPORTUNITIES_TOOL, AUCTIONS_TOOL, WATCHLIST_TOOL, EXPLAIN_LOT_TOOL];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { 
      briefMode = false, 
      briefContext = '', 
      pushMode = false, 
      pushContext = null,
      siteContext = null // New: runtime context from client
    } = body;

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
    
    // Add site context if available
    if (siteContext) {
      const contextLines: string[] = [];
      if (siteContext.route) contextLines.push(`Current page: ${siteContext.route}`);
      if (siteContext.dealer_id) contextLines.push(`Dealer ID: ${siteContext.dealer_id}`);
      if (siteContext.selection?.lot_id) contextLines.push(`Selected lot: ${siteContext.selection.lot_id}`);
      if (siteContext.page_summary?.eligible_lots_today) {
        contextLines.push(`Eligible lots today: ${siteContext.page_summary.eligible_lots_today}`);
      }
      
      if (contextLines.length > 0) {
        systemPrompt += `\n\n=== CURRENT CONTEXT ===\n${contextLines.join('\n')}`;
      }
    }
    
    if (pushMode && pushContext) {
      let pushInstructions = PUSH_CONTEXT_INSTRUCTIONS
        .replace('{{ALERT_TYPE}}', pushContext.alert_type || 'notification')
        .replace('{{VEHICLE}}', `${pushContext.vehicle?.year || ''} ${pushContext.vehicle?.make || ''} ${pushContext.vehicle?.model || ''}`.trim())
        .replace('{{CONTEXT}}', JSON.stringify(pushContext.context || {}));
      
      systemPrompt += pushInstructions;
      console.log("[BOB-REALTIME] Creating session (PUSH MODE)");
    } else if (briefMode && briefContext) {
      systemPrompt += DAILY_BRIEF_INSTRUCTIONS + briefContext;
      console.log("[BOB-REALTIME] Creating session (BRIEF MODE)");
    } else {
      console.log("[BOB-REALTIME] Creating session (SITE-AWARE MODE)");
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
        tools: ALL_TOOLS,
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
    console.log("[BOB-REALTIME] Session created with site-aware tools");

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
