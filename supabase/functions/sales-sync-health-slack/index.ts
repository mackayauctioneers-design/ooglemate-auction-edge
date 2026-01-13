import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function postSlack(webhook: string, blocks: unknown[]) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${txt}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";

  if (!SLACK_WEBHOOK_URL) {
    console.log("[sales-sync-health-slack] No SLACK_WEBHOOK_URL configured, skipping");
    return new Response(JSON.stringify({ success: true, sent: false, reason: "no_webhook" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const { data, error } = await supabase.rpc("get_sales_sync_health");
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw new Error("No health row returned");

    const status = (row.status || "unknown").toString();
    const hours = row.sync_freshness_hours ?? null;
    const total = row.total_rows ?? 0;
    const latestSaleDate = row.latest_sale_date ?? null;
    const latestSync = row.latest_updated_at ?? null;

    // Only alert on stale/critical/broken/empty
    if (!["stale", "critical", "broken", "empty"].includes(status)) {
      console.log(`[sales-sync-health-slack] Status is ${status}, no alert needed`);
      await supabase.from("cron_audit_log").upsert(
        { cron_name: "sales-sync-health-slack", run_date: today, success: true, result: { sent: false, status } },
        { onConflict: "cron_name,run_date" }
      );
      return new Response(JSON.stringify({ success: true, sent: false, status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[sales-sync-health-slack] Status is ${status}, sending alert`);

    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: `⚠️ Sales Sync Health (${today})`, emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `Status: *${status.toUpperCase()}*\n` +
            `Rows: *${total}*\n` +
            `Age: *${hours !== null ? `${hours}h` : "—"}*\n` +
            `Latest sale date: *${latestSaleDate ?? "—"}*\n` +
            `Last sync: *${latestSync ?? "—"}*\n\n` +
            `Impact: Bob's "last equivalent sale" answers may be stale until sync runs.`,
        },
      },
    ];

    await postSlack(SLACK_WEBHOOK_URL, blocks);

    await supabase.from("cron_audit_log").upsert(
      { cron_name: "sales-sync-health-slack", run_date: today, success: true, result: { sent: true, status } },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true, sent: true, status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("[sales-sync-health-slack] Error:", msg);
    
    await supabase.from("cron_audit_log").upsert(
      { cron_name: "sales-sync-health-slack", run_date: today, success: false, error: msg },
      { onConflict: "cron_name,run_date" }
    );
    
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
