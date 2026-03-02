import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Well-known model → make mapping for fallback resolution
const MODEL_TO_MAKE: Record<string, string> = {
  "HILUX": "TOYOTA", "LANDCRUISER": "TOYOTA", "PRADO": "TOYOTA", "RAV4": "TOYOTA",
  "COROLLA": "TOYOTA", "CAMRY": "TOYOTA", "KLUGER": "TOYOTA", "FORTUNER": "TOYOTA",
  "HIACE": "TOYOTA", "YARIS": "TOYOTA", "86": "TOYOTA", "GR86": "TOYOTA", "SUPRA": "TOYOTA",
  "RANGER": "FORD", "EVEREST": "FORD", "MUSTANG": "FORD", "BRONCO": "FORD",
  "FOCUS": "FORD", "ESCAPE": "FORD", "ENDURA": "FORD", "PUMA": "FORD",
  "TRITON": "MITSUBISHI", "PAJERO": "MITSUBISHI", "OUTLANDER": "MITSUBISHI",
  "ASX": "MITSUBISHI", "ECLIPSE CROSS": "MITSUBISHI",
  "NAVARA": "NISSAN", "PATROL": "NISSAN", "X-TRAIL": "NISSAN", "QASHQAI": "NISSAN",
  "PATHFINDER": "NISSAN", "JUKE": "NISSAN",
  "D-MAX": "ISUZU", "DMAX": "ISUZU", "MU-X": "ISUZU", "MUX": "ISUZU",
  "BT-50": "MAZDA", "BT50": "MAZDA", "CX-5": "MAZDA", "CX5": "MAZDA",
  "CX-9": "MAZDA", "CX9": "MAZDA", "CX-3": "MAZDA", "CX-30": "MAZDA",
  "CX-60": "MAZDA", "CX-80": "MAZDA", "MAZDA3": "MAZDA", "MAZDA2": "MAZDA",
  "COLORADO": "HOLDEN", "TRAILBLAZER": "HOLDEN",
  "AMAROK": "VOLKSWAGEN", "TIGUAN": "VOLKSWAGEN", "GOLF": "VOLKSWAGEN",
  "TUCSON": "HYUNDAI", "SANTA FE": "HYUNDAI", "KONA": "HYUNDAI", "IONIQ": "HYUNDAI",
  "I30": "HYUNDAI", "PALISADE": "HYUNDAI", "VENUE": "HYUNDAI", "STARIA": "HYUNDAI",
  "SPORTAGE": "KIA", "SORENTO": "KIA", "CARNIVAL": "KIA", "CERATO": "KIA",
  "EV6": "KIA", "SELTOS": "KIA", "STONIC": "KIA",
  "FORESTER": "SUBARU", "OUTBACK": "SUBARU", "XV": "SUBARU", "WRX": "SUBARU",
  "CROSSTREK": "SUBARU", "BRZ": "SUBARU", "IMPREZA": "SUBARU",
  "GRAND CHEROKEE": "JEEP", "WRANGLER": "JEEP", "GLADIATOR": "JEEP",
  "RAPTOR": "FORD", "WILDTRAK": "FORD",
};

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
  "exclude_terms": string[]
}

Rules:

MAKE/MODEL
- Uppercase make and model always.
- Always infer make from model: Hilux=TOYOTA, Ranger=FORD, D-MAX=ISUZU, Triton=MITSUBISHI, Navara=NISSAN, BT-50=MAZDA, Amarok=VOLKSWAGEN, Colorado=HOLDEN, LandCruiser=TOYOTA, Patrol=NISSAN, Prado=TOYOTA.
- badge is the variant/trim e.g. "GXL", "SR5", "Wildtrak", "GX". Uppercase. null if not specified.
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
Output: {"make":"TOYOTA","model":"LANDCRUISER 79","badge":"GXL","year_min":2024,"year_max":null,"max_km":40000,"price_max":null,"state":null,"body_type":"DUAL CAB","prefer_terms":["ARB","NORWELD"],"must_have_terms":[],"exclude_terms":[]}

Input: "Looking for a 2022 or newer Hilux SR5 in QLD, must have GVM upgrade, no automatics, under $65k"
Output: {"make":"TOYOTA","model":"HILUX","badge":"SR5","year_min":2022,"year_max":null,"max_km":null,"price_max":65000,"state":"QLD","body_type":null,"prefer_terms":[],"must_have_terms":["GVM_UPGRADE"],"exclude_terms":["AUTOMATIC"]}

Input: "Ranger Wildtrak 2021-2023 under 80k km, ideally with ARB or TJM bar"
Output: {"make":"FORD","model":"RANGER","badge":"WILDTRAK","year_min":2021,"year_max":2023,"max_km":80000,"price_max":null,"state":null,"body_type":null,"prefer_terms":["ARB","TJM"],"must_have_terms":[],"exclude_terms":[]}

Output raw JSON only. No markdown. No backticks. No explanation.`;

interface ParsedIntent {
  make: string | null;
  model: string | null;
  badge: string | null;
  year_min: number | null;
  year_max: number | null;
  max_km: number | null;
  price_max: number | null;
  state: string | null;
  body_type: string | null;
  prefer_terms: string[];
  must_have_terms: string[];
  exclude_terms: string[];
}

function validateIntent(raw: unknown): ParsedIntent {
  if (!raw || typeof raw !== "object") throw new Error("Invalid structure: not an object");
  const o = raw as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && v >= min && v <= max ? v : null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map(s => s.toUpperCase()) : [];

  return {
    make: str(o.make),
    model: str(o.model),
    badge: str(o.badge),
    year_min: num(o.year_min, 1990, 2030),
    year_max: num(o.year_max, 1990, 2030),
    max_km: num(o.max_km, 1, 999999),
    price_max: num(o.price_max, 1, 9999999),
    state: str(o.state),
    body_type: str(o.body_type),
    prefer_terms: strArr(o.prefer_terms),
    must_have_terms: strArr(o.must_have_terms),
    exclude_terms: strArr(o.exclude_terms),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";
    if (!apiKey) {
      return new Response(
        JSON.stringify({ status: "error", error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { message } = await req.json();
    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response(
        JSON.stringify({ status: "error", error: "message is required (string)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("ooglebot intent parse request:", message);

    // --- 1. Call Lovable AI as strict JSON intent parser ---
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let llmResponse: Response;
    try {
      llmResponse = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            temperature: 0,
            messages: [
              { role: "system", content: INTENT_SCHEMA },
              { role: "user", content: message.trim() },
            ],
          }),
          signal: controller.signal,
        }
      );
    } catch (fetchErr) {
      clearTimeout(timeout);
      const isTimeout = fetchErr instanceof DOMException && fetchErr.name === "AbortError";
      console.error("Lovable AI fetch error:", isTimeout ? "Timed out" : fetchErr);
      return new Response(
        JSON.stringify({ status: "error", error: isTimeout ? "Intent parser timed out" : String(fetchErr) }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    clearTimeout(timeout);

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error("Lovable AI error:", llmResponse.status, errText);
      if (llmResponse.status === 429) {
        return new Response(
          JSON.stringify({ status: "error", error: "Rate limit exceeded, please try again shortly" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (llmResponse.status === 402) {
        return new Response(
          JSON.stringify({ status: "error", error: "AI credits exhausted, please add funds" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ status: "error", error: `Intent parser error: ${llmResponse.status}` }),
        { status: llmResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 2. Hard parse the response ---
    const llmData = await llmResponse.json();
    const content = llmData.choices?.[0]?.message?.content || "";
    console.log("Lovable AI raw response:", content);

    // Extract JSON from response - model may wrap in prose + markdown fences
    let cleaned = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonMatch) {
      cleaned = jsonMatch[1].trim();
    } else {
      const braceMatch = content.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        cleaned = braceMatch[0].trim();
      }
    }

    let parsed: ParsedIntent;
    try {
      const raw = JSON.parse(cleaned);
      parsed = validateIntent(raw);
    } catch (parseErr) {
      console.error("Intent parse failed:", parseErr, "Raw:", content);
      try {
        await sb.from("cron_audit_log").insert({
          cron_name: "ooglebot-intent",
          run_date: new Date().toISOString().slice(0, 10),
          success: false,
          error: `Parse failed: ${String(parseErr)}. Raw: ${content.substring(0, 200)}`,
        });
      } catch (_) { /* swallow */ }
      return new Response(
        JSON.stringify({ status: "error", error: "Intent parsing failed: invalid JSON returned" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fallback: resolve make from model if LLM missed it
    if (!parsed.make && parsed.model) {
      const resolved = MODEL_TO_MAKE[parsed.model];
      if (resolved) {
        parsed.make = resolved;
        console.log(`Make resolved from model fallback: ${parsed.model} → ${resolved}`);
      }
    }

    if (!parsed.make) {
      return new Response(
        JSON.stringify({ status: "error", error: "Could not extract vehicle make from query", filters: parsed }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 3. Call ooglebot-search internally ---
    const searchBody = {
      make: parsed.make,
      model: parsed.model || "",
      badge: parsed.badge,
      year_min: parsed.year_min,
      year_max: parsed.year_max,
      max_km: parsed.max_km,
      price_max: parsed.price_max,
      state: parsed.state,
      body_type: parsed.body_type,
      prefer_terms: parsed.prefer_terms,
      must_have_terms: parsed.must_have_terms,
      exclude_terms: parsed.exclude_terms,
      limit: 20,
    };

    const searchUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ooglebot-search`;
    const searchResponse = await fetch(searchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(searchBody),
    });

    const searchData = await searchResponse.json();

    // --- 4. Log intent parse ---
    try {
      await sb.from("cron_audit_log").insert({
        cron_name: "ooglebot-intent",
        run_date: new Date().toISOString().slice(0, 10),
        success: true,
        result: {
          raw_query: message.trim(),
          parsed_filters: parsed,
          results_returned: searchData.count || 0,
        },
      });
    } catch (_) { /* swallow */ }

    // --- 5. Return structured results ---
    return new Response(
      JSON.stringify({
        status: "ok",
        filters: parsed,
        count: searchData.count || 0,
        results: searchData.results || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ooglebot error:", error);
    return new Response(
      JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
