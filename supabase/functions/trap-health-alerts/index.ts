import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrapAlert {
  trap_slug: string;
  alert_type: "anchor_crawl_fail" | "anchor_zero_vehicles" | "anchor_count_drop" | "anchor_not_crawled" | "consecutive_failures" | "two_day_drop";
  region_id: string;
  last_vehicle_count: number | null;
  avg_7d: number | null;
  last_fail_reason: string | null;
  last_crawl_at: string | null;
  consecutive_failures: number;
  is_anchor: boolean;
  today_count?: number;
  yesterday_count?: number;
  crawled_today?: boolean;
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
      anchor_crawl_fail: "Anchor Crawl Failed",
      anchor_zero_vehicles: "Anchor Zero Vehicles (Today's Run)",
      anchor_count_drop: "Anchor >50% Drop",
      anchor_not_crawled: "Anchor Not Crawled Today",
      consecutive_failures: "2+ Consecutive Failures",
      two_day_drop: ">50% Drop (2 days)",
    }[alert.alert_type];

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${alert.trap_slug}* (${alert.region_id})\n` +
          `• Type: ${typeLabel}\n` +
          `• Last count: ${alert.last_vehicle_count ?? "N/A"} | 7d avg: ${alert.avg_7d?.toFixed(1) ?? "N/A"}\n` +
          `• Crawled today: ${alert.crawled_today ? "Yes" : "No"}\n` +
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

async function sendHeartbeat(webhookUrl: string, trapsChecked: number): Promise<boolean> {
  if (!webhookUrl) return false;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `✅ All traps healthy (${new Date().toISOString().split("T")[0]}) - ${trapsChecked} traps checked, no alerts triggered`,
    }),
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
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const alerts: TrapAlert[] = [];

    // Get all enabled traps with their stats
    const { data: traps, error: trapsError } = await supabase
      .from("dealer_traps")
      .select("*")
      .eq("enabled", true);

    if (trapsError) throw trapsError;

    // Get 7-day crawl data per trap
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentRuns, error: runsError } = await supabase
      .from("trap_crawl_runs")
      .select("trap_slug, vehicles_found, run_date, error")
      .gte("run_date", sevenDaysAgo.toISOString().split("T")[0]);

    if (runsError) throw runsError;

    // Calculate 7-day averages and track per-day counts + crawl existence
    const avgByTrap: Record<string, { sum: number; count: number }> = {};
    const countByTrapAndDate: Record<string, Record<string, number>> = {};
    const crawledTodaySet = new Set<string>(); // traps that have a run_date = today
    const errorTodaySet = new Set<string>(); // traps with error on today's run
    
    for (const run of recentRuns || []) {
      // Track if this trap was crawled today (regardless of success/failure)
      if (run.run_date === today) {
        crawledTodaySet.add(run.trap_slug);
        if (run.error) {
          errorTodaySet.add(run.trap_slug);
        }
      }

      if (!avgByTrap[run.trap_slug]) {
        avgByTrap[run.trap_slug] = { sum: 0, count: 0 };
      }
      avgByTrap[run.trap_slug].sum += run.vehicles_found || 0;
      avgByTrap[run.trap_slug].count += 1;

      if (!countByTrapAndDate[run.trap_slug]) {
        countByTrapAndDate[run.trap_slug] = {};
      }
      countByTrapAndDate[run.trap_slug][run.run_date] = run.vehicles_found || 0;
    }

    // Check already sent alerts today for dedup
    const { data: sentToday } = await supabase
      .from("trap_health_alerts")
      .select("trap_slug, alert_type")
      .eq("alert_date", today);

    const sentKeys = new Set(
      (sentToday || []).map((a) => `${a.trap_slug}:${a.alert_type}`)
    );

    // Evaluate each trap with refined rules
    for (const trap of traps || []) {
      const avg = avgByTrap[trap.trap_slug];
      const avg7d = avg && avg.count > 0 ? avg.sum / avg.count : null;
      const lastCount = trap.last_vehicle_count;
      
      const todayCount = countByTrapAndDate[trap.trap_slug]?.[today];
      const yesterdayCount = countByTrapAndDate[trap.trap_slug]?.[yesterday];
      const crawledToday = crawledTodaySet.has(trap.trap_slug);
      const errorToday = errorTodaySet.has(trap.trap_slug);

      // Calculate drop percentages
      const todayDrop = avg7d && avg7d > 0 && todayCount !== undefined
        ? (avg7d - todayCount) / avg7d
        : null;
      const yesterdayDrop = avg7d && avg7d > 0 && yesterdayCount !== undefined
        ? (avg7d - yesterdayCount) / avg7d
        : null;

      const baseAlert: Omit<TrapAlert, "alert_type"> = {
        trap_slug: trap.trap_slug,
        region_id: trap.region_id,
        last_vehicle_count: lastCount,
        avg_7d: avg7d,
        last_fail_reason: trap.last_fail_reason,
        last_crawl_at: trap.last_crawl_at,
        consecutive_failures: trap.consecutive_failures,
        is_anchor: trap.anchor_trap || false,
        today_count: todayCount,
        yesterday_count: yesterdayCount,
        crawled_today: crawledToday,
      };

      if (trap.anchor_trap) {
        // ANCHOR TRAPS: Alert on any issue but with refined logic

        // 1. NOT_CRAWLED: Anchor trap has no crawl run for today
        if (!crawledToday) {
          const key = `${trap.trap_slug}:anchor_not_crawled`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "anchor_not_crawled" });
          }
        }

        // 2. CRAWL_FAIL: Has today's run but it errored
        if (crawledToday && errorToday) {
          const key = `${trap.trap_slug}:anchor_crawl_fail`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "anchor_crawl_fail" });
          }
        }

        // 3. ZERO_VEHICLES: Has today's run with vehicles_found = 0 (but no error)
        //    ONLY trigger if we actually crawled today and got 0
        if (crawledToday && !errorToday && todayCount === 0) {
          const key = `${trap.trap_slug}:anchor_zero_vehicles`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "anchor_zero_vehicles" });
          }
        }

        // 4. COUNT_DROP: >50% drop vs 7d avg (only if crawled today)
        if (crawledToday && todayDrop !== null && todayDrop > 0.5) {
          const key = `${trap.trap_slug}:anchor_count_drop`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "anchor_count_drop" });
          }
        }
      } else {
        // NON-ANCHOR TRAPS: Stricter rules to reduce noise
        // Rule 1: Alert on consecutive_failures >= 2
        if (trap.consecutive_failures >= 2) {
          const key = `${trap.trap_slug}:consecutive_failures`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "consecutive_failures" });
          }
        }

        // Rule 2: Alert on >50% drop for 2 consecutive days (must have crawl data)
        if (todayDrop !== null && yesterdayDrop !== null && todayDrop > 0.5 && yesterdayDrop > 0.5) {
          const key = `${trap.trap_slug}:two_day_drop`;
          if (!sentKeys.has(key)) {
            alerts.push({ ...baseAlert, alert_type: "two_day_drop" });
          }
        }
      }
    }

    // Send Slack alert or heartbeat
    let slackSent = false;
    if (slackWebhook) {
      if (alerts.length > 0) {
        slackSent = await sendSlackAlert(slackWebhook, alerts);
      } else {
        // Daily heartbeat when all green
        slackSent = await sendHeartbeat(slackWebhook, traps?.length || 0);
      }
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
            heartbeat_sent: alerts.length === 0,
            anchor_not_crawled: alerts.filter(a => a.alert_type === "anchor_not_crawled").length,
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
          crawled_today: a.crawled_today,
        })),
        slack_sent: slackSent,
        heartbeat_sent: alerts.length === 0,
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
