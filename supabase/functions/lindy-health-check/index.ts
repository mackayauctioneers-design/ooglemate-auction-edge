/**
 * lindy-health-check — Daily health summary for the Carbitrage ingestion pipeline.
 * Called by an external Lindy agent. Secured via HMAC-SHA256 (LINDY_WEBHOOK_SECRET).
 *
 * Always returns 200 with partial data + errors array if individual queries fail.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lindy-signature",
};

type MonitorTier = "critical" | "high" | "medium" | "low" | "unknown";

interface CronSpec {
  expected_minutes: number;
  max_stale_minutes: number;
  tier: Exclude<MonitorTier, "unknown">;
  retired?: boolean;
}

interface HeartbeatRow {
  cron_name: string;
  last_seen_at: string | null;
  last_ok: boolean;
}

interface HeartbeatSummary extends HeartbeatRow {
  monitored: boolean;
  retired: boolean;
  tier: MonitorTier;
  expected_minutes: number | null;
  max_stale_minutes: number | null;
  stale_minutes: number | null;
  stale: boolean;
  failing: boolean;
}

const CRON_REGISTRY: Record<string, CronSpec> = {
  "caroogle-gumtree-ingest": { expected_minutes: 120, max_stale_minutes: 180, tier: "critical" },
  "caroogle-autotrader-ingest": { expected_minutes: 120, max_stale_minutes: 180, tier: "critical" },
  "caroogle-toyota-ingest": { expected_minutes: 120, max_stale_minutes: 180, tier: "critical" },
  "caroogle-pickles-ingest": { expected_minutes: 120, max_stale_minutes: 240, tier: "high" },
  "score-operator-opportunities": { expected_minutes: 30, max_stale_minutes: 75, tier: "critical" },
  "run-mandates": { expected_minutes: 15, max_stale_minutes: 45, tier: "high" },
  "pre-josh-filter": { expected_minutes: 5, max_stale_minutes: 20, tier: "high" },
  "pickles-ingest-cron": { expected_minutes: 30, max_stale_minutes: 75, tier: "critical" },
  "pickles-replication-cron": { expected_minutes: 30, max_stale_minutes: 75, tier: "medium" },
  "manheim-html-ingest": { expected_minutes: 180, max_stale_minutes: 270, tier: "high" },
  "easyauto-ingest": { expected_minutes: 120, max_stale_minutes: 180, tier: "medium" },
  "easyauto-scrape": { expected_minutes: 180, max_stale_minutes: 360, tier: "low" },
  "autotrader-api-cron": { expected_minutes: 5, max_stale_minutes: 20, tier: "high" },
  "gumtree-scan-cron": { expected_minutes: 120, max_stale_minutes: 180, tier: "high" },
  "hunt-scan-cron": { expected_minutes: 15, max_stale_minutes: 45, tier: "medium" },
  "carsales-micro-cron": { expected_minutes: 120, max_stale_minutes: 180, tier: "high" },
  "carsales_micro_cron_high": { expected_minutes: 120, max_stale_minutes: 210, tier: "high" },
  "carsales_micro_cron_medium": { expected_minutes: 360, max_stale_minutes: 480, tier: "medium" },
  "carsales_micro_cron_low": { expected_minutes: 720, max_stale_minutes: 900, tier: "low" },
  "crosssafe-worker": { expected_minutes: 5, max_stale_minutes: 20, tier: "medium" },
  "crosssafe-scheduler": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "autotrader-stale-sweep": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "recompute-fingerprint-performance": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "reconcile-trading-desk": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "nightly-demand-recon": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "low" },
  "trading-desk-stale-sweep": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "slattery-crawl": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "f3-crawl": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "auto-auctions-ingest": { expected_minutes: 1440, max_stale_minutes: 1560, tier: "medium" },
  "fb-marketplace-scan-cron": { expected_minutes: 120, max_stale_minutes: 240, tier: "low" },
  "alert-notifier": { expected_minutes: 5, max_stale_minutes: 20, tier: "high" },
  "caroogle-shadow-promotion": { expected_minutes: 0, max_stale_minutes: 0, tier: "low", retired: true },
  "caroogle-shadow-cron": { expected_minutes: 0, max_stale_minutes: 0, tier: "low", retired: true },
};

async function verifyHmac(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

function summarizeHeartbeat(nowMs: number, heartbeat: HeartbeatRow): HeartbeatSummary {
  const spec = CRON_REGISTRY[heartbeat.cron_name];
  const monitored = Boolean(spec);
  const retired = Boolean(spec?.retired);
  const staleMinutes = heartbeat.last_seen_at
    ? Math.round((nowMs - new Date(heartbeat.last_seen_at).getTime()) / 60000)
    : null;
  const stale = monitored && !retired
    ? staleMinutes === null || staleMinutes > spec.max_stale_minutes
    : false;
  const failing = monitored && !retired && heartbeat.last_ok === false;

  return {
    cron_name: heartbeat.cron_name,
    last_seen_at: heartbeat.last_seen_at,
    last_ok: heartbeat.last_ok,
    monitored,
    retired,
    tier: spec?.tier ?? "unknown",
    expected_minutes: spec?.expected_minutes ?? null,
    max_stale_minutes: spec?.max_stale_minutes ?? null,
    stale_minutes: staleMinutes,
    stale,
    failing,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const secret = Deno.env.get("LINDY_WEBHOOK_SECRET");
  const rawBody = await req.text();
  if (secret) {
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const hmacSig = req.headers.get("x-lindy-signature") || "";

    const bearerOk = bearerToken === secret;
    const hmacOk = hmacSig ? await verifyHmac(rawBody, hmacSig, secret) : false;

    if (!bearerOk && !hmacOk) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const m30 = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();
  const errors: string[] = [];

  let ingestion: {
    last_24h_total: number;
    prev_24h_total: number;
    change_pct: number | null;
    by_source: Record<string, { last_24h: number; prev_24h: number }>;
  } | null = null;

  try {
    const { data: last24, error: e1 } = await sb
      .from("vehicle_listings")
      .select("source")
      .gte("updated_at", h24);
    if (e1) throw e1;

    const { data: prev24, error: e2 } = await sb
      .from("vehicle_listings")
      .select("source")
      .gte("updated_at", h48)
      .lt("updated_at", h24);
    if (e2) throw e2;

    const countBy = (rows: Array<{ source: string | null }>) => {
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const key = row.source || "unknown";
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    };

    const last24By = countBy((last24 || []) as Array<{ source: string | null }>);
    const prev24By = countBy((prev24 || []) as Array<{ source: string | null }>);
    const allKeys = [...new Set([...Object.keys(last24By), ...Object.keys(prev24By)])];
    const bySource: Record<string, { last_24h: number; prev_24h: number }> = {};

    for (const key of allKeys) {
      bySource[key] = {
        last_24h: last24By[key] || 0,
        prev_24h: prev24By[key] || 0,
      };
    }

    const last24Total = (last24 || []).length;
    const prev24Total = (prev24 || []).length;
    const changePct = prev24Total > 0
      ? Math.round(((last24Total - prev24Total) / prev24Total) * 1000) / 10
      : null;

    ingestion = {
      last_24h_total: last24Total,
      prev_24h_total: prev24Total,
      change_pct: changePct,
      by_source: bySource,
    };
  } catch (e: any) {
    errors.push(`ingestion: ${e.message || e}`);
  }

  let stuckCount = 0;
  let stuckIds: string[] = [];
  try {
    const { data, error } = await sb
      .from("outward_jobs")
      .select("id")
      .eq("status", "processing")
      .lt("dispatched_at", m30);
    if (error) throw error;
    stuckCount = (data || []).length;
    stuckIds = (data || []).map((row: { id: string }) => row.id);
  } catch (e: any) {
    errors.push(`stuck_jobs: ${e.message || e}`);
  }

  let failedCount = 0;
  try {
    const { count, error } = await sb
      .from("outward_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", h24);
    if (error) throw error;
    failedCount = count || 0;
  } catch (e: any) {
    errors.push(`failed_jobs: ${e.message || e}`);
  }

  let heartbeats: HeartbeatSummary[] = [];
  try {
    const { data, error } = await sb
      .from("cron_heartbeat")
      .select("cron_name, last_seen_at, last_ok");
    if (error) throw error;
    heartbeats = ((data || []) as HeartbeatRow[])
      .map((heartbeat) => summarizeHeartbeat(now.getTime(), heartbeat))
      .sort((a, b) => {
        const aTime = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
        const bTime = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
        return aTime - bTime;
      });
  } catch (e: any) {
    errors.push(`heartbeats: ${e.message || e}`);
  }

  let queue: Record<string, number> = {};
  try {
    const { data, error } = await sb
      .from("cheap_car_queue")
      .select("status");
    if (error) throw error;
    for (const row of data || []) {
      queue[row.status] = (queue[row.status] || 0) + 1;
    }
  } catch (e: any) {
    errors.push(`queue: ${e.message || e}`);
  }

  const monitoredHeartbeats = heartbeats.filter((heartbeat) => heartbeat.monitored && !heartbeat.retired);
  const staleHeartbeats = monitoredHeartbeats.filter((heartbeat) => heartbeat.stale);
  const failingHeartbeats = monitoredHeartbeats.filter((heartbeat) => heartbeat.failing);
  const criticalBlockingCount = new Set(
    [...staleHeartbeats, ...failingHeartbeats]
      .filter((heartbeat) => heartbeat.tier === "critical" || heartbeat.tier === "high")
      .map((heartbeat) => heartbeat.cron_name),
  ).size;
  const zeroIngestion24h = ingestion ? ingestion.last_24h_total === 0 : false;
  const volumeDrop = typeof ingestion?.change_pct === "number" && ingestion.change_pct < -20;

  let status = "healthy";
  if (stuckCount > 0 || zeroIngestion24h || criticalBlockingCount > 0) {
    status = "critical";
  } else if (volumeDrop || staleHeartbeats.length > 0 || failingHeartbeats.length > 0 || failedCount > 5) {
    status = "degraded";
  }

  const response = {
    status,
    checked_at: now.toISOString(),
    ingestion,
    jobs: {
      stuck_count: stuckCount,
      stuck_ids: stuckIds,
      failed_last_24h: failedCount,
    },
    heartbeat_summary: {
      monitored: monitoredHeartbeats.length,
      stale: staleHeartbeats.length,
      failing: failingHeartbeats.length,
      critical_or_high_issues: criticalBlockingCount,
    },
    heartbeats,
    queue,
    ...(errors.length > 0 ? { errors } : {}),
  };

  console.log(
    `[lindy-health-check] status=${status} ingestion=${ingestion?.last_24h_total ?? "?"} stuck=${stuckCount} failed=${failedCount} stale_hb=${staleHeartbeats.length} failing_hb=${failingHeartbeats.length}`,
  );

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});