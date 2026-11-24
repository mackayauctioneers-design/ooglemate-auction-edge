// sales-ingest: Ooglecars sold sales from the Carbitrage VPS push -> vehicle_sales_truth.
// Auth: header x-ingest-token; its SHA-256 must equal TOKEN_SHA256 (the token itself lives only on the VPS, root-only).
// Insert-only: ON CONFLICT (id) DO NOTHING via service role. Column + account allow-lists; rego/buyer/VIN fields rejected.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_SHA256 = "9fc1d44899fabf8047b8a3ac6d0d8fed18b580e49dfac4ac3c16173d71639651";
const ACCOUNTS = new Set([
  "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51", // Mackay Traders
  "8140eae1-2c36-40b6-a358-4f5ed05bbbcf", // AJH Auto Traders
  "a2aec451-3b68-47f1-aaa8-ce7ef470b30d", // The Wholesale Shed
]);
const COLUMNS = new Set([
  "id", "account_id", "sold_at", "make", "model", "variant", "year", "km", "sale_price", "source", "confidence", "notes",
  "body_type", "fuel_type", "transmission", "drive_type", "acquired_at", "days_to_clear", "buy_price", "series", "badge",
  "platform_class",
]);
const FORBIDDEN = /rego|registration|plate|buyer|customer|purchase_source|bought|vin/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = req.headers.get("x-ingest-token") ?? "";
  if (!token || !safeEqual(await sha256Hex(token), TOKEN_SHA256)) return json(401, { error: "unauthorized" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Read-only lookup for the push's overlap guard: existing non-feed rows for one allowed account.
  if (body?.action === "existing") {
    if (!ACCOUNTS.has(body.account_id)) return json(400, { error: "account_not_allowed" });
    const { data, error } = await sb.from("vehicle_sales_truth")
      .select("id,sold_at,make,model,year,sale_price,buy_price,source")
      .eq("account_id", body.account_id).gte("sold_at", String(body.since ?? "1900-01-01"))
      .neq("source", "ooglecars_feed").limit(5000);
    if (error) return json(500, { error: "lookup_failed" });
    return json(200, { rows: data ?? [] });
  }

  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || rows.length === 0 || rows.length > 600) return json(400, { error: "rows_required_1_to_600" });
  for (const [i, r] of rows.entries()) {
    if (!r || typeof r !== "object") return json(400, { error: "bad_row", row: i });
    for (const k of Object.keys(r)) {
      if (FORBIDDEN.test(k)) return json(400, { error: "forbidden_field", row: i, field: k });
      if (!COLUMNS.has(k)) return json(400, { error: "unknown_field", row: i, field: k });
    }
    if (!UUID.test(String(r.id))) return json(400, { error: "bad_id", row: i });
    if (!ACCOUNTS.has(r.account_id)) return json(400, { error: "account_not_allowed", row: i });
    if (r.source !== "ooglecars_feed") return json(400, { error: "bad_source", row: i });
    if (!r.sold_at || !r.make || !r.model || !r.platform_class) return json(400, { error: "missing_required", row: i });
  }
  const { data, error } = await sb.from("vehicle_sales_truth")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (error) return json(500, { error: "insert_failed", detail: error.message.slice(0, 200) });
  return json(200, { received: rows.length, inserted: data?.length ?? 0 });
});
