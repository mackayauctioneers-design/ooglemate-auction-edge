import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// BOB-SALES-TRUTH — Governed reasoning engine over dealer sales data
// Architecture: Intent Classifier → Evidence Builder → Bob-Core (AI) → Response
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── BOB'S OPERATING CONSTITUTION v1.0 ──
const BOB_CONSTITUTION = `
BOB'S OPERATING CONSTITUTION — Carbitrage v1.0

PURPOSE: Bob exists to convert dealer sales truth into sourcing action.
Bob does not predict markets. Bob does not give opinions.

HARD RULES:
1. Sales truth is the only authority. Bob may only reason from the dealer's own sales data. Market averages, listings, or external guides are never authoritative.
2. A single profitable sale is valid intelligence. One profitable outcome must be surfaced, not discarded. Low sample size reduces confidence, not importance.
3. Repeatability increases confidence, not relevance. High volume = higher confidence. Low volume ≠ low value.
4. Outliers must be remembered. Dealers forget winners. Bob's job is to remember them.
5. Bob must always explain WHY. Every answer must include: what happened, why it matters, how confident we are, what action to take.
6. Bob must state uncertainty explicitly: "Based on one sale", "Based on limited evidence", "Strong outcome, low repeatability so far".
7. Bob outputs sourcing instructions, not observations: "You should watch for…", "This should be hunted…", "This should be re-tested…"

FORBIDDEN BEHAVIOURS:
- Never rank cars purely by volume
- Never ignore profitable single outcomes
- Never speak in absolutes without data
- Never suggest cars the dealer has never sold
- Never hide weak data behind averages
- Never say "market value", "estimated value", "we recommend", "you should consider", "we think", "suggested", "on average dealers do"

REQUIRED LANGUAGE:
- "Based on your sales…"
- "You've proven…"
- "In your data…"
- "This outcome occurred…"
- "You have [N] completed sales showing…"
`.trim();

// ── INTENT TAXONOMY ──
type BobIntent =
  | "winner_identification"
  | "forgotten_winners"
  | "replication_strategy"
  | "risk_confidence"
  | "freeform";

function classifyIntent(question: string): BobIntent {
  const q = question.toLowerCase();

  // Forgotten / hidden winners
  if (
    q.includes("forgot") ||
    q.includes("only sold once") ||
    q.includes("hidden") ||
    q.includes("overlooked") ||
    q.includes("one sale") ||
    q.includes("singleton") ||
    q.includes("outlier") ||
    q.includes("surprising") ||
    q.includes("remember")
  ) {
    return "forgotten_winners";
  }

  // Replication / sourcing strategy
  if (
    q.includes("buy again") ||
    q.includes("hunt") ||
    q.includes("source") ||
    q.includes("watch") ||
    q.includes("should be buying") ||
    q.includes("look for") ||
    q.includes("try to buy") ||
    q.includes("replicate") ||
    q.includes("repeat")
  ) {
    return "replication_strategy";
  }

  // Risk / confidence
  if (
    q.includes("risk") ||
    q.includes("unsure") ||
    q.includes("confident") ||
    q.includes("variance") ||
    q.includes("slow") ||
    q.includes("worst") ||
    q.includes("longest") ||
    q.includes("problem")
  ) {
    return "risk_confidence";
  }

  // Winner identification
  if (
    q.includes("best") ||
    q.includes("most profitable") ||
    q.includes("top") ||
    q.includes("winner") ||
    q.includes("strongest") ||
    q.includes("fastest") ||
    q.includes("money") ||
    q.includes("profit") ||
    q.includes("quickly") ||
    q.includes("reliable") ||
    q.includes("repeatable")
  ) {
    return "winner_identification";
  }

  return "freeform";
}

const INTENT_INSTRUCTIONS: Record<BobIntent, string> = {
  winner_identification: `INTENT: Winner Identification
The dealer wants to know their proven winners.
EVIDENCE FOCUS: Core fingerprints, volume, clearance speed, margin (absolute + %).
PRIORITY: Show repeatable, high-confidence vehicles first. Always include variant/year/drivetrain detail.`,

  forgotten_winners: `INTENT: Forgotten / Hidden Winners
The dealer wants to find profitable vehicles they may have overlooked.
EVIDENCE FOCUS: Outcome fingerprints, single-sale profits, profit percentile vs dealer median.
PRIORITY: Surface low-frequency but high-profit vehicles. A single $3k profit sale is a SIGNAL, not noise. These must be presented as "worth watching and re-testing".`,

  replication_strategy: `INTENT: Replication Strategy
The dealer wants sourcing instructions — what to actively hunt.
EVIDENCE FOCUS: Both core AND outcome fingerprints, variant/drivetrain/year DNA, sourcing channels.
PRIORITY: Convert insights into actionable instructions. Each item must say WHAT to look for and WHERE (auctions, dealer stock, Pickles, Manheim).`,

  risk_confidence: `INTENT: Risk & Confidence Assessment
The dealer wants to understand uncertainty in their data.
EVIDENCE FOCUS: Low sample sizes, high variance, long clearance, thin-margin vehicles.
PRIORITY: Be honest about data gaps. State confidence levels explicitly.`,

  freeform: `INTENT: Free-form Query
Map the question to the most relevant evidence available. Always follow the constitution and 3-part response format.`,
};

// ── Median helper ──
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { question, accountId } = await req.json();
    if (!question || !accountId) {
      return new Response(
        JSON.stringify({ error: "question and accountId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 1. Classify intent ──
    const intent = classifyIntent(question);
    console.log(`[BOB] Intent: ${intent} | Question: "${question.slice(0, 80)}"`);

    // ── 2. Fetch dealer context ──
    const { data: account } = await supabase
      .from("accounts")
      .select("display_name")
      .eq("id", accountId)
      .single();

    // ── 3. Evidence Builder — fetch all relevant data in parallel ──
    const [salesRes, candidatesRes] = await Promise.all([
      supabase
        .from("vehicle_sales_truth")
        .select("make, model, year, variant, body_type, fuel_type, transmission, drive_type, km, buy_price, sale_price, days_to_clear, sold_at")
        .eq("account_id", accountId)
        .order("sold_at", { ascending: false })
        .limit(500),
      supabase
        .from("sales_target_candidates")
        .select("make, model, variant, transmission, fuel_type, drive_type, body_type, sales_count, median_profit, median_profit_pct, median_days_to_clear, target_score, fingerprint_type, confidence_level")
        .eq("account_id", accountId)
        .in("status", ["candidate", "active"])
        .order("target_score", { ascending: false })
        .limit(50),
    ]);

    const sales = (salesRes.data || []) as any[];
    const candidates = (candidatesRes.data || []) as any[];

    // ── 4. Compute evidence summaries ──
    const totalSales = sales.length;
    const withProfit = sales.filter((s: any) => s.buy_price != null && s.sale_price != null);
    const withClearance = sales.filter((s: any) => s.days_to_clear != null);

    // Variant-level grouping (Make → Model → Variant → Year Band → Drivetrain)
    type VehicleGroup = {
      count: number;
      profits: number[];
      days: number[];
      years: number[];
      variants: Set<string>;
      drivetrains: Set<string>;
      fuels: Set<string>;
      transmissions: Set<string>;
    };

    const modelGroups: Record<string, VehicleGroup> = {};
    const variantGroups: Record<string, VehicleGroup> = {};

    sales.forEach((s: any) => {
      const modelKey = `${s.make} ${s.model}`;
      const variantKey = `${s.year} ${s.make} ${s.model} ${s.variant || ""} ${s.drive_type || ""}`.trim();
      const profit = (s.buy_price != null && s.sale_price != null) ? s.sale_price - s.buy_price : null;

      // Model level
      if (!modelGroups[modelKey]) modelGroups[modelKey] = { count: 0, profits: [], days: [], years: [], variants: new Set(), drivetrains: new Set(), fuels: new Set(), transmissions: new Set() };
      const mg = modelGroups[modelKey];
      mg.count++;
      if (profit != null) mg.profits.push(profit);
      if (s.days_to_clear != null) mg.days.push(s.days_to_clear);
      if (s.year) mg.years.push(s.year);
      if (s.variant) mg.variants.add(s.variant);
      if (s.drive_type) mg.drivetrains.add(s.drive_type);
      if (s.fuel_type) mg.fuels.add(s.fuel_type);
      if (s.transmission) mg.transmissions.add(s.transmission);

      // Variant level
      if (!variantGroups[variantKey]) variantGroups[variantKey] = { count: 0, profits: [], days: [], years: [], variants: new Set(), drivetrains: new Set(), fuels: new Set(), transmissions: new Set() };
      const vg = variantGroups[variantKey];
      vg.count++;
      if (profit != null) vg.profits.push(profit);
      if (s.days_to_clear != null) vg.days.push(s.days_to_clear);
    });

    // Top models with full DNA
    const topModels = Object.entries(modelGroups)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([vehicle, g]) => {
        const yearMin = Math.min(...g.years);
        const yearMax = Math.max(...g.years);
        const yearBand = yearMin === yearMax ? `${yearMin}` : `${yearMin}-${yearMax}`;
        return {
          vehicle,
          count: g.count,
          yearBand,
          variants: [...g.variants].join(", ") || "N/A",
          drivetrains: [...g.drivetrains].join(", ") || "N/A",
          fuels: [...g.fuels].join(", ") || "N/A",
          transmissions: [...g.transmissions].join(", ") || "N/A",
          medianProfit: median(g.profits),
          medianDays: median(g.days),
        };
      });

    // Singleton / low-frequency profitable wins
    const singleWinners = withProfit
      .filter((s: any) => {
        const profit = s.sale_price - s.buy_price;
        const key = `${s.make} ${s.model}`;
        return profit >= 1500 && (modelGroups[key]?.count || 0) <= 2;
      })
      .slice(0, 15)
      .map((s: any) => ({
        vehicle: `${s.year} ${s.make} ${s.model} ${s.variant || ""} ${s.drive_type || ""}`.trim(),
        profit: s.sale_price - s.buy_price,
        profitPct: s.buy_price > 0 ? Math.round(((s.sale_price - s.buy_price) / s.buy_price) * 100) : null,
        days: s.days_to_clear,
        km: s.km,
        transmission: s.transmission,
        fuel: s.fuel_type,
      }));

    // Core vs outcome fingerprint targets
    const coreTargets = candidates.filter((c: any) => c.fingerprint_type === "core");
    const outcomeTargets = candidates.filter((c: any) => c.fingerprint_type === "outcome");

    // ── 5. Build evidence context block ──
    const dealerName = account?.display_name || "this dealer";
    const contextBlock = `
DEALER: ${dealerName}
TOTAL SALES IN DATABASE: ${totalSales}
SALES WITH FULL OUTCOME DATA (buy + sell price): ${withProfit.length}
SALES WITH CLEARANCE TIME: ${withClearance.length}
DATA COVERAGE: ${withProfit.length > 0 ? Math.round((withProfit.length / totalSales) * 100) : 0}% of sales have full outcome data

═══ REPEATABLE WINNERS (by volume, with full DNA) ═══
${topModels.map((m) =>
  `• ${m.vehicle} (${m.yearBand}): ${m.count} sales | Variants: ${m.variants} | Drivetrain: ${m.drivetrains} | Fuel: ${m.fuels} | Trans: ${m.transmissions} | Median margin: ${m.medianProfit != null ? "$" + m.medianProfit.toLocaleString() : "N/A"} | Median clearance: ${m.medianDays != null ? m.medianDays + "d" : "N/A"}`
).join("\n")}

═══ PROFITABLE SINGLE/LOW-FREQUENCY WINS (Outcome Fingerprints) ═══
${singleWinners.length ? singleWinners.map((w) =>
  `• ${w.vehicle}: $${w.profit.toLocaleString()} profit${w.profitPct != null ? " (" + w.profitPct + "%)" : ""}${w.days != null ? " | " + w.days + "d clearance" : ""}${w.km != null ? " | " + w.km.toLocaleString() + "km" : ""}${w.transmission ? " | " + w.transmission : ""}${w.fuel ? " | " + w.fuel : ""}`
).join("\n") : "None detected yet — more sales data needed."}

═══ ACTIVE CORE TARGETS (repeatable sourcing signals) ═══
${coreTargets.length ? coreTargets.slice(0, 15).map((c: any) =>
  `• ${c.make} ${c.model} ${c.variant || ""} ${c.drive_type || ""} [${c.confidence_level} confidence] | ${c.sales_count} sales | Median profit: ${c.median_profit != null ? "$" + c.median_profit : "N/A"} | Clearance: ${c.median_days_to_clear != null ? c.median_days_to_clear + "d" : "N/A"} | Score: ${c.target_score}`
).join("\n") : "None generated yet."}

═══ ACTIVE OUTCOME TARGETS (singleton wins worth re-testing) ═══
${outcomeTargets.length ? outcomeTargets.slice(0, 10).map((c: any) =>
  `• ${c.make} ${c.model} ${c.variant || ""} ${c.drive_type || ""} [outcome] | ${c.sales_count} sale(s) | Median profit: ${c.median_profit != null ? "$" + c.median_profit : "N/A"} | Clearance: ${c.median_days_to_clear != null ? c.median_days_to_clear + "d" : "N/A"}`
).join("\n") : "None generated yet."}

═══ RAW SALES DATA (last 50 for detail queries) ═══
${sales.slice(0, 50).map((s: any) =>
  `${s.year} ${s.make} ${s.model} ${s.variant || ""} | ${s.drive_type || ""} ${s.transmission || ""} ${s.fuel_type || ""} | sold ${s.sold_at?.slice(0, 10) || "?"} | buy $${s.buy_price ?? "?"} sell $${s.sale_price ?? "?"} | ${s.days_to_clear != null ? s.days_to_clear + "d" : "?"} | ${s.km != null ? s.km.toLocaleString() + "km" : "?"}`
).join("\n")}
`.trim();

    // ── 6. Compose system prompt with constitution + intent ──
    const intentDirective = INTENT_INSTRUCTIONS[intent];

    const systemPrompt = `${BOB_CONSTITUTION}

═══ CURRENT INTENT ═══
${intentDirective}

═══ RESPONSE FORMAT (mandatory) ═══
Every response MUST follow this exact 3-part structure:

**1. DIRECT ANSWER**
Plain English, confident, dealer-style. Lead with the answer.

**2. EVIDENCE**
Concrete facts only — counts, margins, clearance days, profit %, examples with full vehicle DNA (year, make, model, variant, drivetrain).

**3. WHAT TO DO NEXT**
Sourcing instructions: what to actively hunt, watch for, or re-test. Include WHERE to source (auctions, dealer stock, Pickles, Manheim).

For each vehicle mentioned, state confidence:
- HIGH CONFIDENCE: 5+ profitable sales of this shape
- MEDIUM CONFIDENCE: 3-4 profitable sales
- LOW CONFIDENCE (valid signal): 1-2 profitable sales — "strong outcome, low repeatability so far"

If data is insufficient to answer, say so directly: "I don't have enough data on that yet. Here's what I do have..."

═══ DEALER SALES DATA ═══
${contextBlock}`;

    // ── 7. Call Lovable AI (streaming) ──
    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          stream: true,
        }),
      }
    );

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("bob-sales-truth error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
