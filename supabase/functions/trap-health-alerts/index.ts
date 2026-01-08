import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrapAlert {
  trap_slug: string;
  alert_type: "crawl_fail" | "zero_vehicles" | "count_drop" | "consecutive_failures";
  region_id: string;
  last_vehicle_count: number | null;
  avg_7d: number | null;
  last_fail_reason: string | null;
  last_crawl_at: string | null;
  consecutive_failures: number;
  is_anchor: boolean;
}

async function sendSlackAlert(webhookUrl: string, alerts: TrapAlert[]): Promise<boolean> {
  if (!webhookUrl || alerts.length === 0) return false;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🚨 Trap Health Alert", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${alerts.length} trap(s) require attention*`,
      },
    },
    { type: "divider" },
  ];

  for (const alert of alerts) {
    const emoji = alert.is_anchor ? "⚓" : "🔧";
    const typeLabel = {
      crawl_fail: "Crawl Failed",
      zero_vehicles: "Zero Vehicles Found",
      count_drop: ">50% Drop",
      consecutive_failures: "2+ Consecutive Failures",
    }[alert.alert_type];

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${alert.trap_slug}* (${alert.region_id})\n` +
          `• Type: ${typeLabel}\n` +
          `• Last count: ${alert.last_vehicle_count ?? "N/A"} | 7d avg: ${alert.avg_7d?.toFixed(1) ?? "N/A"}\n` +
          `• Failures: ${alert.consecutive_failures}\n` +
          `• Last crawl: ${alert.last_crawl_at ?? "Never"}\n` +
          (alert.last_fail_reason ? `• Reason: ${alert.last_fail_reason}` : ""),
      },
    } as any);
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  return response.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split("T")[0];
    const alerts: TrapAlert[] = [];

    // Get all enabled traps with their stats
    const { data: traps, error: trapsError } = await supabase
      .from("dealer_traps")
      .select("*")
      .eq("enabled", true);

    if (trapsError) throw trapsError;

    // Get 7-day crawl averages per trap
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentRuns, error: runsError } = await supabase
      .from("trap_crawl_runs")
      .select("trap_slug, vehicles_found, run_date, error")
      .gte("run_date", sevenDaysAgo.toISOString().split("T")[0]);

    if (runsError) throw runsError;

    // Calculate 7-day averages
    const avgByTrap: Record<string, { sum: number; count: number }> = {};
    for (const run of recentRuns || []) {
      if (!avgByTrap[run.trap_slug]) {
        avgByTrap[run.trap_slug] = { sum: 0, count: 0 };
      }
      avgByTrap[run.trap_slug].sum += run.vehicles_found || 0;
      avgByTrap[run.trap_slug].count += 1;
    }

    // Check already sent alerts today for dedup
    const { data: sentToday } = await supabase
      .from("trap_health_alerts")
      .select("trap_slug, alert_type")
      .eq("alert_date", today);

    const sentKeys = new Set(
      (sentToday || []).map((a) => `${a.trap_slug}:${a.alert_type}`)
    );

    // Evaluate each trap
    for (const trap of traps || []) {
      const avg = avgByTrap[trap.trap_slug];
      const avg7d = avg ? avg.sum / avg.count : null;
      const lastCount = trap.last_vehicle_count;

      const baseAlert: Omit<TrapAlert, "alert_type"> = {
        trap_slug: trap.trap_slug,
        region_id: trap.region_id,
        last_vehicle_count: lastCount,
        avg_7d: avg7d,
        last_fail_reason: trap.last_fail_reason,
        last_crawl_at: trap.last_crawl_at,
        consecutive_failures: trap.consecutive_failures,
        is_anchor: trap.anchor_trap || false,
      };

      // Check for anchor trap crawl failure (any error)
      if (trap.anchor_trap && trap.last_fail_reason) {
        const key = `${trap.trap_slug}:crawl_fail`;
        if (!sentKeys.has(key)) {
          alerts.push({ ...baseAlert, alert_type: "crawl_fail" });
        }
      }

      // Check for zero vehicles
      if (lastCount === 0 || lastCount === null) {
        const key = `${trap.trap_slug}:zero_vehicles`;
        if (!sentKeys.has(key)) {
          alerts.push({ ...baseAlert, alert_type: "zero_vehicles" });
        }
      }

      // Check for >50% drop vs 7-day average
      if (avg7d && avg7d > 0 && lastCount !== null) {
        const dropPct = (avg7d - lastCount) / avg7d;
        if (dropPct > 0.5) {
          const key = `${trap.trap_slug}:count_drop`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "count_drop" });
          }
        }
      }

      // Check for 2+ consecutive failures
      if (trap.consecutive_failures >= 2) {
        const key = `${trap.trap_slug}:consecutive_failures`;
        if (!sentKeys.has(key)) {
          alerts.push({ ...baseAlert, alert_type: "consecutive_failures" });
        }
      }
    }

    // Send Slack alert if we have any
    let slackSent = false;
    if (alerts.length > 0 && slackWebhook) {
      slackSent = await sendSlackAlert(slackWebhook, alerts);
    }

    // Record sent alerts for dedup
    if (alerts.length > 0) {
      const inserts = alerts.map((a) => ({
        trap_slug: a.trap_slug,
        alert_date: today,
        alert_type: a.alert_type,
        payload: a,
      }));

      await supabase
        .from("trap_health_alerts")
        .upsert(inserts, { onConflict: "trap_slug,alert_date,alert_type" });
    }

    // Log to cron_audit_log
    await supabase
      .from("cron_audit_log")
      .upsert(
        {
          cron_name: "trap-health-alerts",
          run_date: today,
          success: true,
          result: {
            alerts_count: alerts.length,
            checked_traps: traps?.length || 0,
            slack_sent: slackSent,
          },
        },
        { onConflict: "cron_name,run_date" }
      );

    console.log(`Trap health check: ${alerts.length} alerts, Slack sent: ${slackSent}`);

    return new Response(
      JSON.stringify({
        alerts_count: alerts.length,
        alerts: alerts.map((a) => ({
          trap_slug: a.trap_slug,
          alert_type: a.alert_type,
          is_anchor: a.is_anchor,
        })),
        slack_sent: slackSent,
        checked_traps: traps?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Trap health alerts error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
