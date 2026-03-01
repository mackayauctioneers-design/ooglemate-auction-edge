/**
 * run-outward-search
 *
 * Accepts a free-text instruction (e.g. "2024 Toyota Hilux SR5 under 80,000 km")
 * and returns matching listings from vehicle_listings across all sources
 * (auctions, classifieds, dealer stock, etc.).
 *
 * Uses the Lovable AI gateway to parse intent, then queries vehicle_listings.
 *
 * Response shape matches OutwardSearchResponse in src/lib/api/ooglebot.ts.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTENT_SCHEMA = `You are a vehicle search query parser for an Australian used car platform. Return ONLY a JSON object, nothing else.

Schema:
{"make":string|null,"model":string|null,"badge":string|null,"year_min":number|null,"year_max":number|null,"max_km":number|null,"price_max":number|null}

Rules:
- Uppercase make and model
- Always infer the make from the model name: Hilux=TOYOTA, Ranger=FORD, D-MAX=ISUZU, Triton=MITSUBISHI, Navara=NISSAN, BT-50=MAZDA, Amarok=VOLKSWAGEN, Colorado=HOLDEN, Prado=TOYOTA, LandCruiser=TOYOTA, Patrol=NISSAN, Pajero=MITSUBISHI, Everest=FORD, Wildtrak=FORD, Raptor=FORD, MU-X=ISUZU, Fortuner=TOYOTA, Kluger=TOYOTA, RAV4=TOYOTA, CX-5=MAZDA, Sportage=KIA, Tucson=HYUNDAI, Santa Fe=HYUNDAI, Forester=SUBARU, Outback=SUBARU
- badge is the variant/trim/series e.g. "SR5", "GXL", "Workmate", "Wildtrak", "SX", "Hi-Rider". Uppercase it. null if not specified.
- A single year like "2024" means year_min=2024, year_max=null (2024 or newer)
- Only set year_max if an upper bound is explicitly stated
- CRITICAL: "under Nk km" or "under N,000 km" or "low km" refers to KILOMETRES (max_km), NOT price. Only set price_max when the user mentions "$", "dollars", "budget", "price", or "under $N".
- "under 80k km" → max_km=80000, price_max=null
- "under $80k" → price_max=80000, max_km=null
- "under 80k" with no context → price_max=80000 (assume price unless km unit is present)
- "low km" → max_km=80000
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

const AUCTION_SOURCES = new Set([
  "pickles", "grays", "manheim", "slattery", "f3",
  "auto_auctions", "vma", "bidsonline",
]);
const AUCTION_PREMIUM = 500;
const FREIGHT_FLAT = 800;
const MAX_RESULTS = 30;
const EXCLUDED_LIFECYCLE = ["STALE", "DEAD", "stale", "dead"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "error", error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

  let body: { instruction?: string; internal_count?: number; urgency?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ status: "error", error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const instruction = (body.instruction || "").trim();
  if (!instruction) {
    return new Response(JSON.stringify({ status: "error", error: "instruction is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const internalCount = body.internal_count ?? 0;
  const urgency = body.urgency ?? "normal";

  // Demand gating: skip if plenty of internal results and not urgent
  if (internalCount >= 5 && urgency !== "high") {
    return new Response(
      JSON.stringify({
        status: "ok",
        gated: true,
        reason: `${internalCount} internal results found — external search skipped`,
        results: [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const startMs = Date.now();

  // --- 1. Parse intent with LLM ---
  let intent: ParsedIntent = {
    make: null, model: null, badge: null,
    year_min: null, year_max: null, max_km: null, price_max: null,
  };

  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const llmRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
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
      if (llmRes.ok) {
        const llmData = await llmRes.json();
        const raw = llmData?.choices?.[0]?.message?.content || "";
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        intent = {
          make: parsed.make || null,
          model: parsed.model || null,
          badge: parsed.badge || null,
          year_min: typeof parsed.year_min === "number" ? parsed.year_min : null,
          year_max: typeof parsed.year_max === "number" ? parsed.year_max : null,
          max_km: typeof parsed.max_km === "number" ? parsed.max_km : null,
          price_max: typeof parsed.price_max === "number" ? parsed.price_max : null,
        };
      }
    } catch (err) {
      console.warn("LLM intent parse failed, falling back to regex:", err);
    }
  }

  // --- 2. Regex fallback if LLM unavailable or returned no make ---
  if (!intent.make) {
    const q = instruction;
    // km: must have km/klm/kms unit
    const kmMatch = q.match(/(?:under|below|<|less than)\s*([\d,]+)\s*(?:klms|klm|kms|km)/i);
    if (kmMatch) intent.max_km = parseInt(kmMatch[1].replace(/,/g, ""), 10);
    // price: $ sign or explicit price/budget keyword
    const priceMatch = q.match(/(?:\$|under\s+\$|below\s+\$|budget|price)\s*([\d,]+)\s*k?\b/i);
    if (priceMatch) {
      let val = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (q.toLowerCase().includes("k") && val < 1000) val *= 1000;
      intent.price_max = val;
    }
    const yearMatch = q.match(/\b(20[1-3]\d)\b/);
    if (yearMatch) intent.year_min = parseInt(yearMatch[1], 10);
    const words = q
      .replace(/(?:under|below|budget|max|less than)\s*\$?\s*[\d,]+\s*k?\b/gi, "")
      .replace(/(?:under|below|<|less than)\s*[\d,]+\s*km/gi, "")
      .replace(/\b20[1-3]\d\b/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    intent.make = words[0]?.toUpperCase() || null;
    intent.model = words.slice(1).join(" ").toUpperCase() || null;
  }

  if (!intent.make) {
    return new Response(
      JSON.stringify({ status: "error", error: "Could not determine make/model from instruction" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- 3. Query vehicle_listings ---
  let query = sb
    .from("vehicle_listings")
    .select(`
      id, listing_id, source, source_class, make, model,
      variant_raw, variant_family, variant_used, year, km,
      asking_price, location, state, listing_url,
      auction_house, lifecycle_state, fingerprint,
      first_seen_at, is_dealer_grade, drivetrain, fuel, transmission
    `)
    .ilike("make", `%${intent.make}%`)
    .not("lifecycle_state", "in", `(${EXCLUDED_LIFECYCLE.map(s => `"${s}"`).join(",")})`)
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(200);

  if (intent.model) {
    // Split model into words and match on the first meaningful word to handle badge in model
    const modelCore = intent.model.split(/\s+/)[0];
    query = query.ilike("model", `%${modelCore}%`);
  }
  if (intent.year_min) query = query.gte("year", intent.year_min);
  if (intent.year_max) query = query.lte("year", intent.year_max);
  if (intent.max_km) query = query.lte("km", intent.max_km);
  if (intent.price_max) query = query.lte("asking_price", intent.price_max);

  const { data: listings, error: listingsError } = await query;
  if (listingsError) {
    console.error("vehicle_listings query error:", listingsError);
    return new Response(
      JSON.stringify({ status: "error", error: listingsError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- 4. Badge/variant filter and scoring ---
  let filtered = listings || [];

  // STRICT badge filter — if a badge/variant is specified, ONLY return listings that match it.
  // A search for "N Line Premium" must NEVER return "BASE", "Active", "Elite" etc.
  // If zero matches exist in the DB, we return empty results (correct behaviour — don't pollute with wrong variants).
  if (intent.badge) {
    const badgeUpper = intent.badge.toUpperCase();
    // Tokenise multi-word badges: "N LINE PREMIUM" → ["N", "LINE", "PREMIUM"]
    // Short tokens (1 char) are skipped to avoid false positives on single letters.
    const badgeTokens = badgeUpper.split(/\s+/).filter(t => t.length > 1);
    filtered = filtered.filter((l: any) => {
      const variants = [
        l.variant_raw, l.variant_family, l.variant_used,
        l.model  // some sources embed badge in model field
      ]
        .filter(Boolean)
        .map((v: string) => v.toUpperCase());
      // ALL badge tokens must appear somewhere in the variant fields
      return badgeTokens.every(token =>
        variants.some((v: string) => v.includes(token))
      );
    });
  }

  const results = filtered.map((l: any) => {
    const askPrice = l.asking_price ?? null;
    const isAuction = AUCTION_SOURCES.has((l.source || "").toLowerCase());
    const effectiveCost = askPrice != null ? askPrice + (isAuction ? AUCTION_PREMIUM : 0) + FREIGHT_FLAT : null;

    let score = 50;
    const reasons: string[] = [];

    if ((l.make || "").toUpperCase() === intent.make!.toUpperCase()) {
      score += 5; reasons.push("EXACT_MAKE");
    }
    if (intent.badge) {
      const badgeUpper = intent.badge!.toUpperCase();
      const variants = [l.variant_raw, l.variant_family, l.variant_used].filter(Boolean);
      if (variants.some((v: string) => v.toUpperCase() === badgeUpper)) {
        score += 10; reasons.push("EXACT_BADGE");
      } else if (variants.some((v: string) => v.toUpperCase().includes(badgeUpper))) {
        score += 5; reasons.push("BADGE_PARTIAL");
      }
    }
    if (intent.year_min && l.year >= intent.year_min) {
      score += 5; reasons.push("YEAR_IN_RANGE");
    }
    if (l.km && l.km < 30000) { score += 10; reasons.push("LOW_KM"); }
    else if (l.km && l.km < 60000) { score += 5; reasons.push("MODERATE_KM"); }
    if (l.is_dealer_grade) { score += 5; reasons.push("DEALER_GRADE"); }
    if (intent.price_max && effectiveCost != null && effectiveCost < intent.price_max * 0.85) {
      score += 10; reasons.push("PRICE_WELL_UNDER_BUDGET");
    }
    const daysListed = l.first_seen_at
      ? Math.floor((Date.now() - new Date(l.first_seen_at).getTime()) / 86400000)
      : null;
    if (daysListed !== null && daysListed <= 3) { score += 5; reasons.push("FRESH_LISTING"); }
    score = Math.min(score, 100);

    return {
      source: l.source,
      title: `${l.year || ""} ${l.make || ""} ${l.model || ""} ${l.variant_used || l.variant_family || l.variant_raw || ""}`.trim(),
      year: l.year,
      km: l.km,
      price: askPrice,
      effective_cost: effectiveCost,
      location: l.location,
      state: l.state,
      variant: l.variant_used || l.variant_family || l.variant_raw || null,
      url: l.listing_url,
      score,
      match_reason: reasons,
      source_class: l.source_class,
      auction_house: l.auction_house,
      drivetrain: l.drivetrain,
      fuel: l.fuel,
      transmission: l.transmission,
      days_listed: daysListed,
      is_dealer_grade: l.is_dealer_grade,
    };
  });

  results.sort((a: any, b: any) => b.score - a.score || (a.effective_cost ?? Infinity) - (b.effective_cost ?? Infinity));
  const topResults = results.slice(0, MAX_RESULTS);

  const durationMs = Date.now() - startMs;

  // Log
  try {
    await sb.from("cron_audit_log").insert({
      cron_name: "run-outward-search",
      run_date: new Date().toISOString().slice(0, 10),
      success: true,
      result: {
        instruction,
        intent,
        listings_scanned: (listings || []).length,
        results_returned: topResults.length,
        duration_ms: durationMs,
      },
    });
  } catch (_) { /* swallow */ }

  return new Response(
    JSON.stringify({
      status: "ok",
      gated: false,
      intent: {
        make: intent.make,
        model_keywords: intent.model ? [intent.model] : [],
        year: intent.year_min,
        max_km: intent.max_km,
        price_max: intent.price_max,
      },
      results: topResults,
      total_searched: (listings || []).length,
      total_filtered: filtered.length,
      duration_ms: durationMs,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
