import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MatchAlert {
  id: string;
  dealer_id: string;
  match_type: string;
  benchmark_price: number | null;
  asking_price: number | null;
  delta_pct: number | null;
  make: string | null;
  model: string | null;
  variant_used: string | null;
  year: number | null;
  km: number | null;
  source_class: string | null;
  listing_url: string | null;
  created_at: string;
  dealer_match_specs: {
    dealer_name: string;
  } | null;
}

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return `$${price.toLocaleString()}`;
}

function formatKm(km: number | null): string {
  if (km === null) return "—";
  return `${Math.round(km / 1000)}k km`;
}

function getMatchEmoji(matchType: string): string {
  switch (matchType) {
    case "UNDER_BENCHMARK":
      return "🟢";
    case "BUY_WINDOW_MATCH":
      return "🟡";
    default:
      return "🔵";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // Fetch today's new alerts (not claimed/dismissed)
    const today = new Date().toISOString().split("T")[0];
    const { data: alerts, error } = await supabase
      .from("dealer_match_alerts")
      .select(`
        *,
        dealer_match_specs!spec_id (dealer_name)
      `)
      .eq("alert_date", today)
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(15);

    if (error) throw error;

    if (!alerts || alerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No new alerts to send" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Slack message
    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🎯 ${alerts.length} Spec Match Alerts`,
          emoji: true,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*${today}* | Listings matching dealer buy specs`,
          },
        ],
      },
      { type: "divider" },
    ];

    // Group by match type
    const underBenchmark = alerts.filter((a: MatchAlert) => a.match_type === "UNDER_BENCHMARK");
    const buyWindow = alerts.filter((a: MatchAlert) => a.match_type === "BUY_WINDOW_MATCH");
    const specMatch = alerts.filter((a: MatchAlert) => a.match_type === "SPEC_MATCH");

    const addAlertSection = (alertList: MatchAlert[], title: string) => {
      if (alertList.length === 0) return;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${title}* (${alertList.length})`,
        },
      });

      for (const alert of alertList.slice(0, 5)) {
        const emoji = getMatchEmoji(alert.match_type);
        const vehicle = `${alert.year || ""} ${alert.make || ""} ${alert.model || ""}`.trim();
        const variant = alert.variant_used ? ` (${alert.variant_used})` : "";
        const deltaText = alert.delta_pct !== null 
          ? ` | *${alert.delta_pct > 0 ? "+" : ""}${alert.delta_pct.toFixed(1)}%*` 
          : "";
        const dealerName = (alert as any).dealer_match_specs?.dealer_name || "Unknown";

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} *${vehicle}*${variant}\n${formatPrice(alert.asking_price)} | ${formatKm(alert.km)}${deltaText}\n_For: ${dealerName} | ${alert.source_class || "unknown"}_`,
          },
          accessory: alert.listing_url
            ? {
                type: "button",
                text: { type: "plain_text", text: "View", emoji: true },
                url: alert.listing_url,
                action_id: `view_${alert.id}`,
              }
            : undefined,
        });
      }

      if (alertList.length > 5) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `_+ ${alertList.length - 5} more ${title.toLowerCase()}_`,
            },
          ],
        });
      }
    };

    addAlertSection(underBenchmark, "🟢 Under Benchmark");
    addAlertSection(buyWindow, "🟡 Buy Window");
    addAlertSection(specMatch, "🔵 Spec Matches");

    // Send to Slack
    const slackResponse = await fetch(slackWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!slackResponse.ok) {
      throw new Error(`Slack API error: ${slackResponse.status}`);
    }

    console.log(`[dealer-match-alerts-slack] Sent ${alerts.length} alerts to Slack`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        alertsSent: alerts.length,
        breakdown: {
          underBenchmark: underBenchmark.length,
          buyWindow: buyWindow.length,
          specMatch: specMatch.length,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[dealer-match-alerts-slack] Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
