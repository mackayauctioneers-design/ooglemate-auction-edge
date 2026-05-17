/**
 * Strict Intent Parser — converts free-text dealer queries into a typed
 * `StrictIntent` with per-field confidence and ambiguity tracking.
 *
 * Pipeline:
 *   1. Regex-first deterministic extraction (years, km, $, state, body)
 *   2. Token classification against known taxonomy hints (model/series/body)
 *   3. Optional Gemini fallback (low temp, schema-constrained) when regex
 *      confidence < THRESHOLD. Gemini is forbidden from inventing model
 *      names — it must return null + add to ambiguous_tokens when unsure.
 *
 * AI is never the source of truth. Final inclusion is decided by gates.
 */

import { extractSeries } from "../taxonomy/derivePlatform.ts";

export type FieldConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface StrictIntent {
  raw_query: string;
  make: string | null;
  make_confidence: FieldConfidence;
  model: string | null;
  model_confidence: FieldConfidence;
  series: string | null;          // e.g. LC300, F30, PRADO_250
  body_type: string | null;       // WAGON, SEDAN, UTE, SUV, HATCH, COUPE, DUAL CAB, etc
  variant: string | null;         // e.g. SR5, GXL, Sahara ZX
  year_min: number | null;
  year_max: number | null;
  max_km: number | null;
  price_max: number | null;
  state: string | null;
  transmission: "MANUAL" | "AUTOMATIC" | null;
  fuel: string | null;
  ambiguous_tokens: string[];
  overall_confidence: number;     // 0..1
  used_ai: boolean;
}

const MAKES = [
  "TOYOTA","FORD","MAZDA","MITSUBISHI","ISUZU","NISSAN","HYUNDAI","KIA",
  "VOLKSWAGEN","VW","SUBARU","HONDA","BMW","MERCEDES","MERCEDES-BENZ","AUDI",
  "LEXUS","SUZUKI","TESLA","LDV","RAM","CHEVROLET","JEEP","LAND ROVER",
  "LANDROVER","PORSCHE","VOLVO","PEUGEOT","RENAULT","SKODA","MG","HAVAL","GWM",
];

const MAKE_ALIASES: Record<string, string> = {
  VW: "VOLKSWAGEN", "MERCEDES-BENZ": "MERCEDES", LANDROVER: "LAND ROVER",
};

// Strong model hints — token -> canonical model (used only for HIGH confidence).
// Anything not in this map falls to MEDIUM or routes to ambiguous_tokens.
const MODEL_HINTS: Array<{ make?: string; tokens: string[]; model: string; body?: string; series?: string }> = [
  { make: "SUBARU", tokens: ["WRX","STI"], model: "WRX" },
  { make: "SUBARU", tokens: ["SPORTSWAGON","SPORT WAGON"], model: "WRX", body: "WAGON" },
  { make: "SUBARU", tokens: ["FORESTER"], model: "FORESTER", body: "SUV" },
  { make: "SUBARU", tokens: ["OUTBACK"], model: "OUTBACK", body: "WAGON" },
  { make: "SUBARU", tokens: ["LEVORG"], model: "LEVORG", body: "WAGON" },
  { make: "SUBARU", tokens: ["CROSSTREK","XV"], model: "CROSSTREK", body: "SUV" },
  { make: "TOYOTA", tokens: ["HILUX"], model: "HILUX", body: "UTE" },
  { make: "TOYOTA", tokens: ["LANDCRUISER","LAND CRUISER","LC300","LC200","LC70","LC79","LC76","LC78"], model: "LANDCRUISER" },
  { make: "TOYOTA", tokens: ["PRADO"], model: "PRADO", body: "SUV" },
  { make: "TOYOTA", tokens: ["FORTUNER"], model: "FORTUNER", body: "SUV" },
  { make: "FORD",   tokens: ["RANGER"], model: "RANGER", body: "UTE" },
  { make: "FORD",   tokens: ["EVEREST"], model: "EVEREST", body: "SUV" },
  { make: "ISUZU",  tokens: ["D-MAX","DMAX"], model: "D-MAX", body: "UTE" },
  { make: "ISUZU",  tokens: ["MU-X","MUX"], model: "MU-X", body: "SUV" },
  { make: "NISSAN", tokens: ["PATROL"], model: "PATROL", body: "SUV" },
  { make: "NISSAN", tokens: ["NAVARA"], model: "NAVARA", body: "UTE" },
  { make: "MITSUBISHI", tokens: ["TRITON"], model: "TRITON", body: "UTE" },
  { make: "MAZDA",  tokens: ["BT-50","BT50"], model: "BT-50", body: "UTE" },
  { make: "VOLKSWAGEN", tokens: ["AMAROK"], model: "AMAROK", body: "UTE" },
  { make: "VOLKSWAGEN", tokens: ["TIGUAN"], model: "TIGUAN", body: "SUV" },
  { make: "VOLKSWAGEN", tokens: ["TOUAREG"], model: "TOUAREG", body: "SUV" },
];

const BODY_TOKENS: Array<[RegExp, string]> = [
  [/\bdual\s*cab\b/i, "DUAL CAB"],
  [/\bsingle\s*cab\b/i, "SINGLE CAB"],
  [/\bcab\s*chassis\b/i, "CAB CHASSIS"],
  [/\bsportswagon|sport\s*wagon\b/i, "WAGON"],
  [/\bwagon\b/i, "WAGON"],
  [/\bsedan\b/i, "SEDAN"],
  [/\bsuv\b/i, "SUV"],
  [/\butility|\bute\b/i, "UTE"],
  [/\bhatch(?:back)?\b/i, "HATCH"],
  [/\bcoupe\b/i, "COUPE"],
  [/\bconvertible|cabriolet\b/i, "CONVERTIBLE"],
];

const AMBIGUOUS_NICKNAMES = [
  // sports cars in general — never resolve to a specific model
  "SPORTS","SPORT","SPORTY",
  // generic "ute" w/o make
  "UTE","UTILITY",
];

function normToken(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9-]/g, "").trim();
}

function detectYear(q: string): { min: number | null; max: number | null } {
  // 2025, '25, 25 model — strict
  const four = q.match(/\b(20[1-3]\d)\b/);
  const range = q.match(/\b(20[1-3]\d)\s*[-–to]+\s*(20[1-3]\d)\b/i);
  if (range) return { min: +range[1], max: +range[2] };
  const twoDigit = q.match(/(?:^|\s)['']?(\d{2})\s*model\b/i);
  if (twoDigit) {
    const y = +twoDigit[1];
    return { min: 2000 + y, max: null };
  }
  if (four) return { min: +four[1], max: null };
  return { min: null, max: null };
}

function detectKm(q: string): number | null {
  const m = q.match(/(?:under|below|<|less than|max)\s*([\d,]+)\s*(?:k\s*kms?|km|kms|klms?|k\s*km)\b/i);
  if (m) return parseInt(m[1].replace(/,/g, ""), 10);
  const k = q.match(/(?:under|below|<|less than|max)\s*(\d{2,3})k\b/i);
  if (k) return +k[1] * 1000;
  return null;
}

function detectPrice(q: string): number | null {
  const m = q.match(/(?:under|below|<|less than|budget|max)\s*\$\s*([\d,]+)\s*k?\b/i);
  if (m) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (/k\b/i.test(m[0]) && v < 1000) v *= 1000;
    return v;
  }
  return null;
}

function detectState(q: string): string | null {
  const m = q.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function detectBody(q: string): string | null {
  for (const [re, label] of BODY_TOKENS) if (re.test(q)) return label;
  return null;
}

function detectMake(q: string): { make: string | null; conf: FieldConfidence } {
  const u = q.toUpperCase();
  for (const m of MAKES) {
    if (new RegExp(`\\b${m.replace(/[-\s]/g, "[-\\s]?")}\\b`).test(u)) {
      return { make: MAKE_ALIASES[m] ?? m, conf: "HIGH" };
    }
  }
  return { make: null, conf: "NONE" };
}

function detectModelFromHints(q: string, make: string | null):
  { model: string | null; body: string | null; conf: FieldConfidence; matchedToken: string | null }
{
  const u = q.toUpperCase();
  let best: { hint: typeof MODEL_HINTS[number]; matched: string } | null = null;
  for (const hint of MODEL_HINTS) {
    if (hint.make && make && hint.make !== make) continue;
    for (const tok of hint.tokens) {
      const re = new RegExp(`\\b${tok.replace(/[-\s]/g, "[-\\s]?")}\\b`);
      if (re.test(u)) { best = { hint, matched: tok }; break; }
    }
    if (best) break;
  }
  if (!best) return { model: null, body: null, conf: "NONE", matchedToken: null };
  return {
    model: best.hint.model,
    body: best.hint.body ?? null,
    conf: "HIGH",
    matchedToken: best.matched,
  };
}

function findAmbiguousTokens(q: string, consumed: string[]): string[] {
  const out: string[] = [];
  const u = q.toUpperCase();
  for (const tok of AMBIGUOUS_NICKNAMES) {
    if (new RegExp(`\\b${tok}\\b`).test(u) && !consumed.some(c => c.includes(tok))) {
      out.push(tok);
    }
  }
  return out;
}

export function parseStrictIntentRegex(raw: string): StrictIntent {
  const q = raw.trim();
  const { make, conf: makeConf } = detectMake(q);
  const { model, body: hintBody, conf: modelConf, matchedToken } = detectModelFromHints(q, make);
  const body = detectBody(q) ?? hintBody;
  const series = make && model ? extractSeries(make, `${model} ${q}`) : null;
  const yr = detectYear(q);
  const transM = /\bmanual\b/i.test(q) ? "MANUAL" : (/\bauto(?:matic)?\b/i.test(q) ? "AUTOMATIC" : null);
  const consumed = [make ?? "", model ?? "", matchedToken ?? ""].map(s => s.toUpperCase());
  const ambiguous = findAmbiguousTokens(q, consumed);

  // overall confidence
  let conf = 0;
  if (makeConf === "HIGH") conf += 0.4;
  if (modelConf === "HIGH") conf += 0.4;
  if (yr.min) conf += 0.1;
  if (body) conf += 0.05;
  if (series) conf += 0.05;
  if (ambiguous.length > 0) conf -= 0.15;
  conf = Math.max(0, Math.min(1, conf));

  return {
    raw_query: raw,
    make, make_confidence: makeConf,
    model, model_confidence: modelConf,
    series,
    body_type: body,
    variant: null, // resolved later via taxonomy
    year_min: yr.min, year_max: yr.max,
    max_km: detectKm(q),
    price_max: detectPrice(q),
    state: detectState(q),
    transmission: transM as StrictIntent["transmission"],
    fuel: null,
    ambiguous_tokens: ambiguous,
    overall_confidence: conf,
    used_ai: false,
  };
}

const GEMINI_SYSTEM = `You parse vehicle search queries into strict structured data.

ABSOLUTE RULES:
- NEVER invent model or variant names. If unsure, return null.
- NEVER guess that "sports" means WRX / STI / Sportswagon — return null and add it to ambiguous_tokens.
- NEVER convert a nickname to a model unless the mapping is unambiguous within the make.
- If the query contains ambiguous tokens you could not resolve, list them in ambiguous_tokens.

Return ONLY JSON of shape:
{"make":string|null,"model":string|null,"series":string|null,"body_type":string|null,"variant":string|null,"year_min":number|null,"year_max":number|null,"ambiguous_tokens":string[]}`;

export async function parseStrictIntentLLM(raw: string, apiKey: string): Promise<Partial<StrictIntent> | null> {
  if (!apiKey) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
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
          { role: "system", content: GEMINI_SYSTEM },
          { role: "user", content: raw },
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
      make: j.make ? String(j.make).toUpperCase() : null,
      model: j.model ? String(j.model).toUpperCase() : null,
      series: j.series ? String(j.series).toUpperCase() : null,
      body_type: j.body_type ? String(j.body_type).toUpperCase() : null,
      variant: j.variant ? String(j.variant).toUpperCase() : null,
      year_min: typeof j.year_min === "number" ? j.year_min : null,
      year_max: typeof j.year_max === "number" ? j.year_max : null,
      ambiguous_tokens: Array.isArray(j.ambiguous_tokens) ? j.ambiguous_tokens.map(String) : [],
    };
  } catch (e) {
    console.warn("strict intent LLM failed:", e);
    return null;
  }
}

/** Confidence threshold below which we ask Gemini for help. */
export const AI_FALLBACK_THRESHOLD = 0.7;

export async function parseStrictIntent(raw: string, apiKey: string): Promise<StrictIntent> {
  const base = parseStrictIntentRegex(raw);
  if (base.overall_confidence >= AI_FALLBACK_THRESHOLD) return base;

  const ai = await parseStrictIntentLLM(raw, apiKey);
  if (!ai) return base;

  // Merge: AI fills gaps, never overrides HIGH-confidence regex hits
  const merged: StrictIntent = { ...base, used_ai: true };
  if (!merged.make && ai.make) merged.make = ai.make;
  if (!merged.model && ai.model) { merged.model = ai.model; merged.model_confidence = "MEDIUM"; }
  if (!merged.series && ai.series) merged.series = ai.series;
  if (!merged.body_type && ai.body_type) merged.body_type = ai.body_type;
  if (!merged.variant && ai.variant) merged.variant = ai.variant;
  if (!merged.year_min && ai.year_min) merged.year_min = ai.year_min;
  if (!merged.year_max && ai.year_max) merged.year_max = ai.year_max;
  if (ai.ambiguous_tokens?.length) {
    merged.ambiguous_tokens = Array.from(new Set([...merged.ambiguous_tokens, ...ai.ambiguous_tokens]));
  }

  // Recompute confidence
  let conf = 0;
  if (merged.make) conf += 0.35;
  if (merged.model) conf += merged.model_confidence === "HIGH" ? 0.35 : 0.2;
  if (merged.year_min) conf += 0.1;
  if (merged.body_type) conf += 0.05;
  if (merged.series) conf += 0.05;
  if (merged.ambiguous_tokens.length) conf -= 0.15;
  merged.overall_confidence = Math.max(0, Math.min(1, conf));

  return merged;
}
