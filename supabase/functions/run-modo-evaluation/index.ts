import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateModoResponse } from "../_shared/valo/modoTypes.ts";
import type { ModoInput } from "../_shared/valo/modoTypes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODO_SYSTEM_PROMPT = `You are MODO — a structured vehicle condition assessor.

You do NOT:
- Estimate market value.
- Compare listings.
- Infer pricing.
- Override dealer pricing logic.
- Guess missing details.

Your task:
1. Assess visible condition from photos.
2. Confirm clearly visible accessories only.
3. Identify cosmetic damage.
4. Identify structural or risk signals.
5. Recommend a recon buffer in AUD.
6. Return STRICT JSON only.

Rules:
- Only confirm accessories clearly visible in images.
- If unsure, return null for that field or omit the accessory.
- Do not invent details.
- Do not output commentary outside JSON.
- Keep notes concise and factual.
- recommended_recon_buffer must be between 0 and 15000.

Return JSON in this exact format:

{
  "condition_rating": <1-5>,
  "visible_accessories": ["BULLBAR", "TOWBAR"],
  "damage_flags": ["REAR_BAR_SCUFF"],
  "risk_flags": [],
  "recommended_recon_buffer": <number>,
  "notes": "<concise factual note>"
}

Condition scale:
5 = Excellent — near showroom
4 = Good — minor cosmetic wear
3 = Fair — visible wear, light repairs likely
2 = Poor — heavy cosmetic issues
1 = Severe damage

Recon buffer guide:
Excellent → 500–1000
Good → 1000–2500
Fair → 2500–4000
Poor → 4000–8000
Never exceed 15000.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: ModoInput = await req.json();

    // Validate input basics
    if (!input.vehicle_identity?.make || !input.photos?.length) {
      return new Response(
        JSON.stringify({ error: "Missing vehicle_identity or photos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (input.photos.length > 6) {
      return new Response(
        JSON.stringify({ error: "Maximum 6 photos allowed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build user message with photos as image_url content parts
    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `Vehicle: ${input.vehicle_identity.year} ${input.vehicle_identity.make} ${input.vehicle_identity.model} ${input.vehicle_identity.variant_family ?? ""}
KM: ${input.vehicle_identity.km ?? "unknown"}
Dealer stated condition: ${input.dealer_input.condition_stated ?? "not stated"}
Dealer notes: ${input.dealer_input.description_transcript}

Assess the vehicle condition from the attached photos and return STRICT JSON only.`,
      },
    ];

    // Attach photos as vision content
    for (const photoUrl of input.photos) {
      userContent.push({
        type: "image_url",
        image_url: { url: photoUrl },
      });
    }

    // Call vision model — use gemini-2.5-flash for cost efficiency with vision
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: MODO_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error(`MODO AI error: ${status}`, errText);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please top up." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      throw new Error(`AI gateway returned ${status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error("MODO: empty AI response");
    }

    // Extract JSON from response (handle markdown code fences)
    let jsonStr = rawContent.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("MODO: invalid JSON from AI:", rawContent);
      throw new Error("MODO: AI returned non-JSON content");
    }

    // Strict validation — fail fast, no auto-fix
    const validated = validateModoResponse(parsed);

    return new Response(JSON.stringify(validated), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("MODO error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
