/**
 * Gemini Extraction Helper — narrow, constrained AI extraction.
 *
 * ONLY used when raw listing text is messy and deterministic parsers have
 * left required fields null. Output is fed back into normalize-candidate;
 * gates still decide acceptance.
 *
 * AI is explicitly forbidden from:
 *  - inventing model or variant names
 *  - guessing generation / body when text does not support it
 *  - overriding fields that were already populated by deterministic parsing
 */

export interface ExtractRequest {
  rawText: string;          // listing title + description blob
  knownMake?: string | null;
  knownModel?: string | null;
}

export interface ExtractedFields {
  variant: string | null;
  body_type: string | null;
  year: number | null;
  km: number | null;
  series_hint: string | null;
  drivetrain: string | null;
  transmission: string | null;
  fuel: string | null;
  unresolved_tokens: string[];
  model_confidence: "HIGH" | "MEDIUM" | "LOW";
}

const SYSTEM = `You extract structured vehicle fields from messy listing text.

ABSOLUTE RULES:
- Only extract what is EXPLICITLY stated in the text.
- NEVER invent or guess variant/trim names.
- NEVER guess body type from the model name alone — only from explicit text.
- If unsure about a field, return null and add the relevant token to unresolved_tokens.
- model_confidence must be HIGH only when explicit make+model+variant are clearly stated.

Return ONLY JSON of shape:
{"variant":string|null,"body_type":string|null,"year":number|null,"km":number|null,"series_hint":string|null,"drivetrain":string|null,"transmission":string|null,"fuel":string|null,"unresolved_tokens":string[],"model_confidence":"HIGH"|"MEDIUM"|"LOW"}`;

export async function geminiExtractFields(
  req: ExtractRequest,
  apiKey: string,
): Promise<ExtractedFields | null> {
  if (!apiKey) return null;
  const userPrompt = `Make hint: ${req.knownMake ?? "(unknown)"}\nModel hint: ${req.knownModel ?? "(unknown)"}\n\nListing text:\n${req.rawText.slice(0, 4000)}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const txt = (data?.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
    const j = JSON.parse(txt);
    return {
      variant: j.variant ? String(j.variant).toUpperCase() : null,
      body_type: j.body_type ? String(j.body_type).toUpperCase() : null,
      year: typeof j.year === "number" ? j.year : null,
      km: typeof j.km === "number" ? j.km : null,
      series_hint: j.series_hint ? String(j.series_hint).toUpperCase() : null,
      drivetrain: j.drivetrain ? String(j.drivetrain).toUpperCase() : null,
      transmission: j.transmission ? String(j.transmission).toUpperCase() : null,
      fuel: j.fuel ? String(j.fuel).toUpperCase() : null,
      unresolved_tokens: Array.isArray(j.unresolved_tokens) ? j.unresolved_tokens.map(String) : [],
      model_confidence: ["HIGH","MEDIUM","LOW"].includes(j.model_confidence) ? j.model_confidence : "LOW",
    };
  } catch (e) {
    console.warn("geminiExtractFields failed:", e);
    return null;
  }
}
