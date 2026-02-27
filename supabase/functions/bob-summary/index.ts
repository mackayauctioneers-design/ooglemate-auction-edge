import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// BOB-SUMMARY — Controlled preset-only summary engine for Trading Desk
// Flow: Preset → Load dealer context + desk data → Build structured JSON → AI summary → Response
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are Bob, a vehicle sourcing engine.

You summarise ONLY the structured data provided.
You never invent vehicles.
You never reorder opportunities.
You never refer to "score".
You never use the phrase "value gap".
You never use the field "expected_margin" — use "anchor_profit_aud" instead, which is the actual historical profit from a comparable sale.

Output structure:
1. Lead with total count by source if relevant.
2. Highlight the first item in top_opportunities as the primary opportunity.
3. State anchor_profit_aud as "Based on similar sale profit of $X".
4. State ROI% if provided.
5. If hours_to_close is present and <24, mention urgency.
6. Show anchor comparison: "Last comparable sold at $X. This unit asking $Y."
7. If margin_flag is "high_variance", add: "Note: margin based on prior sale context — verify spec alignment."
8. If anchor_profit_aud is null, say: "No direct comparable anchor found."
9. Keep under 7 lines.
10. No greetings. No personality. No filler language.

If fewer than 3 opportunities exist, reinforce that inventory is light but the engine is active.
If no results: say "Not enough aligned inventory today." and nothing else.`;
type PresetKey =
  | "what_closes_48h"
  | "turn_fast_this_week"
  | "under_described_auction"
  | "retail_yard_profile"
  | "east_coast_arbitrage"
  | "strongest_margin";

const PRESET_INSTRUCTIONS: Record<PresetKey, string> = {
  what_closes_48h: "Focus on opportunities with auction dates within the next 48 hours. Lead with hours_to_close. Prioritise by expected_margin_aud and urgency.",
  turn_fast_this_week: "Focus on opportunities with historically fast days-to-sell for this dealer. Prioritise quick-turn wholesale stock.",
  under_described_auction: "Identify auction listings with thin descriptions but strong anchor-sale backing. These are hidden value.",
  retail_yard_profile: "Match opportunities against the dealer's retail profile — year range, km band, margin expectation. Only retail-grade stock.",
  east_coast_arbitrage: "Compare interstate opportunities where expected margin minus freight still delivers profit. State freight implications explicitly.",
  strongest_margin: "Show the highest expected_margin_aud opportunities. Lead with dollar margin and ROI %. Pure profit ranking.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { preset, accountId } = await req.json();
    if (!preset || !accountId) {
      return new Response(JSON.stringify({ error: "preset and accountId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const presetInstruction = PRESET_INSTRUCTIONS[preset as PresetKey];
    if (!presetInstruction) {
      return new Response(JSON.stringify({ error: "Unknown preset" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 0. Auth gate: derive role from JWT, block dealers from "all" ──
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    // If accountId is "all", verify the caller is an operator
    if (accountId === "all") {
      if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: roleData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .maybeSingle();

          if (!roleData) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }
    }

    // ── 1. Load dealer profile ──
    const { data: account } = await supabase
      .from("accounts")
      .select("display_name")
      .eq("id", accountId)
      .single();

    const dealerName = account?.display_name || "Unknown";

    // ── 2. Load trading desk opportunities ──
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    let query = supabase
      .from("operator_opportunities")
      .select("make, model, variant, year, km, asking_price, best_expected_margin, best_under_buy, best_account_name, best_account_id, tier, listing_source, auction_datetime, auction_house, anchor_sale_profit, anchor_sale_buy_price, anchor_sale_sell_price, anchor_sale_km, anchor_sale_trim_class, retail_median, retail_vs_ask_pct, status, freshness, margin_flag")
      .in("status", ["new", "reviewed", "assigned"])
      .order("best_expected_margin", { ascending: false })
      .limit(200);

    // Filter by account — always filter unless operator explicitly requests "all"
    if (accountId !== "all") {
      query = query.eq("best_account_id", accountId);
    }

    const { data: opportunities, error: oppErr } = await query;
    if (oppErr) throw oppErr;

    // Confidence filter: exclude weak listings before any analysis
    const opps = (opportunities || []).filter((o: any) => (o.best_expected_margin || 0) >= 2000);

    // ── 3. Build source counts ──
    const sourceCounts: Record<string, number> = {};
    opps.forEach((o: any) => {
      const src = o.listing_source || "unknown";
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });

    // ── 4. Build tier counts ──
    const tierCounts: Record<string, number> = {};
    opps.forEach((o: any) => {
      tierCounts[o.tier] = (tierCounts[o.tier] || 0) + 1;
    });

    // ── 5. Build top opportunities based on preset ──
    let topOpps = opps;

    if (preset === "what_closes_48h") {
      topOpps = opps.filter((o: any) => {
        if (!o.auction_datetime) return false;
        const dt = new Date(o.auction_datetime);
        return dt >= now && dt <= in48h;
      }).sort((a: any, b: any) => new Date(a.auction_datetime).getTime() - new Date(b.auction_datetime).getTime());
    } else if (preset === "strongest_margin") {
      topOpps = opps.sort((a: any, b: any) => (b.best_expected_margin || 0) - (a.best_expected_margin || 0));
    } else if (preset === "retail_yard_profile") {
      topOpps = opps.filter((o: any) => ["RETAIL_BUY", "RETAIL_TARGET"].includes(o.tier));
    } else if (preset === "east_coast_arbitrage") {
      // Interstate opportunities where margin justifies freight
      topOpps = opps.filter((o: any) => (o.best_expected_margin || 0) >= 3000 && o.best_under_buy && o.best_under_buy > 1500);
    }

    const top10 = topOpps.slice(0, 10).map((o: any) => {
      const margin = o.best_expected_margin || 0;
      const asking = o.asking_price || 0;
      const hoursToClose = o.auction_datetime
        ? Math.max(0, Math.round((new Date(o.auction_datetime).getTime() - now.getTime()) / (1000 * 60 * 60)))
        : null;

      return {
        vehicle: `${o.year || ""} ${o.make || ""} ${o.model || ""} ${o.variant || ""}`.trim(),
        source: o.listing_source || "unknown",
        tier: o.tier,
        closing: o.auction_datetime ? new Date(o.auction_datetime).toLocaleString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, day: "numeric", month: "short" }) : null,
        hours_to_close: hoursToClose,
        asking_aud: asking,
        anchor_profit_aud: margin > 0 ? margin : null,
        roi_pct: asking > 0 && margin > 0 ? Math.round((margin / asking) * 100) : null,
        anchor_sold_at_aud: o.anchor_sale_sell_price || null,
        anchor_bought_at_aud: o.anchor_sale_buy_price || null,
        anchor_km: o.anchor_sale_km || null,
        anchor_trim: o.anchor_sale_trim_class || null,
        margin_flag: o.margin_flag || null,
        location: o.auction_house || null,
        dealer: o.best_account_name,
      };
    });

    // Minimum count threshold: don't show thin results, but show closest match
    if (top10.length > 0 && top10.length < 3) {
      const bestMargin = Math.max(...topOpps.map((o: any) => o.best_expected_margin || 0));
      return new Response(JSON.stringify({
        response: `Not enough aligned inventory today.\nClosest match expected margin: $${bestMargin.toLocaleString()}.`,
        payload: { dealer: dealerName, preset, summary: { total_active: opps.length, by_source: sourceCounts, by_tier: tierCounts }, top_opportunities: [] },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 6. Build structured payload ──
    const payload = {
      dealer: dealerName,
      preset,
      summary: {
        total_active: opps.length,
        by_source: sourceCounts,
        by_tier: tierCounts,
      },
      top_opportunities: top10,
    };

    console.log(`[BOB-SUMMARY] Preset: ${preset} | Account: ${dealerName} | Opps: ${opps.length} | Top: ${top10.length}`);

    // ── 7. If no results, return canned response ──
    if (top10.length === 0) {
      return new Response(JSON.stringify({
        response: "Not enough aligned inventory today.",
        payload,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 8. Send to Lovable AI for summary ──
    const userMessage = `PRESET: ${preset}
INSTRUCTION: ${presetInstruction}

STRUCTURED DATA:
${JSON.stringify(payload, null, 2)}

Summarise this data for the dealer. Follow the system prompt rules exactly.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        stream: false,
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      const txt = await aiResp.text().catch(() => "");
      console.error(`[BOB-SUMMARY] AI error ${status}: ${txt.slice(0, 300)}`);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiJson = await aiResp.json();
    const bobResponse = aiJson.choices?.[0]?.message?.content || "No summary generated.";

    return new Response(JSON.stringify({
      response: bobResponse,
      payload,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[BOB-SUMMARY] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
