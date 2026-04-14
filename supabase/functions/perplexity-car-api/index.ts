/**
 * perplexity-car-api — Read-only API for Perplexity (and other external tools)
 * to query vehicle listings, dealer fingerprints, and market analytics.
 *
 * Endpoints (via ?endpoint= query param):
 *   listings       — Search auction/OEM listings (vehicle_listings)
 *   retail         — Search retail listings (Carsales, Autotrader, etc.)
 *   search         — Unified cross-table search (retail + auction in one call)
 *   fingerprints   — Dealer buying fingerprints
 *   analytics      — Market summary stats
 *   deals          — Cheap car queue / flagged deals
 *   audit          — Field completeness stats by source (data quality dashboard)
 *   history        — Price history for a specific listing
 *   clearances     — Sold/delisted events with days-on-market
 *   opportunities  — Matched opportunities + caroogle finds + deal flags
 *   sales_truth    — Verified historical sale outcomes
 *   ingestion      — Live ingestion health: cron heartbeats, source registry, failure diagnostics
 *   schema         — System overview with table counts and ingestion architecture
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
      case "retail":
        return await handleRetail(supabase, url);
      case "search":
        return await handleSearch(supabase, url);
      case "fingerprints":
        return await handleFingerprints(supabase, url);
      case "analytics":
        return await handleAnalytics(supabase, url);
      case "deals":
        return await handleDeals(supabase, url);
      case "audit":
        return await handleAudit(supabase, url);
      case "history":
        return await handleHistory(supabase, url);
      case "clearances":
        return await handleClearances(supabase, url);
      case "opportunities":
        return await handleOpportunities(supabase, url);
      case "sales_truth":
        return await handleSalesTruth(supabase, url);
      case "ingestion":
        return await handleIngestion(supabase, url);
      case "schema":
        return await handleSchema(supabase);
      default:
        return json({ error: `Unknown endpoint: ${endpoint}`, available: ["listings", "retail", "search", "fingerprints", "analytics", "deals", "audit", "history", "clearances", "opportunities", "sales_truth", "ingestion", "schema"] }, 400);
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
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 1000);
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
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 1000);

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

// ========== RETAIL ==========
async function handleRetail(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const yearMin = url.searchParams.get("year_min");
  const yearMax = url.searchParams.get("year_max");
  const kmMax = url.searchParams.get("km_max");
  const priceMax = url.searchParams.get("price_max");
  const priceMin = url.searchParams.get("price_min");
  const source = url.searchParams.get("source");
  const state = url.searchParams.get("state");
  const badge = url.searchParams.get("badge");
  const sellerType = url.searchParams.get("seller_type");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 1000);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  let query = supabase
    .from("retail_listings")
    .select("id, source, source_listing_id, make, model, variant_raw, variant_family, badge, year, km, asking_price, last_price, price_change_count, price_badge, market_price, price_difference_percent, state, suburb, transmission, drivetrain, fuel_type, body_type, colour, seller_type, listing_url, first_seen_at, last_seen_at, delisted_at, lifecycle_status, series_family, engine_litres, image_urls")
    .order("last_seen_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (make) query = query.ilike("make", `%${make}%`);
  if (model) query = query.ilike("model", `%${model}%`);
  if (yearMin) query = query.gte("year", parseInt(yearMin));
  if (yearMax) query = query.lte("year", parseInt(yearMax));
  if (kmMax) query = query.lte("km", parseInt(kmMax));
  if (priceMax) query = query.lte("asking_price", parseInt(priceMax));
  if (priceMin) query = query.gte("asking_price", parseInt(priceMin));
  if (source) query = query.eq("source", source);
  if (state) query = query.ilike("state", `%${state}%`);
  if (badge) query = query.ilike("badge", `%${badge}%`);
  if (sellerType) query = query.ilike("seller_type", `%${sellerType}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return json({ endpoint: "retail", count: data?.length ?? 0, offset, limit, data });
}

// ========== AUDIT (Data Quality Dashboard) ==========
async function handleAudit(supabase: any, url: URL) {
  const source = url.searchParams.get("source"); // optional: filter to one source
  const table = url.searchParams.get("table") ?? "retail"; // 'retail' or 'auction'

  if (table === "retail" || table === "both") {
    // Get counts per source
    const { data: sourceCounts } = await supabase.rpc('exec_sql', {
      query: `SELECT source, count(*) as total,
        count(transmission) as has_transmission,
        count(fuel_type) as has_fuel_type,
        count(body_type) as has_body_type,
        count(colour) as has_colour,
        count(drivetrain) as has_drivetrain,
        count(seller_type) FILTER (WHERE seller_type IS NOT NULL AND seller_type != 'unknown') as has_seller_type,
        count(seller_name_raw) as has_seller_name,
        count(state) as has_state,
        count(suburb) as has_suburb,
        count(market_price) as has_market_price,
        count(price_badge) as has_price_badge,
        count(badge) as has_badge,
        count(km) as has_km,
        count(variant_family) as has_variant_family,
        count(*) FILTER (WHERE year >= 2020 AND (km IS NULL OR km <= 120000)) as target_segment
      FROM retail_listings
      ${source ? "WHERE source = '" + source.replace(/'/g, "''") + "'" : ''}
      GROUP BY source ORDER BY total DESC`
    });

    // If RPC doesn't exist, fall back to manual queries per source
    if (sourceCounts) {
      return json({ endpoint: "audit", table: "retail_listings", by_source: sourceCounts });
    }

    // Fallback: query field completeness without custom SQL
    const sources = source ? [source] : ['carsales', 'autotrader', 'drive', 'easyauto123'];
    const results: Record<string, any> = {};
    for (const src of sources) {
      const { count: total } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src);
      const { count: hasTrans } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('transmission', 'is', null);
      const { count: hasFuel } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('fuel_type', 'is', null);
      const { count: hasBody } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('body_type', 'is', null);
      const { count: hasColour } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('colour', 'is', null);
      const { count: hasDrive } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('drivetrain', 'is', null);
      const { count: hasSeller } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('seller_type', 'is', null).neq('seller_type', 'unknown');
      const { count: hasState } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('state', 'is', null);
      const { count: hasMarket } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('market_price', 'is', null);
      const { count: hasBadge } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('price_badge', 'is', null);
      const { count: hasKm } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).not('km', 'is', null);
      const { count: target } = await supabase.from('retail_listings').select('id', { count: 'exact', head: true }).eq('source', src).gte('year', 2020).or('km.is.null,km.lte.120000');

      results[src] = {
        total: total ?? 0,
        target_2020_under120k: target ?? 0,
        fields: {
          transmission: { filled: hasTrans ?? 0, pct: total ? Math.round(((hasTrans ?? 0) / total) * 100) : 0 },
          fuel_type: { filled: hasFuel ?? 0, pct: total ? Math.round(((hasFuel ?? 0) / total) * 100) : 0 },
          body_type: { filled: hasBody ?? 0, pct: total ? Math.round(((hasBody ?? 0) / total) * 100) : 0 },
          colour: { filled: hasColour ?? 0, pct: total ? Math.round(((hasColour ?? 0) / total) * 100) : 0 },
          drivetrain: { filled: hasDrive ?? 0, pct: total ? Math.round(((hasDrive ?? 0) / total) * 100) : 0 },
          seller_type: { filled: hasSeller ?? 0, pct: total ? Math.round(((hasSeller ?? 0) / total) * 100) : 0 },
          state: { filled: hasState ?? 0, pct: total ? Math.round(((hasState ?? 0) / total) * 100) : 0 },
          market_price: { filled: hasMarket ?? 0, pct: total ? Math.round(((hasMarket ?? 0) / total) * 100) : 0 },
          price_badge: { filled: hasBadge ?? 0, pct: total ? Math.round(((hasBadge ?? 0) / total) * 100) : 0 },
          km: { filled: hasKm ?? 0, pct: total ? Math.round(((hasKm ?? 0) / total) * 100) : 0 },
        }
      };
    }
    return json({ endpoint: "audit", table: "retail_listings", by_source: results });
  }

  if (table === "auction" || table === "both") {
    const { count: total } = await supabase.from('vehicle_listings').select('id', { count: 'exact', head: true });
    const { count: hasPrice } = await supabase.from('vehicle_listings').select('id', { count: 'exact', head: true }).not('asking_price', 'is', null).gt('asking_price', 0);
    const { count: hasKm } = await supabase.from('vehicle_listings').select('id', { count: 'exact', head: true }).not('km', 'is', null);
    const { count: hasState } = await supabase.from('vehicle_listings').select('id', { count: 'exact', head: true }).not('state', 'is', null);
    return json({
      endpoint: "audit", table: "vehicle_listings", total: total ?? 0,
      fields: {
        asking_price: { filled: hasPrice ?? 0, pct: total ? Math.round(((hasPrice ?? 0) / total) * 100) : 0 },
        km: { filled: hasKm ?? 0, pct: total ? Math.round(((hasKm ?? 0) / total) * 100) : 0 },
        state: { filled: hasState ?? 0, pct: total ? Math.round(((hasState ?? 0) / total) * 100) : 0 },
      },
      note: "Auction listings don't require asking_price (hammer price determined at auction)"
    });
  }

  return json({ error: "table must be 'retail', 'auction', or 'both'" }, 400);
}

// ========== SEARCH (Unified cross-table) ==========
async function handleSearch(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const yearMin = url.searchParams.get("year_min");
  const yearMax = url.searchParams.get("year_max");
  const kmMax = url.searchParams.get("km_max");
  const priceMax = url.searchParams.get("price_max");
  const priceMin = url.searchParams.get("price_min");
  const state = url.searchParams.get("state");
  const sellerType = url.searchParams.get("seller_type");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 1000);

  // Query retail_listings
  let retailQuery = supabase
    .from("retail_listings")
    .select("id, source, make, model, variant_raw, badge, year, km, asking_price, state, suburb, transmission, fuel_type, body_type, colour, seller_type, listing_url, price_badge, market_price, price_difference_percent, first_seen_at, last_seen_at, lifecycle_status")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (make) retailQuery = retailQuery.ilike("make", `%${make}%`);
  if (model) retailQuery = retailQuery.ilike("model", `%${model}%`);
  if (yearMin) retailQuery = retailQuery.gte("year", parseInt(yearMin));
  if (yearMax) retailQuery = retailQuery.lte("year", parseInt(yearMax));
  if (kmMax) retailQuery = retailQuery.lte("km", parseInt(kmMax));
  if (priceMax) retailQuery = retailQuery.lte("asking_price", parseInt(priceMax));
  if (priceMin) retailQuery = retailQuery.gte("asking_price", parseInt(priceMin));
  if (state) retailQuery = retailQuery.ilike("state", `%${state}%`);
  if (sellerType) retailQuery = retailQuery.eq("seller_type", sellerType);

  // Query vehicle_listings (auction/OEM)
  let auctionQuery = supabase
    .from("vehicle_listings")
    .select("id, source, make, model, variant_raw, year, km, asking_price, state, location, transmission, fuel, seller_type, listing_url, auction_house, auction_datetime, status, first_seen_at, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (make) auctionQuery = auctionQuery.ilike("make", `%${make}%`);
  if (model) auctionQuery = auctionQuery.ilike("model", `%${model}%`);
  if (yearMin) auctionQuery = auctionQuery.gte("year", parseInt(yearMin));
  if (yearMax) auctionQuery = auctionQuery.lte("year", parseInt(yearMax));
  if (kmMax) auctionQuery = auctionQuery.lte("km", parseInt(kmMax));
  if (priceMax) auctionQuery = auctionQuery.lte("asking_price", parseInt(priceMax));
  if (priceMin) auctionQuery = auctionQuery.gte("asking_price", parseInt(priceMin));

  const [retailResult, auctionResult] = await Promise.all([
    retailQuery, auctionQuery
  ]);

  const retail = (retailResult.data ?? []).map((r: any) => ({ ...r, _table: 'retail' }));
  const auction = (auctionResult.data ?? []).map((r: any) => ({ ...r, _table: 'auction' }));

  // Merge and sort by last_seen_at
  const combined = [...retail, ...auction]
    .sort((a: any, b: any) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''))
    .slice(0, limit);

  return json({
    endpoint: "search",
    total: combined.length,
    retail_count: retail.length,
    auction_count: auction.length,
    data: combined
  });
}

// ========== HISTORY (Price history) ==========
async function handleHistory(supabase: any, url: URL) {
  const listingId = url.searchParams.get("listing_id");
  const source = url.searchParams.get("source");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200"), 1000);

  let query = supabase
    .from("listing_price_history")
    .select("id, listing_id, source, price, price_badge, market_price, price_difference_percent, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (listingId) query = query.eq("listing_id", listingId);
  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // If make/model provided, cross-reference with retail_listings to find listing_ids
  if (!listingId && (make || model)) {
    let lookupQuery = supabase.from("retail_listings").select("source_listing_id").limit(100);
    if (make) lookupQuery = lookupQuery.ilike("make", `%${make}%`);
    if (model) lookupQuery = lookupQuery.ilike("model", `%${model}%`);
    const { data: matches } = await lookupQuery;
    if (matches && matches.length > 0) {
      const ids = matches.map((m: any) => m.source_listing_id).filter(Boolean);
      const { data: historyData, error: histError } = await supabase
        .from("listing_price_history")
        .select("id, listing_id, source, price, price_badge, market_price, price_difference_percent, created_at")
        .in("listing_id", ids.slice(0, 50))
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!histError && historyData) {
        return json({ endpoint: "history", count: historyData.length, data: historyData });
      }
    }
  }

  return json({ endpoint: "history", count: data?.length ?? 0, data });
}

// ========== CLEARANCES (Sold/delisted events) ==========
async function handleClearances(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const source = url.searchParams.get("source");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 1000);

  let query = supabase
    .from("clearance_events")
    .select("*")
    .order("cleared_at", { ascending: false })
    .limit(limit);

  if (make) query = query.ilike("make", `%${make}%`);
  if (model) query = query.ilike("model", `%${model}%`);
  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return json({ endpoint: "clearances", count: data?.length ?? 0, data });
}

// ========== OPPORTUNITIES (Matched opps + caroogle + deal flags) ==========
async function handleOpportunities(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const type = url.searchParams.get("type"); // 'matched', 'caroogle', 'flags', or all
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  const results: Record<string, any> = {};

  if (!type || type === "matched") {
    let mq = supabase.from("matched_opportunities_v1").select("*").order("created_at", { ascending: false }).limit(limit);
    if (make) mq = mq.ilike("make", `%${make}%`);
    if (model) mq = mq.ilike("model", `%${model}%`);
    const { data } = await mq;
    results.matched = data ?? [];
  }

  if (!type || type === "caroogle") {
    let cq = supabase.from("caroogle_finds").select("*").order("created_at", { ascending: false }).limit(limit);
    if (make) cq = cq.ilike("make", `%${make}%`);
    if (model) cq = cq.ilike("model", `%${model}%`);
    const { data } = await cq;
    results.caroogle_finds = data ?? [];
  }

  if (!type || type === "flags") {
    let fq = supabase.from("deal_flags").select("*").order("created_at", { ascending: false }).limit(limit);
    if (make) fq = fq.ilike("make", `%${make}%`);
    if (model) fq = fq.ilike("model", `%${model}%`);
    const { data } = await fq;
    results.deal_flags = data ?? [];
  }

  return json({
    endpoint: "opportunities",
    counts: {
      matched: results.matched?.length ?? 'not queried',
      caroogle_finds: results.caroogle_finds?.length ?? 'not queried',
      deal_flags: results.deal_flags?.length ?? 'not queried',
    },
    ...results
  });
}

// ========== SALES TRUTH (Verified historical sales) ==========
async function handleSalesTruth(supabase: any, url: URL) {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const yearMin = url.searchParams.get("year_min");
  const yearMax = url.searchParams.get("year_max");
  const source = url.searchParams.get("source");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 1000);

  let query = supabase
    .from("vehicle_sales_truth")
    .select("*")
    .order("sale_date", { ascending: false })
    .limit(limit);

  if (make) query = query.ilike("make", `%${make}%`);
  if (model) query = query.ilike("model", `%${model}%`);
  if (yearMin) query = query.gte("year", parseInt(yearMin));
  if (yearMax) query = query.lte("year", parseInt(yearMax));
  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return json({ endpoint: "sales_truth", count: data?.length ?? 0, data });
}

// ========== INGESTION (Live health & diagnostics) ==========
async function handleIngestion(supabase: any, url: URL) {
  const source = url.searchParams.get("source"); // filter to one cron
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  // Heartbeats
  let hbQuery = supabase
    .from("cron_heartbeat")
    .select("cron_name, last_seen_at, last_ok, note, rows_inserted")
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (source) hbQuery = hbQuery.ilike("cron_name", `%${source}%`);
  const { data: heartbeats } = await hbQuery;

  // Ingestion sources registry
  const { data: sources } = await supabase
    .from("ingestion_sources")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(100);

  // Recent audit log failures
  const { data: recentFails } = await supabase
    .from("cron_audit_log")
    .select("cron_name, run_at, success, error, result")
    .eq("success", false)
    .order("run_at", { ascending: false })
    .limit(20);

  // Apify runs queue status
  const { data: apifyRuns } = await supabase
    .from("apify_runs_queue")
    .select("id, source, status, started_at, completed_at, items_fetched, items_upserted, last_error")
    .order("created_at", { ascending: false })
    .limit(20);

  return json({
    endpoint: "ingestion",
    heartbeats: heartbeats ?? [],
    ingestion_sources: sources ?? [],
    recent_failures: recentFails ?? [],
    apify_runs: apifyRuns ?? [],
    external_apis: {
      caroogle_api: {
        base_url: "https://backend.caroogle.codesorbit.net/api/ads",
        description: "Fady's unified Caroogle API — serves 4 Australian vehicle marketplace sources from a single endpoint",
        pagination: "?page=N&limit=N (default limit varies by source)",
        sources: {
          pickles: {
            param: "?source=pickles",
            cron: "caroogle-shadow-cron (every 2h)",
            heartbeat_key: "caroogle-pickles-ingest",
            source_class: "auction",
            seller_type: "auction_house",
            writes_to: "vehicle_listings",
            notes: "Primary Pickles feed — replaced legacy Firecrawl scraping"
          },
          toyota: {
            param: "?source=toyota",
            cron: "caroogle-toyota-cron (every 2h)",
            heartbeat_key: "caroogle-toyota-ingest",
            source_class: "oem_used",
            seller_type: "oem_dealer",
            writes_to: "vehicle_listings",
            notes: "Toyota Used Vehicles — OEM certified pre-owned inventory"
          },
          gumtree: {
            param: "?source=gumtree",
            cron: "caroogle-gumtree-cron (every 2h)",
            heartbeat_key: "caroogle-gumtree-ingest",
            source_class: "private_and_dealer",
            seller_type: "inferred",
            writes_to: "vehicle_listings",
            notes: "Gumtree classifieds — replaced expensive Apify scraper ($45/day savings)"
          },
          autotrader: {
            param: "?source=autotrader",
            cron: "caroogle-autotrader-cron (every 2h)",
            heartbeat_key: "caroogle-autotrader-ingest",
            source_class: "retail",
            seller_type: "dealer",
            writes_to: "vehicle_listings",
            listing_id_prefix: "caroogle-autotrader:",
            notes: "Autotrader via Caroogle — listing_id prefixed to avoid collision with direct API ingest"
          }
        },
        troubleshooting: {
          "0_records_returned": "Check if API is up: curl https://backend.caroogle.codesorbit.net/api/ads?source=pickles&page=1&limit=5 — if empty, contact Fady (API maintainer)",
          "schema_change": "Compare returned JSON fields with expected: title, price, odometer, year, make, model, location, url, image_url",
          "rate_limiting": "API has no documented rate limits but runs should be staggered (crons offset by source)"
        }
      },
      autotrader_direct: {
        base_url: "https://listings.platform.autotrader.com.au/api/v3/search",
        cron: "autotrader-api-cron (every 5min)",
        description: "Direct Autotrader Australia search API — cursor-based crawl across make/state segments",
        writes_to: "vehicle_listings (via autotrader_raw_payloads)",
        notes: "Runs alongside Caroogle Autotrader; direct API listings use standard IDs, Caroogle uses 'caroogle-autotrader:' prefix"
      },
      carsales_apify: {
        description: "Carsales via Apify actors — 32 segments (8 states × 4 price bands)",
        cron: "carsales-micro-cron (every 2h)",
        writes_to: "retail_listings",
        notes: "Tiered priority: High=2h, Medium=6h, Low=12h. Cost guard aborts runs >$5 or >25min"
      },
      easyauto123: {
        description: "EasyAuto123 dealer scrape",
        cron: "easyauto-scrape (every 3h)",
        writes_to: "retail_listings"
      }
    },
    note: "Use ?source=caroogle to filter heartbeats to Caroogle crons. Check 'recent_failures' for error details."
  });
}

// ========== SCHEMA ==========
async function handleSchema(supabase: any) {
  const tables = [
    "vehicle_listings", "retail_listings", "dealer_fingerprints", "cheap_car_queue",
    "vehicle_sales_truth", "dealer_outcomes", "dealer_liquidity_profiles",
    "caroogle_finds", "deal_flags", "market_listing_history",
    "listing_price_history", "clearance_events", "dealer_demands",
    "demand_opportunities", "matched_opportunities_v1", "apify_runs_queue",
    "cron_heartbeat", "retail_listing_events", "ingestion_sources"
  ];

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await supabase.from(t).select("id", { count: "exact", head: true });
    counts[t] = count ?? 0;
  }

  return json({
    endpoint: "schema",
    total_tables: 231,
    key_tables: counts,
    table_roles: {
      "vehicle_listings": "Auction + OEM + Caroogle API listings (Pickles, Manheim, Toyota, Gumtree, Autotrader via Caroogle)",
      "retail_listings": "Retail pricing backbone (Carsales 61k, Autotrader direct 67k, Drive, EasyAuto)",
      "dealer_fingerprints": "Dealer buying pattern profiles",
      "cheap_car_queue": "Scored deal opportunities",
      "vehicle_sales_truth": "Historical verified sale outcomes",
      "dealer_liquidity_profiles": "Dealer flip history & profit patterns",
      "caroogle_finds": "AI-detected market anomalies",
      "deal_flags": "Price gap / underpriced flags",
      "market_listing_history": "Persistent market intelligence (price tracking, disappearances)",
      "listing_price_history": "Per-listing price change timeline",
      "clearance_events": "When listings clear (sell/delist) + days on market",
      "dealer_demands": "Active dealer buy requests",
      "demand_opportunities": "Demand-supply gap opportunities",
      "matched_opportunities_v1": "Matched dealer specs to listings",
    },
    ingestion_architecture: {
      description: "5-layer pipeline: Source → Raw → Normalisation → Deduplication → Lifecycle → Master Table",
      primary_external_api: "Fady's Caroogle API (backend.caroogle.codesorbit.net/api/ads) — serves pickles, toyota, gumtree, autotrader via ?source= param",
      caroogle_crons: ["caroogle-shadow-cron (pickles)", "caroogle-toyota-cron", "caroogle-gumtree-cron", "caroogle-autotrader-cron"],
      other_sources: ["autotrader-api-cron (direct API)", "carsales-micro-cron (Apify)", "easyauto-scrape", "manheim-html-ingest", "dealer-outbound-crawl"],
      health_monitoring: "Use ?endpoint=ingestion for live heartbeats, failure logs, and source registry"
    },
    available_endpoints: {
      "listings": "Auction/OEM listings (vehicle_listings). Filters: make, model, year_min, year_max, km_max, price_max, source, status, location",
      "retail": "Retail listings (Carsales, Autotrader, etc). Filters: make, model, year_min, year_max, km_max, price_min, price_max, source, state, badge, seller_type",
      "search": "Unified search across BOTH tables in one call. Filters: make, model, year_min, year_max, km_max, price_min, price_max, state, seller_type",
      "audit": "Data quality dashboard — field completeness by source. Params: table=retail|auction|both, source=carsales|autotrader|etc",
      "deals": "Scored deal opportunities (cheap_car_queue). Filters: make, model, status",
      "history": "Price change timeline. Filters: listing_id, source, make, model",
      "clearances": "Sold/delisted events with days-on-market. Filters: make, model, source",
      "opportunities": "Matched opportunities + caroogle finds + deal flags. Filters: make, model, type=matched|caroogle|flags",
      "sales_truth": "Verified historical sale outcomes. Filters: make, model, year_min, year_max, source",
      "ingestion": "Live ingestion health: cron heartbeats, source registry, recent failures, Caroogle API details. Filters: source",
      "fingerprints": "Dealer buying pattern profiles. Filters: dealer_name, make, model, active_only",
      "analytics": "Market summary stats. Filters: make, model",
      "schema": "This endpoint — system overview with ingestion architecture"
    },
    note: "All endpoints support limit= (up to 1000) and most support offset= for pagination. Use ?endpoint=ingestion for real-time ingestion diagnostics."
  });
}

// Helper
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
