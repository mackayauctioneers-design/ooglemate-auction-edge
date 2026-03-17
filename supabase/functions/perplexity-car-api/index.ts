/**
 * perplexity-car-api — Read-only API for Perplexity (and other external tools)
 * to query vehicle listings, dealer fingerprints, and market analytics.
 *
 * Endpoints (via ?endpoint= query param):
 *   listings     — Search vehicle listings
 *   fingerprints — Dealer buying fingerprints
 *   analytics    — Market summary stats
 *   deals        — Cheap car queue / flagged deals
 *
 * Auth: Bearer token (LINDY_WEBHOOK_SECRET or a dedicated API key)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

function verifyAuth(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return false;
  const lindySecret = Deno.env.get("LINDY_WEBHOOK_SECRET") ?? "";
  const apiKey = Deno.env.get("PERPLEXITY_CAR_API_KEY") ?? "";
  return (lindySecret && token === lindySecret) || (apiKey && token === apiKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  if (!verifyAuth(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint") ?? "listings";
    const supabase = getSupabaseAdmin();

    switch (endpoint) {
      case "listings":
        return await handleListings(supabase, url);
      case "fingerprints":
        return await handleFingerprints(supabase, url);
      case "analytics":
        return await handleAnalytics(supabase, url);
      case "deals":
        return await handleDeals(supabase, url);
      default:
        return json({ error: `Unknown endpoint: ${endpoint}`, available: ["listings", "fingerprints", "analytics", "deals"] }, 400);
    }
  } catch (err) {
    console.error("perplexity-car-api error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// ========== LISTINGS ==========
async function handleListings(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const yearMin = url.searchParams.get("year_min");
  const yearMax = url.searchParams.get("year_max");
  const kmMax = url.searchParams.get("km_max");
  const priceMax = url.searchParams.get("price_max");
  const status = url.searchParams.get("status");
  const source = url.searchParams.get("source");
  const location = url.searchParams.get("location");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  let query = supabase
    .from("vehicle_listings")
    .select("id, listing_id, source, source_class, auction_house, make, model, variant_raw, variant_family, year, km, transmission, drivetrain, fuel, location, state, auction_datetime, listing_url, reserve, highest_bid, asking_price, status, seller_type, first_seen_at, last_seen_at, image_url, condition_notes, wovr_indicator, damage_noted, lemon_flag, lemon_reason")
    .order("last_seen_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (make) query = query.ilike("make", `%${make}%`);
  if (model) query = query.ilike("model", `%${model}%`);
  if (yearMin) query = query.gte("year", parseInt(yearMin));
  if (yearMax) query = query.lte("year", parseInt(yearMax));
  if (kmMax) query = query.lte("km", parseInt(kmMax));
  if (priceMax) query = query.lte("asking_price", parseInt(priceMax));
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (location) query = query.ilike("location", `%${location}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return json({ endpoint: "listings", count: data?.length ?? 0, offset, limit, data });
}

// ========== FINGERPRINTS ==========
async function handleFingerprints(supabase: any, url: URL) {
  const dealerName = url.searchParams.get("dealer_name");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const activeOnly = url.searchParams.get("active_only") !== "false";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  let query = supabase
    .from("dealer_fingerprints")
    .select("fingerprint_id, dealer_name, make, model, variant_family, year_min, year_max, min_km, max_km, is_active, fingerprint_type, fingerprint_priority, alert_enabled, sales_count, avg_profit, avg_days_to_sell, profit_score, recency_weight, is_spec_only, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (activeOnly) query = query.eq("is_active", true);
  if (dealerName) query = query.ilike("dealer_name", `%${dealerName}%`);
  if (make) query = query.ilike("make", `%${make}%`);
  if (model) query = query.ilike("model", `%${model}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return json({ endpoint: "fingerprints", count: data?.length ?? 0, data });
}

// ========== ANALYTICS ==========
async function handleAnalytics(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");

  // Total listings by source
  const { data: listingCounts } = await supabase
    .from("vehicle_listings")
    .select("source, status", { count: "exact", head: false })
    .limit(1000);

  // Aggregate by source
  const sourceSummary: Record<string, { total: number; active: number; sold: number }> = {};
  for (const row of listingCounts ?? []) {
    if (!sourceSummary[row.source]) sourceSummary[row.source] = { total: 0, active: 0, sold: 0 };
    sourceSummary[row.source].total++;
    if (row.status === "ACTIVE" || row.status === "active") sourceSummary[row.source].active++;
    if (row.status === "SOLD" || row.status === "sold") sourceSummary[row.source].sold++;
  }

  // Fingerprint stats
  const { count: activeFingerprintCount } = await supabase
    .from("dealer_fingerprints")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  // Cheap car queue stats
  const { count: dealCount } = await supabase
    .from("cheap_car_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  // If make/model specified, get specific market data
  let marketData = null;
  if (make || model) {
    let mq = supabase
      .from("vehicle_listings")
      .select("asking_price, km, year, status, source, location, first_seen_at")
      .not("asking_price", "is", null)
      .order("asking_price", { ascending: true })
      .limit(200);

    if (make) mq = mq.ilike("make", `%${make}%`);
    if (model) mq = mq.ilike("model", `%${model}%`);

    const { data: mktData } = await mq;
    if (mktData && mktData.length > 0) {
      const prices = mktData.map((r: any) => r.asking_price).filter(Boolean);
      const kms = mktData.map((r: any) => r.km).filter(Boolean);
      marketData = {
        total_listings: mktData.length,
        price_min: Math.min(...prices),
        price_max: Math.max(...prices),
        price_median: prices.sort((a: number, b: number) => a - b)[Math.floor(prices.length / 2)],
        price_avg: Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length),
        km_avg: kms.length > 0 ? Math.round(kms.reduce((a: number, b: number) => a + b, 0) / kms.length) : null,
        sources: [...new Set(mktData.map((r: any) => r.source))],
        locations: [...new Set(mktData.map((r: any) => r.location).filter(Boolean))].slice(0, 10),
      };
    }
  }

  return json({
    endpoint: "analytics",
    source_summary: sourceSummary,
    active_fingerprints: activeFingerprintCount,
    pending_deals: dealCount,
    market_data: marketData,
    note: "Pass ?make=Toyota&model=HiLux for model-specific analytics",
  });
}

// ========== DEALS ==========
async function handleDeals(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const status = url.searchParams.get("status") ?? "new";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  let query = supabase
    .from("cheap_car_queue")
    .select("id, listing_id, source, source_type, make, model, variant, year, km, price, market_price, discount_pct, deal_score, deal_tag, location, listing_url, image_url, transmission, fuel_type, seller_type, status, detected_at, josh_verified, josh_score, flag_damage, flag_km_issue, flag_sold, condition_notes")
    .eq("status", status)
    .order("deal_score", { ascending: false })
    .limit(limit);

  if (make) query = query.ilike("make", `%${make}%`);
  if (model) query = query.ilike("model", `%${model}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return json({ endpoint: "deals", status, count: data?.length ?? 0, data });
}

// Helper
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
