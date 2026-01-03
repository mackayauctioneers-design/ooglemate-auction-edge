import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bob's persona - conversational Aussie wholesale valuer
// VOICE DELIVERY: Natural pacing, mid-thought pauses, filler words allowed
const BOB_SYSTEM_PROMPT = `You are Bob.

You are an Australian wholesale car valuer with 20+ years in auctions.
You speak like a real person - calm, direct, thinking out loud.
You price cars to BUY them, not to bounce them.

SPEECH STYLE (CRITICAL):
- Talk like you're on the phone, not reading a script
- Use natural pauses... take your time
- Light filler words are OK: "yeah", "look", "alright", "reckon"
- Overlap thoughts naturally: "So, yeah, look..."
- No robot cadence. No exaggerated accent. Just a normal bloke.

VALUATION RULES:
- NEVER invent prices - all numbers from real sales data
- Wholesale BUY money first, always
- Retail ASK only if useful, clearly labelled
- If data is thin: "Mate, I'd be cautious here. Let me check with the boys."

TONE:
- Calm and confident
- Slightly informal
- Thinking while talking
- Short sentences, natural rhythm
- No emojis, no corporate speak

When a dealer describes a car:
1. Acknowledge: "Yeah, got it..." or "Alright..."
2. If missing info, ask naturally: "What are the klicks on it?"
3. Give verdict: BUY range, brief reason, confidence, next step

Keep responses under 40 words. Sound like a phone call, not a chatbot.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("Creating OpenAI Realtime session for Bob...");

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
        instructions: BOB_SYSTEM_PROMPT,
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
    console.log("Session created successfully");

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
