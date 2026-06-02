// OpenClaw Intelligence Write — persistent memory layer endpoint.
// Auth: Bearer OPENCLAW_WRITE_TOKEN. Op-based (record_sold, record_opportunity,
// rebuild_fingerprints, write_daily_snapshot). Idempotent via x-request-id.
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

const ALLOWED_OPS = new Set([
  "record_sold",
  "record_opportunity",
  "record_wholesale_opportunity",
  "rebuild_fingerprints",
  "write_daily_snapshot",
]);

// Gates for opportunities
const MIN_MATCH_SCORE = 50;
const MIN_MARGIN_DOLLARS = 1000;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function audit(sb: any, row: Record<string, unknown>) {
  try { await sb.from("pulse_audit").insert(row); } catch (_) {}
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const reqId = req.headers.get("x-request-id");

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== WRITE_TOKEN) {
    await audit(sb, { token_kind: "openclaw_intel", op: "_auth", request_id: reqId, response_status: 401, response_ms: Date.now()-t0, caller_ip: ip, error_text: "bad_token" });
    return jres(401, { error: "unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return jres(400, { error: "invalid_json" }); }
  const op = String(body?.op ?? "");
  const params = body?.params ?? {};

  if (!ALLOWED_OPS.has(op)) {
    await audit(sb, { token_kind: "openclaw_intel", op: op || "_missing", request_id: reqId, params_json: params, response_status: 400, response_ms: Date.now()-t0, caller_ip: ip, error_text: "op_not_allowed" });
    return jres(400, { error: "op_not_allowed", op });
  }

  // Idempotency cache (24h)
  if (reqId) {
    const since24 = new Date(Date.now() - 86_400_000).toISOString();
    const { data: prior } = await sb.from("pulse_audit")
      .select("response_status, cached_response")
      .eq("token_kind", "openclaw_intel").eq("op", op).eq("request_id", reqId)
      .gte("created_at", since24).not("cached_response", "is", null)
      .order("created_at", { ascending: false }).limit(1);
    if (prior && prior.length > 0) return jres(prior[0].response_status ?? 200, prior[0].cached_response);
  }

  let status = 200;
  let payload: any = null;
  let errText: string | null = null;

  try {
    if (op === "record_sold") {
      if (!params.dealer_id) throw new Error("dealer_id required");
      const row = {
        dealer_id: String(params.dealer_id),
        stock_number: params.stock_number ?? null,
        vin: params.vin ?? null,
        make: params.make ?? null,
        model: params.model ?? null,
        variant: params.variant ?? null,
        year: params.year ?? null,
        km: params.km ?? null,
        colour: params.colour ?? null,
        listed_price: params.listed_price ?? null,
        first_seen: params.first_seen ?? null,
        last_seen: params.last_seen ?? null,
        sold_date: params.sold_date ?? null,
        days_online: params.days_online ?? null,
        sale_confidence: params.sale_confidence ?? null,
        source: params.source ?? null,
        raw_snapshot: params.raw_snapshot ?? null,
      };
      // Compute days_online if missing
      if (row.days_online == null && row.first_seen && row.sold_date) {
        const ms = new Date(row.sold_date as string).getTime() - new Date(row.first_seen as string).getTime();
        row.days_online = Math.max(0, Math.round(ms / 86_400_000));
      }
      const onConflict = row.stock_number ? "dealer_id,stock_number" : (row.vin ? "dealer_id,vin" : undefined);
      const q = onConflict
        ? sb.from("dealer_sales_truth").upsert(row, { onConflict }).select("id").single()
        : sb.from("dealer_sales_truth").insert(row).select("id").single();
      const { data, error } = await q;
      if (error) throw error;
      payload = { id: data.id };
    }

    else if (op === "record_opportunity") {
      if (!params.dealer_id || !params.source || !params.listing_id) {
        throw new Error("dealer_id, source, listing_id required");
      }
      const price = Number(params.price ?? 0);
      const margin = Number(params.estimated_margin ?? 0);
      const score = Number(params.fingerprint_match_score ?? 0);
      if (!(price > 0)) throw new Error("invalid_price: price > 0 required");
      if (!(margin >= MIN_MARGIN_DOLLARS)) throw new Error(`insufficient_margin: >= $${MIN_MARGIN_DOLLARS} required`);
      if (!(score >= MIN_MATCH_SCORE)) throw new Error(`low_match_score: >= ${MIN_MATCH_SCORE} required`);

      const row = {
        dealer_id: String(params.dealer_id),
        source: String(params.source),
        listing_id: String(params.listing_id),
        make: params.make ?? null,
        model: params.model ?? null,
        variant: params.variant ?? null,
        year: params.year ?? null,
        km: params.km ?? null,
        price, estimated_margin: margin,
        freight_cost: params.freight_cost ?? null,
        fingerprint_id: params.fingerprint_id ?? null,
        fingerprint_match_score: score,
        confidence: params.confidence ?? null,
        auction_date: params.auction_date ?? null,
        listing_url: params.listing_url ?? null,
        status: params.status ?? "new",
        why_json: params.why_json ?? null,
      };
      const { data, error } = await sb
        .from("dealer_live_opportunities")
        .upsert(row, { onConflict: "dealer_id,source,listing_id" })
        .select("id").single();
      if (error) throw error;
      payload = { id: data.id };
    }

    else if (op === "rebuild_fingerprints") {
      if (!params.dealer_id) throw new Error("dealer_id required");
      const { data, error } = await sb.rpc("rebuild_dealer_fingerprints", { p_dealer_id: params.dealer_id });
      if (error) throw error;
      payload = { rebuilt: data };
    }

    else if (op === "write_daily_snapshot") {
      if (!params.dealer_id || !params.snapshot_date) throw new Error("dealer_id, snapshot_date required");
      const row = {
        dealer_id: String(params.dealer_id),
        snapshot_date: String(params.snapshot_date),
        sold_count: params.sold_count ?? 0,
        fast_movers: params.fast_movers ?? null,
        aged_stock_cleared: params.aged_stock_cleared ?? null,
        replacement_targets: params.replacement_targets ?? null,
        opportunities_found: params.opportunities_found ?? 0,
        notes: params.notes ?? null,
      };
      const { data, error } = await sb
        .from("dealer_daily_snapshots")
        .upsert(row, { onConflict: "dealer_id,snapshot_date" })
        .select("id").single();
      if (error) throw error;
      payload = { id: data.id };
    }
  } catch (e) {
    status = 400;
    errText = (e as Error).message;
    payload = { error: errText };
  }

  await audit(sb, {
    token_kind: "openclaw_intel", op, request_id: reqId, params_json: params,
    response_status: status, response_ms: Date.now() - t0, caller_ip: ip, error_text: errText,
    cached_response: status < 500 && reqId ? payload : null,
  });
  return jres(status, payload);
});
