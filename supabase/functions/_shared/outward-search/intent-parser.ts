/**
 * Intent Parser — extracts ParsedIntent from free-text instruction.
 * Uses LLM with regex fallback.
 */

import type { ParsedIntent } from "./types.ts";
import { FEATURE_ALIASES } from "./types.ts";

const INTENT_SCHEMA = `You are a vehicle search query parser. Return ONLY a JSON object, nothing else.

Schema:
{
  "make": string|null,
  "model": string|null,
  "badge": string|null,
  "year_min": number|null,
  "year_max": number|null,
  "max_km": number|null,
  "price_max": number|null,
  "state": string|null,
  "body_type": string|null,
  "prefer_terms": string[],
  "must_have_terms": string[],
  "exclude_terms": string[],
  "condition": string|null,
  "allowance_aud": number|null,
  "accessory_terms": string[],
  "body_keywords": string[]
}

Rules:

MAKE/MODEL
- Uppercase make and model always.
- Always infer make from model: Hilux=TOYOTA, Ranger=FORD, D-MAX=ISUZU, Triton=MITSUBISHI, Navara=NISSAN, BT-50=MAZDA, Amarok=VOLKSWAGEN, Colorado=HOLDEN, LandCruiser=TOYOTA, Patrol=NISSAN, Prado=TOYOTA.
- badge is the variant/trim e.g. "GXL", "SR5", "Wildtrak", "GX", "LS-U". Uppercase. null if not specified.
- If user says "GX or GXL" or "GX/GXL", set badge=null and add "GX" and "GXL" to prefer_terms.

YEAR/KM/PRICE
- A single year like "2022" means year_min=2022, year_max=null.
- "2020-2022" or "up to 2022" means year_min=2020, year_max=2022.
- "under 50k" or "under 50,000km" = max_km=50000. "under $50k" or "under $50,000" = price_max=50000.
- "low km" = max_km=60000.
- null for anything not specified.

STATE
- Recognise full names and abbreviations: "in WA", "Western Australia", "Queensland", "QLD" etc.
- Uppercase abbreviation: "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT".
- null if not specified.

BODY TYPE
- Extract body configuration if mentioned: "dual cab"="DUAL CAB", "single cab"="SINGLE CAB", "cab chassis"="CAB CHASSIS", "ute"="UTE", "wagon"="WAGON".
- Uppercase. null if not specified.

CONDITION
- Extract condition if explicitly stated: "poor", "fair", "good", "excellent". Lowercase.
- Do NOT infer condition. If not mentioned, return null.

ALLOWANCE
- Extract numeric allowance if stated: "allow 1000", "allow $1,000", "allow $500" → extract numeric value only.
- Do NOT infer allowance. If not mentioned, return null.

ACCESSORY TERMS
- Extract accessory keywords found in the text: bullbar, towbar, canopy, winch, snorkel, roof rack, side steps, nudge bar, tray, drawers, fridge slide.
- Uppercase each term. Return [] if none found.

BODY KEYWORDS
- Extract body configuration keywords found: "dual cab", "single cab", "cab chassis", "wagon", "ute".
- Uppercase each. Return [] if none found.

FEATURE TERMS — prefer_terms, must_have_terms, exclude_terms
- Use prefer_terms when user says: "preferably", "prefer", "ideally", "would like", "if possible".
- Use must_have_terms when user says: "must have", "must", "only", "required", "needs to have".
- Use exclude_terms when user says: "no", "without", "not", "exclude", "don't want".
- Normalise all terms to canonical uppercase form using this alias map:
    NORWELD: ["norweld", "norwell", "norweld tray", "norweld canopy", "norweld box"]
    ARB: ["arb", "arb 4x4", "arb bullbar", "arb bar", "arb barwork", "arb accessories"]
    TJM: ["tjm", "tjm suspension", "tjm bar", "tjm barwork"]
    GVM_UPGRADE: ["gvm", "gvm upgrade", "gvm upgraded", "4200kg", "4,200kg"]
    MANUAL: ["manual", "manual transmission", "6-speed manual"]
    AUTOMATIC: ["auto", "automatic", "auto transmission"]
    DIFF_LOCK: ["diff lock", "diff locks", "locking diff", "factory diff lock"]
- If a term doesn't match any alias, include it uppercase as-is (e.g. "SUSPENSION LIFT").
- prefer_terms, must_have_terms, exclude_terms are always arrays. Use [] if nothing specified.

EXAMPLES

Input: "Need a 2024 LandCruiser 79 GXL V8 dual cab under 40,000km, preferably ARB accessories or Norweld tray"
Output: {"make":"TOYOTA","model":"LANDCRUISER 79","badge":"GXL","year_min":2024,"year_max":null,"max_km":40000,"price_max":null,"state":null,"body_type":"DUAL CAB","prefer_terms":["ARB","NORWELD"],"must_have_terms":[],"exclude_terms":[],"condition":null,"allowance_aud":null,"accessory_terms":[],"body_keywords":["DUAL CAB"]}

Input: "2023 Isuzu D-Max LS-U 120,000km bullbar towbar good condition allow $1,000"
Output: {"make":"ISUZU","model":"D-MAX","badge":"LS-U","year_min":2023,"year_max":null,"max_km":120000,"price_max":null,"state":null,"body_type":null,"prefer_terms":[],"must_have_terms":[],"exclude_terms":[],"condition":"good","allowance_aud":1000,"accessory_terms":["BULLBAR","TOWBAR"],"body_keywords":[]}

Input: "Looking for a 2022 or newer Hilux SR5 in QLD, must have GVM upgrade, no automatics, under $65k"
Output: {"make":"TOYOTA","model":"HILUX","badge":"SR5","year_min":2022,"year_max":null,"max_km":null,"price_max":65000,"state":"QLD","body_type":null,"prefer_terms":[],"must_have_terms":["GVM_UPGRADE"],"exclude_terms":["AUTOMATIC"],"condition":null,"allowance_aud":null,"accessory_terms":[],"body_keywords":[]}

Output raw JSON only. No markdown. No backticks. No explanation.`;

export function emptyIntent(): ParsedIntent {
  return {
    make: null, model: null, badge: null,
    year_min: null, year_max: null, max_km: null, price_max: null,
    state: null, body_type: null,
    prefer_terms: [], must_have_terms: [], exclude_terms: [],
    condition: null, allowance_aud: null,
    accessory_terms: [], body_keywords: [],
    series: null,
  };
}

/** Normalise a raw term against the alias map, returning canonical key or uppercased raw */
function canonicaliseTerm(raw: string): string {
  const lower = raw.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(FEATURE_ALIASES)) {
    if (aliases.includes(lower)) return canonical;
  }
  return raw.toUpperCase().trim();
}

function parseTermsArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map(canonicaliseTerm);
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
        body_type: typeof parsed.body_type === "string" ? parsed.body_type.toUpperCase() : null,
        prefer_terms: parseTermsArray(parsed.prefer_terms),
        must_have_terms: parseTermsArray(parsed.must_have_terms),
        exclude_terms: parseTermsArray(parsed.exclude_terms),
        condition: ["poor", "fair", "good", "excellent"].includes(parsed.condition) ? parsed.condition : null,
        allowance_aud: typeof parsed.allowance_aud === "number" ? parsed.allowance_aud : null,
        accessory_terms: parseTermsArray(parsed.accessory_terms),
        body_keywords: parseTermsArray(parsed.body_keywords),
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

  const stateMatch = q.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  if (stateMatch) intent.state = stateMatch[1].toUpperCase();

  // Body type regex
  const bodyMatch = q.match(/\b(dual\s*cab|single\s*cab|cab\s*chassis|wagon|ute)\b/i);
  if (bodyMatch) intent.body_type = bodyMatch[1].toUpperCase().replace(/\s+/g, " ");

  // VALO: Allowance extraction
  const allowanceMatch = q.match(/allow\s*\$?\s*([\d,]+)/i);
  if (allowanceMatch) {
    intent.allowance_aud = parseInt(allowanceMatch[1].replace(/,/g, ""), 10);
  }

  // VALO: Condition extraction
  if (/\bexcellent\b/i.test(q)) intent.condition = "excellent";
  else if (/\bgood\b/i.test(q)) intent.condition = "good";
  else if (/\bfair\b/i.test(q)) intent.condition = "fair";
  else if (/\bpoor\b/i.test(q)) intent.condition = "poor";

  // VALO: Accessory extraction
  const accessoryKeywords = ["bullbar", "towbar", "canopy", "winch", "snorkel", "roof rack", "side steps", "nudge bar", "tray", "drawers", "fridge slide"];
  intent.accessory_terms = accessoryKeywords
    .filter(k => new RegExp(`\\b${k}\\b`, "i").test(q))
    .map(k => k.toUpperCase());

  // VALO: Body keywords
  const bodyKeywordsList = ["dual cab", "single cab", "cab chassis", "wagon"];
  intent.body_keywords = bodyKeywordsList
    .filter(k => new RegExp(`\\b${k}\\b`, "i").test(q))
    .map(k => k.toUpperCase());

  const words = q
    .replace(/(?:under|below|budget|max|less than)\s*\$?\s*[\d,]+\s*k?\b/gi, "")
    .replace(/(?:under|below|<|less than)\s*[\d,]+\s*km/gi, "")
    .replace(/\b20[1-3]\d\b/g, "")
    .replace(/\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/gi, "")
    .replace(/\b(?:dual\s*cab|single\s*cab|cab\s*chassis|wagon|ute)\b/gi, "")
    .replace(/allow\s*\$?\s*[\d,]+/gi, "")
    .replace(/\b(?:excellent|good|fair|poor)\s*(?:condition)?\b/gi, "")
    .replace(/\b(?:bullbar|towbar|canopy|winch|snorkel|roof rack|side steps|nudge bar|tray|drawers|fridge slide)\b/gi, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  intent.make = words[0]?.toUpperCase() || null;
  intent.model = words.slice(1).join(" ").toUpperCase() || null;

  return intent;
}
