/**
 * ops-guardian — Self-healing health check for Carbitrage ingestion pipeline.
 *
 * Runs every 10 minutes via pg_cron. Performs:
 *
 * 1. Reads cron_heartbeat and compares staleness against expected intervals
 *    defined in the CRON_REGISTRY below (single source of truth).
 * 2. For any cron that is stale beyond its threshold, attempts to re-invoke
 *    the edge function directly via fetch() — automatic self-healing.
 * 3. If the re-invocation also fails, or if a cron has failed its last_ok,
 *    posts a Slack alert with diagnosis.
 * 4. Writes its own heartbeat so the system can monitor the monitor.
 * 5. Deduplicates Slack alerts — won't repeat the same alert set within 30 min.
 *
 * This replaces ingestion-health-check with a self-healing, zero-dependency
 * system that runs entirely inside Supabase.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ═══════════════════════════════════════════════════════════════════════════
// CRON REGISTRY — Single source of truth for all monitored crons.
//
// edge_function: the Supabase edge function name to invoke for self-healing
// expected_minutes: how often this cron should fire (used for staleness calc)
// max_stale_minutes: alert/heal threshold (typically 2x expected + buffer)
// can_self_heal: whether we should attempt to re-invoke on staleness
// tier: "critical" | "high" | "medium" | "low" — controls alert urgency
// retired: true = ignore this heartbeat entirely (legacy)
// ═══════════════════════════════════════════════════════════════════════════

interface CronSpec {
  edge_function: string;
  expected_minutes: number;
  max_stale_minutes: number;
  can_self_heal: boolean;
  tier: "critical" | "high" | "medium" | "low";
  retired?: boolean;
}

const CRON_REGISTRY: Record<string, CronSpec> = {
  // ── Caroogle feeds (every 2h) ──
  "caroogle-gumtree-ingest": {
    edge_function: "caroogle-gumtree-cron",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "critical",
  },
  "caroogle-autotrader-ingest": {
    edge_function: "caroogle-autotrader-cron",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "critical",
  },
  "caroogle-toyota-ingest": {
    edge_function: "caroogle-toyota-cron",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "critical",
  },

  // ── Scoring & matching (high frequency) ──
  "score-operator-opportunities": {
    edge_function: "score-operator-opportunities",
    expected_minutes: 30,
    max_stale_minutes: 75,
    can_self_heal: true,
    tier: "critical",
  },
  "run-mandates": {
    edge_function: "run-mandates",
    expected_minutes: 15,
    max_stale_minutes: 45,
    can_self_heal: true,
    tier: "high",
  },
  "pre-josh-filter": {
    edge_function: "pre-josh-filter",
    expected_minutes: 5,
    max_stale_minutes: 20,
    can_self_heal: true,
    tier: "high",
  },

  // ── Auction sources ──
  "pickles-ingest-cron": {
    edge_function: "pickles-ingest-cron",
    expected_minutes: 30,
    max_stale_minutes: 75,
    can_self_heal: true,
    tier: "critical",
  },
  "manheim-html-ingest": {
    edge_function: "manheim-html-ingest",
    expected_minutes: 180,
    max_stale_minutes: 270,
    can_self_heal: true,
    tier: "high",
  },
  "slattery-crawl": {
    edge_function: "slattery-crawl",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },
  "f3-crawl": {
    edge_function: "f3-crawl",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },
  "auto-auctions-ingest": {
    edge_function: "auto-auctions-ingest",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },

  // ── Retail classifieds ──
  "autotrader-api-cron": {
    edge_function: "autotrader-api-cron",
    expected_minutes: 5,
    max_stale_minutes: 20,
    can_self_heal: true,
    tier: "high",
  },
  "gumtree-scan-cron": {
    edge_function: "gumtree-scan-cron",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "high",
  },
  "hunt-scan-cron": {
    edge_function: "hunt-scan-cron",
    expected_minutes: 15,
    max_stale_minutes: 45,
    can_self_heal: true,
    tier: "medium",
  },
  "carsales-micro-cron": {
    edge_function: "carsales-micro-cron",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "high",
  },

  // ── Nightly / periodic jobs ──
  "recompute-fingerprint-performance": {
    edge_function: "recompute-fingerprint-performance",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },
  "crosssafe-scheduler": {
    edge_function: "crosssafe-scheduler",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },
  "autotrader-stale-sweep": {
    edge_function: "autotrader-stale-sweep",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },
  "reconcile-trading-desk": {
    edge_function: "reconcile-trading-desk",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },
  "nightly-demand-recon": {
    edge_function: "nightly-demand-recon",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "low",
  },
  "trading-desk-stale-sweep": {
    edge_function: "trading-desk-stale-sweep",
    expected_minutes: 1440,
    max_stale_minutes: 1560,
    can_self_heal: true,
    tier: "medium",
  },

  // ── Supporting crons ──
  "easyauto-ingest": {
    edge_function: "easyauto-ingest",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "medium",
  },
  "caroogle-pickles-ingest": {
    edge_function: "caroogle-pickles-ingest",
    expected_minutes: 120,
    max_stale_minutes: 240,
    can_self_heal: false, // Not a standard edge function
    tier: "high",
  },
  "crosssafe-worker": {
    edge_function: "crosssafe-worker",
    expected_minutes: 5,
    max_stale_minutes: 20,
    can_self_heal: true,
    tier: "medium",
  },
  "carsales-cleanup": {
    edge_function: "carsales-cleanup",
    expected_minutes: 120,
    max_stale_minutes: 180,
    can_self_heal: true,
    tier: "low",
  },
  "alert-notifier": {
    edge_function: "alert-notifier",
    expected_minutes: 5,
    max_stale_minutes: 20,
    can_self_heal: true,
    tier: "high",
  },
  "pickles-replication-cron": {
    edge_function: "pickles-replication-cron",
    expected_minutes: 30,
    max_stale_minutes: 75,
    can_self_heal: true,
    tier: "medium",
  },

  // ── Scrapers with external dependencies ──
  "fb-marketplace-scan-cron": {
    edge_function: "fb-marketplace-scan-cron",
    expected_minutes: 120,
    max_stale_minutes: 240,
    can_self_heal: false, // External dependency (FB blocking)
    tier: "low",
  },
  "easyauto-scrape": {
    edge_function: "easyauto-scrape",
    expected_minutes: 180,
    max_stale_minutes: 360,
    can_self_heal: false, // Apify actor — may be intentionally paused
    tier: "low",
  },

  // ── Legacy / retired — heartbeats to ignore ──
  "caroogle-shadow-promotion": {
    edge_function: "",
    expected_minutes: 0,
    max_stale_minutes: 0,
    can_self_heal: false,
    tier: "low",
    retired: true,
  },
  "caroogle-shadow-cron": {
    edge_function: "",
    expected_minutes: 0,
    max_stale_minutes: 0,
    can_self_heal: false,
    tier: "low",
    retired: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface HeartbeatRow {
  cron_name: string;
  last_seen_at: string;
  last_ok: boolean;
  note: string | null;
}

interface Alert {
  cron_name: string;
  tier: string;
  status: "STALE" | "FAILING" | "HEALED" | "HEAL_FAILED" | "UNREGISTERED";
  message: string;
  stale_minutes?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-HEALING: Invoke an edge function directly
// ═══════════════════════════════════════════════════════════════════════════

async function invokeEdgeFunction(functionName: string): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 140_000); // 140s — just under edge limit

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: "{}",
      signal: ac.signal,
    });
    clearTimeout(timeout);
    const body = await resp.text();
    return { ok: resp.ok, status: resp.status, body: body.slice(0, 500) };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: msg.slice(0, 500) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SLACK ALERTING
// ═══════════════════════════════════════════════════════════════════════════

async function sendSlack(
  webhookUrl: string,
  alerts: Alert[],
  healed: Alert[],
  stats: { total: number; healthy: number; stale: number; failing: number; healed: number },
): Promise<boolean> {
  const tierEmoji: Record<string, string> = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "⚪",
  };
  const statusEmoji: Record<string, string> = {
    STALE: "⏰",
    FAILING: "❌",
    HEAL_FAILED: "💀",
    HEALED: "🩹",
    UNREGISTERED: "❓",
  };

  const blocks: any[] = [];

  // Header
  if (alerts.length > 0) {
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 Ops Guardian — ${alerts.length} issue(s) detected`,
      },
    });
  }

  // Summary line
  const summaryParts = [];
  if (stats.healthy > 0) summaryParts.push(`✅ ${stats.healthy} healthy`);
  if (stats.stale > 0) summaryParts.push(`⏰ ${stats.stale} stale`);
  if (stats.failing > 0) summaryParts.push(`❌ ${stats.failing} failing`);
  if (stats.healed > 0) summaryParts.push(`🩹 ${stats.healed} self-healed`);

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: summaryParts.join("  •  ") },
  });

  blocks.push({ type: "divider" });

  // Self-healed (good news first)
  for (const h of healed) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🩹 *${h.cron_name}* — Auto-healed\n${h.message}`,
      },
    });
  }

  // Unresolved alerts (bad news)
  for (const a of alerts) {
    const te = tierEmoji[a.tier] || "❓";
    const se = statusEmoji[a.status] || "❓";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${se} ${te} *${a.cron_name}* — \`${a.status}\`\n${a.message}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `ops-guardian | ${new Date().toISOString()} | ${stats.total} crons monitored`,
      },
    ],
  });

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const slackUrl = Deno.env.get("SLACK_OPS_WEBHOOK_URL") || Deno.env.get("SLACK_WEBHOOK_URL");

  try {
    // ── 1. Fetch all heartbeats ──
    const { data: heartbeats, error: hbErr } = await sb
      .from("cron_heartbeat")
      .select("cron_name, last_seen_at, last_ok, note");

    if (hbErr) throw new Error(`Heartbeat query failed: ${hbErr.message}`);

    const hbMap = new Map<string, HeartbeatRow>();
    for (const h of heartbeats || []) {
      hbMap.set(h.cron_name, h);
    }

    const now = Date.now();
    const alerts: Alert[] = [];
    const healed: Alert[] = [];
    let healthyCount = 0;

    // ── 2. Check each registered cron ──
    for (const [cronName, spec] of Object.entries(CRON_REGISTRY)) {
      if (spec.retired) continue;

      const hb = hbMap.get(cronName);

      // No heartbeat at all — never ran
      if (!hb) {
        alerts.push({
          cron_name: cronName,
          tier: spec.tier,
          status: "STALE",
          message: "No heartbeat found — cron has never run or heartbeat row is missing.",
        });
        continue;
      }

      const staleMs = now - new Date(hb.last_seen_at).getTime();
      const staleMinutes = Math.round(staleMs / 60_000);

      // Check last_ok = false (ran but failed)
      if (!hb.last_ok) {
        const noteSnippet = hb.note ? hb.note.slice(0, 200) : "no details";
        alerts.push({
          cron_name: cronName,
          tier: spec.tier,
          status: "FAILING",
          message: `Last run failed ${staleMinutes}min ago: ${noteSnippet}`,
          stale_minutes: staleMinutes,
        });
        continue;
      }

      // Check staleness
      if (staleMinutes > spec.max_stale_minutes) {
        console.log(
          `[ops-guardian] ${cronName} is stale: ${staleMinutes}min (threshold: ${spec.max_stale_minutes}min)`,
        );

        // ── Attempt self-healing ──
        if (spec.can_self_heal && spec.edge_function) {
          console.log(`[ops-guardian] Attempting self-heal: invoking ${spec.edge_function}...`);
          const result = await invokeEdgeFunction(spec.edge_function);

          if (result.ok) {
            console.log(`[ops-guardian] Self-heal SUCCESS for ${cronName} (HTTP ${result.status})`);
            healed.push({
              cron_name: cronName,
              tier: spec.tier,
              status: "HEALED",
              message: `Was ${staleMinutes}min stale (threshold ${spec.max_stale_minutes}min). Auto-invoked \`${spec.edge_function}\` → HTTP ${result.status}.`,
              stale_minutes: staleMinutes,
            });
            continue;
          } else {
            console.error(
              `[ops-guardian] Self-heal FAILED for ${cronName}: HTTP ${result.status} — ${result.body}`,
            );
            alerts.push({
              cron_name: cronName,
              tier: spec.tier,
              status: "HEAL_FAILED",
              message: `${staleMinutes}min stale. Auto-heal attempted but failed: HTTP ${result.status}. Edge function: \`${spec.edge_function}\`. Error: ${result.body.slice(0, 150)}`,
              stale_minutes: staleMinutes,
            });
            continue;
          }
        }

        // Can't self-heal — just alert
        alerts.push({
          cron_name: cronName,
          tier: spec.tier,
          status: "STALE",
          message: `${staleMinutes}min since last run (threshold: ${spec.max_stale_minutes}min). Cannot self-heal — requires manual intervention.`,
          stale_minutes: staleMinutes,
        });
        continue;
      }

      // Healthy
      healthyCount++;
    }

    // ── 3. Check for unregistered heartbeats (new crons someone added) ──
    for (const [cronName] of hbMap) {
      if (!CRON_REGISTRY[cronName]) {
        // Don't alert, just log — these are crons we haven't registered yet
        console.log(`[ops-guardian] Unregistered heartbeat: ${cronName}`);
      }
    }

    // ── 4. Slack alerting (deduplicated) ──
    const stats = {
      total: Object.entries(CRON_REGISTRY).filter(([_, s]) => !s.retired).length,
      healthy: healthyCount,
      stale: alerts.filter((a) => a.status === "STALE" || a.status === "HEAL_FAILED").length,
      failing: alerts.filter((a) => a.status === "FAILING").length,
      healed: healed.length,
    };

    let slackSent = false;

    if ((alerts.length > 0 || healed.length > 0) && slackUrl) {
      // Dedup check: don't repeat identical alerts within 30 min
      const alertKey = alerts
        .map((a) => `${a.cron_name}:${a.status}`)
        .sort()
        .join("|");

      const { data: lastAudit } = await sb
        .from("cron_audit_log")
        .select("run_at, error")
        .eq("cron_name", "ops-guardian")
        .order("run_at", { ascending: false })
        .limit(1)
        .single();

      const lastKey = lastAudit?.error || "";
      const lastAge = lastAudit?.run_at
        ? (now - new Date(lastAudit.run_at).getTime()) / 60_000
        : Infinity;

      // Send if: alerts changed, or been >30min, or we have healed items to report
      if (alertKey !== lastKey || lastAge > 30 || healed.length > 0) {
        slackSent = await sendSlack(slackUrl, alerts, healed, stats);
      } else {
        console.log("[ops-guardian] Suppressing duplicate Slack alert (same issues, <30min)");
      }

      // Log the alert key for dedup
      await sb.from("cron_audit_log").insert({
        cron_name: "ops-guardian",
        run_date: new Date().toISOString().split("T")[0],
        success: alerts.length === 0,
        result: { stats, alerts_count: alerts.length, healed_count: healed.length, slack_sent: slackSent },
        error: alertKey || null,
      });
    }

    // ── 5. Write own heartbeat ──
    const runtimeMs = Date.now() - startTime;
    await sb.from("cron_heartbeat").upsert(
      {
        cron_name: "ops-guardian",
        last_seen_at: new Date().toISOString(),
        last_ok: true,
        note: `healthy=${stats.healthy} stale=${stats.stale} failing=${stats.failing} healed=${stats.healed} slack=${slackSent} ms=${runtimeMs}`,
      },
      { onConflict: "cron_name" },
    );

    const response = {
      success: true,
      stats,
      alerts: alerts.map((a) => ({
        cron: a.cron_name,
        tier: a.tier,
        status: a.status,
        message: a.message,
      })),
      healed: healed.map((h) => ({
        cron: h.cron_name,
        message: h.message,
      })),
      slack_sent: slackSent,
      runtime_ms: runtimeMs,
    };

    console.log(`[ops-guardian] Complete:`, JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ops-guardian] Fatal:`, errorMsg);

    // Still try to write heartbeat on failure
    try {
      await sb.from("cron_heartbeat").upsert(
        {
          cron_name: "ops-guardian",
          last_seen_at: new Date().toISOString(),
          last_ok: false,
          note: `FATAL: ${errorMsg.slice(0, 200)}`,
        },
        { onConflict: "cron_name" },
      );
    } catch (_) {}

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
