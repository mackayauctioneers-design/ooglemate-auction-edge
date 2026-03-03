/**
 * valo-market-commentary — Lazy Gemini commentary on VALO market snapshot.
 * 
 * RULES:
 * - Gemini can ONLY interpret the numbers provided
 * - It must NEVER recalculate, override, or suggest alternative prices
 * - It must NEVER introduce new price points
 * - It must NEVER suggest alternative listings
 * - Output is plain text market analysis, 2-4 sentences max
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      vehicle, // e.g. "2022 Toyota HiLux SR5"
      floor,   // p25
      median,  // p50
      ceiling, // p75
      spread_pct,
      comp_count,
      trimmed,
      confidence,
      state_breakdown, // [{ state, median, count }]
      trade_in_offer,  // { low, mid, high }
    } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are a concise market analyst for an Australian car dealership tool called Carbitrage.

STRICT RULES:
- You may ONLY interpret the numbers provided. Do NOT recalculate anything.
- Do NOT suggest alternative listings or price points.
- Do NOT override or question any values.
- Do NOT use AI branding, emoji, or chatbot language.
- Keep it to 2-4 sentences. Professional tone. Data-driven.
- Reference state differences if provided.
- Comment on spread tightness/looseness and what it means for negotiation confidence.
- If confidence is LOW, note the limited data but do not apologise.`;

    const stateInfo = state_breakdown?.length > 0
      ? `\nState breakdown: ${state_breakdown.map((s: any) => `${s.state}: $${s.median?.toLocaleString()} (${s.count} listings)`).join(", ")}`
      : "";

    const userPrompt = `Vehicle: ${vehicle}
Market floor (P25): $${floor?.toLocaleString()}
Market median (P50): $${median?.toLocaleString()}
Market ceiling (P75): $${ceiling?.toLocaleString()}
Spread: ${spread_pct}%
Comparable listings: ${comp_count}
Outliers trimmed: ${trimmed ? "Yes" : "No"}
Confidence: ${confidence}
Trade-in offer range: $${trade_in_offer?.low?.toLocaleString()} – $${trade_in_offer?.high?.toLocaleString()}${stateInfo}

Provide a brief market commentary.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "Commentary generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const commentary = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(
      JSON.stringify({ commentary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("valo-market-commentary error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
