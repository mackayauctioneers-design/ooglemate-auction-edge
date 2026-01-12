/// <reference lib="deno.ns" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Row = {
  region_id: string | null;
  make: string | null;
  model: string | null;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  cleared_total: number | null;
  avg_days_to_clear: number | null;
  confidence_level: string | null;
  missing_benchmark: boolean;
  thin_benchmark: boolean;
  stale_benchmark: boolean;
  impact_score: number | null;
};

function fmtYears(r: Row) {
  if (!r.year_min || !r.year_max) return "—";
  return r.year_min === r.year_max ? `${r.year_min}` : `${r.year_min}–${r.year_max}`;
}

function issues(r: Row) {
  const out: string[] = [];
  if (r.missing_benchmark) out.push("Missing");
  if (r.thin_benchmark) out.push("Thin");
  if (r.stale_benchmark) out.push("Stale");
  return out.length ? out.join(", ") : "—";
}

function safe(v: string | null | undefined) {
  return (v ?? "—").toString();
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";

  if (!SLACK_WEBHOOK_URL) {
    return new Response(JSON.stringify({ error: "Missing SLACK_WEBHOOK_URL secret" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // Pull top 5 by impact score
    const { data, error } = await supabase
      .from("fingerprint_benchmark_watchlist")
      .select("*")
      .order("impact_score", { ascending: false, nullsFirst: false })
      .limit(5);

    if (error) throw error;

    const rows = (data as Row[]) || [];
    const today = new Date().toISOString().slice(0, 10);

    if (rows.length === 0) {
      await postSlack(SLACK_WEBHOOK_URL, [
        { type: "header", text: { type: "plain_text", text: `✅ Benchmark Watchlist (${today})`, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: "No benchmark issues right now. Nice." } },
      ]);

      return new Response(JSON.stringify({ success: true, sent: true, count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: `📌 Benchmark Watchlist Top 5 (${today})`, emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "These fingerprints need a logged sale to harden benchmarks. Highest impact first.",
        },
      },
      { type: "divider" },
    ];

    rows.forEach((r, idx) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*${idx + 1}.* *${safe(r.make)} ${safe(r.model)} ${safe(r.variant_family) === "—" ? "" : `(${safe(r.variant_family)})`}* ` +
            `• ${safe(r.region_id)} • Years: ${fmtYears(r)}\n` +
            `Clears: *${r.cleared_total ?? 0}* • Avg days: ${r.avg_days_to_clear ? Math.round(r.avg_days_to_clear) + "d" : "—"} • ` +
            `Confidence: *${safe(r.confidence_level)}* • Issues: *${issues(r)}* • Impact: *${r.impact_score?.toFixed(2) ?? "—"}*`,
        },
      });
    });

    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Action: open *Operator → Benchmark Watchlist* and hit *Log Sale* on any row you can fill.",
      },
    });

    await postSlack(SLACK_WEBHOOK_URL, blocks);

    // Audit log
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "benchmark-watchlist-slack",
        run_date: today,
        success: true,
        result: { sent: true, rows: rows.length },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true, sent: true, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    // Audit failure
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "benchmark-watchlist-slack",
        run_date: today,
        success: false,
        error: msg,
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
