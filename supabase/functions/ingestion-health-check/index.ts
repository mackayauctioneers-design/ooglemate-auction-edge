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
    // Query the health view
    const { data: sources, error } = await supabase
      .from("ingestion_source_health")
      .select("*")
      .eq("enabled", true);

    if (error) throw new Error(`Health query failed: ${error.message}`);

    const alerts: Array<{ source: string; status: string; message: string }> = [];

    for (const s of sources || []) {
      if (s.health_status === "stale") {
        const mins = s.last_run_at
          ? Math.round((Date.now() - new Date(s.last_run_at).getTime()) / 60000)
          : null;
        alerts.push({
          source: s.display_name,
          status: "STALE",
          message: `No successful run in ${mins ?? "?"} minutes (expected every ${s.expected_interval_minutes}min).`,
        });
      }

      if (s.health_status === "erroring") {
        alerts.push({
          source: s.display_name,
          status: "ERROR",
          message: `Last run failed: ${(s.last_error_message || "unknown error").slice(0, 200)}`,
        });
      }

      if (s.health_status === "never_run") {
        alerts.push({
          source: s.display_name,
          status: "NEVER_RUN",
          message: "Source is enabled but has never reported a run.",
        });
      }

      // Min listings threshold (e.g. autotrader < 100/day)
      if (s.min_listings_24h && s.new_24h < s.min_listings_24h) {
        alerts.push({
          source: s.display_name,
          status: "LOW_VOLUME",
          message: `Only ${s.new_24h} new listings in 24h (expected ≥${s.min_listings_24h}).`,
        });
      }
    }

    // If no alerts, just log and return
    if (alerts.length === 0) {
      console.log("Health check: all sources healthy");
      return new Response(JSON.stringify({ healthy: true, sources: sources?.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Health check: ${alerts.length} alert(s) found`);

    // Build Slack message
    const slackBlocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `🚨 Ingestion Alert — ${alerts.length} issue(s)` },
      },
      ...alerts.map((a) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${a.source}* — \`${a.status}\`\n${a.message}`,
        },
      })),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Checked at ${new Date().toISOString()}` }],
      },
    ];

    // Send Slack webhook
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
        console.log("Slack alert sent");
      }
    } else {
      console.warn("SLACK_WEBHOOK_URL not set, skipping Slack alert");
    }

    // Log alert to cron_audit_log for traceability
    await supabase.from("cron_audit_log").insert({
      cron_name: "ingestion-health-check",
      success: false,
      result: { alerts },
      error: alerts.map((a) => `${a.source}: ${a.status}`).join("; "),
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ healthy: false, alerts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Health check error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
