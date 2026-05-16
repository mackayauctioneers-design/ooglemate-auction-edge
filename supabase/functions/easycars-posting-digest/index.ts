// EasyCars manual posting — Slack alerts.
// Modes:
//   ?mode=digest  → daily counts (pending / ready / posted today / oldest ready)
//   ?mode=stale   → backlog check, only fires if any manual_ready trade > threshold hours

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_HOURS = Number(Deno.env.get("EASYCARS_STALE_HOURS") ?? "24");
const CRITICAL_HOURS = Number(Deno.env.get("EASYCARS_CRITICAL_HOURS") ?? "72");
const APP_BASE = Deno.env.get("EASYCARS_APP_BASE_URL") ?? "https://www.carbitrage.com.au";

function fmtAge(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

async function slackPost(payload: unknown): Promise<boolean> {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) { console.warn("SLACK_WEBHOOK_URL not set"); return false; }
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.error("Slack send failed:", r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "digest";
  const link = `${APP_BASE}/operator/easycars-posting`;

  try {
    const nowIso = new Date().toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const staleCutoff = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
    const criticalCutoff = new Date(Date.now() - CRITICAL_HOURS * 3600 * 1000).toISOString();

    const [pendingCount, readyCount, postedTodayCount, staleRows, criticalCount] = await Promise.all([
      supabase.from("trades").select("id", { count: "exact", head: true }).eq("easycars_post_status", "pending"),
      supabase.from("trades").select("id", { count: "exact", head: true }).eq("easycars_post_status", "manual_ready"),
      supabase.from("trades").select("id", { count: "exact", head: true })
        .eq("easycars_post_status", "manual_posted").gte("easycars_posted_at", todayStart.toISOString()),
      supabase.from("trades")
        .select("id,rego,vin,year,make,model,dealer_name,easycars_ready_at,easycars_ready_by,easycars_stock_number_manual,sell_price_inc_gst")
        .eq("easycars_post_status", "manual_ready").lt("easycars_ready_at", staleCutoff)
        .order("easycars_ready_at", { ascending: true }).limit(25),
      supabase.from("trades").select("id", { count: "exact", head: true })
        .eq("easycars_post_status", "manual_ready").lt("easycars_ready_at", criticalCutoff),
    ]);

    const pending = pendingCount.count ?? 0;
    const ready = readyCount.count ?? 0;
    const postedToday = postedTodayCount.count ?? 0;
    const stale = staleRows.data ?? [];
    const critical = criticalCount.count ?? 0;

    let sent = false;
    let skipped = false;

    if (mode === "stale") {
      if (stale.length === 0) {
        skipped = true;
      } else {
        const header = critical > 0
          ? `🚨 EasyCars posting backlog — ${critical} item(s) over ${CRITICAL_HOURS}h`
          : `⚠️ EasyCars posting backlog — ${stale.length} item(s) over ${STALE_HOURS}h`;
        const lines = stale.slice(0, 10).map((t: any) => {
          const ageH = (Date.now() - new Date(t.easycars_ready_at).getTime()) / 3600000;
          const veh = [t.year, t.make, t.model].filter(Boolean).join(" ") || "—";
          const id = t.rego || t.vin || "—";
          const price = t.sell_price_inc_gst ? ` · $${Number(t.sell_price_inc_gst).toLocaleString()}` : "";
          return `• \`${id}\` ${veh} — ready ${fmtAge(ageH)} ago by ${t.easycars_ready_by ?? "?"}${price}`;
        }).join("\n");
        const more = stale.length > 10 ? `\n…and ${stale.length - 10} more` : "";
        sent = await slackPost({
          text: header,
          blocks: [
            { type: "header", text: { type: "plain_text", text: header } },
            { type: "section", text: { type: "mrkdwn", text: lines + more } },
            { type: "actions", elements: [
              { type: "button", text: { type: "plain_text", text: "Open posting queue" }, url: link },
            ]},
          ],
        });
      }
    } else {
      const oldest = stale[0];
      const oldestAge = oldest ? (Date.now() - new Date(oldest.easycars_ready_at).getTime()) / 3600000 : null;
      const headerEmoji = critical > 0 ? "🚨" : ready > 0 ? "📋" : "✅";
      const header = `${headerEmoji} EasyCars Manual Posting — daily digest`;
      const body = [
        `*Pending:* ${pending}`,
        `*Manual ready:* ${ready}` + (oldestAge ? ` (oldest ${fmtAge(oldestAge)})` : ""),
        `*Stale (>${STALE_HOURS}h):* ${stale.length}` + (critical > 0 ? ` — *${critical} critical >${CRITICAL_HOURS}h*` : ""),
        `*Posted today:* ${postedToday}`,
      ].join("\n");
      sent = await slackPost({
        text: header,
        blocks: [
          { type: "header", text: { type: "plain_text", text: header } },
          { type: "section", text: { type: "mrkdwn", text: body } },
          { type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: "Open posting queue" }, url: link },
          ]},
          { type: "context", elements: [{ type: "mrkdwn", text: `Generated ${nowIso}` }] },
        ],
      });
    }

    await supabase.from("cron_audit_log").insert({
      cron_name: `easycars-posting-${mode}`,
      success: true,
      result: { pending, ready, posted_today: postedToday, stale: stale.length, critical, sent, skipped },
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({
      mode, sent, skipped, pending, ready, posted_today: postedToday, stale: stale.length, critical,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("easycars-posting-digest error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
