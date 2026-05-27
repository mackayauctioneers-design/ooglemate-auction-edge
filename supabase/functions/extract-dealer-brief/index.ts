/**
 * extract-dealer-brief — Convert an uploaded file (PDF/DOCX/TXT/MD/image) into
 * a clean markdown brief for the dealer Master Profile.
 *
 * POST { file_name: string, mime_type: string, data_base64: string }
 * → { markdown: string }
 *
 * Uses Lovable AI Gateway (Gemini) for multimodal parsing. No external keys.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You convert dealer research documents into a structured markdown brief used by a vehicle-sourcing scoring engine.

Output ONLY clean markdown with these sections (omit any that don't apply):
# {Dealer Name}
## Overview
## Winners (what they sell well — make/model, price band, KM band, why)
## Avoid (what underperforms — and why)
## Niches / Sweet Spots
## Buying Rules (price ceilings, KM ceilings, condition rules)
## Notes

Preserve all specific numbers (margins, days-to-clear, $ amounts, KM). Do NOT invent data — only structure what's in the source.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file_name, mime_type, data_base64 } = await req.json();
    if (!data_base64 || !mime_type) {
      return json({ error: "data_base64 and mime_type are required" }, 400);
    }

    // Fast path: plain text / markdown — decode directly, skip AI.
    if (mime_type.startsWith("text/") || /\.(md|txt)$/i.test(file_name || "")) {
      const raw = atob(data_base64);
      return json({ markdown: raw, mode: "passthrough" });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    // Gemini supports PDFs and images via inlineData parts.
    const userPart: any = {
      type: "image_url",
      image_url: { url: `data:${mime_type};base64,${data_base64}` },
    };

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `Convert this file (${file_name || "document"}) into the structured brief.` },
              userPart,
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[extract-dealer-brief] AI gateway error:", resp.status, t);
      return json({ error: `AI gateway ${resp.status}`, detail: t.slice(0, 500) }, 500);
    }

    const data = await resp.json();
    const markdown = data?.choices?.[0]?.message?.content ?? "";
    if (!markdown) return json({ error: "Empty response from AI" }, 500);

    return json({ markdown, mode: "ai" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract-dealer-brief] error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
