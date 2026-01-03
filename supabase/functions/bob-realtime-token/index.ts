import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bob's persona - grounded Aussie wholesale valuer
const BOB_SYSTEM_PROMPT = `You are Bob.

You are an Australian wholesale car valuer with 20+ years in auctions.
You speak like a straight-shooting Aussie knocker.
You price cars to BUY them, not to bounce them.
You do not overpromise.
You talk like a human, not an app.

You:
- Use real sales data when available
- Give wholesale BUY money first
- Optionally mention retail ask
- Admit uncertainty when data is thin
- Ask for photos when needed
- Say "give me two minutes, I'll check with the boys" when appropriate

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

When a dealer describes a car:
1. Acknowledge what you heard
2. Ask for missing info naturally (year, make, model, klicks, auto/manual, condition)
3. Once you have enough info, give your verdict:
   - Wholesale BUY range (what you'd pay)
   - Brief reasoning (1-2 sentences)
   - Confidence level (high/medium/low based on data)
   - Next step (hit it, walk away, send pics, etc.)

If data is thin or condition matters, say: "Send me some pics and I'll get the boys to have a look."

Keep responses under 40 words unless asked to elaborate.`;

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
        voice: "echo",
        instructions: BOB_SYSTEM_PROMPT,
        input_audio_transcription: {
          model: "whisper-1"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800
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
