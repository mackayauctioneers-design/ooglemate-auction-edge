/**
 * ooglebot-gemini-insight — Interpretive market insight from top 3 cheapest listings.
 * Only called when listing age data is available.
 *
 * RULES:
 * - Gemini can ONLY interpret the numbers provided
 * - It must NEVER recalculate, override, or suggest alternative prices
 * - It must NEVER introduce new price points or listings
 * - Output is structured bullet points, max 5 lines
 */



const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      vehicle, floor, second, third, spread_pct, count, outlier_flag,
      floor_days_listed, second_days_listed, third_days_listed,
    } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are a concise used vehicle market analyst for an Australian car dealership tool.

STRICT RULES:
- You may ONLY interpret the numbers provided. Do NOT recalculate anything.
- Do NOT suggest alternative listings or price points.
- Do NOT override or question any values.
- Do NOT use AI branding, emoji, or chatbot language.
- Do NOT use markdown headers or formatting.
- Maximum 5 bullet points using • character.
- Professional tone. Data-driven. No fluff.
- ALWAYS reference listing age / velocity in your analysis.`;

    const ageLines = [
      floor_days_listed != null ? `Floor listing age: ${floor_days_listed} days` : null,
      second_days_listed != null ? `2nd listing age: ${second_days_listed} days` : null,
      third_days_listed != null ? `3rd listing age: ${third_days_listed} days` : null,
    ].filter(Boolean).join("\n");

    const userPrompt = `Vehicle: ${vehicle}
Floor (cheapest): $${floor?.toLocaleString()}
Second: $${second?.toLocaleString()}
Third: $${third?.toLocaleString()}
Spread: ${spread_pct}%
Listing count: ${count}
Outlier detected: ${outlier_flag ? "Yes" : "No"}
${ageLines}

Provide:
• Market velocity (fast-moving / steady / stale) based on listing ages
• Market strength (tight / moderate / weak)
• Risk level (low / medium / high)
• Likely negotiation window (%) — factor in listing age
• One short buying insight (max 15 words)`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 250,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "Insight generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const insight = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(
      JSON.stringify({ insight }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ooglebot-gemini-insight error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
