// OpenClaw Market READ — GET endpoint returning unified market_listings rows
// Auth: Bearer OPENCLAW_MARKET_TOKEN. Audited to pulse_audit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MARKET_TOKEN = Deno.env.get("OPENCLAW_MARKET_TOKEN")!;

const RATE_LIMIT = 300;
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
  if (req.method !== "GET") return jres(405, { error: "method_not_allowed" });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const reqId = req.headers.get("x-request-id");

  // Auth
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!MARKET_TOKEN || token !== MARKET_TOKEN) {
    await audit(sb, {
      token_kind: "market", op: "market_read", request_id: reqId,
      response_status: 401, response_ms: Date.now() - t0, caller_ip: ip, error_text: "unauthorized",
    });
    return jres(401, { error: "unauthorized" });
  }

  // Parse query params
  const url = new URL(req.url);
  const qp = url.searchParams;
  const params = {
    source: qp.get("source"),
    source_class: qp.get("source_class"),
    since_minutes: qp.get("since_minutes"),
    min_price: qp.get("min_price"),
    max_price: qp.get("max_price"),
    make: qp.get("make"),
    model: qp.get("model"),
    lifecycle_status: qp.get("lifecycle_status"),
    state: qp.get("state"),
    limit: qp.get("limit"),
  };

  // Rate limit
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString();
  const { count: recentCount } = await sb
    .from("pulse_audit")
    .select("id", { count: "exact", head: true })
    .eq("token_kind", "market")
    .gte("created_at", since);
  if ((recentCount ?? 0) >= RATE_LIMIT) {
    await audit(sb, {
      token_kind: "market", op: "market_read", request_id: reqId, params_json: params,
      response_status: 429, response_ms: Date.now() - t0, caller_ip: ip, error_text: "rate_limited",
    });
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(RATE_WINDOW_MIN * 60) },
    });
  }

  let status = 200;
  let payload: any = null;
  let errText: string | null = null;

  try {
    const sinceMin = Math.max(1, Math.min(43200, Number(params.since_minutes ?? 4320)));
    const limit = Math.max(1, Math.min(2000, Number(params.limit ?? 500)));
    const minPrice = params.min_price != null ? Number(params.min_price) : null;
    const maxPrice = params.max_price != null ? Number(params.max_price) : null;
    const sinceIso = new Date(Date.now() - sinceMin * 60_000).toISOString();

    let q = sb.from("market_listings")
      .select([
        "id","make","model","variant_raw","year","km","price","asking_price",
        "body_type","fuel_type","transmission","colour",
        "source","source_class","status","lifecycle_status",
        "location","state","suburb","postcode",
        "seller_type","auction_house","auction_datetime",
        "market_price","price_difference_percent","price_badge",
        "fingerprint","fingerprint_hash","fingerprint_confidence",
        "first_seen_at","last_seen_at","listing_url","created_at",
      ].join(","))
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (params.source) q = q.eq("source", params.source);
    if (params.source_class) q = q.eq("source_class", params.source_class);
    if (params.make) q = q.ilike("make", params.make);
    if (params.model) q = q.ilike("model", `%${params.model}%`);
    if (params.state) q = q.ilike("state", params.state);
    if (params.lifecycle_status) {
      const statuses = params.lifecycle_status.split(",").map(s => s.trim()).filter(Boolean);
      if (statuses.length) q = q.in("lifecycle_status", statuses);
    }
    if (minPrice != null && Number.isFinite(minPrice)) q = q.gte("price", minPrice);
    if (maxPrice != null && Number.isFinite(maxPrice)) q = q.lte("price", maxPrice);

    const { data, error } = await q;
    if (error) throw error;

    payload = {
      count: data?.length ?? 0,
      since: sinceIso,
      listings: data ?? [],
    };
  } catch (e) {
    status = 500;
    errText = (e as Error).message;
    payload = { error: errText };
  }

  await audit(sb, {
    token_kind: "market", op: "market_read", request_id: reqId, params_json: params,
    response_status: status, response_ms: Date.now() - t0, caller_ip: ip, error_text: errText,
  });
  return jres(status, payload);
});
