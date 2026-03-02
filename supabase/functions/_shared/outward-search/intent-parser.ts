/**
 * Intent Parser — extracts ParsedIntent from free-text instruction.
 * Uses LLM with regex fallback.
 */

import type { ParsedIntent } from "./types.ts";

const INTENT_SCHEMA = `You are a vehicle search query parser for an Australian used car platform. Return ONLY a JSON object, nothing else.

Schema:
{"make":string|null,"model":string|null,"badge":string|null,"year_min":number|null,"year_max":number|null,"max_km":number|null,"price_max":number|null,"state":string|null}

Rules:
- Uppercase make and model
- state is the Australian state abbreviation if mentioned (NSW, VIC, QLD, WA, SA, TAS, ACT, NT). null if not specified.
- Always infer the make from the model name: Hilux=TOYOTA, Ranger=FORD, D-MAX=ISUZU, Triton=MITSUBISHI, Navara=NISSAN, BT-50=MAZDA, Amarok=VOLKSWAGEN, Colorado=HOLDEN, Prado=TOYOTA, LandCruiser=TOYOTA, Patrol=NISSAN, Pajero=MITSUBISHI, Everest=FORD, Wildtrak=FORD, Raptor=FORD, MU-X=ISUZU, Fortuner=TOYOTA, Kluger=TOYOTA, RAV4=TOYOTA, CX-5=MAZDA, Sportage=KIA, Tucson=HYUNDAI, Santa Fe=HYUNDAI, Forester=SUBARU, Outback=SUBARU, i30=HYUNDAI, i20=HYUNDAI, i40=HYUNDAI
- badge is the variant/trim/series e.g. "SR5", "GXL", "Workmate", "Wildtrak", "SX", "Hi-Rider", "N Line Premium". Uppercase it. null if not specified.
- A single year like "2024" means year_min=2024, year_max=null (2024 or newer)
- Only set year_max if an upper bound is explicitly stated
- CRITICAL: "under Nk km" or "under N,000 km" or "low km" refers to KILOMETRES (max_km), NOT price. Only set price_max when the user mentions "$", "dollars", "budget", "price", or "under $N".
- Output raw JSON only. No markdown. No backticks. No explanation.`;

export function emptyIntent(): ParsedIntent {
  return { make: null, model: null, badge: null, year_min: null, year_max: null, max_km: null, price_max: null, state: null };
}

export async function parseIntentLLM(instruction: string, apiKey: string): Promise<ParsedIntent> {
  const intent = emptyIntent();
  if (!apiKey) return intent;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        temperature: 0,
        messages: [
          { role: "system", content: INTENT_SCHEMA },
          { role: "user", content: instruction },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        make: parsed.make || null,
        model: parsed.model || null,
        badge: parsed.badge || null,
        year_min: typeof parsed.year_min === "number" ? parsed.year_min : null,
        year_max: typeof parsed.year_max === "number" ? parsed.year_max : null,
        max_km: typeof parsed.max_km === "number" ? parsed.max_km : null,
        price_max: typeof parsed.price_max === "number" ? parsed.price_max : null,
        state: typeof parsed.state === "string" ? parsed.state.toUpperCase() : null,
      };
    }
  } catch (err) {
    console.warn("LLM intent parse failed:", err);
  }
  return intent;
}

export function parseIntentRegex(instruction: string): ParsedIntent {
  const intent = emptyIntent();
  const q = instruction;

  const kmMatch = q.match(/(?:under|below|<|less than)\s*([\d,]+)\s*(?:klms|klm|kms|km)/i);
  if (kmMatch) intent.max_km = parseInt(kmMatch[1].replace(/,/g, ""), 10);

  const priceMatch = q.match(/(?:\$|under\s+\$|below\s+\$|budget|price)\s*([\d,]+)\s*k?\b/i);
  if (priceMatch) {
    let val = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (q.toLowerCase().includes("k") && val < 1000) val *= 1000;
    intent.price_max = val;
  }

  const yearMatch = q.match(/\b(20[1-3]\d)\b/);
  if (yearMatch) intent.year_min = parseInt(yearMatch[1], 10);

  // State extraction (Australian states/territories)
  const stateMatch = q.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  if (stateMatch) intent.state = stateMatch[1].toUpperCase();

  const words = q
    .replace(/(?:under|below|budget|max|less than)\s*\$?\s*[\d,]+\s*k?\b/gi, "")
    .replace(/(?:under|below|<|less than)\s*[\d,]+\s*km/gi, "")
    .replace(/\b20[1-3]\d\b/g, "")
    .replace(/\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/gi, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  intent.make = words[0]?.toUpperCase() || null;
  intent.model = words.slice(1).join(" ").toUpperCase() || null;

  return intent;
}
