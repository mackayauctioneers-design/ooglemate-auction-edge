import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * bob-chat — Carbitrage AI Buying Assistant
 * 
 * Architecture: Conversation → Intent → Tool Execution → Results → AI Explains
 * Bob is NOT a chatbot. Bob controls the Carbitrage engine.
 */

const SYSTEM_PROMPT = `You are Bob, the embedded AI buying assistant for Carbitrage — an Australian dealer vehicle sourcing platform.

IDENTITY:
- You are a sharp, commercially-aware vehicle buyer who controls the Carbitrage sourcing engine
- You speak like a trusted dealer buyer — concise, practical, no fluff
- You use Australian automotive language naturally (utes, dual cabs, 79 Series, etc.)
- You feel like talking to a seasoned buyer connected to live supply, NOT a chatbot

CORE RULE — ACTION FIRST:
You must ALWAYS attempt to execute system actions. Never just reply conversationally when the dealer is asking about vehicles, performance, or market data.

Flow: Understand intent → Call tools → Return real data → Explain results

CRITICAL RULE — NEVER EXPOSE INTERNAL ERRORS:
- You must NEVER tell the dealer about system errors, tool failures, search issues, or technical problems.
- If a tool returned an error or empty results, you MUST NOT mention the error. Instead:
  1. Describe what you found (even if it's a broader set of results from a retry)
  2. Offer to narrow down: "I pulled a wider net — want me to filter by variant or KM?"
  3. If truly nothing was found, say "Nothing matching that exact spec on the market right now. Want me to widen the search or set up a watch?"
- Internal tool errors are SILENT. The dealer sees results or helpful next steps, never error messages.
- Never use words like "error", "failed", "issue", "problem", "broke", "bug", "unfortunately there was an error" in reference to system behaviour.

BEHAVIOUR RULES:
1. ALWAYS CALL TOOLS: If the dealer mentions vehicles, buying, selling, performance, or market data — call the appropriate tool. Do NOT reply with generic advice.
2. INFER BEFORE ASKING: Use dealer context (fingerprints, sales history) to fill in defaults. If a dealer says "79 Series", you already know they mean Toyota LandCruiser 79 Series in their preferred KM/year band.
3. ONE QUESTION MAX: If you must clarify, ask ONE targeted question with a suggested default. "Dual cab or single? (Your history says dual cab)"
4. VEHICLE CARDS: When returning vehicles, always use the tool. Never describe vehicles in paragraphs.
5. CONVERSATION MEMORY: If the dealer refines a previous request ("only diesel", "under 100k km"), update the existing search parameters — don't start fresh.
6. EXPLAIN IN DEALER TERMS: "Strong fit — matches your best 79 Series band, you've sold 12 of these at $4k avg profit" NOT "This vehicle has a high relevance score."

TOOL USAGE RULES:
- "What should I buy today?" → get_buy_recommendations
- "Find me a [vehicle]" → search_vehicles (infer make/model/params from context)
- "I just sold a [vehicle], find me another" → find_replacement
- "Why is this ranked high?" → explain_vehicle_score
- "Watch for [vehicle]" → create_watch
- "How am I performing?" → get_dealer_performance
- "Explain this page" → explain_page
- Any vehicle-related question → get_dealer_context first if needed, then search

RESPONSE FORMAT:
- Keep text responses SHORT (2-4 sentences max)
- Lead with the action: "Found 5 strong matches for you:" then show results
- After tool results, add a brief dealer-relevant insight
- Never repeat vehicle data in text that's already shown in cards
- If results came from a broadened search (retry), present them naturally: "Here's what's on the market for [make model]" and offer to filter further

TONE: Sharp, direct, commercially savvy. Australian dealer language. "Yeah mate, found three solid options" not "I've identified several potential vehicles."

OUTWARD SEARCH:
- When a dealer asks about market prices, availability, or "what's the cheapest", ALWAYS use search_market in addition to search_vehicles.
- search_vehicles checks YOUR internal database (wholesale, auctions, dealer sites).
- search_market checks the RETAIL market (Carsales, AutoTrader, Drive, CarsGuide) for current advertised prices.
- Use BOTH for comprehensive answers. Internal for wholesale intel, market for retail context and margin calculation.

TRADE VALUATIONS:
- When a dealer describes a vehicle for trade-in valuation, use valor_quick_appraise.
- This searches both internal and market, then you calculate the trade guide.
- Be FAST and DIRECT. The dealer is likely standing with a customer.
- Format: "[Year Make Model] — cheapest comparable is $XX,XXX at [source]. Trade guide: $XX,XXX floor / $XX,XXX mid / $XX,XXX ceiling. [One sentence of market context]."

VALO PAGE (page_type: valuation):
- When the dealer is on the VALO page, use the start_valo tool to fill the form.
- Ask the dealer to describe the vehicle: make, model, year, km, and badge/variant.
- You MUST collect at minimum: make, model, year, and km before auto-running.
- If they give partial info (e.g. "2022 Hilux"), ask for km and badge in ONE follow-up: "Got it — 2022 Hilux. What's the km and badge? (e.g. SR5, 85,000km)"
- Once you have enough, call start_valo with auto_run=true to fill AND trigger the valuation.
- Don't use valor_quick_appraise on the VALO page — use start_valo instead so the form is populated.

FULL DATA ACCESS:
- You have query_database — a universal tool that can read ANY table in Carbitrage.
- Use it when dealers ask about their sales history, past profits, fingerprints, specific deals, auction results, watches, hunts, or anything about their data.
- Key tables you should know:
  - sales_normalised: dealer's past sales with buy_price, sell_price, gross_profit, days_in_stock, km, make, model, variant, year, region_id, dealer_name
  - dealer_outcomes: historical deal outcomes with gross_profit, days_to_exit, buy_price, sell_price, confidence
  - dealer_fingerprints: buying patterns — make, model, variant_family, avg_profit, avg_days_to_sell, sales_count, fingerprint_priority, km bands
  - dealer_profit_patterns: profit analysis by segment — median_profit, median_buy_price, median_sell_price, km_min/max, year_min/max
  - dealer_platform_clusters: performance clusters by generation — total_flips, median_profit, avg_days_to_sell
  - valo_runs: past trade-in valuations with intent, market data, confidence, offers
  - vehicle_listings: all current wholesale/auction/dealer listings (active and historical)
  - retail_listings: current retail market listings from Carsales etc
  - winners_watchlist: top performing vehicle segments to watch
  - sale_hunts: active vehicle hunts/searches
  - hunt_alerts: alerts triggered by hunts
  - bob_watch_profiles: watches you've set up for dealers
  - verified_deals: confirmed good deals with josh_score, discount_pct
  - alert_logs: notification history
- ALWAYS filter by dealer_profile_id or dealer_name='Dave' or account_id to scope results to the current dealer.
- When the dealer asks "how did I do on my last RAV4" or "what profit did I make on Hiluxes" — use query_database on sales_normalised or dealer_outcomes.
- When they ask about fingerprints, patterns, best sellers — use the fingerprint/pattern tables.
- Present data in dealer terms: profit, days to sell, margin %. Never dump raw data."`;

// Tool definitions
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_vehicles",
      description: "Search live vehicle listings across all Carbitrage sources. ALWAYS use this when a dealer mentions any vehicle, make, model, or buying intent.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Vehicle make e.g. Toyota, Mitsubishi" },
          model: { type: "string", description: "Vehicle model e.g. LandCruiser, Hilux, Triton" },
          variant: { type: "string", description: "Variant/trim e.g. GXL, SR5, Workmate, 79 Series" },
          year_min: { type: "number" },
          year_max: { type: "number" },
          km_min: { type: "number" },
          km_max: { type: "number" },
          price_max: { type: "number" },
          body_type: { type: "string", description: "Body type e.g. dual cab, single cab, wagon" },
          fuel: { type: "string", description: "Fuel type e.g. diesel, petrol" },
          source: { type: "string", description: "Filter: auction, retail, all" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["make"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dealer_context",
      description: "Load the dealer's buying profile: fingerprints, profit bands, km preferences, strong/weak segments. Call this to infer defaults before searching.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_vehicle_score",
      description: "Explain why a specific vehicle is scored the way it is for this dealer.",
      parameters: {
        type: "object",
        properties: {
          listing_id: { type: "string", description: "The vehicle listing ID" },
        },
        required: ["listing_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_buy_recommendations",
      description: "Get today's top buying opportunities ranked by dealer-specific fit. Use when dealer asks 'what should I buy' or wants recommendations.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of recommendations (default 5)" },
          source_filter: { type: "string", description: "Filter: auction, retail, all" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_replacement",
      description: "Find replacement stock for a sold or reference vehicle. Use when dealer says 'I sold a...' or 'find another like...'",
      parameters: {
        type: "object",
        properties: {
          reference_make: { type: "string" },
          reference_model: { type: "string" },
          reference_variant: { type: "string" },
          reference_year: { type: "number" },
          reference_km: { type: "number" },
          limit: { type: "number" },
        },
        required: ["reference_make", "reference_model"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_watch",
      description: "Create a persistent watch alert. Use when dealer says 'watch for', 'alert me', 'let me know when'.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string" },
          make: { type: "string" },
          model: { type: "string" },
          variant: { type: "string" },
          year_min: { type: "number" },
          year_max: { type: "number" },
          km_max: { type: "number" },
          price_max: { type: "number" },
        },
        required: ["label", "make", "model"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dealer_performance",
      description: "Get dealer performance summary: best/worst segments, profit heatmap, km bands, days-to-sell.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_page",
      description: "Explain what the current Carbitrage page means and what the dealer should do next.",
      parameters: {
        type: "object",
        properties: {
          page_route: { type: "string" },
          page_context: { type: "object" },
        },
        required: ["page_route"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_market",
      description: "Search the external Australian car market for current retail prices and listings. Checks Carsales, AutoTrader, Drive, CarsGuide. Use this when: (a) The dealer asks about market prices or what something is worth retail, (b) You need to compare internal stock prices against retail, (c) Finding the cheapest available comparable for a trade valuation, (d) The dealer asks about market trends or availability. ALWAYS use this alongside search_vehicles for comprehensive answers.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query e.g. '2022 Toyota RAV4 GXL for sale Australia price' or 'cheapest BYD Atto 3 under 30000km Australia'" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_database",
      description: "Query any Carbitrage database table directly. Use this for: sales history, past profits, fingerprint details, deal outcomes, valuation history, hunt/watch status, alert history, retail listings, or any data question the dealer asks about their business. Always filter by dealer_profile_id or dealer_name to scope to the current dealer.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name e.g. sales_normalised, dealer_outcomes, dealer_fingerprints, dealer_profit_patterns, valo_runs, vehicle_listings, retail_listings, winners_watchlist, sale_hunts, hunt_alerts, bob_watch_profiles, verified_deals, alert_logs, dealer_platform_clusters" },
          select: { type: "string", description: "Comma-separated columns to return, or * for all. e.g. 'make, model, gross_profit, sell_price, days_in_stock'" },
          filters: { type: "object", description: "Key-value filters. Keys are column names, values are the filter values. Use special prefixes: 'gte:' for >=, 'lte:' for <=, 'ilike:' for partial match, 'neq:' for not equal. e.g. {make: 'TOYOTA', year: 'gte:2022', gross_profit: 'gte:2000'}" },
          order_by: { type: "string", description: "Column to sort by, prefix with '-' for descending. e.g. '-gross_profit' or 'price'" },
          limit: { type: "number", description: "Max rows to return (default 20, max 50)" }
        },
        required: ["table"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "start_valo",
      description: "Fill the VALO trade-in valuation form on the current page. Use this when the dealer is on the VALO page and describes a vehicle they want to value. Extract make, model, year, km, badge/variant from their description and fill the form. If they haven't provided all details, ask for the missing ones (especially year, km, and badge). Once you have enough info, call this to populate the form and optionally auto-run the valuation.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Vehicle make e.g. TOYOTA, HYUNDAI" },
          model: { type: "string", description: "Vehicle model e.g. HILUX, TUCSON" },
          year: { type: "string", description: "Year of the vehicle e.g. '2022'" },
          km: { type: "string", description: "Kilometres e.g. '85000'" },
          badge: { type: "string", description: "Badge/variant e.g. SR5, GXL, Active" },
          condition: { type: "string", description: "Condition: excellent, good, fair, poor. Default 'good'" },
          description: { type: "string", description: "Any extra notes about the vehicle" },
          auto_run: { type: "boolean", description: "Whether to automatically run the VALO after filling the form. Set true when you have make, model, year, and km." }
        },
        required: ["make", "model"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "valor_quick_appraise",
      description: "Run a quick trade-in valuation. Use when a dealer describes a vehicle they need to value for a trade-in. Searches internal database and external market for the cheapest comparable, then calculates a trade guide (floor/mid/ceiling). The dealer is likely standing with a customer — be fast and direct.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Vehicle make e.g. HYUNDAI, TOYOTA" },
          model: { type: "string", description: "Vehicle model e.g. TUCSON, RAV4" },
          variant: { type: "string", description: "Variant/badge e.g. Active, GXL, SR5" },
          year: { type: "number", description: "Year of the vehicle" },
          km: { type: "number", description: "Kilometres on the vehicle" }
        },
        required: ["make", "model"]
      }
    }
  },
];

// ============================================================================
// Graceful degradation helpers
// ============================================================================

/** Priority order of parameters to drop when a search fails or returns no results */
const SEARCH_DEGRADE_ORDER = ["variant", "body_type", "fuel", "km_min", "price_max", "year_min", "year_max", "km_max"];

function degradeSearchParams(params: Record<string, any>): { degraded: Record<string, any>; dropped: string } | null {
  for (const key of SEARCH_DEGRADE_ORDER) {
    if (params[key] !== undefined && params[key] !== null) {
      const degraded = { ...params };
      delete degraded[key];
      return { degraded, dropped: key };
    }
  }
  return null; // nothing left to drop
}

// ============================================================================
// Tool execution functions
// ============================================================================

async function executeSearchVehicles(params: any, dealerProfileId: string, supabase: any): Promise<any> {
  // Retry loop with graceful parameter degradation
  let currentParams = { ...params };
  const droppedParams: string[] = [];
  const MAX_RETRIES = 4;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await _runSearchQuery(currentParams, dealerProfileId, supabase);

      // If we got results, return them (with info about broadened search for AI context)
      if (result.results && result.results.length > 0) {
        if (droppedParams.length > 0) {
          result._broadened = true;
          result._dropped_params = droppedParams;
          result._original_params = params;
          console.log(`[BOB-CHAT] Search succeeded after dropping: ${droppedParams.join(", ")}`);
        }
        return result;
      }

      // No results — try degrading
      if (result.results && result.results.length === 0) {
        const next = degradeSearchParams(currentParams);
        if (!next) {
          // Nothing left to drop — return empty with broadening context
          return {
            results: [],
            total: 0,
            search_params: currentParams,
            _broadened: droppedParams.length > 0,
            _dropped_params: droppedParams,
            _original_params: params,
            _no_results: true,
          };
        }
        droppedParams.push(next.dropped);
        currentParams = next.degraded;
        console.log(`[BOB-CHAT] No results, retrying without: ${next.dropped}`);
        continue;
      }

      // Query error — try degrading
      if (result.error) {
        console.error(`[BOB-CHAT] Search error (attempt ${attempt}): ${result.error}`);
        const next = degradeSearchParams(currentParams);
        if (!next) {
          // Can't degrade further — return empty results, NOT the error
          return {
            results: [],
            total: 0,
            search_params: currentParams,
            _broadened: true,
            _dropped_params: droppedParams,
            _original_params: params,
            _no_results: true,
          };
        }
        droppedParams.push(next.dropped);
        currentParams = next.degraded;
        console.log(`[BOB-CHAT] Error on param, retrying without: ${next.dropped}`);
        continue;
      }
    } catch (err) {
      console.error(`[BOB-CHAT] Search exception (attempt ${attempt}):`, err);
      const next = degradeSearchParams(currentParams);
      if (!next) {
        return { results: [], total: 0, search_params: currentParams, _no_results: true };
      }
      droppedParams.push(next.dropped);
      currentParams = next.degraded;
    }
  }

  return { results: [], total: 0, search_params: currentParams, _no_results: true };
}

/** Core search query — no retry logic, just executes */
async function _runSearchQuery(params: any, dealerProfileId: string, supabase: any) {
  const query = supabase
    .from("vehicle_listings")
    .select("id, make, model, variant, year, km, price, location, source, listing_url, image_url, price_badge, seller_type, days_on_market, first_seen_at, last_seen_at")
    .eq("status", "active");

  if (params.make) query.ilike("make", `%${params.make}%`);
  if (params.model) query.ilike("model", `%${params.model}%`);
  if (params.variant) query.ilike("variant", `%${params.variant}%`);
  if (params.year_min) query.gte("year", params.year_min);
  if (params.year_max) query.lte("year", params.year_max);
  if (params.km_min) query.gte("km", params.km_min);
  if (params.km_max) query.lte("km", params.km_max);
  if (params.price_max) query.lte("price", params.price_max);
  if (params.fuel) query.ilike("fuel_type", `%${params.fuel}%`);
  if (params.body_type) query.ilike("body_type", `%${params.body_type}%`);

  const limit = Math.min(params.limit || 10, 25);
  query.order("price", { ascending: true }).limit(limit);

  const { data, error } = await query;
  if (error) return { error: error.message };

  // Enrich with dealer fingerprint matching
  const { data: fingerprints } = await supabase
    .from("dealer_fingerprints")
    .select("make, model, variant_family, year_min, year_max, min_km, max_km, avg_profit, avg_days_to_sell, sales_count, fingerprint_priority")
    .eq("dealer_profile_id", dealerProfileId)
    .eq("is_active", true);

  const enriched = (data || []).map((v: any) => {
    const match = (fingerprints || []).find((f: any) =>
      f.make?.toLowerCase() === v.make?.toLowerCase() &&
      f.model?.toLowerCase() === v.model?.toLowerCase() &&
      (!f.year_min || v.year >= f.year_min) &&
      (!f.year_max || v.year <= f.year_max)
    );

    const kmInBand = match ? (v.km >= (match.min_km || 0) && v.km <= (match.max_km || 999999)) : false;
    const fitScore = match
      ? (match.fingerprint_priority === "high" ? 9 : match.fingerprint_priority === "medium" ? 7 : 5) + (kmInBand ? 1 : 0)
      : 3;

    const riskFlags: string[] = [];
    if (v.km > 200000) riskFlags.push("Very high km");
    else if (v.km > 150000) riskFlags.push("High km");
    if (v.days_on_market > 90) riskFlags.push("90+ days on market");
    else if (v.days_on_market > 60) riskFlags.push("60+ days listed");
    if (v.price_badge?.toLowerCase().includes("above")) riskFlags.push("Above market price");

    return {
      ...v,
      fingerprint_match: !!match,
      fingerprint_priority: match?.fingerprint_priority || null,
      estimated_profit: match?.avg_profit || null,
      avg_days_to_sell: match?.avg_days_to_sell || null,
      historical_sales: match?.sales_count || 0,
      km_in_band: kmInBand,
      fit_score: fitScore,
      risk_flags: riskFlags,
      confidence: match ? (match.sales_count >= 5 ? "high" : match.sales_count >= 2 ? "medium" : "low") : "none",
    };
  });

  enriched.sort((a: any, b: any) => (b.fit_score || 0) - (a.fit_score || 0));

  return { results: enriched, total: enriched.length, search_params: params };
}

// --- Other tool executors (unchanged, but wrapped for safety) ---

async function executeGetDealerContext(dealerProfileId: string, supabase: any) {
  try {
    const [fingerprintsRes, profileRes, performanceRes] = await Promise.all([
      supabase
        .from("dealer_fingerprints")
        .select("make, model, variant_family, year_min, year_max, min_km, max_km, avg_profit, avg_days_to_sell, sales_count, fingerprint_priority, fingerprint_type")
        .eq("dealer_profile_id", dealerProfileId)
        .eq("is_active", true)
        .order("sales_count", { ascending: false })
        .limit(20),
      supabase
        .from("dealer_profiles")
        .select("dealer_name, dealer_type, region_id")
        .eq("id", dealerProfileId)
        .single(),
      supabase
        .from("dealer_profit_patterns")
        .select("make, model, trim_class, year_min, year_max, km_min, km_max, median_profit, median_sell_price, total_flips")
        .eq("account_id", dealerProfileId)
        .order("median_profit", { ascending: false })
        .limit(15),
    ]);

    const topFingerprints = (fingerprintsRes.data || []).slice(0, 10);
    return {
      dealer_name: profileRes.data?.dealer_name || "Unknown Dealer",
      dealer_type: profileRes.data?.dealer_type || "independent",
      region: profileRes.data?.region_id || "unknown",
      fingerprint_count: fingerprintsRes.data?.length || 0,
      strong_segments: topFingerprints
        .filter((f: any) => f.fingerprint_priority === "high")
        .map((f: any) => ({
          make: f.make, model: f.model, variant: f.variant_family,
          years: `${f.year_min}-${f.year_max}`,
          km_band: f.min_km && f.max_km ? `${(f.min_km/1000).toFixed(0)}k-${(f.max_km/1000).toFixed(0)}k` : null,
          avg_profit: f.avg_profit, avg_days_to_sell: f.avg_days_to_sell, sales_count: f.sales_count,
        })),
      weak_segments: topFingerprints
        .filter((f: any) => f.avg_profit !== null && f.avg_profit < 1000)
        .map((f: any) => ({ make: f.make, model: f.model, avg_profit: f.avg_profit })),
      profit_patterns: (performanceRes.data || []).slice(0, 8).map((p: any) => ({
        make: p.make, model: p.model, trim: p.trim_class,
        years: `${p.year_min}-${p.year_max}`,
        km_band: `${(p.km_min/1000).toFixed(0)}k-${(p.km_max/1000).toFixed(0)}k`,
        median_profit: p.median_profit, total_flips: p.total_flips,
      })),
    };
  } catch (err) {
    console.error("[BOB-CHAT] get_dealer_context error:", err);
    return { dealer_name: "Dealer", fingerprint_count: 0, strong_segments: [], weak_segments: [], profit_patterns: [] };
  }
}

async function executeGetBuyRecommendations(params: any, dealerProfileId: string, supabase: any) {
  try {
    const { data: fingerprints } = await supabase
      .from("dealer_fingerprints")
      .select("make, model, variant_family, year_min, year_max, min_km, max_km, avg_profit, avg_days_to_sell, sales_count, fingerprint_priority")
      .eq("dealer_profile_id", dealerProfileId)
      .eq("is_active", true)
      .eq("fingerprint_priority", "high")
      .order("avg_profit", { ascending: false })
      .limit(5);

    if (!fingerprints?.length) {
      return { recommendations: [], message: "Upload your sales history so I can learn what works for you and start recommending." };
    }

    const allResults: any[] = [];
    for (const fp of fingerprints.slice(0, 3)) {
      const query = supabase
        .from("vehicle_listings")
        .select("id, make, model, variant, year, km, price, location, source, listing_url, image_url, price_badge, seller_type, days_on_market")
        .eq("status", "active")
        .ilike("make", `%${fp.make}%`)
        .ilike("model", `%${fp.model}%`);

      if (fp.year_min) query.gte("year", fp.year_min);
      if (fp.year_max) query.lte("year", fp.year_max);
      if (fp.max_km) query.lte("km", fp.max_km);

      query.order("price", { ascending: true }).limit(5);
      const { data } = await query;

      if (data) {
        const riskFlags = (v: any): string[] => {
          const flags: string[] = [];
          if (v.km > 150000) flags.push("High km");
          if (v.days_on_market > 60) flags.push("Long time listed");
          return flags;
        };

        allResults.push(...data.map((v: any) => ({
          ...v,
          fingerprint_match: true,
          fingerprint_priority: fp.fingerprint_priority,
          estimated_profit: fp.avg_profit,
          avg_days_to_sell: fp.avg_days_to_sell,
          historical_sales: fp.sales_count,
          confidence: fp.sales_count >= 5 ? "high" : fp.sales_count >= 2 ? "medium" : "low",
          risk_flags: riskFlags(v),
          fit_reason: `Matches your ${fp.make} ${fp.model} fingerprint (${fp.sales_count} sales, ~$${fp.avg_profit?.toLocaleString()} avg profit)`,
        })));
      }
    }

    const seen = new Set();
    const unique = allResults.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    return {
      recommendations: unique.slice(0, params.limit || 5),
      total_found: unique.length,
      fingerprints_searched: fingerprints.length,
    };
  } catch (err) {
    console.error("[BOB-CHAT] get_buy_recommendations error:", err);
    return { recommendations: [], total_found: 0 };
  }
}

async function executeFindReplacement(params: any, dealerProfileId: string, supabase: any) {
  try {
    const query = supabase
      .from("vehicle_listings")
      .select("id, make, model, variant, year, km, price, location, source, listing_url, image_url, price_badge, seller_type, days_on_market")
      .eq("status", "active")
      .ilike("make", `%${params.reference_make}%`)
      .ilike("model", `%${params.reference_model}%`);

    if (params.reference_variant) query.ilike("variant", `%${params.reference_variant}%`);
    if (params.reference_year) {
      query.gte("year", params.reference_year - 2);
      query.lte("year", params.reference_year + 2);
    }
    if (params.reference_km) query.lte("km", params.reference_km * 1.3);

    query.order("price", { ascending: true }).limit(params.limit || 5);
    const { data, error } = await query;

    if (error) {
      console.error("[BOB-CHAT] find_replacement query error:", error.message);
      // Retry without variant
      if (params.reference_variant) {
        console.log("[BOB-CHAT] Retrying find_replacement without variant");
        const retryParams = { ...params };
        delete retryParams.reference_variant;
        return executeFindReplacement(retryParams, dealerProfileId, supabase);
      }
      return { replacements: [], reference: `${params.reference_make} ${params.reference_model}`, total: 0 };
    }

    const { data: fp } = await supabase
      .from("dealer_fingerprints")
      .select("avg_profit, avg_days_to_sell, sales_count, fingerprint_priority")
      .eq("dealer_profile_id", dealerProfileId)
      .eq("is_active", true)
      .ilike("make", `%${params.reference_make}%`)
      .ilike("model", `%${params.reference_model}%`)
      .limit(1)
      .single();

    return {
      replacements: (data || []).map((v: any) => ({
        ...v,
        fingerprint_match: !!fp,
        estimated_profit: fp?.avg_profit || null,
        avg_days_to_sell: fp?.avg_days_to_sell || null,
        confidence: fp ? (fp.sales_count >= 5 ? "high" : "medium") : "none",
        risk_flags: [
          v.km > 150000 ? "High km" : null,
          v.days_on_market > 60 ? "Long time listed" : null,
        ].filter(Boolean),
      })),
      reference: `${params.reference_year || ''} ${params.reference_make} ${params.reference_model} ${params.reference_variant || ''}`.trim(),
      total: data?.length || 0,
    };
  } catch (err) {
    console.error("[BOB-CHAT] find_replacement exception:", err);
    return { replacements: [], reference: `${params.reference_make} ${params.reference_model}`, total: 0 };
  }
}

async function executeCreateWatch(params: any, dealerProfileId: string, supabase: any) {
  try {
    const searchProfile = {
      make: params.make, model: params.model, variant: params.variant || null,
      year_min: params.year_min || null, year_max: params.year_max || null,
      km_max: params.km_max || null, price_max: params.price_max || null,
    };

    const { data, error } = await supabase
      .from("bob_watch_profiles")
      .insert({ dealer_profile_id: dealerProfileId, search_profile: searchProfile, label: params.label, status: "active" })
      .select().single();

    if (error) {
      console.error("[BOB-CHAT] create_watch error:", error.message);
      return { watch_created: false, label: params.label };
    }
    return { watch_id: data.id, label: params.label, profile: searchProfile, status: "active" };
  } catch (err) {
    console.error("[BOB-CHAT] create_watch exception:", err);
    return { watch_created: false, label: params.label };
  }
}

async function executeGetDealerPerformance(dealerProfileId: string, supabase: any) {
  try {
    const [patternsRes, clustersRes, fingerprintsRes] = await Promise.all([
      supabase
        .from("dealer_profit_patterns")
        .select("make, model, trim_class, year_min, year_max, km_min, km_max, median_profit, median_sell_price, median_buy_price, total_flips")
        .eq("account_id", dealerProfileId)
        .order("median_profit", { ascending: false })
        .limit(20),
      supabase
        .from("dealer_platform_clusters")
        .select("make, model, generation, year_min, year_max, total_flips, median_profit, avg_days_to_sell, median_km")
        .eq("account_id", dealerProfileId)
        .order("total_flips", { ascending: false })
        .limit(15),
      supabase
        .from("dealer_fingerprints")
        .select("make, model, variant_family, avg_profit, avg_days_to_sell, sales_count, fingerprint_priority")
        .eq("dealer_profile_id", dealerProfileId)
        .eq("is_active", true)
        .order("sales_count", { ascending: false })
        .limit(20),
    ]);

    const patterns = patternsRes.data || [];
    return {
      total_patterns: patterns.length,
      best_performers: patterns.filter((p: any) => p.median_profit > 2000).slice(0, 5).map((p: any) => ({
        segment: `${p.make} ${p.model} ${p.trim_class}`,
        years: `${p.year_min}-${p.year_max}`,
        km_band: `${(p.km_min/1000).toFixed(0)}k-${(p.km_max/1000).toFixed(0)}k`,
        median_profit: p.median_profit, median_sell: p.median_sell_price, flips: p.total_flips,
      })),
      worst_performers: patterns.filter((p: any) => p.median_profit < 500).slice(0, 5).map((p: any) => ({
        segment: `${p.make} ${p.model} ${p.trim_class}`, median_profit: p.median_profit, flips: p.total_flips,
      })),
      clusters: (clustersRes.data || []).slice(0, 8).map((c: any) => ({
        segment: `${c.make} ${c.model} (${c.generation})`,
        total_flips: c.total_flips, median_profit: c.median_profit,
        avg_days_to_sell: c.avg_days_to_sell, median_km: c.median_km,
      })),
      fingerprint_count: fingerprintsRes.data?.length || 0,
      high_priority_count: (fingerprintsRes.data || []).filter((f: any) => f.fingerprint_priority === "high").length,
    };
  } catch (err) {
    console.error("[BOB-CHAT] get_dealer_performance error:", err);
    return { total_patterns: 0, best_performers: [], worst_performers: [], clusters: [], fingerprint_count: 0 };
  }
}

function executeExplainPage(params: any) {
  const explanations: Record<string, string> = {
    "/": "Your Carbitrage dashboard — quick access to alerts, active hunts, and sourcing tools.",
    "/dealer-home": "Your home base. Shows recent activity, top opportunities, and quick actions.",
    "/trading-desk": "The Trading Desk shows vehicles from auctions and retail ranked by profit potential. Auction sources pinned to top. Each vehicle shows an 'Anchor Sale' — a real win from your history that validates the opportunity.",
    "/sales-upload": "Upload your sales history (CSV/XLSX) here. Your sales data powers everything — fingerprints, scoring, and recommendations. More data = smarter Bob.",
    "/sales-insights": "Your historical performance breakdown. Profit heatmaps by KM band, best/worst segments, days-to-sell trends.",
    "/deals": "Closed deals tracker. Full lifecycle from sourcing to sale, actual vs estimated profit.",
    "/ooglebot": "OogleBot search engine. Search across all supply sources, ranked by your dealer fingerprints.",
    "/valo": "VALO trade-in valuation. Enter a vehicle for a market-based offer range using real comparable sales.",
    "/my-hunts": "Active vehicle hunts. Persistent searches that scan new supply and alert you on matches.",
    "/upcoming-auctions": "Upcoming auctions with lot counts and relevance scores based on your buying profile.",
    "/opportunities": "Scored opportunities from across all sources, ranked by fit to your fingerprints.",
  };

  const route = params.page_route || "/";
  return {
    route,
    explanation: explanations[route] || `You're on ${route}. This shows Carbitrage data relevant to your dealer profile.`,
    context: params.page_context || null,
  };
}

async function executeExplainVehicleScore(params: any, dealerProfileId: string, supabase: any) {
  try {
    const { data: listing } = await supabase
      .from("vehicle_listings").select("*").eq("id", params.listing_id).single();

    if (!listing) return { vehicle: null, message: "Vehicle no longer available in the system." };

    const { data: fingerprints } = await supabase
      .from("dealer_fingerprints").select("*")
      .eq("dealer_profile_id", dealerProfileId).eq("is_active", true)
      .ilike("make", `%${listing.make}%`).ilike("model", `%${listing.model}%`).limit(3);

    const bestMatch = fingerprints?.[0] || null;
    return {
      vehicle: {
        id: listing.id,
        title: `${listing.year} ${listing.make} ${listing.model} ${listing.variant || ''}`.trim(),
        price: listing.price, km: listing.km, location: listing.location,
        source: listing.source, price_badge: listing.price_badge, days_on_market: listing.days_on_market,
      },
      fingerprint_match: bestMatch ? {
        matched: true, priority: bestMatch.fingerprint_priority,
        historical_profit: bestMatch.avg_profit, historical_sales: bestMatch.sales_count,
        avg_days_to_sell: bestMatch.avg_days_to_sell,
        km_fit: listing.km >= (bestMatch.min_km || 0) && listing.km <= (bestMatch.max_km || 999999) ? "within_band" : "outside_band",
        year_fit: listing.year >= bestMatch.year_min && listing.year <= bestMatch.year_max ? "within_range" : "outside_range",
      } : { matched: false, reason: "No fingerprint found for this make/model" },
      risk_flags: [
        listing.km > 150000 ? "High kilometres" : null,
        listing.days_on_market > 60 ? "Long time on market" : null,
        listing.price_badge?.toLowerCase().includes("above") ? "Above market price" : null,
      ].filter(Boolean),
    };
  } catch (err) {
    console.error("[BOB-CHAT] explain_vehicle_score error:", err);
    return { vehicle: null, message: "Couldn't pull details on that vehicle right now." };
  }
}

async function executeQueryDatabase(params: any, dealerProfileId: string, supabase: any): Promise<any> {
  // Whitelist of tables Bob can read (no writes, no admin tables)
  const ALLOWED_TABLES = new Set([
    "sales_normalised", "dealer_sales", "dealer_outcomes", "dealer_fingerprints",
    "dealer_profit_patterns", "dealer_platform_clusters", "dealer_profiles",
    "valo_runs", "vehicle_listings", "retail_listings", "winners_watchlist",
    "sale_hunts", "hunt_alerts", "hunt_matches", "bob_watch_profiles",
    "verified_deals", "alert_logs", "dealer_match_alerts", "dealer_demands",
    "fingerprint_performance_metrics", "fingerprint_profit_stats",
    "opportunities", "operator_opportunities", "demand_velocity_daily",
    "model_market_snapshot", "listing_price_history", "auction_source_events",
    "dealer_entitlements", "dealer_notification_settings",
  ]);

  const table = params.table;
  if (!table || !ALLOWED_TABLES.has(table)) {
    console.error(`[BOB-CHAT] query_database: table '${table}' not allowed`);
    return { rows: [], error: "Table not available.", total: 0 };
  }

  try {
    const selectCols = params.select || "*";
    const limit = Math.min(params.limit || 20, 50);

    let query = supabase.from(table).select(selectCols);

    // Apply filters
    const filters = params.filters || {};
    for (const [key, rawVal] of Object.entries(filters)) {
      const val = String(rawVal);
      if (val.startsWith("gte:")) {
        query = query.gte(key, val.slice(4));
      } else if (val.startsWith("lte:")) {
        query = query.lte(key, val.slice(4));
      } else if (val.startsWith("ilike:")) {
        query = query.ilike(key, `%${val.slice(6)}%`);
      } else if (val.startsWith("neq:")) {
        query = query.neq(key, val.slice(4));
      } else {
        query = query.ilike(key, `%${val}%`);
      }
    }

    // Auto-scope to dealer where possible (security)
    const dealerScopedTables = new Set([
      "sales_normalised", "dealer_sales", "dealer_outcomes", "dealer_fingerprints",
      "dealer_profit_patterns", "dealer_platform_clusters", "valo_runs",
      "sale_hunts", "hunt_alerts", "bob_watch_profiles", "alert_logs",
      "dealer_match_alerts", "dealer_demands", "winners_watchlist",
      "fingerprint_performance_metrics", "fingerprint_profit_stats",
      "dealer_entitlements", "dealer_notification_settings",
    ]);

    if (dealerScopedTables.has(table) && dealerProfileId) {
      // Try different column names for dealer scoping
      if (["dealer_fingerprints", "bob_watch_profiles", "alert_logs", "dealer_notification_settings"].includes(table)) {
        query = query.eq("dealer_profile_id", dealerProfileId);
      } else if (["dealer_profit_patterns", "dealer_platform_clusters", "valo_runs", "winners_watchlist", "dealer_entitlements"].includes(table)) {
        query = query.eq("account_id", dealerProfileId);
      } else if (["sale_hunts", "hunt_alerts"].includes(table)) {
        query = query.eq("dealer_id", dealerProfileId);
      } else if (["sales_normalised", "dealer_sales", "dealer_outcomes"].includes(table)) {
        // These use dealer_name = 'Dave' based on user's setup
        query = query.eq("dealer_name", "Dave");
      }
    }

    // Ordering
    if (params.order_by) {
      const desc = params.order_by.startsWith("-");
      const col = desc ? params.order_by.slice(1) : params.order_by;
      query = query.order(col, { ascending: !desc });
    }

    query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      console.error(`[BOB-CHAT] query_database error on ${table}:`, error.message);
      return { rows: [], total: 0, table, error: "Query failed." };
    }

    return { rows: data || [], total: (data || []).length, table };
  } catch (err) {
    console.error(`[BOB-CHAT] query_database exception:`, err);
    return { rows: [], total: 0, table };
  }
}

async function executeSearchMarket(params: any): Promise<any> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    console.error("[BOB-CHAT] PERPLEXITY_API_KEY not configured");
    return { results: [], summary: "Market search not available." };
  }

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: `You are a vehicle market research assistant for Australian car dealers. Search for currently advertised vehicles matching the query.

RULES:
- Only return REAL listings you find. Do NOT fabricate listings.
- Focus on: prices (AUD), kilometres, year, variant, dealer/seller name, state, source site.
- Include listings from Carsales, Drive, CarsGuide, AutoTrader, dealer websites.
- Return the cheapest listings first.
- Be specific with prices — exact dollar amounts where possible.
- Include the source URL where you found each listing.
- Summarise in a dealer-friendly format.`
          },
          { role: "user", content: params.query }
        ],
        temperature: 0.1,
        search_domain_filter: [
          "carsales.com.au",
          "drive.com.au",
          "autotrader.com.au",
          "carsguide.com.au",
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[BOB-CHAT] Perplexity API error:", response.status, errText);
      return { results: [], summary: "Market search temporarily unavailable." };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const citations = data.citations ?? [];

    return {
      summary: content,
      citations: citations.slice(0, 10),
      source: "perplexity_sonar",
    };
  } catch (err) {
    console.error("[BOB-CHAT] search_market error:", err);
    return { results: [], summary: "Market search temporarily unavailable." };
  }
}

async function executeValorQuickAppraise(params: any, dealerProfileId: string, supabase: any): Promise<any> {
  const make = (params.make || "").toUpperCase();
  const model = (params.model || "").toUpperCase();
  const variant = params.variant || null;
  const year = params.year || null;
  const km = params.km || null;

  // Step 1: Search internal DB for comparables
  const internalParams: any = { make, limit: 10 };
  if (model) internalParams.model = model;
  if (year) { internalParams.year_min = year - 2; internalParams.year_max = year + 1; }
  if (km) internalParams.km_max = Math.round(km * 1.5);

  const internalResult = await executeSearchVehicles(internalParams, dealerProfileId, supabase);
  const internalListings = internalResult?.results || [];

  // Step 2: Search external market for cheapest comparable
  const yearStr = year ? `${year}` : "";
  const kmStr = km ? `under ${Math.round(km * 1.3).toLocaleString()} km` : "";
  const marketQuery = `cheapest ${yearStr} ${make} ${model} ${variant || ""} for sale Australia ${kmStr} price`.trim();

  const marketResult = await executeSearchMarket({ query: marketQuery });

  // Step 3: Find cheapest price from either source
  let cheapestInternal = null;
  let cheapestInternalPrice = Infinity;
  for (const listing of internalListings) {
    if (listing.price && listing.price < cheapestInternalPrice) {
      cheapestInternalPrice = listing.price;
      cheapestInternal = listing;
    }
  }

  return {
    vehicle_description: `${year || ""} ${make} ${model} ${variant || ""}`.trim(),
    km: km,
    internal_comps: internalListings.slice(0, 5),
    internal_cheapest: cheapestInternal ? {
      price: cheapestInternal.price,
      year: cheapestInternal.year,
      km: cheapestInternal.km,
      source: cheapestInternal.source,
      location: cheapestInternal.location,
      url: cheapestInternal.listing_url || cheapestInternal.url || null,
    } : null,
    market_summary: marketResult.summary,
    market_citations: marketResult.citations || [],
    trade_guide_instructions: `Calculate trade guide from the cheapest comparable found:
    - Floor = cheapest retail price × 0.80 (20% margin for wholesale)
    - Mid = cheapest retail price × 0.85 (15% margin)
    - Ceiling = cheapest retail price × 0.90 (10% margin, tight, only if fast seller)
    Present the trade guide prominently.`,
  };
}

function executeStartValo(params: any): any {
  const make = (params.make || "").toUpperCase().trim();
  const model = (params.model || "").toUpperCase().trim();
  const year = params.year || "";
  const km = params.km || "";
  const badge = params.badge || "";
  const condition = params.condition || "good";
  const description = params.description || "";
  const autoRun = params.auto_run ?? (!!make && !!model && !!year && !!km);

  // Build missing fields list
  const missing: string[] = [];
  if (!make) missing.push("make");
  if (!model) missing.push("model");
  if (!year) missing.push("year");
  if (!km) missing.push("kilometres");

  return {
    form_fill: {
      make,
      model,
      year: String(year),
      km: String(km),
      badge,
      condition,
      description,
      autoRun: missing.length === 0 && autoRun,
    },
    missing_fields: missing,
    message: missing.length > 0
      ? `I need a few more details: ${missing.join(", ")}. Can you fill those in?`
      : `Filling in ${year} ${make} ${model}${badge ? ` ${badge}` : ""} with ${Number(km).toLocaleString()} km. Running the valuation now.`,
  };
}

// ============================================================================
// Safe tool executor wrapper — guarantees no exceptions leak to AI as errors
// ============================================================================

async function safeExecuteTool(funcName: string, args: any, dealerProfileId: string, supabase: any): Promise<any> {
  try {
    switch (funcName) {
      case "search_vehicles":
        return await executeSearchVehicles(args, dealerProfileId, supabase);
      case "get_dealer_context":
        return await executeGetDealerContext(dealerProfileId, supabase);
      case "explain_vehicle_score":
        return await executeExplainVehicleScore(args, dealerProfileId, supabase);
      case "get_buy_recommendations":
        return await executeGetBuyRecommendations(args, dealerProfileId, supabase);
      case "find_replacement":
        return await executeFindReplacement(args, dealerProfileId, supabase);
      case "create_watch":
        return await executeCreateWatch(args, dealerProfileId, supabase);
      case "get_dealer_performance":
        return await executeGetDealerPerformance(dealerProfileId, supabase);
      case "explain_page":
        return executeExplainPage(args);
      case "query_database":
        return await executeQueryDatabase(args, dealerProfileId, supabase);
      case "search_market":
        return await executeSearchMarket(args);
      case "valor_quick_appraise":
        return await executeValorQuickAppraise(args, dealerProfileId, supabase);
      case "start_valo":
        return executeStartValo(args);
      default:
        return { results: [], message: "No data available for that request." };
    }
  } catch (err) {
    // CRITICAL: Never return error details — return empty/neutral result
    console.error(`[BOB-CHAT] Tool ${funcName} unhandled error:`, err);
    return { results: [], message: "No data available right now." };
  }
}

// ============================================================================
// Main handler
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, dealer_profile_id, page_context } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Build context block
    let contextBlock = "";
    if (page_context) {
      contextBlock += `\n\nCURRENT PAGE CONTEXT:`;
      contextBlock += `\n- Route: ${page_context.route || 'unknown'}`;
      if (page_context.page_type) contextBlock += `\n- Page type: ${page_context.page_type}`;
      if (page_context.page_title) contextBlock += `\n- Page title: ${page_context.page_title}`;
      if (page_context.vehicle_ids?.length) contextBlock += `\n- Vehicles visible: ${page_context.vehicle_ids.length}`;
      if (page_context.filters) contextBlock += `\n- Active filters: ${JSON.stringify(page_context.filters)}`;
      if (page_context.selected_vehicle) contextBlock += `\n- Selected vehicle: ${JSON.stringify(page_context.selected_vehicle)}`;
      if (page_context.metrics) contextBlock += `\n- Page metrics: ${JSON.stringify(page_context.metrics)}`;
    }
    if (dealer_profile_id) contextBlock += `\n\nDEALER ID: ${dealer_profile_id}`;

    const systemMessage = SYSTEM_PROMPT + contextBlock;

    // Pass 1: Non-streaming tool selection
    console.log("[BOB-CHAT] Starting tool selection pass");
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemMessage }, ...(messages || [])],
        tools: TOOLS,
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("[BOB-CHAT] AI error:", status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const choice = aiData.choices?.[0];
    const fullContent = choice?.message?.content || "";
    let toolCalls = choice?.message?.tool_calls || [];

    // ── AUTO-INJECT search_market when search_vehicles is called ──
    // Gemini often skips search_market even when instructed. If search_vehicles
    // is selected but search_market isn't, auto-inject it so we always check
    // the external market alongside internal results.
    const hasSearchVehicles = toolCalls.some((tc: any) => tc.function?.name === "search_vehicles");
    const hasSearchMarket = toolCalls.some((tc: any) => tc.function?.name === "search_market");
    const hasValorAppraise = toolCalls.some((tc: any) => tc.function?.name === "valor_quick_appraise");

    if (hasSearchVehicles && !hasSearchMarket && !hasValorAppraise) {
      // Build a market query from the search_vehicles params
      const svCall = toolCalls.find((tc: any) => tc.function?.name === "search_vehicles");
      let svArgs: any = {};
      try { svArgs = JSON.parse(svCall.function.arguments); } catch { svArgs = {}; }
      const marketQuery = [
        svArgs.year_min ? `${svArgs.year_min}` : "",
        svArgs.make || "",
        svArgs.model || "",
        svArgs.variant || "",
        "for sale Australia",
        svArgs.km_max ? `under ${svArgs.km_max.toLocaleString()} km` : "",
        svArgs.price_max ? `under $${svArgs.price_max.toLocaleString()}` : "",
        "price",
      ].filter(Boolean).join(" ");

      const injectedId = `injected_market_${Date.now()}`;
      toolCalls = [
        ...toolCalls,
        {
          id: injectedId,
          type: "function",
          function: {
            name: "search_market",
            arguments: JSON.stringify({ query: marketQuery }),
          },
        },
      ];
      console.log(`[BOB-CHAT] Auto-injected search_market: "${marketQuery}"`);
    }

    // Execute tool calls if present
    if (toolCalls.length > 0) {
      const toolResults: any[] = [];

      for (const tc of toolCalls) {
        const funcName = tc.function.name;
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        console.log(`[BOB-CHAT] Executing tool: ${funcName}`, JSON.stringify(args).substring(0, 200));

        const result = await safeExecuteTool(funcName, args, dealer_profile_id, supabase);
        toolResults.push({ tool_call_id: tc.id, function_name: funcName, result });
      }

      // Pass 2: Stream final response with tool results
      const toolMessages = [
        { role: "system", content: systemMessage },
        ...(messages || []),
        {
          role: "assistant", content: fullContent || null,
          tool_calls: toolCalls.map((tc: any) => ({
            id: tc.id, type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        },
        ...toolResults.map(tr => ({
          role: "tool", tool_call_id: tr.tool_call_id, content: JSON.stringify(tr.result),
        })),
      ];

      const finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: toolMessages, stream: true }),
      });

      if (!finalResponse.ok) {
        const errText = await finalResponse.text();
        console.error("[BOB-CHAT] Final AI error:", errText);
        return new Response(JSON.stringify({ error: "AI processing error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Prepend tool results as custom SSE event, then stream AI response
      const toolDataEvent = `data: ${JSON.stringify({ type: "tool_results", results: toolResults })}\n\n`;
      const encoder = new TextEncoder();

      const combinedStream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(toolDataEvent));
          const reader = finalResponse.body!.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        },
      });

      return new Response(combinedStream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // No tool calls — return content as SSE
    const encoder = new TextEncoder();
    const reconstructed = new ReadableStream({
      start(controller) {
        const chunk = JSON.stringify({ choices: [{ delta: { content: fullContent }, index: 0 }] });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(reconstructed, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[BOB-CHAT] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
