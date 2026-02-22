import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MIN_SCORE = 75;
const MAX_ALERTS = 20;
const MIN_UNDERVALUE_PCT = 5; // lot must be at least 5% below anchor sell price
const MACKAY_TRADERS_ACCOUNT_ID = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51";

interface MatchedOpp {
  id: string;
  make: string;
  model: string;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  match_score: number;
  fingerprint_make: string;
  fingerprint_model: string;
  sales_count: number;
  km_band: string;
  url_canonical: string;
  anchor_profit: number | null;
  anchor_sell_price: number | null;
  anchor_buy_price: number | null;
  anchor_days_to_sell: number | null;
  transmission: string | null;
  body_type: string | null;
  created_at: string;
}

function fmtPrice(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtKm(km: number | null): string {
  if (km === null) return "—";
  return `${Math.round(km / 1000)}k`;
}

function scoreEmoji(score: number): string {
  if (score >= 75) return "🟢";
  if (score >= 60) return "🟡";
  return "🔵";
}

async function postSlack(webhook: string, payload: any): Promise<void> {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${txt}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");

  if (!slackWebhook) {
    return new Response(
      JSON.stringify({ error: "SLACK_WEBHOOK_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const minScore = body.min_score ?? MIN_SCORE;
    const lookbackHours = body.lookback_hours ?? 24;
    const minUndervaluePct = body.min_undervalue_pct ?? MIN_UNDERVALUE_PCT;

    // Query matched opportunities from Manheim
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

    const { data: rawMatches, error: qErr } = await supabase
      .from("matched_opportunities_v1")
      .select(
        "id, make, model, year, km, asking_price, match_score, fingerprint_make, fingerprint_model, sales_count, km_band, url_canonical, anchor_profit, anchor_sell_price, anchor_buy_price, anchor_days_to_sell, transmission, body_type, created_at"
      )
      .eq("account_id", MACKAY_TRADERS_ACCOUNT_ID)
      .eq("source_searched", "manheim")
      .gte("match_score", minScore)
      .gte("created_at", cutoff)
      .order("match_score", { ascending: false })
      .limit(100); // fetch extra for dedup + undervalue filtering

    if (qErr) throw qErr;

    // Filter: only keep lots priced at least X% below anchor sell price
    const undervalued = (rawMatches || []).filter((m: any) => {
      if (!m.anchor_sell_price || !m.asking_price) return false;
      const underPct = ((m.anchor_sell_price - m.asking_price) / m.anchor_sell_price) * 100;
      return underPct >= minUndervaluePct;
    }) as MatchedOpp[];

    // Deduplicate: keep only the BEST fingerprint per lot (by url_canonical)
    const bestPerLot = new Map<string, MatchedOpp>();
    for (const m of undervalued) {
      const key = m.url_canonical;
      const existing = bestPerLot.get(key);
      if (!existing || m.match_score > existing.match_score) {
        bestPerLot.set(key, m);
      }
    }
    const matches = [...bestPerLot.values()]
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, MAX_ALERTS);

    const today = new Date().toISOString().split("T")[0];

    if (!matches || matches.length === 0) {
      // Send "all clear" message
      await postSlack(slackWebhook, {
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "📋 Manheim Daily — No Matches", emoji: true },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `No Manheim listings scored ≥${minScore} in the last ${lookbackHours}h.\n_${today}_`,
            },
          },
        ],
      });

      await auditLog(supabase, today, true, { sent: 0, min_score: minScore });

      return new Response(
        JSON.stringify({ success: true, sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Slack blocks
    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🎯 Manheim Daily — ${matches.length} Match${matches.length > 1 ? "es" : ""}`,
          emoji: true,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*${today}* | Score ≥${minScore} | ≥${minUndervaluePct}% under anchor | Last ${lookbackHours}h | Mackay Traders`,
          },
        ],
      },
      { type: "divider" },
    ];

    for (const m of matches as MatchedOpp[]) {
      const emoji = scoreEmoji(m.match_score);
      const vehicle = `${m.year ?? "—"} ${m.make} ${m.model}`;
      const kmStr = fmtKm(m.km);
      const priceStr = fmtPrice(m.asking_price);

      let profitLine = "";
      if (m.anchor_sell_price && m.asking_price) {
        const underPct = ((m.anchor_sell_price - m.asking_price) / m.anchor_sell_price * 100).toFixed(0);
        profitLine = `\n💰 *${underPct}% under anchor* • Profit: ${fmtPrice(m.anchor_profit)} • Sell: ${fmtPrice(m.anchor_sell_price)}`;
        if (m.anchor_days_to_sell) profitLine += ` • ${m.anchor_days_to_sell}d turn`;
      }

      // Show the specific fingerprint this lot matched
      const fpLine = `📋 Matched: ${m.fingerprint_make} ${m.fingerprint_model} ${m.km_band} • bought ${fmtPrice(m.anchor_buy_price)}, sold ${fmtPrice(m.anchor_sell_price)}`;

      const section: any = {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `${emoji} *${vehicle}* — Score *${m.match_score}*\n` +
            `${priceStr} • ${kmStr} km` +
            (m.transmission ? ` • ${m.transmission}` : "") +
            profitLine +
            `\n_${fpLine}_`,
        },
      };

      if (m.url_canonical) {
        section.accessory = {
          type: "button",
          text: { type: "plain_text", text: "View", emoji: true },
          url: m.url_canonical,
          action_id: `view_manheim_${m.id}`,
        };
      }

      blocks.push(section);
    }

    // Summary footer
    const topMakes = [...new Set(matches.map((m: any) => m.make))].slice(0, 5).join(", ");
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Top makes: ${topMakes} | Full list in dashboard`,
          },
        ],
      }
    );

    await postSlack(slackWebhook, { blocks });
    await auditLog(supabase, today, true, { sent: matches.length, min_score: minScore, top_score: matches[0]?.match_score });

    console.log(`[manheim-match-alerts] Sent ${matches.length} matches to Slack`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: matches.length,
        topScore: matches[0]?.match_score,
        topMakes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[manheim-match-alerts] Error:", msg);

    const today = new Date().toISOString().split("T")[0];
    await auditLog(supabase, today, false, null, msg).catch(() => {});

    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function auditLog(
  supabase: any,
  runDate: string,
  success: boolean,
  result: any,
  error?: string
) {
  await supabase.from("cron_audit_log").insert({
    cron_name: "manheim-match-alerts",
    run_date: runDate,
    success,
    result,
    error: error || null,
  });
}
