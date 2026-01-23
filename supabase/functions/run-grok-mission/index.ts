import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Mission {
  mission_name: string;
  make: string;
  model: string;
  variant_allow?: string[];
  year_min?: number;
  year_max?: number;
  km_max?: number;
  price_max?: number | null;
  location?: string;
  seller_type?: string[];
  exclude_sources?: string[];
  allowed_domains?: string[];
  notes?: string;
}

interface GrokCandidate {
  listing_url: string;
  dealer_name: string | null;
  location: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  km: number | null;
  price: number | null;
  vin: string | null;
  stock_number: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence_snippet: string;
}

interface GrokResult {
  mission_name: string;
  searched_at: string;
  items: GrokCandidate[];
}

function buildPrompt(m: Mission): string {
  return `
You are a sourcing analyst. Find *specific, actionable* listings that match the mission.
Return ONLY valid JSON matching the schema. No prose.

Mission:
- Make: ${m.make}
- Model: ${m.model}
- Variant allowed: ${(m.variant_allow || []).join(", ") || "ANY"}
- Year: ${m.year_min || "ANY"} to ${m.year_max || "ANY"}
- Max KM: ${m.km_max || "ANY"}
- Max Price: ${m.price_max ?? "ANY"}
- Location: ${m.location || "Australia"}
- Seller type: ${(m.seller_type || []).join(", ") || "ANY"}
- Exclude: ${(m.exclude_sources || []).join(", ") || "NONE"}
- Notes: ${m.notes || ""}

Rules:
- Only include listings with a working URL.
- Prefer VIN or stock number if available; otherwise leave null.
- If you cannot find matches, return an empty list.
- Provide evidence: short extracted text snippet from the listing page for each item.

JSON schema:
{
  "mission_name": string,
  "searched_at": string (ISO),
  "items": [
    {
      "listing_url": string,
      "dealer_name": string|null,
      "location": string|null,
      "year": number|null,
      "make": string|null,
      "model": string|null,
      "variant": string|null,
      "km": number|null,
      "price": number|null,
      "vin": string|null,
      "stock_number": string|null,
      "confidence": "HIGH"|"MEDIUM"|"LOW",
      "evidence_snippet": string
    }
  ]
}
`.trim();
}

async function callXai(prompt: string, allowed_domains?: string[]): Promise<string> {
  const XAI_API_KEY = Deno.env.get("XAI_API_KEY");
  if (!XAI_API_KEY) throw new Error("XAI_API_KEY missing");

  console.log("[run-grok-mission] Calling xAI Responses API with web_search...");

  // Use Responses API with web search tools
  const body: Record<string, unknown> = {
    model: "grok-3-fast",
    input: prompt,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
  };

  // Apply search filters (allowed_domains etc.)
  if (allowed_domains && allowed_domains.length) {
    body.search_parameters = {
      sources: [{ type: "web", allowed_domains }],
    };
  }

  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[run-grok-mission] xAI error:", res.status, errorText);
    
    // Fallback to chat completions API if Responses API fails
    if (res.status === 404 || res.status === 400) {
      console.log("[run-grok-mission] Falling back to chat completions API...");
      return await callXaiChatCompletions(prompt);
    }
    
    throw new Error(`xAI error ${res.status}: ${errorText}`);
  }

  const json = await res.json();
  console.log("[run-grok-mission] xAI response received");

  // Extract text output (Responses API can return in different shapes)
  const text =
    json.output_text ||
    json.output?.map((o: { content?: { text?: string }[] }) => 
      o.content?.map((c) => c.text).join("")
    ).join("") ||
    json?.choices?.[0]?.message?.content ||
    "";

  if (!text) throw new Error("No text returned from xAI");

  return text;
}

async function callXaiChatCompletions(prompt: string): Promise<string> {
  const XAI_API_KEY = Deno.env.get("XAI_API_KEY");
  if (!XAI_API_KEY) throw new Error("XAI_API_KEY missing");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-3-fast",
      messages: [
        { role: "system", content: "You are a car sourcing analyst. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`xAI chat completions error ${res.status}: ${errorText}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

function parseGrokResponse(raw: string): GrokResult {
  let cleaned = raw.trim();
  
  // Strip markdown code fences
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  return JSON.parse(cleaned) as GrokResult;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[run-grok-mission] Received request");

    const mission = (await req.json()) as Mission;
    
    if (!mission?.make || !mission?.model || !mission?.mission_name) {
      console.error("[run-grok-mission] Missing required fields");
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Missing required mission fields: mission_name, make, model" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[run-grok-mission] Mission:", mission.mission_name);

    const prompt = buildPrompt(mission);
    const raw = await callXai(prompt, mission.allowed_domains);

    let parsed: GrokResult;
    try {
      parsed = parseGrokResponse(raw);
    } catch (parseError) {
      console.error("[run-grok-mission] Failed to parse JSON:", parseError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Could not parse Grok response",
          rawResponse: raw,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    console.log("[run-grok-mission] Found", items.length, "candidates");

    // Upsert to pickles_detail_queue for review (source='grok_search')
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const now = new Date().toISOString();

    const rows = items.map((it) => ({
      source: "grok_search",
      source_listing_id: it.vin || it.stock_number || it.listing_url,
      detail_url: it.listing_url,
      search_url: mission.mission_name,
      page_no: null,
      crawl_status: "pending",
      first_seen_at: now,
      last_seen_at: now,
      year: it.year ?? null,
      make: it.make ?? null,
      model: it.model ?? null,
      variant_raw: it.variant ?? null,
      km: it.km ?? null,
      asking_price: it.price ?? null,
      location: it.location ?? null,
      state: null,
    }));

    let upsertedCount = 0;
    if (rows.length > 0) {
      const { error, data } = await supabase
        .from("pickles_detail_queue")
        .upsert(rows, { onConflict: "source,source_listing_id" })
        .select("id");

      if (error) {
        console.error("[run-grok-mission] Upsert error:", error);
        throw error;
      }
      upsertedCount = data?.length || 0;
    }

    console.log("[run-grok-mission] Upserted", upsertedCount, "rows");

    return new Response(
      JSON.stringify({ 
        success: true, 
        mission: mission.mission_name, 
        found: items.length,
        upserted: upsertedCount,
        candidates: items,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[run-grok-mission] Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
