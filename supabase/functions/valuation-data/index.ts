// valuation-data: Returns sales truth + market retail comps for a given vehicle spec.
// Auth: Bearer OPENCLAW_HUNTER_TOKEN
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("OPENCLAW_HUNTER_TOKEN")!;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function avg(xs: number[]) {
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== TOKEN) {
    return j(401, { error: "unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return j(400, { error: "invalid_json" }); }
  const make = String(body.make ?? "").trim();
  const model = String(body.model ?? "").trim();
  const year = Number(body.year);
  const tol = Math.max(0, Math.min(5, Number(body.year_tolerance ?? 2)));
  if (!make || !model || !Number.isFinite(year)) {
    return j(400, { error: "make_model_year_required" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const yLo = year - tol, yHi = year + tol;

  // Sales truth
  const { data: sales, error: salesErr } = await sb.from("vehicle_sales_truth")
    .select("sale_price, days_to_clear")
    .ilike("make", make)
    .ilike("model", `%${model}%`)
    .gte("year", yLo).lte("year", yHi)
    .not("sale_price", "is", null)
    .limit(2000);
  if (salesErr) return j(500, { error: salesErr.message });

  const salePrices = (sales ?? []).map((r: any) => Number(r.sale_price)).filter(Number.isFinite);
  const daysVals = (sales ?? []).map((r: any) => Number(r.days_to_clear)).filter(Number.isFinite);

  // Retail market comps from unified market_listings (excludes auction sources by status filter)
  const { data: comps, error: compsErr } = await sb.from("market_listings")
    .select("price, status")
    .ilike("make", make)
    .ilike("model", `%${model}%`)
    .gte("year", yLo).lte("year", yHi)
    .gt("price", 1000)
    .limit(2000);
  if (compsErr) return j(500, { error: compsErr.message });

  const retailPrices = (comps ?? [])
    .filter((r: any) => ["active", "listed", "relisted"].includes(String(r.status ?? "").toLowerCase()))
    .map((r: any) => Number(r.price))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return j(200, {
    sales_truth: {
      avg_sale_price: avg(salePrices),
      avg_days_to_sell: avg(daysVals),
      count: salePrices.length,
    },
    market_comps: {
      cheapest_retail: retailPrices[0] ?? null,
      avg_retail: avg(retailPrices),
      count: retailPrices.length,
    },
  });
});
