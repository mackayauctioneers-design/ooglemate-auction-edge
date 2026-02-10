import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // ── 1. Fetch dealer's account name ──
    const { data: account } = await supabase
      .from("accounts")
      .select("display_name")
      .eq("id", accountId)
      .single();

    // ── 2. Fetch sales truth summary data ──
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
        .limit(30),
    ]);

    const sales = (salesRes.data || []) as any[];
    const candidates = (candidatesRes.data || []) as any[];

    // ── 3. Compute summary stats for context ──
    const totalSales = sales.length;
    const withProfit = sales.filter(
      (s: any) => s.buy_price != null && s.sale_price != null
    );
    const withClearance = sales.filter(
      (s: any) => s.days_to_clear != null
    );

    // Top models by volume
    const modelCounts: Record<string, { count: number; profits: number[]; days: number[] }> = {};
    sales.forEach((s: any) => {
      const key = `${s.make} ${s.model}`;
      if (!modelCounts[key]) modelCounts[key] = { count: 0, profits: [], days: [] };
      modelCounts[key].count++;
      if (s.buy_price != null && s.sale_price != null) {
        modelCounts[key].profits.push(s.sale_price - s.buy_price);
      }
      if (s.days_to_clear != null) {
        modelCounts[key].days.push(s.days_to_clear);
      }
    });

    const topModels = Object.entries(modelCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([vehicle, stats]) => {
        const medProfit = stats.profits.length
          ? Math.round(
              [...stats.profits].sort((a, b) => a - b)[
                Math.floor(stats.profits.length / 2)
              ]
            )
          : null;
        const medDays = stats.days.length
          ? Math.round(
              [...stats.days].sort((a, b) => a - b)[
                Math.floor(stats.days.length / 2)
              ]
            )
          : null;
        return { vehicle, count: stats.count, medianProfit: medProfit, medianDays: medDays };
      });

    // Single-sale winners (outcome fingerprints)
    const singleWinners = withProfit
      .filter((s: any) => {
        const profit = s.sale_price - s.buy_price;
        const key = `${s.make} ${s.model}`;
        return profit >= 2000 && (modelCounts[key]?.count || 0) <= 2;
      })
      .slice(0, 10)
      .map((s: any) => ({
        vehicle: `${s.year} ${s.make} ${s.model} ${s.variant || ""}`.trim(),
        profit: s.sale_price - s.buy_price,
        days: s.days_to_clear,
        km: s.km,
      }));

    // ── 4. Build context for AI ──
    const dealerName = account?.display_name || "this dealer";
    const contextBlock = `
DEALER: ${dealerName}
TOTAL SALES IN DATABASE: ${totalSales}
SALES WITH FULL OUTCOME DATA (buy + sell price): ${withProfit.length}
SALES WITH CLEARANCE TIME: ${withClearance.length}

TOP MODELS BY VOLUME (up to 15):
${topModels.map((m) => `- ${m.vehicle}: ${m.count} sales, median margin ${m.medianProfit != null ? "$" + m.medianProfit.toLocaleString() : "N/A"}, median clearance ${m.medianDays != null ? m.medianDays + "d" : "N/A"}`).join("\n")}

PROFITABLE SINGLE/LOW-FREQUENCY WINS (outcome fingerprints):
${singleWinners.length ? singleWinners.map((w) => `- ${w.vehicle}: $${w.profit.toLocaleString()} profit${w.days != null ? ", " + w.days + "d clearance" : ""}${w.km != null ? ", " + w.km.toLocaleString() + "km" : ""}`).join("\n") : "None detected yet."}

ACTIVE SOURCING TARGETS (from sales_target_candidates):
${candidates.length ? candidates.slice(0, 15).map((c: any) => `- ${c.make} ${c.model} ${c.variant || ""} ${c.transmission || ""} ${c.fuel_type || ""} [${c.fingerprint_type}] score:${c.target_score}, ${c.sales_count} sales, median profit ${c.median_profit != null ? "$" + c.median_profit : "N/A"}, clearance ${c.median_days_to_clear != null ? c.median_days_to_clear + "d" : "N/A"}`).join("\n") : "None generated yet."}

RAW SALES DATA (last 50 for detail queries):
${sales.slice(0, 50).map((s: any) => `${s.year} ${s.make} ${s.model} ${s.variant || ""} | sold ${s.sold_at?.slice(0, 10) || "?"} | buy $${s.buy_price ?? "?"} sell $${s.sale_price ?? "?"} | ${s.days_to_clear != null ? s.days_to_clear + "d" : "?"} | ${s.km != null ? s.km + "km" : "?"} | ${s.transmission || ""} ${s.fuel_type || ""} ${s.drive_type || ""}`).join("\n")}
`.trim();

    const systemPrompt = `You are Bob — the sales truth assistant for Carbitrage.
You answer questions ONLY from the dealer's own sales data provided below. You never hallucinate market data or general averages.

RULES (non-negotiable):
- Only reference data from the context below. If data is insufficient, say so plainly.
- Never say "market value", "estimated value", "we recommend", or "you should consider".
- Always say "based on your sales", "you've proven", "in your data", "this outcome occurred".
- When answering, use this 3-part format:
  1. DIRECT ANSWER: Plain English, confident, dealer-style.
  2. EVIDENCE: Concrete numbers — counts, margins, clearance days, examples.
  3. SOURCING ACTION: What to actively hunt or watch based on the evidence.
- Treat single profitable sales as valid intelligence, not noise. A $3k win on one sale is a signal.
- When comparing vehicles, always differentiate by year band, variant, and drivetrain where data exists.
- Keep responses concise. Dealers don't read essays.

DEALER SALES DATA:
${contextBlock}`;

    // ── 5. Call Lovable AI (streaming) ──
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
