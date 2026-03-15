import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bob-chat — GPT-5 powered dealer buying assistant
 * 
 * Orchestrates conversation with tool-calling for:
 * - Vehicle search across all sources
 * - Dealer fingerprint + performance context
 * - Score explanation
 * - Watch profile creation
 * - Page context understanding
 */

const SYSTEM_PROMPT = `You are Bob, an embedded AI vehicle buying assistant for Carbitrage — an Australian dealer intelligence and sourcing platform.

IDENTITY:
- You are a sharp, commercially-aware buying assistant who understands dealer language
- You speak concisely and practically — no corporate fluff, no robotic wording
- You use Australian automotive terminology naturally
- You feel like talking to an experienced buyer, not a chatbot

CORE PRINCIPLE — AUTOMOTIVE TRUTH:
Vehicle value is dealer-specific, based on proven sales outcomes ("sales truth"), not public listing averages.
Every recommendation must be grounded in the dealer's own performance data when available.

BEHAVIOR RULES:
1. ACTION-FIRST: Do real work. Search, rank, explain. Don't just talk.
2. INFER BEFORE ASKING: Use dealer context, page context, and conversation history to infer intent. Only ask clarifying questions when critical details are truly missing.
3. ONE QUESTION AT A TIME: Never ask a checklist of questions. Ask the single most important missing piece.
4. OFFER DEFAULTS: When asking, suggest dealer-relevant defaults based on their history.
5. STRUCTURED OUTPUTS: For vehicle searches, return structured data via tools. Never respond with vague paragraphs when cars are requested.
6. EXPLAIN IN DEALER TERMS: "Strong fit because it matches your best 79 Series band" not "This vehicle has a high relevance score"

WHAT YOU CAN DO:
- Search live supply across auctions, retail, and dealer feeds
- Explain why vehicles score high or low for this specific dealer
- Summarize dealer performance (profit bands, km sweet spots, avoid segments)
- Explain what any page in Carbitrage means
- Create watch alerts for specific vehicle profiles
- Find replacement stock for sold vehicles
- Recommend what to buy today based on dealer fingerprints

TONE: Concise, practical, commercially sharp. Australian dealer language. Never waffle.`;

// Tool definitions for GPT-5
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_vehicles",
      description: "Search live vehicle listings across all Carbitrage sources (auctions, retail, dealer feeds). Returns ranked results with dealer-specific scoring.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Vehicle make e.g. Toyota, Mitsubishi" },
          model: { type: "string", description: "Vehicle model e.g. LandCruiser, Hilux" },
          variant: { type: "string", description: "Variant/trim e.g. GXL, SR5, Workmate" },
          year_min: { type: "number", description: "Minimum year" },
          year_max: { type: "number", description: "Maximum year" },
          km_min: { type: "number", description: "Minimum kilometres" },
          km_max: { type: "number", description: "Maximum kilometres" },
          price_max: { type: "number", description: "Maximum price" },
          body_type: { type: "string", description: "Body type e.g. dual cab, wagon" },
          fuel: { type: "string", description: "Fuel type e.g. diesel, petrol" },
          source: { type: "string", description: "Source filter: auction, retail, all" },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
        required: ["make"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dealer_context",
      description: "Get the current dealer's full buying profile: fingerprints, profit bands, km preferences, strong/weak segments, recent sales.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_vehicle_score",
      description: "Explain why a specific vehicle is scored the way it is for this dealer. Breaks down fingerprint match, margin estimate, km fit, risk flags.",
      parameters: {
        type: "object",
        properties: {
          listing_id: { type: "string", description: "The vehicle listing ID to explain" },
        },
        required: ["listing_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_buy_recommendations",
      description: "Get today's top buying opportunities ranked by dealer-specific fit. Uses fingerprints, margins, and current supply.",
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
      description: "Find replacement stock for a sold or reference vehicle. Searches live supply for similar vehicles matching the dealer's proven profile.",
      parameters: {
        type: "object",
        properties: {
          reference_make: { type: "string" },
          reference_model: { type: "string" },
          reference_variant: { type: "string" },
          reference_year: { type: "number" },
          reference_km: { type: "number" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
        required: ["reference_make", "reference_model"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_watch",
      description: "Create a persistent watch alert for a specific vehicle profile. The dealer will be notified when matching vehicles appear.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", description: "Human-readable label for the watch" },
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
      description: "Get dealer performance summary: best segments, worst segments, profit heatmap, km bands, days-to-sell stats.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_page",
      description: "Explain what the current Carbitrage page means, what data is shown, and what the dealer should do next.",
      parameters: {
        type: "object",
        properties: {
          page_route: { type: "string", description: "The current page route" },
          page_context: { type: "object", description: "Page-specific context data" },
        },
        required: ["page_route"],
      },
    },
  },
];

// Tool execution functions
async function executeSearchVehicles(params: any, dealerProfileId: string, supabase: any) {
  const conditions: string[] = [];
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

  const limit = Math.min(params.limit || 10, 25);
  query.order("price", { ascending: true }).limit(limit);

  const { data, error } = await query;
  if (error) return { error: error.message };

  // Enrich with dealer fingerprint matching
  const { data: fingerprints } = await supabase
    .from("dealer_fingerprints")
    .select("make, model, variant_family, year_min, year_max, min_km, max_km, avg_profit, sales_count, fingerprint_priority")
    .eq("dealer_profile_id", dealerProfileId)
    .eq("is_active", true);

  const enriched = (data || []).map((v: any) => {
    const match = (fingerprints || []).find((f: any) =>
      f.make?.toLowerCase() === v.make?.toLowerCase() &&
      f.model?.toLowerCase() === v.model?.toLowerCase() &&
      (!f.year_min || v.year >= f.year_min) &&
      (!f.year_max || v.year <= f.year_max)
    );

    return {
      ...v,
      fingerprint_match: match ? true : false,
      fingerprint_priority: match?.fingerprint_priority || null,
      estimated_profit: match?.avg_profit || null,
      historical_sales: match?.sales_count || 0,
      fit_score: match ? (match.fingerprint_priority === "high" ? 9 : match.fingerprint_priority === "medium" ? 7 : 5) : 3,
    };
  });

  // Sort by fit score desc
  enriched.sort((a: any, b: any) => (b.fit_score || 0) - (a.fit_score || 0));

  return {
    results: enriched,
    total: enriched.length,
    source_filter: params.source || "all",
  };
}

async function executeGetDealerContext(dealerProfileId: string, supabase: any) {
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
  const strongSegments = topFingerprints.filter((f: any) => f.fingerprint_priority === "high");
  const weakSegments = topFingerprints.filter((f: any) => f.avg_profit !== null && f.avg_profit < 1000);

  return {
    dealer_name: profileRes.data?.dealer_name || "Unknown Dealer",
    dealer_type: profileRes.data?.dealer_type || "independent",
    region: profileRes.data?.region_id || "unknown",
    fingerprint_count: fingerprintsRes.data?.length || 0,
    strong_segments: strongSegments.map((f: any) => ({
      make: f.make,
      model: f.model,
      variant: f.variant_family,
      years: `${f.year_min}-${f.year_max}`,
      avg_profit: f.avg_profit,
      avg_days_to_sell: f.avg_days_to_sell,
      sales_count: f.sales_count,
    })),
    weak_segments: weakSegments.map((f: any) => ({
      make: f.make,
      model: f.model,
      avg_profit: f.avg_profit,
    })),
    profit_patterns: (performanceRes.data || []).slice(0, 8).map((p: any) => ({
      make: p.make,
      model: p.model,
      trim: p.trim_class,
      years: `${p.year_min}-${p.year_max}`,
      km_band: `${(p.km_min/1000).toFixed(0)}k-${(p.km_max/1000).toFixed(0)}k`,
      median_profit: p.median_profit,
      total_flips: p.total_flips,
    })),
  };
}

async function executeGetBuyRecommendations(params: any, dealerProfileId: string, supabase: any) {
  // Get dealer fingerprints first
  const { data: fingerprints } = await supabase
    .from("dealer_fingerprints")
    .select("make, model, variant_family, year_min, year_max, min_km, max_km, avg_profit, sales_count, fingerprint_priority")
    .eq("dealer_profile_id", dealerProfileId)
    .eq("is_active", true)
    .eq("fingerprint_priority", "high")
    .order("avg_profit", { ascending: false })
    .limit(5);

  if (!fingerprints?.length) {
    return { recommendations: [], message: "No fingerprints found. Upload sales history first to get personalised recommendations." };
  }

  // Search for each high-priority fingerprint
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
      allResults.push(...data.map((v: any) => ({
        ...v,
        fingerprint_make: fp.make,
        fingerprint_model: fp.model,
        estimated_profit: fp.avg_profit,
        historical_sales: fp.sales_count,
        fit_reason: `Matches your ${fp.make} ${fp.model} fingerprint (${fp.sales_count} historical sales, avg profit $${fp.avg_profit?.toLocaleString()})`,
      })));
    }
  }

  // Deduplicate and sort
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  const limit = params.limit || 5;
  return {
    recommendations: unique.slice(0, limit),
    total_found: unique.length,
    fingerprints_searched: fingerprints.length,
  };
}

async function executeFindReplacement(params: any, dealerProfileId: string, supabase: any) {
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
  if (params.reference_km) {
    query.lte("km", params.reference_km * 1.3);
  }

  const limit = params.limit || 5;
  query.order("price", { ascending: true }).limit(limit);

  const { data, error } = await query;
  if (error) return { error: error.message };

  return {
    replacements: data || [],
    reference: `${params.reference_year || ''} ${params.reference_make} ${params.reference_model} ${params.reference_variant || ''}`.trim(),
    total: data?.length || 0,
  };
}

async function executeCreateWatch(params: any, dealerProfileId: string, supabase: any) {
  const searchProfile = {
    make: params.make,
    model: params.model,
    variant: params.variant || null,
    year_min: params.year_min || null,
    year_max: params.year_max || null,
    km_max: params.km_max || null,
    price_max: params.price_max || null,
  };

  const { data, error } = await supabase
    .from("bob_watch_profiles")
    .insert({
      dealer_profile_id: dealerProfileId,
      search_profile: searchProfile,
      label: params.label,
      status: "active",
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { watch_id: data.id, label: params.label, profile: searchProfile, status: "active" };
}

async function executeGetDealerPerformance(dealerProfileId: string, supabase: any) {
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
  const bestPerformers = patterns.filter((p: any) => p.median_profit > 2000).slice(0, 5);
  const worstPerformers = patterns.filter((p: any) => p.median_profit < 500).slice(0, 5);

  return {
    total_patterns: patterns.length,
    best_performers: bestPerformers.map((p: any) => ({
      segment: `${p.make} ${p.model} ${p.trim_class}`,
      years: `${p.year_min}-${p.year_max}`,
      km_band: `${(p.km_min/1000).toFixed(0)}k-${(p.km_max/1000).toFixed(0)}k`,
      median_profit: p.median_profit,
      median_sell: p.median_sell_price,
      flips: p.total_flips,
    })),
    worst_performers: worstPerformers.map((p: any) => ({
      segment: `${p.make} ${p.model} ${p.trim_class}`,
      median_profit: p.median_profit,
      flips: p.total_flips,
    })),
    clusters: (clustersRes.data || []).slice(0, 8).map((c: any) => ({
      segment: `${c.make} ${c.model} (${c.generation})`,
      total_flips: c.total_flips,
      median_profit: c.median_profit,
      avg_days_to_sell: c.avg_days_to_sell,
      median_km: c.median_km,
    })),
    fingerprint_count: fingerprintsRes.data?.length || 0,
    high_priority_count: (fingerprintsRes.data || []).filter((f: any) => f.fingerprint_priority === "high").length,
  };
}

function executeExplainPage(params: any) {
  const routeExplanations: Record<string, string> = {
    "/": "This is your Carbitrage home dashboard. It shows your overall activity, recent alerts, and quick access to key tools.",
    "/trading-desk": "The Trading Desk is your unified sourcing engine. It shows vehicles from auctions and retail sources ranked by profit potential. Auction sources are pinned to the top. Each vehicle shows an 'Anchor Sale' — a specific historical win from your sales data that validates the opportunity.",
    "/sales-upload": "This is where you upload your sales history (CSV/XLSX). Your sales data powers everything — fingerprints, scoring, and recommendations. The more data you upload, the smarter Carbitrage gets for you.",
    "/sales-insights": "Sales Insights breaks down your historical performance. Profit heatmaps by KM band, best/worst segments, days-to-sell trends. Use this to understand what works and what to avoid.",
    "/deals": "Your closed deals tracker. Each deal captures the full lifecycle from sourcing to sale, including actual vs estimated profit.",
    "/ooglebot": "OogleBot is the search engine. Enter make, model, year, and KM to search across all supply sources. It uses your dealer fingerprints to rank results by fit.",
    "/valo": "VALO is the trade-in valuation tool. Enter a vehicle and get a market-based offer range using real comparable sales data.",
    "/my-hunts": "Your active vehicle hunts. Each hunt is a persistent search that scans new supply and alerts you when matches appear.",
  };

  const route = params.page_route || "/";
  const baseExplanation = routeExplanations[route] || `You're on ${route}. This page shows Carbitrage data relevant to your dealer profile.`;

  return {
    route,
    explanation: baseExplanation,
    context: params.page_context || null,
  };
}

async function executeExplainVehicleScore(params: any, dealerProfileId: string, supabase: any) {
  const { data: listing } = await supabase
    .from("vehicle_listings")
    .select("*")
    .eq("id", params.listing_id)
    .single();

  if (!listing) return { error: "Vehicle not found" };

  // Find matching fingerprint
  const { data: fingerprints } = await supabase
    .from("dealer_fingerprints")
    .select("*")
    .eq("dealer_profile_id", dealerProfileId)
    .eq("is_active", true)
    .ilike("make", `%${listing.make}%`)
    .ilike("model", `%${listing.model}%`)
    .limit(3);

  const bestMatch = fingerprints?.[0] || null;

  return {
    vehicle: {
      id: listing.id,
      title: `${listing.year} ${listing.make} ${listing.model} ${listing.variant || ''}`.trim(),
      price: listing.price,
      km: listing.km,
      location: listing.location,
      source: listing.source,
      price_badge: listing.price_badge,
      days_on_market: listing.days_on_market,
    },
    fingerprint_match: bestMatch ? {
      matched: true,
      priority: bestMatch.fingerprint_priority,
      historical_profit: bestMatch.avg_profit,
      historical_sales: bestMatch.sales_count,
      avg_days_to_sell: bestMatch.avg_days_to_sell,
      km_fit: listing.km >= (bestMatch.min_km || 0) && listing.km <= (bestMatch.max_km || 999999) ? "within_band" : "outside_band",
      year_fit: listing.year >= bestMatch.year_min && listing.year <= bestMatch.year_max ? "within_range" : "outside_range",
    } : {
      matched: false,
      reason: "No fingerprint found for this make/model",
    },
    risk_flags: [
      listing.km > 150000 ? "High kilometres" : null,
      listing.days_on_market > 60 ? "Long time on market — possible issues" : null,
      listing.price_badge?.toLowerCase().includes("above") ? "Priced above market" : null,
    ].filter(Boolean),
  };
}

// Main handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, dealer_profile_id, page_context } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build context-enriched system prompt
    let contextBlock = "";
    if (page_context) {
      contextBlock += `\n\nCURRENT PAGE CONTEXT:\n- Route: ${page_context.route || 'unknown'}`;
      if (page_context.page_type) contextBlock += `\n- Page type: ${page_context.page_type}`;
      if (page_context.vehicle_ids?.length) contextBlock += `\n- Vehicles visible: ${page_context.vehicle_ids.length}`;
      if (page_context.filters) contextBlock += `\n- Active filters: ${JSON.stringify(page_context.filters)}`;
      if (page_context.selected_vehicle) contextBlock += `\n- Selected vehicle: ${JSON.stringify(page_context.selected_vehicle)}`;
      if (page_context.page_title) contextBlock += `\n- Page title: ${page_context.page_title}`;
      if (page_context.metrics) contextBlock += `\n- Page metrics: ${JSON.stringify(page_context.metrics)}`;
    }

    if (dealer_profile_id) {
      contextBlock += `\n\nDEALER ID: ${dealer_profile_id}`;
    }

    const systemMessage = SYSTEM_PROMPT + contextBlock;

    // First pass: Use fast model for tool selection (non-streaming for speed)
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemMessage },
          ...(messages || []),
        ],
        tools: TOOLS,
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("[BOB-CHAT] AI error:", status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse non-streaming response for tool calls
    const aiData = await aiResponse.json();
    const choice = aiData.choices?.[0];
    const fullContent = choice?.message?.content || "";
    const toolCalls = choice?.message?.tool_calls || [];

    // If there are tool calls, execute them and re-call AI
    if (toolCalls.length > 0) {
      const toolResults: any[] = [];

      for (const tc of toolCalls) {
        const funcName = tc.function.name;
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

        console.log(`[BOB-CHAT] Executing tool: ${funcName}`, args);

        let result: any;
        switch (funcName) {
          case "search_vehicles":
            result = await executeSearchVehicles(args, dealer_profile_id, supabase);
            break;
          case "get_dealer_context":
            result = await executeGetDealerContext(dealer_profile_id, supabase);
            break;
          case "explain_vehicle_score":
            result = await executeExplainVehicleScore(args, dealer_profile_id, supabase);
            break;
          case "get_buy_recommendations":
            result = await executeGetBuyRecommendations(args, dealer_profile_id, supabase);
            break;
          case "find_replacement":
            result = await executeFindReplacement(args, dealer_profile_id, supabase);
            break;
          case "create_watch":
            result = await executeCreateWatch(args, dealer_profile_id, supabase);
            break;
          case "get_dealer_performance":
            result = await executeGetDealerPerformance(dealer_profile_id, supabase);
            break;
          case "explain_page":
            result = executeExplainPage(args);
            break;
          default:
            result = { error: `Unknown tool: ${funcName}` };
        }

        toolResults.push({
          tool_call_id: tc.id,
          function_name: funcName,
          result,
        });
      }

      // Re-call AI with tool results for final response
      const toolMessages = [
        { role: "system", content: systemMessage },
        ...(messages || []),
        {
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        },
        ...toolResults.map(tr => ({
          role: "tool",
          tool_call_id: tr.tool_call_id,
          content: JSON.stringify(tr.result),
        })),
      ];

      const finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5",
          messages: toolMessages,
          stream: true,
        }),
      });

      if (!finalResponse.ok) {
        const errText = await finalResponse.text();
        console.error("[BOB-CHAT] Final AI error:", errText);
        return new Response(JSON.stringify({ error: "AI processing error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Stream the final response back with tool data attached
      // We'll prepend a custom SSE event with tool results
      const toolDataEvent = `data: ${JSON.stringify({ type: "tool_results", results: toolResults })}\n\n`;
      const encoder = new TextEncoder();

      const combinedStream = new ReadableStream({
        async start(controller) {
          // Send tool results first
          controller.enqueue(encoder.encode(toolDataEvent));
          
          // Then stream the AI response
          const finalReader = finalResponse.body!.getReader();
          while (true) {
            const { done, value } = await finalReader.read();
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

    // No tool calls — stream the original response
    // Reconstruct SSE from collected content
    const encoder = new TextEncoder();
    const reconstructed = new ReadableStream({
      start(controller) {
        // Send accumulated content as SSE
        const chunk = JSON.stringify({
          choices: [{ delta: { content: fullContent }, index: 0 }],
        });
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
