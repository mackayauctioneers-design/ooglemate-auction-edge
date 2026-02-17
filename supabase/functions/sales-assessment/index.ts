import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// SALES-ASSESSMENT v3 — Deep badge-level AI assessment with server-side
// aggregation, KM awareness, and cross-dealer comparison.
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Server-side aggregation helpers ──

interface RawSale {
  make: string;
  model: string;
  variant: string | null;
  badge: string | null;
  series: string | null;
  description_raw: string | null;
  year: number | null;
  km: number | null;
  sale_price: number | null;
  buy_price: number | null;
  days_to_clear: number | null;
  sold_at: string | null;
  body_type: string | null;
  transmission: string | null;
  fuel_type: string | null;
}

interface AggBadge {
  make: string;
  model: string;
  badge: string;
  engine_hint: string | null;
  count: number;
  total_profit: number;
  avg_profit: number;
  avg_days: number;
  avg_km: number | null;
  km_count: number;
  losses: number;
  profits: number[];
}

function extractBadge(r: RawSale): string {
  // Prefer badge, then variant, then series, fallback to description snippet
  if (r.badge && r.badge.trim()) return r.badge.trim();
  if (r.variant && r.variant.trim()) return r.variant.trim();
  if (r.series && r.series.trim()) return r.series.trim();
  // Try to extract from description_raw (first meaningful word after make/model)
  if (r.description_raw) {
    const desc = r.description_raw.trim();
    // Common pattern: "2021 Toyota Landcruiser VDJ200R VX" — extract after model
    const parts = desc.split(/\s+/);
    if (parts.length >= 4) {
      // Skip year, make, model — take the rest
      return parts.slice(3).join(" ").substring(0, 40);
    }
  }
  return "(unspecified)";
}

function extractEngineHint(r: RawSale): string | null {
  const desc = r.description_raw || "";
  // Match common engine codes
  const engineMatch = desc.match(/\b(\d\.\d[A-Z]{1,3}(?:\d{2,3})?|V[468]\s*(?:Turbo\s*)?(?:Diesel)?|TDI\d{2,3}|[A-Z]{2,3}\d{3,4})\b/i);
  if (engineMatch) return engineMatch[1];
  if (r.fuel_type?.toLowerCase() === "diesel") return "Diesel";
  return null;
}

function aggregateBadges(sales: RawSale[]): AggBadge[] {
  const map: Record<string, AggBadge> = {};

  for (const r of sales) {
    if (!r.make || !r.model) continue;
    const badge = extractBadge(r);
    const profit = (r.sale_price != null && r.buy_price != null) ? r.sale_price - r.buy_price : null;
    const key = `${r.make}|${r.model}|${badge}`;

    if (!map[key]) {
      map[key] = {
        make: r.make,
        model: r.model,
        badge,
        engine_hint: extractEngineHint(r),
        count: 0,
        total_profit: 0,
        avg_profit: 0,
        avg_days: 0,
        avg_km: null,
        km_count: 0,
        losses: 0,
        profits: [],
      };
    }
    const agg = map[key];
    agg.count++;
    if (profit != null) {
      agg.total_profit += profit;
      agg.profits.push(profit);
      if (profit < 0) agg.losses++;
    }
    if (r.days_to_clear != null) agg.avg_days += r.days_to_clear;
    if (r.km != null && r.km > 0) {
      agg.km_count++;
      agg.avg_km = (agg.avg_km || 0) + r.km;
    }
    // Update engine hint if better one found
    if (!agg.engine_hint) agg.engine_hint = extractEngineHint(r);
  }

  // Finalize averages
  return Object.values(map).map((a) => ({
    ...a,
    avg_profit: a.profits.length > 0 ? Math.round(a.total_profit / a.profits.length) : 0,
    avg_days: a.count > 0 ? Math.round(a.avg_days / a.count) : 0,
    avg_km: a.km_count > 0 ? Math.round((a.avg_km || 0) / a.km_count) : null,
    total_profit: Math.round(a.total_profit),
  }));
}

function computeOverallStats(sales: RawSale[]) {
  let totalProfit = 0;
  let profitCount = 0;
  let positiveCount = 0;
  let hasKm = 0;

  for (const r of sales) {
    if (r.sale_price != null && r.buy_price != null) {
      const p = r.sale_price - r.buy_price;
      totalProfit += p;
      profitCount++;
      if (p > 0) positiveCount++;
    }
    if (r.km != null && r.km > 0) hasKm++;
  }

  return {
    total_sales: sales.length,
    net_profit: Math.round(totalProfit),
    avg_profit: profitCount > 0 ? Math.round(totalProfit / profitCount) : 0,
    pct_profitable: profitCount > 0 ? Math.round((positiveCount / profitCount) * 100) : 0,
    sales_with_profit_data: profitCount,
    sales_with_km: hasKm,
    km_coverage_pct: sales.length > 0 ? Math.round((hasKm / sales.length) * 100) : 0,
  };
}

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

    // ── Fetch raw sales for this account + other accounts for comparison ──
    const [rawSalesRes, otherAccountsRes] = await Promise.all([
      supabase
        .from("vehicle_sales_truth")
        .select("make, model, variant, badge, year, km, sale_price, buy_price, days_to_clear, sold_at, series, body_type, transmission, fuel_type, description_raw")
        .eq("account_id", account_id)
        .order("sold_at", { ascending: false })
        .limit(800),
      // Fetch top sellers from OTHER accounts for comparison
      supabase
        .from("sales_clearance_velocity")
        .select("account_id, make, model, variant, sales_count, median_profit_dollars")
        .neq("account_id", account_id)
        .order("sales_count", { ascending: false })
        .limit(30),
    ]);

    const rawSales = (rawSalesRes.data || []) as RawSale[];

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
          summary: [], core_engines: [], shape_winners: [], outcome_signals: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Server-side aggregation ──
    const overallStats = computeOverallStats(rawSales);
    const badgeAggs = aggregateBadges(rawSales);

    // Top winners (sorted by total_profit desc)
    const topWinners = [...badgeAggs]
      .filter((a) => a.total_profit > 0)
      .sort((a, b) => b.total_profit - a.total_profit)
      .slice(0, 12);

    // Loss makers
    const lossMakers = [...badgeAggs]
      .filter((a) => a.avg_profit < 0)
      .sort((a, b) => a.avg_profit - b.avg_profit)
      .slice(0, 8);

    // KM stats on winners
    const winnersWithKm = topWinners.filter((w) => w.avg_km != null);
    const avgKmWinners = winnersWithKm.length > 0
      ? Math.round(winnersWithKm.reduce((s, w) => s + (w.avg_km || 0), 0) / winnersWithKm.length)
      : null;

    // Cross-dealer comparison data
    const otherTopSellers = (otherAccountsRes.data || []) as any[];
    // Find overlapping models between this dealer and others
    const thisModels = new Set(topWinners.map((w) => `${w.make}|${w.model}`));
    const crossOverlap = otherTopSellers
      .filter((o: any) => thisModels.has(`${o.make}|${o.model}`))
      .slice(0, 5);

    // ── Build compact facts for AI ──
    const factsPayload = {
      overall: overallStats,
      top_winners: topWinners.map((w) => ({
        make: w.make,
        model: w.model,
        badge: w.badge,
        engine: w.engine_hint,
        count: w.count,
        avg_profit: w.avg_profit,
        total_profit: w.total_profit,
        avg_days: w.avg_days,
        avg_km: w.avg_km,
        loss_rate: w.count > 0 ? `${Math.round((w.losses / w.count) * 100)}%` : "0%",
      })),
      loss_makers: lossMakers.map((l) => ({
        make: l.make,
        model: l.model,
        badge: l.badge,
        count: l.count,
        avg_profit: l.avg_profit,
        total_profit: l.total_profit,
        avg_days: l.avg_days,
      })),
      km_stats: {
        coverage_pct: overallStats.km_coverage_pct,
        avg_km_on_winners: avgKmWinners,
        winners_with_km: winnersWithKm.length,
      },
      cross_dealer_overlap: crossOverlap.length > 0
        ? crossOverlap.map((o: any) => ({
            make: o.make,
            model: o.model,
            variant: o.variant,
            other_count: o.sales_count,
            other_median_profit: o.median_profit_dollars,
          }))
        : null,
    };

    // ── Call Lovable AI ──
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
            content: `You are a senior automotive buying analyst — a deal captain briefing a head buyer at a used car dealership.

TASK: Produce a DEEP, ACTIONABLE sales assessment from the pre-aggregated data provided.

CRITICAL RULES:
- READ-ONLY. NEVER invent numbers. Only use what is provided.
- ALWAYS reference specific badge/variant (e.g. "VX Landcruiser", "XLT Ranger", "ST-X Navara") — NEVER generic "Toyota Landcruiser".
- Dollar figures with $ sign, rounded to nearest $100.
- Frame as "your business" and "you've proven".
- Best-first ordering (highest profit first).
- Be specific about engine/drivetrain when data shows it.

OUTPUT: Return valid JSON matching this EXACT schema:
{
  "executive_summary": "string — 3-5 sentences. MUST include: total sales count, net profit, avg profit per vehicle, % profitable vehicles. Then a key insight about what drives profit pattern (e.g. 'Profits driven by premium-spec diesel 4x4 utes and SUVs; base/low-spec models frequently break even or lose.').",
  "proven_fingerprints": [
    {
      "make": "string",
      "model": "string",
      "badge_variant": "string — the specific badge/series/variant name",
      "engine_spec": "string or null",
      "avg_km": number or null,
      "count": number,
      "avg_profit": number,
      "total_profit": number,
      "avg_days": number,
      "turnover_speed": "Fast|Medium|Slow",
      "recommendation": "string — short actionable sourcing note"
    }
  ],
  "loss_patterns": ["string — each must name specific badge and dollar range"],
  "km_insight": {
    "has_km_data": boolean,
    "summary": "string"
  },
  "recommendations": ["string — each must reference a specific badge/variant"],
  "comparison_note": "string or null",
  "warnings": ["string — data quality only"]
}

PROVEN FINGERPRINTS:
- Use the pre-aggregated top_winners data directly. Sort by total_profit desc.
- Up to 10 entries.
- Turnover Speed: "Fast" if avg_days < 60, "Medium" if 60-120, "Slow" if > 120.
- ALWAYS use the badge field — never collapse to just make/model.
- Include avg_km if available (null if not).

LOSS PATTERNS (3-6 bullets):
- Use the loss_makers data. Name specific badge (e.g. "GLX-R Triton", "XL Ranger").
- Include dollar range (e.g. "loses $1,000-$3,000 per unit").

KM INSIGHT:
- If km_stats.coverage_pct < 20: return has_km_data=false, summary="KM rarely reported — recommend adding odometer to future uploads for tighter matching."
- If coverage is decent: summarize avg_km on winners and note bands.

COMPARISON (comparison_note):
- If cross_dealer_overlap is provided and has entries: note which models appear across dealers with similar profit patterns.
- If null: set comparison_note to null.

RECOMMENDATIONS (3-5 items):
- "Prioritize [badge] [model] in sourcing — proven $X avg profit"
- "Avoid [badge] [model] — consistent $X losses"
- "Check traps for [model] — low supply vs high win rate"

Keep under 600 words total. Concise, commercial, replication-oriented.`,
          },
          {
            role: "user",
            content: `Here is the pre-aggregated sales data. Produce the assessment.\n\n${JSON.stringify(factsPayload)}`,
          },
        ],
        temperature: 0.15,
        max_tokens: 3000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI assessment call failed:", aiRes.status, errText);

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

      // Fallback: return server-aggregated data without AI narrative
      return new Response(
        JSON.stringify({
          executive_summary: `${overallStats.total_sales} sales analysed. Net profit: $${overallStats.net_profit.toLocaleString()}. Average profit: $${overallStats.avg_profit.toLocaleString()} per vehicle. ${overallStats.pct_profitable}% of vehicles were profitable.`,
          proven_fingerprints: topWinners.slice(0, 10).map((w) => ({
            make: w.make,
            model: w.model,
            badge_variant: w.badge,
            engine_spec: w.engine_hint,
            avg_km: w.avg_km,
            count: w.count,
            avg_profit: w.avg_profit,
            total_profit: w.total_profit,
            avg_days: w.avg_days,
            turnover_speed: w.avg_days < 60 ? "Fast" : w.avg_days <= 120 ? "Medium" : "Slow",
            recommendation: w.avg_profit >= 3000 ? "High-priority sourcing target" : "Worth repeating",
          })),
          loss_patterns: lossMakers.slice(0, 6).map((l) =>
            `${l.badge} ${l.model} (${l.make}) — avg loss $${Math.abs(l.avg_profit).toLocaleString()} across ${l.count} sale${l.count > 1 ? "s" : ""}`
          ),
          km_insight: overallStats.km_coverage_pct < 20
            ? { has_km_data: false, summary: "KM rarely reported — recommend adding odometer to future uploads for tighter matching." }
            : { has_km_data: true, summary: avgKmWinners ? `Winners average ${avgKmWinners.toLocaleString()} km at sale.` : "KM data available but limited on top winners." },
          recommendations: topWinners.slice(0, 3).map((w) =>
            `Prioritize ${w.badge} ${w.model} in sourcing — proven $${w.avg_profit.toLocaleString()} avg profit`
          ),
          comparison_note: null,
          warnings: ["AI narrative unavailable — showing raw aggregated data."],
          summary: [], core_engines: [], shape_winners: [], outcome_signals: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let assessment: any;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      assessment = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse AI assessment JSON:", e, "Raw:", content);
      // Return server-side aggregated fallback
      assessment = {
        executive_summary: `${overallStats.total_sales} sales analysed. Net profit: $${overallStats.net_profit.toLocaleString()}. Average profit: $${overallStats.avg_profit.toLocaleString()} per vehicle.`,
        proven_fingerprints: topWinners.slice(0, 10).map((w) => ({
          make: w.make, model: w.model, badge_variant: w.badge, engine_spec: w.engine_hint,
          avg_km: w.avg_km, count: w.count, avg_profit: w.avg_profit, total_profit: w.total_profit,
          avg_days: w.avg_days, turnover_speed: w.avg_days < 60 ? "Fast" : w.avg_days <= 120 ? "Medium" : "Slow",
          recommendation: "Sourcing target",
        })),
        loss_patterns: lossMakers.slice(0, 6).map((l) => `${l.badge} ${l.model} — avg loss $${Math.abs(l.avg_profit).toLocaleString()}`),
        km_insight: { has_km_data: overallStats.km_coverage_pct >= 20, summary: avgKmWinners ? `Winners average ${avgKmWinners.toLocaleString()} km` : "Limited KM data" },
        recommendations: [],
        comparison_note: null,
        warnings: ["AI narrative parse error — showing aggregated data."],
      };
    }

    const result = {
      executive_summary: typeof assessment.executive_summary === "string" ? assessment.executive_summary : "",
      proven_fingerprints: Array.isArray(assessment.proven_fingerprints) ? assessment.proven_fingerprints.slice(0, 10) : [],
      loss_patterns: Array.isArray(assessment.loss_patterns) ? assessment.loss_patterns.slice(0, 6) : [],
      km_insight: assessment.km_insight || null,
      recommendations: Array.isArray(assessment.recommendations) ? assessment.recommendations.slice(0, 5) : [],
      comparison_note: typeof assessment.comparison_note === "string" ? assessment.comparison_note : null,
      warnings: Array.isArray(assessment.warnings) ? assessment.warnings.slice(0, 4) : [],
      summary: [], core_engines: [], shape_winners: [], outcome_signals: [],
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
