// OpenClaw WRITE edge function — Pulse Agent
// Auth: Bearer OPENCLAW_WRITE_TOKEN. Idempotent via x-request-id (24h cache).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WRITE_TOKEN = Deno.env.get("OPENCLAW_WRITE_TOKEN")!;

const ALLOWED_OPS = new Set(["record_alert", "record_unmatched_model", "log_health"]);
const RATE_LIMIT = 200;
const RATE_WINDOW_MIN = 15;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function audit(sb: any, row: Record<string, unknown>) {
  try { await sb.from("pulse_audit").insert(row); } catch (_) { /* swallow */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const reqId = req.headers.get("x-request-id");

  // Auth
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== WRITE_TOKEN) {
    await audit(sb, {
      token_kind: "write", op: "_auth", request_id: reqId, params_json: null,
      response_status: 401, response_ms: Date.now() - t0, caller_ip: ip, error_text: "bad_token",
    });
    return jres(401, { error: "unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return jres(400, { error: "invalid_json" }); }
  const op = String(body?.op ?? "");
  const params = body?.params ?? {};

  if (!ALLOWED_OPS.has(op)) {
    await audit(sb, {
      token_kind: "write", op: op || "_missing", request_id: reqId, params_json: params,
      response_status: 400, response_ms: Date.now() - t0, caller_ip: ip, error_text: "op_not_allowed",
    });
    return jres(400, { error: "op_not_allowed", op });
  }

  // Rate limit
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString();
  const { count: recentCount } = await sb
    .from("pulse_audit")
    .select("id", { count: "exact", head: true })
    .eq("token_kind", "write")
    .gte("created_at", since);
  if ((recentCount ?? 0) >= RATE_LIMIT) {
    await audit(sb, {
      token_kind: "write", op, request_id: reqId, params_json: params,
      response_status: 429, response_ms: Date.now() - t0, caller_ip: ip, error_text: "rate_limited",
    });
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(RATE_WINDOW_MIN * 60) },
    });
  }

  // Idempotency: same (op, request_id) within 24h returns cached response
  if (reqId) {
    const since24 = new Date(Date.now() - 86_400_000).toISOString();
    const { data: prior } = await sb.from("pulse_audit")
      .select("response_status, cached_response")
      .eq("token_kind", "write").eq("op", op).eq("request_id", reqId)
      .gte("created_at", since24)
      .not("cached_response", "is", null)
      .order("created_at", { ascending: false }).limit(1);
    if (prior && prior.length > 0) {
      return jres(prior[0].response_status ?? 200, prior[0].cached_response);
    }
  }

  let status = 200;
  let payload: any = null;
  let errText: string | null = null;

  try {
    if (op === "record_alert") {
      const insert = {
        listing_id: String(params.listing_id),
        family_key: params.family_key ?? null,
        source: params.source ?? null,
        status: params.status ?? null,
        candidate_price: params.candidate_price ?? null,
        cheapest_peer: params.cheapest_peer ?? null,
        median_peer: params.median_peer ?? null,
        peer_count: params.peer_count ?? null,
        gap_to_cheapest: params.gap_to_cheapest ?? null,
        gap_to_median: params.gap_to_median ?? null,
        composite_score: params.composite_score ?? null,
        reasoning_json: params.reasoning_json ?? null,
      };
      const { data, error } = await sb.from("pulse_alerts").insert(insert).select("id, alerted_at").single();
      if (error) throw error;
      payload = { id: data.id, alerted_at: data.alerted_at };
    }

    else if (op === "record_unmatched_model") {
      const make = String(params.make ?? "").trim();
      const model = String(params.model ?? "").trim();
      if (!make && !model) throw new Error("make_or_model_required");
      // Upsert: try insert, on conflict bump count + last_seen
      const { data: existing } = await sb.from("pulse_unmatched_models")
        .select("id, occurrence_count").eq("make", make).eq("model", model).maybeSingle();
      if (existing) {
        const { data, error } = await sb.from("pulse_unmatched_models")
          .update({ occurrence_count: (existing.occurrence_count ?? 0) + 1, last_seen_at: new Date().toISOString() })
          .eq("id", existing.id).select("id, occurrence_count").single();
        if (error) throw error;
        payload = { id: data.id, occurrence_count: data.occurrence_count };
      } else {
        const { data, error } = await sb.from("pulse_unmatched_models")
          .insert({ make, model }).select("id, occurrence_count").single();
        if (error) throw error;
        payload = { id: data.id, occurrence_count: data.occurrence_count };
      }
    }

    else if (op === "log_health") {
      const insert = {
        script: String(params.script ?? "unknown"),
        rows_scanned: params.rows_scanned ?? null,
        alerts_emitted: params.alerts_emitted ?? null,
        errors_seen: params.errors_seen ?? null,
        notes: params.notes ?? null,
      };
      const { data, error } = await sb.from("pulse_health_log").insert(insert).select("id").single();
      if (error) throw error;
      payload = { id: data.id };
    }
  } catch (e) {
    status = 500;
    errText = (e as Error).message;
    payload = { error: errText };
  }

  await audit(sb, {
    token_kind: "write", op, request_id: reqId, params_json: params,
    response_status: status, response_ms: Date.now() - t0, caller_ip: ip, error_text: errText,
    cached_response: status < 500 && reqId ? payload : null,
  });
  return jres(status, payload);
});
