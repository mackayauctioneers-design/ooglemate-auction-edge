import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// SALES-ASSESSMENT v2 — Deep, badge/variant-level AI assessment
// Reads raw sales truth + pre-computed views for deep fingerprint analysis
// Returns: structured assessment with executive summary, fingerprint table,
//          loss patterns, KM insight, and actionable recommendations
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { account_id } = await req.json();
    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Gather data: raw sales + pre-computed views ──
    const [rawSalesRes, clearanceRes, variationRes] = await Promise.all([
      supabase
        .from("vehicle_sales_truth")
        .select("make, model, variant, badge, year, km, sale_price, buy_price, days_to_clear, sold_at, series, body_type, transmission, fuel_type, description_raw")
        .eq("account_id", account_id)
        .order("sold_at", { ascending: false })
        .limit(500),
      supabase
        .from("sales_clearance_velocity")
        .select("make, model, variant, sales_count, median_days_to_clear, median_profit_dollars, median_profit_pct, pct_under_30, pct_under_60")
        .eq("account_id", account_id)
        .order("sales_count", { ascending: false })
        .limit(30),
      supabase
        .from("sales_variation_performance")
        .select("make, model, variant, transmission, fuel_type, body_type, sales_count, median_days_to_clear, median_profit_dollars, median_profit_pct")
        .eq("account_id", account_id)
        .order("sales_count", { ascending: false })
        .limit(40),
    ]);

    const rawSales = rawSalesRes.data || [];
    const clearance = clearanceRes.data || [];
    const variations = variationRes.data || [];

    if (rawSales.length < 3) {
      return new Response(
        JSON.stringify({
          executive_summary: "",
          proven_fingerprints: [],
          loss_patterns: [],
          km_insight: null,
          recommendations: [],
          comparison_note: null,
          warnings: ["Not enough sales data for a meaningful assessment. Upload more sales history."],
          // Legacy fields for backward compat
          summary: [],
          core_engines: [],
          shape_winners: [],
          outcome_signals: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build deep facts payload ──
    const factsPayload = {
      total_sales: rawSales.length,
      raw_sales_sample: rawSales.slice(0, 80).map((r: any) => ({
        make: r.make,
        model: r.model,
        badge: r.badge || r.variant || r.series || null,
        year: r.year,
        km: r.km,
        sale_price: r.sale_price,
        buy_price: r.buy_price,
        profit: r.sale_price && r.buy_price ? r.sale_price - r.buy_price : null,
        days_in_stock: r.days_to_clear,
        sold_date: r.sold_at,
        body_type: r.body_type,
        transmission: r.transmission,
        fuel_type: r.fuel_type,
        description: r.description_raw,
      })),
      clearance_velocity: clearance.map((c: any) => ({
        make: c.make, model: c.model, variant: c.variant,
        count: c.sales_count,
        median_days: c.median_days_to_clear,
        median_profit: c.median_profit_dollars,
        median_profit_pct: c.median_profit_pct,
        pct_under_30: c.pct_under_30,
        pct_under_60: c.pct_under_60,
      })),
      variation_detail: variations.map((v: any) => ({
        make: v.make, model: v.model, variant: v.variant,
        transmission: v.transmission, fuel: v.fuel_type, body: v.body_type,
        count: v.sales_count,
        median_days: v.median_days_to_clear,
        median_profit: v.median_profit_dollars,
        median_profit_pct: v.median_profit_pct,
      })),
    };

    // ── Call Lovable AI for deep assessment ──
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a senior automotive buying analyst — a deal captain briefing a head buyer.

TASK: Analyse this dealer's sales data and produce a DEEP, ACTIONABLE assessment.

HARD RULES:
- You are READ-ONLY. NEVER invent or modify data.
- ALWAYS reference specific badge/variant/series (e.g., "VX Landcruiser", "XLT Ranger", "ST-X Navara") — never just "Toyota Landcruiser".
- Include dollar figures with $ sign. Round to nearest $100.
- Frame as "your business" and "you've proven".
- Lead with what's making money (best-first).
- Be specific about engine/spec when data shows it (e.g., "Diesel 4x4", "V8 turbo diesel").

OUTPUT: Return valid JSON matching this EXACT schema:
{
  "executive_summary": "string — 2-4 sentences. Total sales count, net profit, avg profit per vehicle, % profitable. Key insight about what drives profit (e.g. 'Profits driven by premium-spec diesel 4x4 utes; base models break even or lose').",
  "proven_fingerprints": [
    {
      "make": "string",
      "model": "string",
      "badge_variant": "string — specific badge/series/variant (e.g. VX, XLT, ST-X, Sahara)",
      "engine_spec": "string or null — e.g. V8 Diesel, TDI580, Bi-Turbo",
      "count": number,
      "avg_profit": number,
      "total_profit": number,
      "avg_days": number,
      "turnover_speed": "Fast|Medium|Slow",
      "recommendation": "string — short actionable note"
    }
  ],
  "loss_patterns": [
    "string — specific loss pattern with badge (e.g. 'Base GLX-R Triton loses $1k-$3k per unit')"
  ],
  "km_insight": {
    "has_km_data": boolean,
    "summary": "string — KM band insight or 'KM rarely reported — recommend adding odometer to future uploads'"
  },
  "recommendations": [
    "string — specific actionable recommendation referencing badge/variant"
  ],
  "comparison_note": "string or null — only if data suggests cross-dealer patterns",
  "warnings": ["string — data quality warnings only"]
}

PROVEN FINGERPRINTS RULES:
- Sort by total_profit descending
- Include up to 10 entries
- Turnover Speed: "Fast" if avg_days < 60, "Medium" if 60-120, "Slow" if > 120
- Always specify the badge/variant — never leave it as just the model name
- If a vehicle sold only once, still include it if profit > $3000

LOSS PATTERNS:
- 3-6 bullet items
- Reference specific badge/variant (e.g., "XL Ranger", "RX Navara")
- Include typical loss range in dollars

RECOMMENDATIONS:
- 3-5 items
- "Prioritize [specific badge] in sourcing"
- "Avoid [specific badge] — consistent losses"
- Reference fingerprints by badge name

Keep total output under 500 words. Be concise, commercial, dealer-focused.`,
          },
          {
            role: "user",
            content: `Analyse this dealer's complete sales data and produce the deep assessment.\n\n${JSON.stringify(factsPayload, null, 2)}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 3000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI assessment call failed:", aiRes.status, errText);

      // Handle rate limits
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          executive_summary: "",
          proven_fingerprints: [],
          loss_patterns: [],
          km_insight: null,
          recommendations: [],
          comparison_note: null,
          warnings: ["Assessment temporarily unavailable."],
          summary: [], core_engines: [], shape_winners: [], outcome_signals: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from AI response
    let assessment: any;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      assessment = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse AI assessment JSON:", e, "Raw:", content);
      assessment = {
        executive_summary: "",
        proven_fingerprints: [],
        loss_patterns: [],
        km_insight: null,
        recommendations: [],
        comparison_note: null,
        warnings: ["Assessment format error. Raw data is still available below."],
      };
    }

    // Enforce schema shape and limits
    const result = {
      executive_summary: typeof assessment.executive_summary === "string" ? assessment.executive_summary : "",
      proven_fingerprints: Array.isArray(assessment.proven_fingerprints) ? assessment.proven_fingerprints.slice(0, 10) : [],
      loss_patterns: Array.isArray(assessment.loss_patterns) ? assessment.loss_patterns.slice(0, 6) : [],
      km_insight: assessment.km_insight || null,
      recommendations: Array.isArray(assessment.recommendations) ? assessment.recommendations.slice(0, 5) : [],
      comparison_note: typeof assessment.comparison_note === "string" ? assessment.comparison_note : null,
      warnings: Array.isArray(assessment.warnings) ? assessment.warnings.slice(0, 4) : [],
      // Legacy compat
      summary: [],
      core_engines: [],
      shape_winners: [],
      outcome_signals: [],
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sales-assessment error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
