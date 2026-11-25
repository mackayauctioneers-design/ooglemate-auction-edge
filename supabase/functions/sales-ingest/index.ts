// sales-ingest: Ooglecars sold sales from the Carbitrage VPS push -> vehicle_sales_truth.
// Auth: header x-ingest-token; its SHA-256 must equal TOKEN_SHA256 (the token itself lives only on the VPS, root-only).
// Insert-only: ON CONFLICT (id) DO NOTHING via service role. Column + account allow-lists; rego/buyer/VIN fields rejected.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FingerprintInputError, FingerprintRetryError, parseRetire, receiveFingerprints } from "./fingerprints.ts";
import type { ExistingFingerprint } from "./fingerprints.ts";
import { CatchInputError, KNOWN_ACTIONS, countUpsert, parseCatches, parseCoverage } from "./catches.ts";

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

  // Any named action must be one we know; only a body with no action reaches the sales handler.
  if (body && typeof body === "object" && "action" in body && body.action !== undefined && !KNOWN_ACTIONS.has(body.action)) {
    return json(400, { error: "unknown_action", action: body.action });
  }

  // Finder catches (upsert on catch_id) and per-source daily coverage (upsert on date + source). Owner-only tables.
  if (body?.action === "finder_catches" || body?.action === "source_coverage") {
    const action = body.action as string;
    const received = Array.isArray(body.rows) ? body.rows.length : 0;
    const fail = (status: number, error: string, extra: Record<string, unknown> = {}, counts = { inserted: 0, updated: 0 }) =>
      json(status, { action, received, ...counts, error, ...extra });
    try {
      const catches = action === "finder_catches";
      const rows = catches ? parseCatches(body.rows) : parseCoverage(body.rows);
      const table = catches ? "finder_catches" : "source_coverage";
      const keyOf = (r: any) => catches ? String(r.catch_id) : `${r.date}\u0000${r.source}`;
      // Exact per-key lookups (keys may contain commas/quotes that in.(...) filters would mangle).
      const existing = new Set<string>();
      for (let i = 0; i < rows.length; i += 20) {
        const res = await Promise.all(rows.slice(i, i + 20).map((r: any) => {
          const q = sb.from(table).select(catches ? "catch_id" : "date,source");
          return catches ? q.eq("catch_id", r.catch_id).limit(1) : q.eq("date", r.date).eq("source", r.source).limit(1);
        }));
        for (const { data, error } of res) {
          if (error) return fail(500, "lookup_failed");
          for (const d of data ?? []) existing.add(keyOf(d));
        }
      }
      const now = new Date().toISOString();
      const { error } = await sb.from(table).upsert(rows.map((r) => ({ ...r, received_at: now })), { onConflict: catches ? "catch_id" : "date,source" });
      if (error) return fail(500, "upsert_failed", { detail: error.message.slice(0, 200) });
      return json(200, { action, received: rows.length, ...countUpsert(rows.map(keyOf), existing) });
    } catch (error) {
      if (error instanceof CatchInputError) return fail(400, error.message, error.extra);
      return fail(500, "ingest_failed");
    }
  }

  // Mark cells that dropped out of the VPS snapshot inactive (no deletes).
  if (body?.action === "fingerprints_deactivate") {
    try {
      const { account, ids } = parseRetire(body);
      if (!ACCOUNTS.has(account)) return json(400, { error: "account_not_allowed" });
      const { data: profiles, error: pe } = await sb.from("dealer_profiles").select("id").eq("account_id", account).limit(2);
      if (pe) return json(500, { error: "profile_lookup_failed" });
      if (profiles?.length !== 1) return json(400, { error: "dealer_profile_required" });
      // One .eq per ID: vps-winner IDs contain quotes and commas that PostgREST in.(...) cannot match.
      let deactivated = 0;
      for (let o = 0; o < ids.length; o += 10) {
        const results = await Promise.all(ids.slice(o, o + 10).map((id) => sb.from("dealer_fingerprints")
          .update({ is_active: false, alert_enabled: false })
          .eq("fingerprint_id", id).eq("dealer_profile_id", profiles[0].id).select("fingerprint_id")));
        for (const { data, error } of results) {
          if (error) return json(500, { error: "deactivate_failed", deactivated });
          deactivated += data?.length ?? 0;
        }
      }
      return json(200, { received: ids.length, deactivated, not_found: ids.length - deactivated });
    } catch (error) {
      if (error instanceof FingerprintInputError) return json(400, { error: error.message });
      return json(500, { error: "deactivate_failed" });
    }
  }

  // Same authenticated conduit; distinct allow-list and tenant-scoped fingerprint identity.
  if (body?.action === "fingerprints") {
    try {
      const deadline = Date.now() + 110_000;
      const result = await receiveFingerprints(body, ACCOUNTS, {
        async profiles(account) {
          const { data, error } = await sb.from("dealer_profiles")
            .select("id,account_id,dealer_name").eq("account_id", account).limit(2);
          if (error) throw new Error("profile_lookup_failed");
          return data ?? [];
        },
        async existing(ids) {
          // One .eq per ID: vps-winner IDs contain quotes and commas that PostgREST in.(...) cannot match.
          // Ownership of the whole batch is still validated before any write.
          const found: ExistingFingerprint[] = [];
          for (let offset = 0; offset < ids.length; offset += 10) {
            if (Date.now() >= deadline) throw new FingerprintRetryError("time_budget");
            const results = await Promise.all(ids.slice(offset, offset + 10).map((id) => sb.from("dealer_fingerprints")
              .select("fingerprint_id,dealer_profile_id,dealer_name,make,model,variant_family,year_min,year_max,max_km,sales_count,avg_profit,avg_days_to_sell,updated_at")
              .eq("fingerprint_id", id)));
            for (const { data, error } of results) {
              if (error) throw new Error("fingerprint_lookup_failed");
              found.push(...(data ?? []));
            }
          }
          return found;
        },
        async insert(row) {
          const { data, error } = await sb.from("dealer_fingerprints")
            .upsert(row, { onConflict: "fingerprint_id", ignoreDuplicates: true }).select("fingerprint_id");
          if (error) throw new Error("fingerprint_insert_failed");
          return (data?.length ?? 0) === 1;
        },
        async update(row) {
          // Never touches is_active/alert_enabled, so site approval is preserved.
          const { data, error } = await sb.from("dealer_fingerprints").update(row)
            .eq("fingerprint_id", row.fingerprint_id).eq("dealer_profile_id", row.dealer_profile_id)
            .select("fingerprint_id");
          if (error) throw new Error("fingerprint_update_failed");
          return (data?.length ?? 0) === 1;
        },
      });
      return json(result.retry_required ? 503 : 200, result);
    } catch (error) {
      if (error instanceof FingerprintInputError) return json(400, { error: error.message });
      if (error instanceof FingerprintRetryError) return json(503, { error: "fingerprint_retry_required", retry_required: true });
      return json(500, { error: "fingerprint_sync_failed" });
    }
  }

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
