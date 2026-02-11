import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// SALES-ASSESSMENT — Read-only AI interpretation of pre-computed sales data
// Reads: clearance velocity, target candidates, unexpected winners, sales scope
// Returns: structured narrative assessment (never writes data)
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
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Gather all pre-computed facts (read-only) ──
    const [clearanceRes, targetsRes, salesScopeRes, variationRes] = await Promise.all([
      supabase
        .from("sales_clearance_velocity")
        .select("make, model, variant, sales_count, median_days_to_clear, median_profit_dollars, median_profit_pct, pct_under_30, pct_under_60")
        .eq("account_id", account_id)
        .order("sales_count", { ascending: false })
        .limit(20),
      supabase
        .from("sales_target_candidates")
        .select("make, model, variant, sales_count, median_profit, median_profit_pct, median_days_to_clear, target_score, fingerprint_type, confidence_level, spec_completeness, transmission, fuel_type, drive_type, body_type")
        .eq("account_id", account_id)
        .in("status", ["candidate", "active"])
        .order("target_score", { ascending: false })
        .limit(30),
      supabase
        .from("vehicle_sales_truth")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account_id),
      supabase
        .from("sales_variation_performance")
        .select("make, model, variant, transmission, fuel_type, body_type, sales_count, median_days_to_clear, median_profit_dollars, median_profit_pct")
        .eq("account_id", account_id)
        .order("sales_count", { ascending: false })
        .limit(30),
    ]);

    const clearance = clearanceRes.data || [];
    const targets = targetsRes.data || [];
    const totalSales = salesScopeRes.count || 0;
    const variations = variationRes.data || [];

    if (totalSales < 5) {
      return new Response(
        JSON.stringify({
          summary: [],
          core_engines: [],
          shape_winners: [],
          outcome_signals: [],
          warnings: ["Not enough sales data for a meaningful assessment. Upload more sales history."],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build the facts payload for the AI ──
    const factsPayload = {
      total_sales_records: totalSales,
      clearance_velocity_top_20: clearance.map((c: any) => ({
        make: c.make,
        model: c.model,
        variant: c.variant,
        sales_count: c.sales_count,
        median_days_to_clear: c.median_days_to_clear,
        median_profit_dollars: c.median_profit_dollars,
        median_profit_pct: c.median_profit_pct,
        pct_under_30_days: c.pct_under_30,
        pct_under_60_days: c.pct_under_60,
      })),
      target_candidates: targets.map((t: any) => ({
        make: t.make,
        model: t.model,
        variant: t.variant,
        specs: [t.transmission, t.fuel_type, t.drive_type, t.body_type].filter(Boolean).join(", "),
        sales_count: t.sales_count,
        median_profit: t.median_profit,
        median_days_to_clear: t.median_days_to_clear,
        target_score: t.target_score,
        fingerprint_type: t.fingerprint_type,
        confidence_level: t.confidence_level,
        spec_completeness: t.spec_completeness,
      })),
      variation_performance_top_30: variations.map((v: any) => ({
        make: v.make,
        model: v.model,
        variant: v.variant,
        transmission: v.transmission,
        fuel_type: v.fuel_type,
        body_type: v.body_type,
        sales_count: v.sales_count,
        median_days_to_clear: v.median_days_to_clear,
        median_profit_dollars: v.median_profit_dollars,
        median_profit_pct: v.median_profit_pct,
      })),
    };

    // ── Call AI to interpret (read-only analysis) ──
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a senior automotive buying analyst — a deal captain, not a compliance officer.

TONE: Commercial, decisive, buyer-oriented. You're briefing a head buyer, not writing a report.
- Lead with what's making money.
- Be direct about what to hunt.
- No excessive caveats or hedging when data is clear.

HARD RULES:
- You are READ-ONLY. You NEVER create, modify, or score data.
- You NEVER invent numbers — only reference what is provided.
- Distinguish HIGH volume repeatable sellers from LOW volume profitable outcomes.
- High sales counts with low spec completeness = MIXED TRIMS — say so.
- A vehicle with 2 sales is an outcome signal, not a core seller.
- Frame as "your numbers show" or "you've proven."
- Lead with what's working (best-first ordering).

OUTPUT FORMAT: Return valid JSON matching this exact schema:
{
  "summary": ["string — 3-5 punchy observations, buyer tone, each under 15 words"],
  "core_engines": [{"vehicle": "string", "reason": "string — why this prints money", "confidence": "HIGH|MEDIUM"}],
  "shape_winners": [{"vehicle": "string with year range", "signal": "string — what the edge is", "note": "string — buy ceiling or context", "confidence": "MEDIUM|HIGH"}],
  "outcome_signals": [{"vehicle": "string", "signal": "string — what happened", "instruction": "string — what to do if it appears again", "confidence": "LOW"}],
  "warnings": ["string — data gaps only, keep it brief"]
}

Keep it tight. Maximum 4 core_engines, 4 shape_winners, 4 outcome_signals, 3 warnings.
If a category has no entries, return an empty array.`,
          },
          {
            role: "user",
            content: `Here is the pre-computed sales data for this dealer account. Interpret it.\n\n${JSON.stringify(factsPayload, null, 2)}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!aiRes.ok) {
      console.error("AI assessment call failed:", aiRes.status, await aiRes.text());
      return new Response(
        JSON.stringify({
          summary: [],
          core_engines: [],
          shape_winners: [],
          outcome_signals: [],
          warnings: ["Assessment temporarily unavailable."],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from AI response (may be wrapped in markdown code block)
    let assessment;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      assessment = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse AI assessment JSON:", e, "Raw:", content);
      assessment = {
        summary: [],
        core_engines: [],
        shape_winners: [],
        outcome_signals: [],
        warnings: ["Assessment format error. Raw data is still available below."],
      };
    }

    // Enforce schema shape
    const result = {
      summary: Array.isArray(assessment.summary) ? assessment.summary.slice(0, 5) : [],
      core_engines: Array.isArray(assessment.core_engines) ? assessment.core_engines.slice(0, 4) : [],
      shape_winners: Array.isArray(assessment.shape_winners) ? assessment.shape_winners.slice(0, 4) : [],
      outcome_signals: Array.isArray(assessment.outcome_signals) ? assessment.outcome_signals.slice(0, 4) : [],
      warnings: Array.isArray(assessment.warnings) ? assessment.warnings.slice(0, 3) : [],
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
