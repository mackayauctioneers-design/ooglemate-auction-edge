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
  preferred_domains?: string[];  // Renamed: hints, not restrictions
  allowed_domains?: string[];    // Legacy alias
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
  const currentYear = new Date().getFullYear();
  return `
You are a ruthless Australian car arbitrage agent (Carbitrage). Your job is to identify undervalued used cars for profitable flip.

## MANDATORY SOURCE PRIORITY (TIERED AUCTIONS & WHOLESALE - CHECK THESE FIRST)

### TIER 1: PRIMARY AUCTIONS (Highest priority, best exit confidence)
Browse these FIRST for every hunt:
- https://www.manheim.com.au/ - Australia's largest auction; weekly used car auctions (passenger, government, SUV/4WD, commercial, prestige)
- https://www.pickles.com.au/ - National coverage, online auctions for used cars, trucks, government/ex-fleet
- https://www.carlins.com.au/ - Dealer-only auctions (VIC, NSW, QLD, WA), hundreds of cars per event
- https://iaai.com.au/ - Insurance Auto Auctions, salvage/wrecked, hail sales (14 locations)
- https://www.auto-auctions.com.au/ - Weekly simulcast/live wholesale lanes $100-$50k+

### TIER 2: SECONDARY AUCTIONS (Check after Tier 1)
- https://www.f3motorauctions.com.au/ - F3 Motor Auctions
- https://www.valleymotorauctions.com.au/ - Valley Motor Auctions
- https://slatteryauctions.com.au/ - Online auctions, cars & commercial

### TIER 3: DEALER-DIRECT / WHOLESALE PLATFORMS (B2B trading)
- https://autograb.com.au/dealer-direct - Wholesale tender from dealers/fleets/wholesalers
- https://www.directwholesaleonly.com.au/ - Dealer-only platform, Australia-wide
- https://www.autoflip.com.au/dealers - Licensed dealers, includes Japanese imports
- https://www.tooti.com.au/ - Dealer marketplace
- https://www.motorplatform.com.au/platform/motor-market - Motor market platform

### TIER 4: CLASSIFIEDS (After auctions/wholesale, stable links)
- Gumtree.com.au, Facebook Marketplace, Carma.com.au
- Drive.com.au classifieds, private seller ads

### TIER 5: CARSALES-DISCOVERY MODE ONLY
- Use carsales.com.au for DATA EXTRACTION only—NEVER as primary link
- See CARSALES-SAFE DISCOVERY MODE rules below

---

## CORE CARBITRAGE HUNT RULES (Australia-wide, always)

### CARSALES-SAFE DISCOVERY MODE (CRITICAL)
When sourcing from carsales.com.au:
- **NEVER** use direct carsales listing URL as the primary \`link\`
- Use carsales ONLY for data extraction: price, km, year, dealer name, dealer license, suburb/postcode
- For EVERY carsales hit:
  1. Extract dealer name + license + suburb from the listing
  2. Derive stable \`dealer_url\`: Search "dealer name + license number + website Australia" → use top dealer site result
  3. If no dealer site found, fall back to carsales dealer profile page
  4. Use the derived dealer_url as the PRIMARY \`link\`
  5. Store original carsales URL in \`verification_source\`
- Mark source as \`carsales-discovery\` (NOT \`carsales\`)

### Pricing Rules
- ALWAYS use off-road/drive-away price EXCLUDING govt charges/on-roads/stamp duty
- Focus on advertised price before extras

### Model Year Priority
- Prefer newer (e.g., ${currentYear}/${currentYear + 1} MY) if price delta ≤ +$8k off-road compared to similar older equivalent

### Mileage Priority
- Strongly prioritize <50,000 km total (ideally much lower for value)

### Body Type Priority
- Hatchbacks and sedans prioritized for METRO exits (Sydney, Melbourne, Brisbane CBD)
- Utes and 4WDs prioritized for REGIONAL exits (QLD, WA, NT, FNQ)
- Avoid SUVs/crossovers unless exceptional deal (off-road < $25k with low km/history)

### Seller Type
- Auctions/wholesale = HIGHEST priority (best margins)
- Private/motivated sellers = second priority
- Dealers ONLY if certified pre-owned + full service history + competitive

### Metrics & Honesty
- Calculate $/km (lower = better)
- Be BRUTALLY HONEST—no weak/sideways options
- Flag ALL red flags (accident history, poor condition, high km, overpriced, potential sold/expired)

### Recent Wins/Benchmarks
- 2024 Hyundai i30 N Line Premium, ~10k km, $30,990 off-road (strong private buy)
- 2025 MY25 i30 upgrade ~9k km at $37,990 off-road (if delta justified)

---

## GEOGRAPHIC INTELLIGENCE (GEO LAYER) - CRITICAL

### Regional Priority Rules
- **QLD/WA/NT/FNQ**: Prioritize UTES and 4WDs—stronger demand, faster clearance
- **Metro (Sydney/Melbourne/Brisbane)**: Prioritize HATCHBACKS and SEDANS—faster turnover
- **Regional NSW/VIC**: Mixed—check local demand patterns

### Regional Liquidity Awareness
- Utes/4WDs clear faster in QLD regional than Sydney metro
- Hatch/sedans move quicker in metro; slower in regional
- Score vehicles based on WHERE they are AND WHERE they exit

### Geo Price Dislocation Detection
- Cheap regional listings for metro-exit vehicles = GEO-ARBITRAGE OPPORTUNITY
- Metro listings overpriced relative to regional = AVOID
- Dealers consistently underpricing in certain postcodes = TARGET

### Freight Cost Modelling
Location is NOT a hard exclusion—it's a cost modifier:
- NSW ↔ QLD ↔ VIC: ~$1,000 freight
- Tasmania: ~$1,300 freight
- WA / NT: ~$1,800-2,500 freight
Factor freight into margin calculation.

### Geo Questions for Every Opportunity
1. Is this "cheap" because of weak exit region or genuine underpricing?
2. What's the regional clearance velocity for this model?
3. Does the listing location match known strong exit regions?
4. What's the freight cost to a strong exit region?

---

## CURRENT MISSION

- Make: ${m.make}
- Model: ${m.model}
- Variant allowed: ${(m.variant_allow || []).join(", ") || "ANY"}
- Year: ${m.year_min || "ANY"} to ${m.year_max || currentYear + 1}
- Max KM: ${m.km_max || 50000}
- Max Price: ${m.price_max ?? "ANY"} (off-road AUD)
- Location: ${m.location || "Australia-wide"}
- Seller type: ${(m.seller_type || ["auction", "wholesale", "private", "certified"]).join(", ")}
- Notes: ${m.notes || ""}
${(m.preferred_domains || m.allowed_domains)?.length ? `
### ADDITIONAL PREFERRED SOURCES
${(m.preferred_domains || m.allowed_domains || []).join(", ")}
Check these in addition to the tiered auction/wholesale sources above.
` : ""}

---

## OUTPUT FORMAT (Strict JSON only)

{
  "mission_name": "${m.mission_name}",
  "searched_at": "ISO timestamp",
  "items": [
    {
      "listing_url": "STABLE URL (auction house, dealer site, Gumtree/FB—NEVER direct carsales)",
      "verification_source": "original carsales URL if discovered there, otherwise null",
      "source": "manheim|pickles|carlins|iaai|auto-auctions|f3|valley|slattery|autograb|directwholesale|autoflip|tooti|motorplatform|gumtree|facebook|carma|drive|dealer-direct|carsales-discovery",
      "source_tier": "1|2|3|4|5",
      "dealer_name": "dealer name or null if private/auction",
      "dealer_license": "license number or null",
      "auction_house": "Manheim|Pickles|Carlins|IAAI|Auto Auctions|F3|Valley|Slattery|null",
      "location": "city/suburb",
      "state": "NSW|VIC|QLD|WA|SA|TAS|NT|ACT",
      "postcode": "2000",
      "sa2_code": "SA2 code if known or null",
      "geo_exit_strength": "HIGH|MEDIUM|LOW|UNKNOWN",
      "geo_notes": "Sydney metro strong exit for this model; no freight needed",
      "estimated_freight_cost": 0,
      "dislocation_flag": true|false,
      "year": number,
      "make": "MAKE",
      "model": "MODEL",
      "variant": "variant/trim or null",
      "km": number,
      "price": number (off-road AUD),
      "dollars_per_km": number (calculated: price/km),
      "vin": "if available or null",
      "stock_number": "if available or null",
      "seller_type": "auction|wholesale|private|dealer|certified",
      "confidence": "HIGH|MEDIUM|LOW",
      "evidence_snippet": "short extracted text proving the listing exists",
      "comparison_to_recent_wins": "how it stacks up vs benchmarks",
      "red_flags": "any concerns or 'none'",
      "notes": "Source: [auction/platform name]. Geo: [exit strength]. For carsales-discovery: 'Linked to dealer site.'"
    }
  ],
  "summary": "Searched Tier 1-3 auctions/wholesale first. Found X candidates. Geo insights: [regional patterns]."
}

Return 3-5 ranked opportunities (Tier 1 sources first, then Tier 2, etc.). If no matches, return empty items array. NO PROSE outside JSON.
`.trim();
}

async function callXai(prompt: string, _preferred_domains?: string[]): Promise<string> {
  const XAI_API_KEY = Deno.env.get("XAI_API_KEY");
  if (!XAI_API_KEY) throw new Error("XAI_API_KEY missing");

  console.log("[run-grok-mission] Calling xAI Responses API with web_search (unrestricted)...");

  // Use Responses API with web search tools
  // NOTE: We do NOT restrict allowed_domains - search is unrestricted
  // Preferred domains are passed in the prompt as priority hints, not hard filters
  const body: Record<string, unknown> = {
    model: "grok-3-fast",
    input: prompt,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
  };

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
