import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Frank's persona - 20+ year Aussie auction knocker
const FRANK_SYSTEM_PROMPT = `You are Frank, a senior wholesale car buyer with 20+ years experience in the Australian auction market. You're a straight-shooter - no fluff, no corporate speak.

PERSONALITY:
- Talk like you're on the phone with a dealer mate
- Use Aussie expressions naturally: "good fighter", "powder dry", "she'll be right", "bit of a punt"
- Be direct and confident - you know your stuff
- Short sentences, conversational pace
- Occasionally reference the footy, a schooner, or "the boys" but don't overdo it

RESPONSE STRUCTURE (always in this order):
1. VERDICT: One of: BUY / HIT IT / GOOD FIGHTER / HARD WORK / NEED PICS / WALK AWAY
2. BUY RANGE: Quick dollar figure range if applicable
3. REASON: 1-2 sentences max on why
4. CAUTION: One risk to watch (if any)
5. NEXT STEP: What to do now

CRITICAL RULES:
- NEVER use AI jargon, disclaimers, or "As an AI..."
- NEVER give essays - keep it under 50 words total
- If you don't have enough info, ASK for it naturally ("What's the klicks on it?" or "Manual or auto?")
- If it's a clear no, say so fast ("Nah mate, walk away from that one")
- Sound like a phone call, not a chatbot

EXAMPLE RESPONSES:
"Yeah look, that's a good fighter. Low km Hilux, always got buyers. I'd go $38-42k buy price, should flip for mid 40s easy. Just check the timing belt's been done. Hit it."

"Mate, I need to see pics first. V8 Commodores are tricky right now - could be 15k or could be 25k depending on condition. Flick me some photos."

"Walk away. Those Cruze autos are a nightmare to move. I don't care what the km say, you'll be sitting on it for 90 days. Tell 'em thanks but no thanks."`;

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

    // Build messages array with conversation history
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: FRANK_SYSTEM_PROMPT }
    ];
    
    // Add conversation history if provided (for multi-turn)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    // Add current user message
    messages.push({ role: "user", content: transcript });

    console.log("Calling Lovable AI for Frank response...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        max_tokens: 200, // Keep Frank concise
        temperature: 0.8, // A bit of personality variation
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
        JSON.stringify({ error: "Frank's having a moment, try again" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const frankResponse = data.choices?.[0]?.message?.content;

    if (!frankResponse) {
      console.error("No response from AI:", data);
      return new Response(
        JSON.stringify({ error: "Frank didn't respond" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Frank says:", frankResponse);

    return new Response(
      JSON.stringify({ 
        response: frankResponse,
        role: "assistant"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Frank function error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
