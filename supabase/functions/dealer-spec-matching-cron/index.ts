import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MatchResult {
  listings_checked: number;
  specs_evaluated: number;
  matches_created: number;
  strong_buys: number;
  mispriced: number;
  buy_windows_set: number;
}

interface SlackAlert {
  match_id: string;
  spec_name: string;
  dealer_name: string;
  make: string;
  model: string;
  variant_used: string | null;
  year: number | null;
  km: number | null;
  region_id: string | null;
  asking_price: number | null;
  benchmark_price: number | null;
  delta_pct: number | null;
  deal_label: string;
  listing_url: string | null;
  source_class: string | null;
}

function formatPrice(price: number | null): string {
  if (!price) return "N/A";
  return "$" + price.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function formatKm(km: number | null): string {
  if (!km) return "N/A";
  return Math.round(km / 1000) + "k km";
}

function getDealEmoji(label: string): string {
  switch (label) {
    case "MISPRICED": return "🔥";
    case "STRONG_BUY": return "🎯";
    default: return "📋";
  }
}

async function postSlack(webhook: string, payload: object): Promise<boolean> {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SLACK_WEBHOOK = Deno.env.get("SLACK_WEBHOOK_URL");
  
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = new Date().toISOString().slice(0, 10);

  // Parse hours from request body or default to 1 hour
  let sinceHours = 1;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.since_hours && typeof body.since_hours === "number") {
      sinceHours = body.since_hours;
    }
  } catch {
    // Use default
  }

  try {
    // 1) Run batch matching
    const { data: matchResult, error: matchError } = await supabase
      .rpc("run_spec_matching_batch", { p_since_hours: sinceHours });

    if (matchError) throw matchError;

    const result: MatchResult = Array.isArray(matchResult) && matchResult.length > 0
      ? matchResult[0]
      : {
          listings_checked: 0,
          specs_evaluated: 0,
          matches_created: 0,
          strong_buys: 0,
          mispriced: 0,
          buy_windows_set: 0,
        };

    // 2) Send Slack alerts for pending matches
    let slackSent = 0;
    if (SLACK_WEBHOOK) {
      const { data: pendingAlerts, error: alertsError } = await supabase
        .rpc("get_pending_spec_match_slack_alerts");

      if (!alertsError && pendingAlerts && pendingAlerts.length > 0) {
        const alerts = pendingAlerts as SlackAlert[];
        const matchIds: string[] = [];

        for (const alert of alerts) {
          const emoji = getDealEmoji(alert.deal_label);
          const variant = alert.variant_used ? ` ${alert.variant_used}` : "";
          const vehicle = `${alert.year || ""} ${alert.make || ""} ${alert.model || ""}${variant}`.trim();
          
          const blocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${emoji} *SPEC MATCH — ${alert.deal_label}*\n*${vehicle}*`,
              },
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*Spec:*\n${alert.spec_name}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Dealer:*\n${alert.dealer_name}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Asking:*\n${formatPrice(alert.asking_price)}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Benchmark:*\n${formatPrice(alert.benchmark_price)}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Delta:*\n${alert.delta_pct ? alert.delta_pct + "%" : "N/A"}`,
                },
                {
                  type: "mrkdwn",
                  text: `*KM:*\n${formatKm(alert.km)}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Region:*\n${alert.region_id || "N/A"}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Source:*\n${alert.source_class || "N/A"}`,
                },
              ],
            },
          ];

          if (alert.listing_url) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<${alert.listing_url}|View Listing>`,
              },
            } as any);
          }

          blocks.push({
            type: "divider",
          } as any);

          const sent = await postSlack(SLACK_WEBHOOK, { blocks });
          if (sent) {
            matchIds.push(alert.match_id);
            slackSent++;
          }
        }

        // Mark as sent
        if (matchIds.length > 0) {
          await supabase.rpc("mark_spec_matches_slack_sent", { p_match_ids: matchIds });
        }
      }
    }

    // 3) Audit log
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "dealer-spec-matching-cron",
        run_date: today,
        success: true,
        result: {
          ...result,
          slack_sent: slackSent,
          since_hours: sinceHours,
        },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        slack_sent: slackSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);

    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "dealer-spec-matching-cron",
        run_date: today,
        success: false,
        error: msg,
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
