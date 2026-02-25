import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTENT_SCHEMA = `You are a vehicle search query parser. Return ONLY a JSON object, nothing else.

Schema:
{"make":string|null,"model":string|null,"badge":string|null,"year_min":number|null,"year_max":number|null,"max_km":number|null,"price_max":number|null}

Rules:
- Uppercase make and model
- badge is the variant/trim/series e.g. "SX", "GXL", "Workmate", "Wildtrak", "SR5", "Hi-Rider". Uppercase it. Use null if not specified.
- A single year like "2022" means year_min=2022, year_max=null (2022 or newer)
- Only set year_max if the user specifies an upper year bound like "2020-2022" or "up to 2022"
- "under 50k" or "under 50000" means price_max=50000
- "low km" means max_km=60000
- Use null for anything not specified
- Output raw JSON only. No markdown. No backticks. No explanation.`;

interface ParsedIntent {
  make: string | null;
  model: string | null;
  badge: string | null;
  year_min: number | null;
  year_max: number | null;
  max_km: number | null;
  price_max: number | null;
}

function validateIntent(raw: unknown): ParsedIntent {
  if (!raw || typeof raw !== "object") throw new Error("Invalid structure: not an object");
  const o = raw as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && v >= min && v <= max ? v : null;

  return {
    make: str(o.make),
    model: str(o.model),
    badge: str(o.badge),
    year_min: num(o.year_min, 1990, 2030),
    year_max: num(o.year_max, 1990, 2030),
    max_km: num(o.max_km, 1, 999999),
    price_max: num(o.price_max, 1, 9999999),
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
