// auction-feed: Returns recent auction (Pickles/Manheim/etc) listings for OpenClaw hunter swarm.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== TOKEN) {
    return j(401, { error: "unauthorized" });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const makes: string[] = Array.isArray(body.makes) ? body.makes.map(String) : [];
  const models: string[] = Array.isArray(body.models) ? body.models.map(String) : [];
  const minYear = Number.isFinite(Number(body.min_year)) ? Number(body.min_year) : null;
  const sources: string[] = Array.isArray(body.sources) && body.sources.length
    ? body.sources.map((s: string) => String(s).toLowerCase())
    : ["pickles", "manheim"];
  const hours = Math.max(1, Math.min(168, Number(body.hours ?? 24)));
  const limit = Math.max(1, Math.min(2000, Number(body.limit ?? 1000)));
  const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let q = sb.from("vehicle_listings")
    .select("id, source, make, model, variant_raw, year, km, highest_bid, asking_price, guide_price, reserve_price, sold_price, location, auction_datetime, listing_url, created_at, status")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Source filter (case-insensitive substring via in() on canonical values)
  if (sources.length) q = q.in("source", sources);
  if (minYear !== null) q = q.gte("year", minYear);
  if (makes.length) {
    // make-case-insensitive: match any provided make
    q = q.or(makes.map(m => `make.ilike.${m}`).join(","));
  }
  if (models.length) {
    q = q.or(models.map(m => `model.ilike.%${m}%`).join(","));
  }

  const { data, error } = await q;
  if (error) return j(500, { error: error.message });

  const listings = (data ?? []).map((r: any) => ({
    id: r.id,
    source: r.source,
    make: r.make,
    model: r.model,
    year: r.year,
    variant: r.variant_raw,
    km: r.km,
    price: r.price ?? r.asking_price,
    location: r.location,
    auction_date: r.auction_datetime,
    url: r.listing_url,
    status: r.status,
    created_at: r.created_at,
  }));

  return j(200, { count: listings.length, listings });
});
