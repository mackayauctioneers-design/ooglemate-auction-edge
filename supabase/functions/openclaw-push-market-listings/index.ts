// openclaw-push-market-listings — batch upsert into vehicle_listings (the table
// behind the canonical `market_listings` view).
// Auth: X-OpenClaw-Token or Bearer OPENCLAW_WRITE_TOKEN. Never expose service_role.
// Body: { source: "autograb", mandate_id?: "...", listings: [ {...}, ... ] } (max 200/call)
// Upsert key: listing_id (synthesized from source + url/identity when not supplied).
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

const MAX_BATCH = 200;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildListingId(source: string, item: any): string {
  if (item.listing_id) return String(item.listing_id);
  if (item.id) return `${source}-${item.id}`;
  const url = item.url || item.listing_url || "";
  if (url) {
    // stable-ish hash via url tail
    const tail = url.replace(/[^a-z0-9]/gi, "").slice(-40);
    return `${source}-${tail}`;
  }
  const parts = [source, item.make, item.model, item.year, item.odometer ?? item.km, item.price]
    .map((v) => String(v ?? "").toLowerCase().replace(/\s+/g, "-"))
    .join("-");
  return parts;
}

function normalize(source: string, mandateId: string | null, o: any) {
  if (!o || typeof o !== "object") return { error: "invalid_record" };
  const listing_id = buildListingId(source, o);
  const now = new Date().toISOString();
  const price = o.price != null ? Number(o.price) : null;
  const km = o.odometer != null ? Number(o.odometer) : (o.km != null ? Number(o.km) : null);

  const row: Record<string, unknown> = {
    listing_id,
    source,
    source_class: o.source_class ?? "retail",
    make: o.make ? String(o.make).toUpperCase() : null,
    model: o.model ? String(o.model).toUpperCase() : null,
    variant_raw: o.variant ?? o.vehicle_title ?? null,
    year: o.year != null ? Number(o.year) : null,
    km,
    asking_price: price,
    location: o.location ?? ([o.suburb, o.state].filter(Boolean).join(", ") || null),
    suburb: o.suburb ?? null,
    listing_url: o.url ?? o.listing_url ?? null,
    image_url: o.image_url ?? o.cover_image_url ?? null,
    seller_type: o.seller_type ?? null,
    dealer_name: o.dealer_name ?? o.dealership_name ?? null,
    status: o.status ?? "active",
    lifecycle_state: o.lifecycle_state ?? "NEW",
    first_seen_at: o.first_seen_at ?? now,
    last_seen_at: now,
    updated_at: now,
    visible_to_dealers: true,
    platform_class: o.platform_class ?? source,
  };

  // Pass-through enrichment fields if provided
  if (o.score != null) row.match_score = Number(o.score);
  if (mandateId) row.mandate_id = mandateId;

  return { row };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  const xToken = req.headers.get("X-OpenClaw-Token") || "";
  const token = xToken || authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token || !WRITE_TOKEN || token !== WRITE_TOKEN) {
    return jres(401, { error: "Unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return jres(400, { error: "invalid_json" }); }

  const source = body?.source ? String(body.source) : null;
  const mandateId = body?.mandate_id ? String(body.mandate_id) : null;
  if (!source) return jres(400, { error: "source required" });

  const list = Array.isArray(body?.listings) ? body.listings : null;
  if (!list || list.length === 0) return jres(400, { error: "listings array required" });
  if (list.length > MAX_BATCH) {
    return jres(400, { error: `batch too large (max ${MAX_BATCH})`, received: list.length });
  }

  const rows: any[] = [];
  const errors: { index: number; error: string }[] = [];
  list.forEach((o: any, i: number) => {
    const n = normalize(source, mandateId, o);
    if ("error" in n) errors.push({ index: i, error: n.error });
    else rows.push(n.row);
  });

  if (rows.length === 0) return jres(400, { error: "no valid records", details: errors });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Strip optional columns that may not exist on vehicle_listings to avoid hard failures.
  // Retry without `mandate_id` / `match_score` if the first attempt fails on unknown column.
  let attempt = await sb
    .from("vehicle_listings")
    .upsert(rows, { onConflict: "listing_id" })
    .select("listing_id, source");

  if (attempt.error && /column .* does not exist/i.test(attempt.error.message)) {
    const stripped = rows.map(({ mandate_id, match_score, ...rest }) => rest);
    attempt = await sb
      .from("vehicle_listings")
      .upsert(stripped, { onConflict: "listing_id" })
      .select("listing_id, source");
  }

  if (attempt.error) {
    return jres(500, { error: attempt.error.message, skipped: errors.length, details: errors });
  }

  // Optional: append price-tracking history (non-critical)
  try {
    const nowIso = new Date().toISOString();
    const history = rows
      .filter((r) => r.asking_price != null)
      .map((r) => ({
        listing_id: r.listing_id,
        source_site: source,
        price_at_first_seen: r.asking_price,
        first_seen_at: r.first_seen_at ?? nowIso,
        last_seen_at: nowIso,
      }));
    if (history.length > 0) {
      await sb.from("market_listing_history").upsert(history, {
        onConflict: "listing_id,source_site",
        ignoreDuplicates: false,
      });
    }
  } catch (_) { /* non-critical */ }

  return jres(200, {
    ok: true,
    source,
    mandate_id: mandateId,
    upserted: attempt.data?.length ?? 0,
    skipped: errors.length,
    errors: errors.length ? errors : undefined,
  });
});
