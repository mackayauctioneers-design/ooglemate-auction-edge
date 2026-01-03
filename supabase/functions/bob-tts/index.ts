import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bob TTS: Convert Bob's response text to speech using OpenAI TTS
// Uses 'alloy' voice with gpt-4o-mini-tts model
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();
    
    if (!text || typeof text !== 'string') {
      console.error("bob-tts: Missing or invalid text");
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      console.error("bob-tts: OPENAI_API_KEY not configured");
      throw new Error("OPENAI_API_KEY not configured");
    }

    console.log(`bob-tts: Processing text (${text.length} chars): "${text.substring(0, 50)}..."`);

    // TTS request with retry logic
    const makeTTSRequest = async (): Promise<Response> => {
      return await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: text,
          voice: "alloy",
          response_format: "mp3",
        }),
      });
    };

    // First attempt
    let response = await makeTTSRequest();
    console.log(`bob-tts: First attempt - status ${response.status}`);

    // Retry once on 429 after 1.5s
    if (response.status === 429) {
      console.log("bob-tts: Rate limited (429), retrying in 1.5s...");
      await new Promise(resolve => setTimeout(resolve, 1500));
      response = await makeTTSRequest();
      console.log(`bob-tts: Retry attempt - status ${response.status}`);
    }

    // Still 429 after retry
    if (response.status === 429) {
      console.error("bob-tts: Still rate limited after retry");
      return new Response(
        JSON.stringify({ 
          error: "Bob's having a smoke — try again in a sec.",
          retryable: true 
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`bob-tts: OpenAI error - status ${response.status}, body: ${errorText}`);
      throw new Error(`TTS failed: ${response.status} - ${errorText}`);
    }

    // Get binary audio response
    const audioBuffer = await response.arrayBuffer();
    console.log(`bob-tts: Success - ${audioBuffer.byteLength} bytes, model: gpt-4o-mini-tts`);

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("bob-tts error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "TTS failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
