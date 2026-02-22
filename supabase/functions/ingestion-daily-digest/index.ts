import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { data: sources, error } = await supabase
      .from("ingestion_source_health")
      .select("*")
      .order("enabled", { ascending: false });

    if (error) throw new Error(`Query failed: ${error.message}`);

    const enabled = (sources || []).filter((s: any) => s.enabled);
    const disabled = (sources || []).filter((s: any) => !s.enabled);

    const statusEmoji: Record<string, string> = {
      healthy: "✅",
      stale: "⏰",
      erroring: "❌",
      never_run: "⚪",
      disabled: "⛔",
    };

    const lines = enabled.map((s: any) => {
      const emoji = statusEmoji[s.health_status] || "❓";
      const lastRun = s.last_run_at
        ? `${Math.round((Date.now() - new Date(s.last_run_at).getTime()) / 60000)}m ago`
        : "never";

      let detail = `${s.new_24h} new, ${s.updated_24h} updated`;
      if (s.runs_24h > 0) detail += ` (${s.successes_24h}/${s.runs_24h} runs OK)`;

      // Flag zero-output anomaly
      if (s.successes_24h > 0 && s.new_24h === 0 && s.updated_24h === 0 && s.min_listings_24h > 0) {
        detail += " ⚠️ ZERO OUTPUT";
      }

      return `${emoji} *${s.display_name}*: ${detail} — last run ${lastRun}`;
    });

    const healthyCount = enabled.filter((s: any) => s.health_status === "healthy").length;
    const alertCount = enabled.filter((s: any) => ["stale", "erroring", "never_run"].includes(s.health_status)).length;

    const header = alertCount > 0
      ? `🔴 ${alertCount} source(s) need attention`
      : `🟢 All ${healthyCount} sources healthy`;

    const slackBlocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `📊 Daily Ingestion Digest` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: header },
      },
      {
        type: "divider",
      },
      ...lines.map((line: string) => ({
        type: "section",
        text: { type: "mrkdwn", text: line },
      })),
      ...(disabled.length > 0
        ? [
            { type: "divider" },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Disabled: ${disabled.map((s: any) => s.display_name).join(", ")}`,
                },
              ],
            },
          ]
        : []),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Generated at ${new Date().toISOString()}` }],
      },
    ];

    const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    if (slackUrl) {
      const slackRes = await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: slackBlocks }),
      });
      if (!slackRes.ok) {
        console.error("Slack send failed:", await slackRes.text());
      } else {
        console.log("Daily digest sent to Slack");
      }
    } else {
      console.warn("SLACK_WEBHOOK_URL not set");
    }

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "ingestion-daily-digest",
      success: true,
      result: {
        total_enabled: enabled.length,
        healthy: healthyCount,
        alerting: alertCount,
        disabled: disabled.length,
      },
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ sent: true, sources: enabled.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Daily digest error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
