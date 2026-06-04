// openclaw-push-opportunities — batch upsert into dealer_live_opportunities
// Auth: X-OpenClaw-Token or Bearer OPENCLAW_WRITE_TOKEN (never expose service_role to OpenClaw).
// Body: { opportunities: [ {...}, ... ] }  (max 100 per call)
// Upsert key: (account_id, source, listing_id)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-openclaw-token, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WRITE_TOKEN = Deno.env.get("OPENCLAW_WRITE_TOKEN")!;

const MAX_BATCH = 100;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(o: any) {
  if (!o || typeof o !== "object") return { error: "invalid_record" };
  const account_id = o.account_id ?? null;
  const source = o.source != null ? String(o.source) : null;
  const listing_id = (o.listing_id ?? o.source_listing_id) != null
    ? String(o.listing_id ?? o.source_listing_id)
    : null;
  if (!account_id) return { error: "account_id required" };
  if (!source) return { error: "source required" };
  if (!listing_id) return { error: "listing_id required" };

  return {
    row: {
      account_id: String(account_id),
      dealer_id: o.dealer_id ?? null,
      source,
      listing_id,
      make: o.make ?? null,
      model: o.model ?? null,
      variant: o.variant ?? null,
      year: o.year != null ? Number(o.year) : null,
      km: o.km != null ? Number(o.km) : null,
      price: o.price != null ? Number(o.price) : null,
      estimated_margin: o.estimated_margin != null ? Number(o.estimated_margin) : null,
      freight_cost: o.freight_cost != null ? Number(o.freight_cost) : null,
      fingerprint_id: o.fingerprint_id ?? null,
      fingerprint_match_score: o.fingerprint_match_score != null
        ? Number(o.fingerprint_match_score) : null,
      confidence: o.confidence ?? null,
      auction_date: o.auction_date ?? null,
      listing_url: o.listing_url ?? null,
      status: o.status ?? "new",
      why_json: o.why_json ?? null,
      updated_at: new Date().toISOString(),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  const xToken = req.headers.get("X-OpenClaw-Token") || "";
  const token = xToken || authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token || token !== Deno.env.get("OPENCLAW_WRITE_TOKEN")) {
    return jres(401, { error: "Unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return jres(400, { error: "invalid_json" }); }

  const list = Array.isArray(body?.opportunities)
    ? body.opportunities
    : Array.isArray(body) ? body : (body?.opportunity ? [body.opportunity] : null);
  if (!list || list.length === 0) {
    return jres(400, { error: "opportunities array required" });
  }
  if (list.length > MAX_BATCH) {
    return jres(400, { error: `batch too large (max ${MAX_BATCH})`, received: list.length });
  }

  const rows: any[] = [];
  const errors: { index: number; error: string }[] = [];
  list.forEach((o: any, i: number) => {
    const n = normalize(o);
    if ("error" in n) errors.push({ index: i, error: n.error });
    else rows.push(n.row);
  });

  if (rows.length === 0) {
    return jres(400, { error: "no valid records", details: errors });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("dealer_live_opportunities")
    .upsert(rows, { onConflict: "account_id,source,listing_id" })
    .select("id, account_id, source, listing_id");

  if (error) {
    return jres(500, { error: error.message, details: errors });
  }

  return jres(200, {
    ok: true,
    upserted: data?.length ?? 0,
    skipped: errors.length,
    errors: errors.length ? errors : undefined,
    ids: data,
  });
});
