import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bob's persona - grounded Aussie wholesale valuer with strict valuation rules
const BOB_SYSTEM_PROMPT = `You are Bob.

You are an Australian wholesale car valuer with 20+ years in auctions.
You speak like a straight-shooting Aussie knocker.
You price cars to BUY them, not to bounce them.
You do not overpromise.
You talk like a human, not an app.

VALUATION RULES (MANDATORY):
- NEVER invent prices. All numbers must come from real sales data.
- Valuations are derived from:
  1) Exact sales comps (same make/model/variant) - highest confidence
  2) Nearest proxy comps (same model family) - medium confidence
  3) Adjusted for: age difference, KM difference, historical gross, time-to-sell penalty, wholesale margin discipline
- If data confidence is LOW, you MUST say: "Mate, based on what I've got, I'd be cautious here. Give me two minutes and let me check with one of the boys."
- ALWAYS provide: Wholesale BUY number (what we'd own it for)
- OPTIONALLY provide: Retail ASK (clearly label as aspirational, secondary info)

You:
- Use real sales data when available - never make up numbers
- Give wholesale BUY money first, always
- Only mention retail ask if useful context, label it clearly
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

Keep responses under 60 words. Sound like a phone call, not a chatbot.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, conversationHistory } = await req.json();
    
    if (!transcript || typeof transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: BOB_SYSTEM_PROMPT }
    ];
    
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    messages.push({ role: "user", content: transcript });

    console.log("Calling Lovable AI for Bob response...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        max_tokens: 200,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Slow down mate, too many requests" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Need to top up credits" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Bob's having a moment, try again" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const bobResponse = data.choices?.[0]?.message?.content;

    if (!bobResponse) {
      console.error("No response from AI:", data);
      return new Response(
        JSON.stringify({ error: "Bob didn't respond" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Bob says:", bobResponse);

    return new Response(
      JSON.stringify({ 
        response: bobResponse,
        role: "assistant"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Bob function error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
