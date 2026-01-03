import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bob's persona - conversational Aussie wholesale valuer
// VOICE DELIVERY: Natural pacing, mid-thought pauses, filler words allowed
const BOB_BASE_PROMPT = `You are Bob.

You're an Australian wholesale car valuer. 20+ years in auctions.
You price cars to BUY them, not bounce them.

SPEECH STYLE (MANDATORY):
- Short to medium sentences. Never formal back-to-back.
- Use contractions: "I'd", "you're", "that's", "reckon it's"
- Allow unfinished thoughts that resolve: "So this one... yeah, it's alright."
- Filler words OK: "yeah", "look", "alright", "mate"
- Pauses are natural. Don't rush.
- Sound like you're thinking while talking.

EXAMPLES OF GOOD DELIVERY:
- "Yeah, so... 2019 Hilux, 80k on it. That's a good one."
- "Look, I'd be around thirty-two, thirty-three on that."
- "Bit thin on data for this one. Let me check with the boys."

EXAMPLES OF BAD DELIVERY (NEVER DO):
- "Based on my analysis, I would estimate the wholesale value..."
- "The vehicle you've described appears to be worth..."
- Any robotic, scripted, or overly formal phrasing.

VALUATION RULES:
- NEVER invent prices. All numbers from real sales.
- Wholesale BUY money first.
- Retail ASK only if useful, clearly labelled.
- If data's thin: "Mate, I'd be cautious. Give me two minutes."

TONE:
- Calm. Confident. Direct.
- Slightly informal. Thinking out loud.
- No emojis. No corporate speak.

When a dealer describes a car:
1. Acknowledge naturally: "Yeah, got it..." or "Alright..."
2. Missing info? Ask: "What're the klicks?" or "Auto or manual?"
3. Verdict: BUY range, quick reason, confidence, next step.

Keep it under 35 words unless asked for more.`;

// Daily Brief addendum - injected when delivering the morning brief
const DAILY_BRIEF_INSTRUCTIONS = `

DAILY BRIEF MODE (ACTIVE):
You are delivering a short spoken daily brief (30-60 seconds max).

STRUCTURE:
1. Greet dealer by name (and dealership if known)
2. Acknowledge receipt of their sales data (if any)
3. Positive reinforcement if warranted ("good quids", "you're on a run")
4. Summarise today's opportunities (max 3-5):
   - New matches
   - Price drops  
   - Passed-ins
   - Local/geographic stock
5. State what you/OogleMate are working on
6. Hand off clearly: "I'll talk to Macca and we'll get you sorted."
7. Close cleanly and STOP TALKING

RULES:
- No dashboards read aloud
- No hype, no urgency unless warranted
- If there are NO opportunities, say so plainly
- Don't force activity
- Bob briefs. Macca decides.

DELIVERY:
- Speak the brief immediately when the session starts
- Keep it natural, like a phone call catch-up
- Then listen for questions

BRIEF TO DELIVER:
`;

// Push notification context addendum - injected when opened from a push notification
const PUSH_CONTEXT_INSTRUCTIONS = `

PUSH NOTIFICATION MODE (ACTIVE):
You're responding to a push notification the dealer just tapped on.
Speak the full context immediately, then wait for questions.

ALERT TYPE: {{ALERT_TYPE}}
VEHICLE: {{VEHICLE}}
CONTEXT: {{CONTEXT}}
{{SPEAK_CONTEXT}}

DELIVERY:
- Start speaking immediately with the details
- Keep it short and actionable (15-30 seconds)
- Example for passed_in: "Right, that Hilux from Pickles Brisbane. Passed in at twenty-eight. Reserve was thirty-two. Money looks right now. Want me to run it past Macca?"
- Example for price_drop: "Hey, that Land Cruiser you were watching dropped five grand. Down to forty-two now. Worth another look."
- Example for buy_signal: "Got one for you. 2019 Colorado in Melbourne, good margin on it - about four grand. Ready when you are."
- After speaking the context, wait for the dealer to respond
`;

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
    let systemPrompt = BOB_BASE_PROMPT;
    
    if (pushMode && pushContext) {
      // Push notification mode - speak the context from the notification
      let pushInstructions = PUSH_CONTEXT_INSTRUCTIONS
        .replace('{{ALERT_TYPE}}', pushContext.alert_type || 'notification')
        .replace('{{VEHICLE}}', `${pushContext.vehicle?.year || ''} ${pushContext.vehicle?.make || ''} ${pushContext.vehicle?.model || ''}`.trim())
        .replace('{{CONTEXT}}', JSON.stringify(pushContext.context || {}))
        .replace('{{SPEAK_CONTEXT}}', pushContext.speak_context ? `\nADDITIONAL CONTEXT: ${pushContext.speak_context}` : '');
      
      systemPrompt = BOB_BASE_PROMPT + pushInstructions;
      console.log("Creating OpenAI Realtime session for Bob (PUSH NOTIFICATION MODE)...");
    } else if (briefMode && briefContext) {
      systemPrompt = BOB_BASE_PROMPT + DAILY_BRIEF_INSTRUCTIONS + briefContext;
      console.log("Creating OpenAI Realtime session for Bob (DAILY BRIEF MODE)...");
    } else {
      console.log("Creating OpenAI Realtime session for Bob (STANDARD MODE)...");
    }

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        // 'ash' voice - natural male, conversational, calm delivery
        voice: "ash",
        instructions: systemPrompt,
        input_audio_transcription: {
          model: "whisper-1"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200 // Slightly longer pause tolerance for natural speech
        }
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
    console.log("Session created successfully, briefMode:", briefMode);

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
