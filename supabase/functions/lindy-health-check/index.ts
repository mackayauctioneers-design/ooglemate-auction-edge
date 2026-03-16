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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Auth: HMAC signature OR Bearer token ──
  const secret = Deno.env.get("LINDY_WEBHOOK_SECRET");
  const rawBody = await req.text();
  if (secret) {
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const hmacSig = req.headers.get("x-lindy-signature") || "";

    // Accept either: Bearer <secret> OR HMAC signature
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
  const h6 = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const m30 = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const h2 = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const errors: string[] = [];

  // ── 1. Ingestion volume ──
  let ingestion: any = null;
  try {
    const { data: last24, error: e1 } = await sb
      .from("outward_search_results")
      .select("source_key")
      .gte("ingested_at", h24);
    if (e1) throw e1;

    const { data: prev24, error: e2 } = await sb
      .from("outward_search_results")
      .select("source_key")
      .gte("ingested_at", h48)
      .lt("ingested_at", h24);
    if (e2) throw e2;

    const countBy = (rows: any[]) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[r.source_key] = (m[r.source_key] || 0) + 1;
      return m;
    };
    const last24By = countBy(last24 || []);
    const prev24By = countBy(prev24 || []);
    const allKeys = [...new Set([...Object.keys(last24By), ...Object.keys(prev24By)])];
    const bySource: Record<string, { last_24h: number; prev_24h: number }> = {};
    for (const k of allKeys) {
      bySource[k] = { last_24h: last24By[k] || 0, prev_24h: prev24By[k] || 0 };
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

  // ── 2. Stuck jobs (processing > 30min) ──
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
    stuckIds = (data || []).map((r: any) => r.id);
  } catch (e: any) {
    errors.push(`stuck_jobs: ${e.message || e}`);
  }

  // ── 3. Failed jobs last 24h ──
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

  // ── 4. Cron heartbeats ──
  let heartbeats: any[] = [];
  try {
    const { data, error } = await sb
      .from("cron_heartbeat")
      .select("cron_name, last_seen_at, last_ok");
    if (error) throw error;
    heartbeats = (data || []).map((h: any) => ({
      cron_name: h.cron_name,
      last_seen_at: h.last_seen_at,
      last_ok: h.last_ok,
      stale: h.last_seen_at ? new Date(h.last_seen_at).getTime() < new Date(h2).getTime() : true,
    }));
  } catch (e: any) {
    errors.push(`heartbeats: ${e.message || e}`);
  }

  // ── 5. Queue depth ──
  let queue: Record<string, number> = {};
  try {
    const { data, error } = await sb
      .from("cheap_car_queue")
      .select("status");
    if (error) throw error;
    for (const r of data || []) {
      queue[r.status] = (queue[r.status] || 0) + 1;
    }
  } catch (e: any) {
    errors.push(`queue: ${e.message || e}`);
  }

  // ── 6. Compute overall status ──
  const staleHeartbeats = heartbeats.filter((h) => h.stale).length;
  const zeroIngestion6h = ingestion
    ? ingestion.last_24h_total === 0
    : false;
  const volumeDrop = ingestion?.change_pct !== null && ingestion?.change_pct < -20;

  let status = "healthy";
  if (stuckCount > 0 || zeroIngestion6h || staleHeartbeats >= 2) {
    status = "critical";
  } else if (volumeDrop || staleHeartbeats === 1 || failedCount > 5) {
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
    heartbeats,
    queue,
    ...(errors.length > 0 ? { errors } : {}),
  };

  console.log(`[lindy-health-check] status=${status} ingestion=${ingestion?.last_24h_total ?? "?"} stuck=${stuckCount} failed=${failedCount} stale_hb=${staleHeartbeats}`);

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
