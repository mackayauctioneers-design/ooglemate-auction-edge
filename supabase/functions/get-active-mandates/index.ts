// get-active-mandates — returns mandate list for OpenClaw/Arby
// Built from distinct make/model/variant sales in vehicle_sales_truth (last 90 days).
// Auth: Bearer OPENCLAW_WRITE_TOKEN (or X-OpenClaw-Token). Never expose service_role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-openclaw-token, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WRITE_TOKEN = Deno.env.get("OPENCLAW_WRITE_TOKEN")!;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jres(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  const xToken = req.headers.get("X-OpenClaw-Token") || "";
  const token = xToken || authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || !WRITE_TOKEN || token !== WRITE_TOKEN) {
    return jres(401, { error: "unauthorized" });
  }

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? 90)));
  const accountId = url.searchParams.get("account_id");
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") ?? 500)));
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let q = sb
    .from("vehicle_sales_truth")
    .select("account_id, make, model, variant, year, km, sale_price, sold_at")
    .gte("sold_at", sinceIso)
    .not("make", "is", null)
    .not("model", "is", null)
    .limit(10000);
  if (accountId) q = q.eq("account_id", accountId);

  const { data, error } = await q;
  if (error) return jres(500, { error: error.message });

  // Aggregate by make|model|variant
  type Agg = {
    make: string; model: string; variant: string | null;
    years: number[]; kms: number[]; prices: number[]; count: number;
    last_sold: string;
  };
  const groups = new Map<string, Agg>();
  for (const r of data ?? []) {
    const make = String(r.make).trim().toUpperCase();
    const model = String(r.model).trim().toUpperCase();
    const variant = r.variant ? String(r.variant).trim() : null;
    const key = `${make}|${model}|${variant ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { make, model, variant, years: [], kms: [], prices: [], count: 0, last_sold: r.sold_at };
      groups.set(key, g);
    }
    if (r.year != null) g.years.push(Number(r.year));
    if (r.km != null) g.kms.push(Number(r.km));
    if (r.sale_price != null) g.prices.push(Number(r.sale_price));
    g.count += 1;
    if (r.sold_at > g.last_sold) g.last_sold = r.sold_at;
  }

  const mandates = Array.from(groups.values())
    .map((g) => {
      const minYear = g.years.length ? Math.min(...g.years) : null;
      const maxYear = g.years.length ? Math.max(...g.years) : null;
      const minKm = g.kms.length ? Math.min(...g.kms) : null;
      const maxKm = g.kms.length ? Math.max(...g.kms) : null;
      const maxPrice = g.prices.length ? Math.max(...g.prices) : null;
      return {
        make: g.make,
        model: g.model,
        variant: g.variant,
        year_min: minYear != null ? minYear - 1 : null,
        year_max: maxYear != null ? maxYear + 1 : null,
        km_min: minKm != null ? Math.max(0, minKm - 15000) : null,
        km_max: maxKm != null ? maxKm + 15000 : null,
        price_max: maxPrice != null ? Math.round(maxPrice * 1.10) : null,
        sales_count: g.count,
        last_sold_at: g.last_sold,
      };
    })
    .sort((a, b) => b.sales_count - a.sales_count)
    .slice(0, limit);

  return jres(200, {
    count: mandates.length,
    window_days: days,
    since: sinceIso,
    mandates,
  });
});
