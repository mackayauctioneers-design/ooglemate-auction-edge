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
      .eq("enabled", true);

    if (error) throw new Error(`Health query failed: ${error.message}`);

    const alerts: Array<{ source: string; status: string; message: string }> = [];

    for (const s of sources || []) {
      // Standard health status checks
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

      // Min listings threshold
      if (s.min_listings_24h && s.new_24h < s.min_listings_24h) {
        alerts.push({
          source: s.display_name,
          status: "LOW_VOLUME",
          message: `Only ${s.new_24h} new listings in 24h (expected ≥${s.min_listings_24h}).`,
        });
      }

      // ZERO-ROW ANOMALY: Job ran successfully but wrote 0 rows
      // This catches broken filters, changed HTML, blocked requests
      if (s.runs_24h > 0 && s.successes_24h > 0 && s.new_24h === 0 && s.updated_24h === 0) {
        // Only alert if this source has a min_listings_24h set (means it should produce rows)
        // or if it had runs but literally zero output
        if (s.min_listings_24h && s.min_listings_24h > 0) {
          alerts.push({
            source: s.display_name,
            status: "ZERO_OUTPUT",
            message: `${s.successes_24h} successful runs but 0 new + 0 updated listings. Likely a broken filter or blocked scraper.`,
          });
        }
      }

      // SILENT DEATH: Last note says 0 found/new on most recent run
      if (s.last_ok && s.last_note) {
        const noteStr = String(s.last_note);
        const foundMatch = noteStr.match(/found=(\d+)/);
        const newMatch = noteStr.match(/new=(\d+)/);
        if (foundMatch && newMatch) {
          const found = parseInt(foundMatch[1]);
          const newCount = parseInt(newMatch[1]);
          if (found === 0 && newCount === 0 && s.min_listings_24h && s.min_listings_24h > 0) {
            alerts.push({
              source: s.display_name,
              status: "SILENT_FAIL",
              message: `Last run reported found=0, new=0. Job "succeeded" but produced nothing.`,
            });
          }
        }
      }
    }

    if (alerts.length === 0) {
      console.log("Health check: all sources healthy");
      return new Response(JSON.stringify({ healthy: true, sources: sources?.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Health check: ${alerts.length} alert(s) found`);

    // Deduplicate: only send Slack if we haven't sent the same alerts recently
    // Check last alert log to avoid spam
    const { data: lastAlert } = await supabase
      .from("cron_audit_log")
      .select("run_at, error")
      .eq("cron_name", "ingestion-health-check")
      .eq("success", false)
      .order("run_at", { ascending: false })
      .limit(1)
      .single();

    const currentAlertKey = alerts.map(a => `${a.source}:${a.status}`).sort().join("|");
    const lastAlertKey = lastAlert?.error || "";
    const lastAlertAge = lastAlert?.run_at
      ? (Date.now() - new Date(lastAlert.run_at).getTime()) / 60000
      : Infinity;

    // Only send Slack if alerts changed or it's been > 60 min since last alert
    const shouldSendSlack = currentAlertKey !== lastAlertKey || lastAlertAge > 60;

    if (shouldSendSlack) {
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
        console.warn("SLACK_WEBHOOK_URL not set");
      }
    } else {
      console.log("Skipping Slack: same alerts as last check, sent <60min ago");
    }

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "ingestion-health-check",
      success: false,
      result: { alerts },
      error: currentAlertKey,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ healthy: false, alerts, slack_sent: shouldSendSlack }), {
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
