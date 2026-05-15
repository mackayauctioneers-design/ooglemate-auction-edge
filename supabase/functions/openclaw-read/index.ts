// OpenClaw READ edge function — Pulse Agent
// Auth: Bearer OPENCLAW_READ_TOKEN. RLS-bypassing service role used internally.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const READ_TOKEN = Deno.env.get("OPENCLAW_READ_TOKEN")!;

const ALLOWED_OPS = new Set([
  "find_candidates",
  "find_peers",
  "recent_alerts",
  "stock_review",
  "health_stats",
]);

const BUYABLE = ["active", "listed", "inprep", "catalogue", "relisted", "prepcompleted"];
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

  // Auth bypassed — open access (per user request, 2026-05-15)
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  void token; void READ_TOKEN;

  // Parse body
  let body: any;
  try { body = await req.json(); } catch { return jres(400, { error: "invalid_json" }); }
  const op = String(body?.op ?? "");
  const params = body?.params ?? {};

  if (!ALLOWED_OPS.has(op)) {
    await audit(sb, {
      token_kind: "read", op: op || "_missing", request_id: reqId, params_json: params,
      response_status: 400, response_ms: Date.now() - t0, caller_ip: ip, error_text: "op_not_allowed",
    });
    return jres(400, { error: "op_not_allowed", op });
  }

  // Rate limit (sliding window over pulse_audit)
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString();
  const { count: recentCount } = await sb
    .from("pulse_audit")
    .select("id", { count: "exact", head: true })
    .eq("token_kind", "read")
    .gte("created_at", since);
  if ((recentCount ?? 0) >= RATE_LIMIT) {
    await audit(sb, {
      token_kind: "read", op, request_id: reqId, params_json: params,
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
    if (op === "find_candidates") {
      const sinceMin = Math.max(1, Math.min(1440, Number(params.since_minutes ?? 15)));
      const minPrice = Math.max(0, Number(params.min_price ?? 1000));
      const exclude: string[] = Array.isArray(params.exclude_listing_ids) ? params.exclude_listing_ids.map(String) : [];
      const sinceIso = new Date(Date.now() - sinceMin * 60_000).toISOString();

      let q = sb.from("market_listings")
        .select("id, make, model, year, km, price, source, status, location, listing_url, created_at")
        .gte("created_at", sinceIso)
        .gte("price", minPrice)
        .limit(2000);
      const { data: rows, error } = await q;
      if (error) throw error;

      // Filter buyable + exclude
      const excludeSet = new Set(exclude);
      const filtered = (rows ?? []).filter((r: any) =>
        BUYABLE.includes(String(r.status ?? "").toLowerCase()) && !excludeSet.has(String(r.id))
      );

      // Join taxonomy in batch
      const { data: taxa } = await sb.from("taxonomy_models").select("*");
      const taxIndex = new Map<string, any>();
      for (const t of (taxa ?? [])) {
        const aliases: string[] = Array.isArray(t.aliases) ? t.aliases : [];
        const keys = [String(t.canonical_model ?? "").toLowerCase(), ...aliases.map((a: string) => a.toLowerCase())];
        for (const k of keys) {
          if (k) taxIndex.set(`${String(t.make ?? "").toLowerCase()}|${k}`, t);
        }
      }

      payload = filtered.map((r: any) => {
        const mk = String(r.make ?? "").toLowerCase();
        const md = String(r.model ?? "").toLowerCase();
        let tax: any = null;
        // exact, then prefix-match (model field may include trim text)
        tax = taxIndex.get(`${mk}|${md}`);
        if (!tax) {
          for (const [k, v] of taxIndex) {
            if (k.startsWith(`${mk}|`) && md.includes(k.split("|")[1])) { tax = v; break; }
          }
        }
        return {
          listing_id: r.id,
          make: r.make, model: r.model, year: r.year, km: r.km, price: r.price,
          source: r.source, status: r.status, location: r.location, listing_url: r.listing_url,
          family_key: tax?.family_key ?? null,
          year_band_min: tax?.year_band_min ?? null,
          year_band_max: tax?.year_band_max ?? null,
          km_band_min: tax?.km_band_min ?? null,
          km_band_max: tax?.km_band_max ?? null,
        };
      });
    }

    else if (op === "find_peers") {
      const familyKey = String(params.family_key ?? "");
      const year = Number(params.year);
      const km = Number(params.km);
      const exclId = String(params.exclude_listing_id ?? "");
      const sinceDays = Math.max(1, Math.min(180, Number(params.since_days ?? 30)));
      if (!familyKey || !Number.isFinite(year)) throw new Error("family_key_and_year_required");
      const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

      // Resolve family_key -> aliases via taxonomy
      const { data: taxa } = await sb.from("taxonomy_models").select("*").eq("family_key", familyKey);
      const aliasPairs: Array<{ make: string; aliases: string[] }> = (taxa ?? []).map((t: any) => ({
        make: String(t.make ?? "").toLowerCase(),
        aliases: [String(t.canonical_model ?? "").toLowerCase(), ...(Array.isArray(t.aliases) ? t.aliases.map((a: string) => a.toLowerCase()) : [])].filter(Boolean),
      }));
      if (aliasPairs.length === 0) {
        payload = { peer_count: 0, cheapest: null, median: null, p25: null, p75: null };
      } else {
        // Pull candidates by year window first; filter make/model in app
        const { data: rows, error } = await sb.from("market_listings")
          .select("id, make, model, price, km, status, year, created_at")
          .gte("year", year - 2).lte("year", year + 2)
          .gt("price", 1000)
          .gte("created_at", sinceIso)
          .limit(5000);
        if (error) throw error;

        const peers = (rows ?? []).filter((r: any) => {
          if (String(r.id) === exclId) return false;
          if (!BUYABLE.includes(String(r.status ?? "").toLowerCase())) return false;
          if (Number.isFinite(km) && Number.isFinite(r.km) && Math.abs(Number(r.km) - km) > 40000) return false;
          const mk = String(r.make ?? "").toLowerCase();
          const md = String(r.model ?? "").toLowerCase();
          return aliasPairs.some(p => p.make === mk && p.aliases.some(a => md.includes(a)));
        }).map((r: any) => Number(r.price)).filter((n: number) => Number.isFinite(n)).sort((a, b) => a - b);

        const pct = (arr: number[], p: number) => {
          if (arr.length === 0) return null;
          const i = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * (arr.length - 1))));
          return arr[i];
        };
        payload = {
          peer_count: peers.length,
          cheapest: peers[0] ?? null,
          p25: pct(peers, 25),
          median: pct(peers, 50),
          p75: pct(peers, 75),
        };
      }
    }

    else if (op === "recent_alerts") {
      const listingId = String(params.listing_id ?? "");
      const sinceDays = Math.max(1, Math.min(60, Number(params.since_days ?? 7)));
      const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const { data, error } = await sb.from("pulse_alerts")
        .select("candidate_price, alerted_at")
        .eq("listing_id", listingId)
        .gte("alerted_at", sinceIso)
        .order("alerted_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0];
      payload = {
        has_recent_alert: !!row,
        last_alert_price: row?.candidate_price ?? null,
        last_alert_at: row?.alerted_at ?? null,
      };
    }

    else if (op === "stock_review") {
      // Pull stock; for each, compute peer p75 inline using same logic as find_peers (light version).
      const { data: stock, error } = await sb.from("trap_inventory_current")
        .select("listing_id, family_key, asking_price, days_on_market, year, km")
        .gt("days_on_market", 14)
        .limit(500);
      if (error) throw error;

      const out: any[] = [];
      for (const s of (stock ?? [])) {
        if (!s.family_key || !s.asking_price) continue;
        const { data: taxa } = await sb.from("taxonomy_models").select("*").eq("family_key", s.family_key);
        const aliasPairs = (taxa ?? []).map((t: any) => ({
          make: String(t.make ?? "").toLowerCase(),
          aliases: [String(t.canonical_model ?? "").toLowerCase(), ...(Array.isArray(t.aliases) ? t.aliases.map((a: string) => a.toLowerCase()) : [])].filter(Boolean),
        }));
        const yr = Number(s.year);
        const km = Number(s.km);
        const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const { data: rows } = await sb.from("market_listings")
          .select("make, model, price, km, status, year")
          .gte("year", yr - 2).lte("year", yr + 2)
          .gt("price", 1000)
          .gte("created_at", sinceIso)
          .limit(2000);
        const peers = (rows ?? []).filter((r: any) => {
          if (!BUYABLE.includes(String(r.status ?? "").toLowerCase())) return false;
          if (Number.isFinite(km) && Number.isFinite(r.km) && Math.abs(Number(r.km) - km) > 40000) return false;
          const mk = String(r.make ?? "").toLowerCase();
          const md = String(r.model ?? "").toLowerCase();
          return aliasPairs.some(p => p.make === mk && p.aliases.some(a => md.includes(a)));
        }).map((r: any) => Number(r.price)).filter(Number.isFinite).sort((a, b) => a - b);
        if (peers.length < 3) continue;
        const pct = (p: number) => peers[Math.floor((p / 100) * (peers.length - 1))];
        const p25 = pct(25), p50 = pct(50), p75 = pct(75);
        if (Number(s.asking_price) > p75) {
          out.push({
            listing_id: s.listing_id, family_key: s.family_key,
            asking_price: s.asking_price,
            market_p25: p25, market_median: p50, market_p75: p75,
            days_on_market: s.days_on_market,
          });
        }
      }
      payload = out;
    }

    else if (op === "health_stats") {
      const since24 = new Date(Date.now() - 86_400_000).toISOString();
      const [{ count: ingested24 }, { count: alerts24 }, lastIngest, unmatchedPending, lastPulse] = await Promise.all([
        sb.from("market_listings").select("id", { count: "exact", head: true }).gte("created_at", since24),
        sb.from("pulse_alerts").select("id", { count: "exact", head: true }).gte("alerted_at", since24),
        sb.from("market_listings").select("created_at").order("created_at", { ascending: false }).limit(1),
        sb.from("pulse_unmatched_models").select("id", { count: "exact", head: true }).eq("reviewed", false),
        sb.from("pulse_health_log").select("ran_at").order("ran_at", { ascending: false }).limit(1),
      ]);
      payload = {
        ingested_24h: ingested24 ?? 0,
        alerts_24h: alerts24 ?? 0,
        last_ingest_at: lastIngest.data?.[0]?.created_at ?? null,
        unmatched_pending: unmatchedPending.count ?? 0,
        last_pulse_run_at: lastPulse.data?.[0]?.ran_at ?? null,
      };
    }
  } catch (e) {
    status = 500;
    errText = (e as Error).message;
    payload = { error: errText };
  }

  await audit(sb, {
    token_kind: "read", op, request_id: reqId, params_json: params,
    response_status: status, response_ms: Date.now() - t0, caller_ip: ip, error_text: errText,
  });
  return jres(status, payload);
});
