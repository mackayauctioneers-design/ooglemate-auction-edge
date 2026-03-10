
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBadge } from "../_shared/taxonomy/extractBadge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Time budget to stay under platform timeout
const TIME_BUDGET_MS = 25000;
const LOCK_DURATION_MS = 60000; // 1 minute lock per run

interface MappedListing {
  source: string;
  source_listing_id: string;
  listing_url: string;
  year: number;
  make: string;
  model: string;
  variant_raw?: string;
  km?: number;
  asking_price: number;
  state?: string;
  suburb?: string;
  price_badge?: string;
  market_price?: number;
  price_difference?: number;
  price_difference_percent?: number;
  market_price_source?: string;
  fuel_type?: string;
  transmission?: string;
  body_type?: string;
  // Auction-specific fields
  auction_house?: string;
  auction_datetime?: string;
  guide_price?: number;
  sold?: boolean;
  sold_price?: number;
}

// Badge-to-discount estimation table (Tier 1 fast scoring)
const BADGE_DISCOUNT_MAP: Record<string, { low: number; high: number; mid: number }> = {
  'well below market': { low: 0.10, high: 0.20, mid: 0.13 },
  'below market':      { low: 0.06, high: 0.12, mid: 0.08 },
  'great price':       { low: 0.05, high: 0.10, mid: 0.07 },
  'good price':        { low: 0.03, high: 0.06, mid: 0.04 },
  'fair price':        { low: 0.00, high: 0.03, mid: 0.01 },
  'around market':     { low: -0.02, high: 0.02, mid: 0.00 },
  'above market':      { low: -0.08, high: -0.03, mid: -0.05 },
  'well above market': { low: -0.15, high: -0.08, mid: -0.12 },
};

function estimateMarketDelta(badge: string | undefined, askingPrice: number): {
  market_price?: number;
  price_difference?: number;
  price_difference_percent?: number;
} {
  if (!badge || !askingPrice) return {};
  const key = badge.toLowerCase().replace(/\s+price$/i, '').trim();
  // Try exact match first, then partial
  let discount = BADGE_DISCOUNT_MAP[key];
  if (!discount) {
    for (const [k, v] of Object.entries(BADGE_DISCOUNT_MAP)) {
      if (key.includes(k) || k.includes(key)) { discount = v; break; }
    }
  }
  if (!discount) return {};
  const estimatedMarket = Math.round(askingPrice / (1 - discount.mid));
  return {
    market_price: estimatedMarket,
    price_difference: askingPrice - estimatedMarket,
    price_difference_percent: parseFloat((-(discount.mid * 100)).toFixed(2)),
  };
}

// ─── SOURCE-SPECIFIC MAPPERS ───────────────────────────────────

function mapAutotraderItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = (rawItem._source as Record<string, unknown>) || rawItem;
    const sourceId = item.id as number | string;
    const urlPath = (item.url || "") as string;
    const idMatch = urlPath.match(/car\/(\d+)\//);
    const listingId = String(sourceId || idMatch?.[1] || "");
    if (!listingId) return null;

    const year = (item.manu_year || item.year) as number;
    if (!year || year < 2000) return null;

    const vehicle = (item.vehicle || {}) as Record<string, unknown>;
    const make = ((item.make || vehicle.make || "") as string).toUpperCase().trim();
    const model = ((item.model || vehicle.model || "") as string).toUpperCase().trim();
    if (!make || !model) return null;

    const variant = ((item.variant || vehicle.variant || "") as string).toUpperCase().trim();
    const priceObj = (item.price || {}) as Record<string, unknown>;
    const price = (priceObj.advertised_price || priceObj.driveaway_price || item.price) as number;
    if (!price || price < 1000 || price > 500000) return null;

    const km = (item.odometer || item.km || item.mileage) as number | undefined;
    const state = ((item.location_state || item.state || "") as string).toUpperCase();
    const suburb = (item.location_city || item.suburb || item.location || "") as string;

    const baseUrl = "https://www.autotrader.com.au/";
    const fullUrl = urlPath.startsWith("http") ? urlPath : `${baseUrl}${urlPath}`;

    return {
      source: "autotrader",
      source_listing_id: listingId,
      listing_url: fullUrl,
      year, make, model,
      variant_raw: variant || undefined,
      km, asking_price: price,
      state: state || undefined,
      suburb: suburb || undefined,
    };
  } catch { return null; }
}

/**
 * Carsales Cheerio (memo23/carsales-cheerio) output:
 * { title, make, model, year, networkId, name, price/prices, odometer, 
 *   location, state, url/link, transmission, fuelType, drive, ... }
 */
/**
 * Deep-scan the Carsales Merlin UI component tree to extract structured fields.
 * The Apify actor returns a server-driven UI payload with vehicle data buried in
 * nested GridItem > Stack > Icon(title="Odometer") + Text(value="32km") patterns.
 */
function extractFromMerlinTree(node: unknown): {
  km?: number; bodyType?: string; fuel?: string; transmission?: string; priceBadge?: string;
} {
  const result: { km?: number; bodyType?: string; fuel?: string; transmission?: string; priceBadge?: string } = {};
  if (!node || typeof node !== "object") return result;
  const n = node as Record<string, unknown>;

  // Check if this is a Stack with Icon+Text children (key-details pattern)
  if (Array.isArray(n.children)) {
    const children = n.children as Record<string, unknown>[];
    // Look for Icon with title + sibling Text with value
    const icon = children.find((c) => c?.type === "Icon" && typeof c.title === "string");
    const text = children.find((c) => c?.type === "Text" && typeof c.value === "string");
    if (icon && text) {
      const title = (icon.title as string).toLowerCase();
      const value = (text.value as string).trim();
      if (title === "odometer" || title === "kms") {
        const parsed = parseInt(value.replace(/[^0-9]/g, ""), 10);
        if (parsed >= 0) result.km = parsed;
      } else if (title === "body type") {
        result.bodyType = value;
      } else if (title === "fuel") {
        result.fuel = value;
      } else if (title === "transmission") {
        result.transmission = value;
      }
    }

    // Check for price badge: Badge with label like "Well Below Market Price"
    for (const c of children) {
      if (c?.type === "Tooltip") {
        const badge = (c as Record<string, unknown>).child as Record<string, unknown> | undefined;
        if (badge?.type === "Badge" && typeof badge.label === "string") {
          result.priceBadge = badge.label as string;
        }
      }
      if (c?.type === "Badge" && typeof c.label === "string") {
        result.priceBadge = c.label as string;
      }
    }

    // Recurse into children
    for (const c of children) {
      const sub = extractFromMerlinTree(c);
      if (sub.km !== undefined && result.km === undefined) result.km = sub.km;
      if (sub.bodyType && !result.bodyType) result.bodyType = sub.bodyType;
      if (sub.fuel && !result.fuel) result.fuel = sub.fuel;
      if (sub.transmission && !result.transmission) result.transmission = sub.transmission;
      if (sub.priceBadge && !result.priceBadge) result.priceBadge = sub.priceBadge;
    }
  }

  // Recurse into child (single child node)
  if (n.child) {
    const sub = extractFromMerlinTree(n.child);
    if (sub.km !== undefined && result.km === undefined) result.km = sub.km;
    if (sub.bodyType && !result.bodyType) result.bodyType = sub.bodyType;
    if (sub.fuel && !result.fuel) result.fuel = sub.fuel;
    if (sub.transmission && !result.transmission) result.transmission = sub.transmission;
    if (sub.priceBadge && !result.priceBadge) result.priceBadge = sub.priceBadge;
  }

  return result;
}

function mapCarsalesItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = rawItem;
    
    // Listing ID: networkId or fallback to URL-based ID
    const networkId = (item.networkId || item.id || "") as string;
    const url = (item.url || item.link || item.detailUrl || "") as string;
    const idMatch = url.match(/(\d{6,})/);
    const listingId = networkId.replace(/^sse-ad-/, "") || idMatch?.[1] || "";
    if (!listingId) return null;

    // Year
    let year = 0;
    if (typeof item.year === "number") year = item.year;
    else if (typeof item.year === "string") year = parseInt(item.year, 10) || 0;
    if (!year || year < 2000) return null;

    // Make/Model - carsales uses lowercase
    const make = ((item.make || "") as string).toUpperCase().trim();
    const model = ((item.model || "") as string).toUpperCase().trim();
    if (!make || !model) return null;

    // Variant from title or badge field
    const title = (item.title || item.name || "") as string;
    const variant = ((item.badge || item.variant || "") as string).toUpperCase().trim() 
      || title.toUpperCase();

    // Price: can be nested object or flat
    let price = 0;
    if (typeof item.price === "number") {
      price = item.price;
    } else if (typeof item.price === "object" && item.price !== null) {
      const p = item.price as Record<string, unknown>;
      price = (p.value || p.advertised || p.driveaway || p.price || 0) as number;
    } else if (item.prices && typeof item.prices === "object") {
      const p = item.prices as Record<string, unknown>;
      price = (p.advertised || p.driveaway || p.price || 0) as number;
    }
    // Try extracting from string like "$29,990"
    if (!price && typeof item.price === "string") {
      const m = (item.price as string).replace(/[^0-9]/g, "");
      if (m) price = parseInt(m, 10);
    }
    if (!price || price < 1000 || price > 500000) return null;

    // Extract fields from Merlin UI tree if present
    const merlin = item.root ? extractFromMerlinTree(item.root) : {};

    // KM: try flat fields first, then Merlin tree
    let km: number | undefined;
    const rawKm = item.odometer || item.km || item.mileage || item.kilometres;
    if (typeof rawKm === "number") km = rawKm;
    else if (typeof rawKm === "string") {
      const parsed = parseInt(rawKm.replace(/[^0-9]/g, ""), 10);
      if (parsed > 0) km = parsed;
    }
    if (km === undefined && merlin.km !== undefined) km = merlin.km;

    // Location
    const state = ((item.state || item.location_state || "") as string).toUpperCase().trim();
    const suburb = (item.suburb || item.location || item.city || "") as string;

    // Price badge: flat fields first, then Merlin tree
    const priceBadge = (
      (item.priceBadge || item.priceRating || item.dealRating || item.priceLabel || "") as string
    ).trim() || merlin.priceBadge || undefined;

    // Try to extract structured pricing data from raw payload
    let marketPrice: number | undefined;
    let priceDiff: number | undefined;
    let priceDiffPct: number | undefined;
    let marketPriceSource: string | undefined;

    // Check for structured pricing objects (Carsales __NEXT_DATA__ or similar)
    const pricing = (item.vehiclePricing || item.priceInsights || item.pricing || item.dealRating) as Record<string, unknown> | undefined;
    if (pricing && typeof pricing === 'object') {
      const mp = (pricing.marketAverage || pricing.marketPrice || pricing.estimatedValue || pricing.average) as number;
      const diff = (pricing.difference || pricing.priceDifference) as number;
      const diffPct = (pricing.differencePercent || pricing.priceDifferencePercent) as number;
      if (mp && mp > 1000) {
        marketPrice = Math.round(mp);
        priceDiff = diff || (price - mp);
        priceDiffPct = diffPct || parseFloat(((price - mp) / mp * 100).toFixed(2));
        marketPriceSource = 'carsales_structured';
      }
    }
    // Also check flat fields
    if (!marketPrice) {
      const flatMarket = (item.marketPrice || item.market_price || item.estimatedValue) as number;
      if (flatMarket && flatMarket > 1000) {
        marketPrice = Math.round(flatMarket);
        priceDiff = price - flatMarket;
        priceDiffPct = parseFloat(((price - flatMarket) / flatMarket * 100).toFixed(2));
        marketPriceSource = 'carsales_flat';
      }
    }
    // Tier 1 fallback: estimate from badge
    if (!marketPrice && priceBadge) {
      const est = estimateMarketDelta(priceBadge, price);
      if (est.market_price) {
        marketPrice = est.market_price;
        priceDiff = est.price_difference;
        priceDiffPct = est.price_difference_percent;
        marketPriceSource = 'badge_estimate';
      }
    }

    // URL
    const fullUrl = url.startsWith("http") ? url 
      : url ? `https://www.carsales.com.au${url}` : "";
    if (!fullUrl) return null;

    return {
      source: "carsales",
      source_listing_id: listingId,
      listing_url: fullUrl,
      year, make, model,
      variant_raw: variant || undefined,
      km, asking_price: price,
      state: state || undefined,
      suburb: suburb || undefined,
      price_badge: priceBadge,
      market_price: marketPrice,
      price_difference: priceDiff,
      price_difference_percent: priceDiffPct,
      market_price_source: marketPriceSource,
      // Pass through Merlin-extracted fields for downstream enrichment
      ...(merlin.fuel ? { fuel_type: merlin.fuel } : {}),
      ...(merlin.transmission ? { transmission: merlin.transmission } : {}),
      ...(merlin.bodyType ? { body_type: merlin.bodyType } : {}),
    };
  } catch { return null; }
}

/**
 * Gumtree Cheerio (memo23/gumtree-cheerio) output:
 * { title, price, url/link, location, attributes (array or object), 
 *   description, seller, images, ... }
 * Vehicle fields often in attributes: make, model, year, odometer/km
 */
function mapGumtreeItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = rawItem;
    
    // Listing ID from URL or id field
    const url = (item.url || item.link || "") as string;
    const rawId = (item.id || item.adId || "") as string;
    const idMatch = url.match(/\/(\d{8,})/);
    const listingId = String(rawId || idMatch?.[1] || "");
    if (!listingId) return null;

    // Attributes can be an object or array of {name, value}
    const attrs: Record<string, string> = {};
    if (Array.isArray(item.attributes)) {
      for (const a of item.attributes as Array<{name?: string; key?: string; value?: string}>) {
        const key = ((a.name || a.key || "") as string).toLowerCase();
        attrs[key] = (a.value || "") as string;
      }
    } else if (item.attributes && typeof item.attributes === "object") {
      for (const [k, v] of Object.entries(item.attributes as Record<string, unknown>)) {
        attrs[k.toLowerCase()] = String(v || "");
      }
    }

    // Year
    const yearRaw = item.year || attrs.year || attrs.caryear || attrs["car year"];
    const year = typeof yearRaw === "number" ? yearRaw : parseInt(String(yearRaw || "0"), 10);
    if (!year || year < 2000) return null;

    // Make/Model - try top-level then attributes
    const make = ((item.make || attrs.make || attrs.carmake || "") as string).toUpperCase().trim();
    const model = ((item.model || attrs.model || attrs.carmodel || "") as string).toUpperCase().trim();
    
    // If no structured make/model, try parsing from title
    const title = (item.title || item.name || "") as string;
    if (!make || !model) {
      // Can't reliably map without make/model
      return null;
    }

    // Price
    let price = 0;
    const rawPrice = item.price || item.amount;
    if (typeof rawPrice === "number") price = rawPrice;
    else if (typeof rawPrice === "string") {
      const m = rawPrice.replace(/[^0-9]/g, "");
      if (m) price = parseInt(m, 10);
    } else if (rawPrice && typeof rawPrice === "object") {
      const p = rawPrice as Record<string, unknown>;
      price = (p.value || p.amount || 0) as number;
    }
    if (!price || price < 1000 || price > 500000) return null;

    // KM
    let km: number | undefined;
    const rawKm = item.odometer || item.km || item.mileage || attrs.odometer || attrs.km || attrs.kilometres;
    if (typeof rawKm === "number") km = rawKm;
    else if (typeof rawKm === "string") {
      const parsed = parseInt(rawKm.replace(/[^0-9]/g, ""), 10);
      if (parsed > 0) km = parsed;
    }

    // Location
    const location = (item.location || item.suburb || attrs.location || "") as string;
    const stateMatch = location.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/i);
    const state = stateMatch ? stateMatch[1].toUpperCase() : undefined;

    const fullUrl = url.startsWith("http") ? url 
      : url ? `https://www.gumtree.com.au${url}` : "";
    if (!fullUrl) return null;

    return {
      source: "gumtree",
      source_listing_id: listingId,
      listing_url: fullUrl,
      year, make, model,
      variant_raw: title.toUpperCase() || undefined,
      km, asking_price: price,
      state, suburb: location || undefined,
    };
  } catch { return null; }
}

/**
 * Slattery actor output (affectionate_yepsen/slatteryv6):
 * The actor pushes data via webhooks to slattery-detail-ingest-webhook,
 * but if it also stores to dataset, we handle it here.
 * Fields: source_stock_id, detail_url, year, make, model, variant_raw,
 *         km, current_bid, guide_price, sold_price, location, state, etc.
 */
function mapSlatteryItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = rawItem;
    
    const listingId = (item.source_stock_id || item.consignmentNo || item.id || "") as string;
    if (!listingId) return null;

    const year = (item.year || 0) as number;
    if (!year || year < 2000) return null;

    const make = ((item.make || "") as string).toUpperCase().trim();
    const model = ((item.model || "") as string).toUpperCase().trim();
    if (!make || !model) return null;

    // Slattery is auction — use guide_price or current_bid as asking_price
    const guidePrice = (item.guide_price || item.guidePrice || 0) as number;
    const currentBid = (item.current_bid || item.currentBid || 0) as number;
    const startingBid = (item.starting_bid || item.startingBid || 0) as number;
    const price = guidePrice || currentBid || startingBid;
    // Allow priceless auction listings through (they'll get auction-watch treatment)

    const km = (item.km || item.odometer) as number | undefined;
    const state = ((item.state || "") as string).toUpperCase();
    const url = (item.detail_url || item.url || "") as string;
    const fullUrl = url.startsWith("http") ? url : "";

    return {
      source: "slattery",
      source_listing_id: listingId,
      listing_url: fullUrl || `https://slatteryauctions.com.au/assets/${listingId}`,
      year, make, model,
      variant_raw: ((item.variant_raw || "") as string).toUpperCase() || undefined,
      km,
      asking_price: price || 0, // 0 = priceless auction
      state: state || undefined,
      auction_house: "slattery",
      auction_datetime: (item.auction_datetime || null) as string | undefined,
      guide_price: guidePrice || undefined,
      sold: (item.sold || false) as boolean,
      sold_price: (item.sold_price || item.soldPrice || undefined) as number | undefined,
    };
  } catch { return null; }
}

/**
 * thescrapelab/ultimate-car-listings-scraper-50-sites output:
 * { source, source_site, listing_id, url, title, car_name,
 *   price, year, brand, model, mileage_km, trim,
 *   transmission, fuel, drivetrain, colour, condition,
 *   dealer, dealer_key, location, image_url, country_code, currency_code }
 */
function mapUltimateCarItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = rawItem;

    // Listing ID
    const listingId = String(item.listing_id || item.stock_reference || "");
    if (!listingId) return null;

    // URL
    const url = (item.url || "") as string;
    if (!url) return null;

    // Year
    const year = Number(item.year || 0);
    if (!year || year < 2000) return null;

    // Make/Model — actor uses "brand" not "make"
    const make = ((item.brand || "") as string).toUpperCase().trim();
    const model = ((item.model || "") as string).toUpperCase().trim();
    if (!make || !model) return null;

    // Variant from trim field
    const variant = ((item.trim || "") as string).toUpperCase().trim();

    // Price
    let price = 0;
    if (typeof item.price === "number") {
      price = item.price;
    } else if (typeof item.price === "string") {
      const m = (item.price as string).replace(/[^0-9]/g, "");
      if (m) price = parseInt(m, 10);
    }
    if (!price || price < 1000 || price > 500000) return null;

    // KM — actor uses mileage_km
    let km: number | undefined;
    const rawKm = item.mileage_km || item.mileage;
    if (typeof rawKm === "number") km = rawKm;
    else if (typeof rawKm === "string") {
      const parsed = parseInt(rawKm.replace(/[^0-9]/g, ""), 10);
      if (parsed > 0) km = parsed;
    }

    // Location / state — try to extract AU state from location string
    const location = (item.location || "") as string;
    let state: string | undefined;
    const stateMatch = location.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
    if (stateMatch) state = stateMatch[1].toUpperCase();

    // Determine the actual marketplace source from the actor's source field
    // e.g. "carsguideau" → "carsguide", "driveau" → "drive"
    const actorSource = ((item.source || item.source_site || "") as string).toLowerCase();
    let mappedSource = "ultimate-car";
    if (actorSource.startsWith("carsguide")) mappedSource = "carsguide";
    else if (actorSource.startsWith("drive")) mappedSource = "drive";
    else if (actorSource.startsWith("justcars")) mappedSource = "justcars";
    else if (actorSource.startsWith("onlycars")) mappedSource = "onlycars";
    else if (actorSource.startsWith("pickles")) mappedSource = "pickles";
    else if (actorSource.startsWith("autotrader")) mappedSource = "autotrader-uc";

    return {
      source: mappedSource,
      source_listing_id: listingId,
      listing_url: url,
      year, make, model,
      variant_raw: variant || undefined,
      km, asking_price: price,
      state,
      suburb: location || undefined,
    };
  } catch { return null; }
}

// ─── SOURCE ROUTER ─────────────────────────────────────────────

function mapItemForSource(source: string, rawItem: Record<string, unknown>): MappedListing | null {
  switch (source) {
    case "autotrader": return mapAutotraderItem(rawItem);
    case "carsales": return mapCarsalesItem(rawItem);
    case "gumtree": return mapGumtreeItem(rawItem);
    case "slattery": return mapSlatteryItem(rawItem);
    case "ultimate-car": return mapUltimateCarItem(rawItem);
    default: {
      // Fallback: try generic mapping for unknown sources
      console.warn(`[FETCH] Unknown source '${source}', attempting generic mapping`);
      return mapCarsalesItem(rawItem) || mapAutotraderItem(rawItem);
    }
  }
}

// Auction sources get upserted differently (vehicle_listings vs retail_listings)
const AUCTION_SOURCES = new Set(["slattery", "pickles"]);

// ─── MAIN WORKER ───────────────────────────────────────────────

/**
 * autotrader-fetch: UNIVERSAL APIFY WORKER
 * 
 * Claims queued Apify runs from ANY source, checks if complete,
 * fetches datasets, and upserts listings using source-specific mappers.
 * 
 * Supports: autotrader, carsales, gumtree, slattery
 * 
 * CRITICAL STATE MACHINE:
 * - queued → running (Apify still processing)
 * - running → fetching (Apify complete, fetching dataset)
 * - fetching → fetching (partial progress, time budget exhausted)
 * - fetching → done (all items fetched)
 * - any → error (on failure)
 * 
 * A run is ONLY marked "done" when:
 * - items.length === 0 (no more items)
 * - items.length < batchSize (last page)
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    const now = new Date();

    let runsProcessed = 0;
    let totalNew = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    const runResults: Array<{ run_id: string; source: string; status: string; items?: number; reason?: string }> = [];

    // Process runs until time budget exhausted
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Claim next queued or running run (ANY source)
      const { data: runs, error: fetchError } = await supabase
        .from("apify_runs_queue")
        .select("*")
        .in("status", ["queued", "running", "fetching"])
        .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
        // Order by updated_at ASC so least-recently-touched runs get priority
        // This prevents a single long-running "fetching" source from starving others
        .order("updated_at", { ascending: true })
        .limit(1);

      if (fetchError || !runs || runs.length === 0) {
        console.log("No runs to process");
        break;
      }

      const run = runs[0];
      const runSource = (run.source || "autotrader") as string;

      // Generate PER-RUN lock token (not reused across loop iterations)
      const runLockToken = crypto.randomUUID();
      const lockAttemptAtIso = new Date().toISOString();
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

      // If this row has an expired lock, clear it first so claim can proceed.
      if (run.locked_until && new Date(run.locked_until).getTime() < Date.now()) {
        await supabase
          .from("apify_runs_queue")
          .update({
            lock_token: null,
            locked_until: null,
            updated_at: lockAttemptAtIso,
          })
          .eq("id", run.id)
          .lt("locked_until", lockAttemptAtIso);
      }

      // Atomic lock claim
      const { data: locked, error: lockError } = await supabase
        .from("apify_runs_queue")
        .update({
          lock_token: runLockToken,
          locked_until: lockUntil,
          updated_at: lockAttemptAtIso,
        })
        .eq("id", run.id)
        .is("lock_token", null)
        .select()
        .maybeSingle();

      if (lockError || !locked) {
        console.log(`Run ${run.run_id} already locked by another worker, skipping`);
        // Break instead of continue to avoid tight-looping on same run
        break;
      }

      console.log(`[${runSource}] Processing run ${run.run_id} (status: ${run.status})`);

      try {
        const datasetId = run.dataset_id || run.run_id;

        // Check Apify run status if not yet fetching
        if (run.status !== "fetching") {
          const statusResponse = await fetch(
            `https://api.apify.com/v2/actor-runs/${run.run_id}?token=${apifyToken}`
          );

          if (!statusResponse.ok) {
            throw new Error(`Failed to check run status: ${statusResponse.status}`);
          }

          const statusData = await statusResponse.json();
          const apifyStatus = statusData.data?.status;
          const actualDatasetId = statusData.data?.defaultDatasetId || datasetId;

          console.log(`[${runSource}] Run ${run.run_id} Apify status: ${apifyStatus}`);

          if (apifyStatus === "RUNNING" || apifyStatus === "READY") {
            // Still running - update status and release lock
            await supabase
              .from("apify_runs_queue")
              .update({ 
                status: "running",
                started_at: run.started_at || now.toISOString(),
                locked_until: null,
                lock_token: null,
                updated_at: now.toISOString()
              })
              .eq("id", run.id);

            runResults.push({ run_id: run.run_id, source: runSource, status: "still_running" });
            // Break out — don't re-poll the same still-running run in a tight loop
            break;
          }

          if (apifyStatus === "FAILED" || apifyStatus === "ABORTED") {
            await supabase
              .from("apify_runs_queue")
              .update({ 
                status: "error",
                last_error: `Apify run ${apifyStatus}`,
                completed_at: now.toISOString(),
                locked_until: null,
                lock_token: null,
                updated_at: now.toISOString()
              })
              .eq("id", run.id);

            runResults.push({ run_id: run.run_id, source: runSource, status: `apify_${apifyStatus}` });
            totalErrors++;
            continue;
          }

          // TIMED-OUT runs still have partial results in their dataset — treat as fetchable
          if (apifyStatus === "TIMED-OUT") {
            console.log(`[${runSource}] Run ${run.run_id} timed out but has partial results — fetching dataset`);
            // Fall through to dataset fetch below
          }

          if (apifyStatus !== "SUCCEEDED" && apifyStatus !== "TIMED-OUT") {
            // Unknown status - release lock
            await supabase
              .from("apify_runs_queue")
              .update({ 
                locked_until: null,
                lock_token: null,
                updated_at: now.toISOString()
              })
              .eq("id", run.id);

            runResults.push({ run_id: run.run_id, source: runSource, status: `unknown_${apifyStatus}` });
            continue;
          }

          // Apify run succeeded - update to fetching status
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "fetching",
              dataset_id: actualDatasetId,
              updated_at: now.toISOString()
            })
            .eq("id", run.id);
        }

        // Fetch dataset items with pagination
        let offset = run.items_fetched || 0;
        // Carsales payloads can be very heavy (images/spec blobs) — keep batches small to avoid OOM.
        const batchSize = runSource === "carsales" ? 20 : 100;
        
        let itemsFetchedThisRun = 0;
        let itemsUpsertedThisRun = 0;
        let runNew = 0;
        let runUpdated = 0;
        let runErrors = 0;
        let isFinished = false;
        const priceBadgeAlerts: Array<{ badge: string; make: string; model: string; variant: string; year: number; price: number; km?: number; url: string; state: string }> = [];

        const effectiveDatasetId = run.dataset_id || datasetId;

        while (Date.now() - startTime < TIME_BUDGET_MS) {
          const datasetUrl = `https://api.apify.com/v2/datasets/${effectiveDatasetId}/items?token=${apifyToken}&offset=${offset}&limit=${batchSize}&clean=true&skipHidden=true&format=json`;
          const datasetResponse = await fetch(datasetUrl);

          if (!datasetResponse.ok) {
            throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`);
          }

          const items = await datasetResponse.json();
          
          if (!items || items.length === 0) {
            isFinished = true;
            console.log(`[${runSource}] Run ${run.run_id}: no more items at offset ${offset}, marking done`);
            break;
          }

          console.log(`[${runSource}] Fetched ${items.length} items from offset ${offset}`);
          itemsFetchedThisRun += items.length;

          // Map items using source-specific mapper
          const listings = items
            .map((item: Record<string, unknown>) => mapItemForSource(runSource, item))
            .filter((l: MappedListing | null): l is MappedListing => l !== null);

          console.log(`[${runSource.toUpperCase()} UPSERT] Batch: ${items.length} raw → ${listings.length} mapped (${items.length - listings.length} rejected)`);
          
          if (listings.length > 0) {
            console.log(`[${runSource.toUpperCase()} UPSERT] First item: ${listings[0].year} ${listings[0].make} ${listings[0].model} $${listings[0].asking_price}`);
          }

          for (const listing of listings) {
            try {
              const extracted = extractBadge(
                listing.make || '',
                listing.model || '',
                listing.variant_raw,
              );

              if (AUCTION_SOURCES.has(runSource)) {
                // Auction source → vehicle_listings table
                const { error } = await supabase
                  .from("vehicle_listings")
                  .upsert({
                    listing_id: `${runSource}:${listing.source_listing_id}`,
                    source: runSource,
                    listing_url: listing.listing_url,
                    year: listing.year,
                    make: listing.make,
                    model: listing.model,
                    variant_raw: listing.variant_raw || null,
                    badge: extracted.badge || null,
                    km: listing.km || null,
                    asking_price: listing.asking_price || null,
                    state: listing.state || null,
                    auction_house: listing.auction_house || runSource,
                    auction_datetime: listing.auction_datetime || null,
                    status: listing.sold ? "sold" : "listed",
                    first_seen_at: new Date().toISOString(),
                    last_seen_at: new Date().toISOString(),
                  }, { onConflict: "listing_id" });

                if (error) {
                  console.error(`[${runSource.toUpperCase()} UPSERT] Error for ${listing.source_listing_id}:`, error.message);
                  runErrors++;
                } else {
                  itemsUpsertedThisRun++;
                  runNew++; // Can't distinguish new vs updated with upsert
                }
              } else {
                // Retail source → retail_listings via RPC
                const { data, error } = await supabase.rpc("upsert_retail_listing", {
                  p_source: runSource,
                  p_source_listing_id: listing.source_listing_id,
                  p_listing_url: listing.listing_url,
                  p_year: listing.year,
                  p_make: listing.make,
                  p_model: listing.model,
                  p_variant_raw: listing.variant_raw || null,
                  p_variant_family: extracted.badge,
                  p_km: listing.km || null,
                  p_asking_price: listing.asking_price,
                  p_state: listing.state || null,
                  p_suburb: listing.suburb || null,
                  p_run_id: run.id,
                  p_price_type: "ask",
                });

                if (error) {
                  console.error(`[${runSource.toUpperCase()} UPSERT] RPC error for ${listing.source_listing_id}:`, error.message);
                  runErrors++;
                  continue;
                }

                // Update structured fields
                const resultRow = data?.[0] || data;
                if (resultRow?.id && (extracted.badge || extracted.fuel_type || extracted.drivetrain || extracted.body_type || listing.price_badge || listing.fuel_type || listing.transmission || listing.body_type)) {
                  const updateFields: Record<string, unknown> = {};
                  if (extracted.badge) updateFields.badge = extracted.badge;
                  if (extracted.fuel_type || listing.fuel_type) updateFields.fuel_type = extracted.fuel_type || listing.fuel_type;
                  if (extracted.drivetrain) updateFields.drivetrain = extracted.drivetrain;
                  if (extracted.body_type || listing.body_type) updateFields.body_type = extracted.body_type || listing.body_type;
                  if (listing.transmission) updateFields.transmission = listing.transmission;
                  if (listing.price_badge) updateFields.price_badge = listing.price_badge;
                  if (listing.market_price) updateFields.market_price = listing.market_price;
                  if (listing.price_difference !== undefined) updateFields.price_difference = listing.price_difference;
                  if (listing.price_difference_percent !== undefined) updateFields.price_difference_percent = listing.price_difference_percent;
                  if (listing.market_price_source) updateFields.market_price_source = listing.market_price_source;
                  updateFields.classified_at = new Date().toISOString();
                  updateFields.variant_source = 'extractBadge_v1';
                  await supabase.from("retail_listings").update(updateFields).eq("id", resultRow.id);
                }

                // ── Price badge Slack alert for high-value signals ──
                if (listing.price_badge && resultRow?.is_new) {
                  const badgeLower = listing.price_badge.toLowerCase();
                  const isHighValue = badgeLower.includes("well below") || badgeLower.includes("great price") || badgeLower.includes("below market");
                  if (isHighValue) {
                    priceBadgeAlerts.push({
                      badge: listing.price_badge,
                      make: listing.make,
                      model: listing.model,
                      variant: listing.variant_raw || "",
                      year: listing.year,
                      price: listing.asking_price,
                      km: listing.km,
                      url: listing.listing_url,
                      state: listing.state || "",
                    });
                  }
                }

                itemsUpsertedThisRun++;
                if (resultRow?.is_new) {
                  runNew++;
                } else {
                  runUpdated++;
                }
              }
            } catch (err) {
              console.error(`[${runSource.toUpperCase()} UPSERT] Exception for ${listing.source_listing_id}:`, err);
              runErrors++;
            }
          }

          offset += items.length;

          // Check if this was the last page
          if (items.length < batchSize) {
            isFinished = true;
            console.log(`[${runSource}] Run ${run.run_id}: last page (${items.length} < ${batchSize}), marking done`);
            break;
          }

          // Save intermediate progress atomically
          await supabase.rpc("increment_apify_run_progress", {
            p_id: run.id,
            p_items_fetched: offset,
            p_items_upserted_delta: itemsUpsertedThisRun,
          });
          itemsUpsertedThisRun = 0;
        }

        // Persist any remaining upserted items
        if (itemsUpsertedThisRun > 0) {
          await supabase.rpc("increment_apify_run_progress", {
            p_id: run.id,
            p_items_fetched: offset,
            p_items_upserted_delta: itemsUpsertedThisRun,
          });
        }

        // ── Send Slack alert for price badge hits ──
        const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
        if (priceBadgeAlerts.length > 0 && SLACK_WEBHOOK_URL) {
          try {
            const blocks: Record<string, unknown>[] = [
              { type: "header", text: { type: "plain_text", text: `🏷️ ${priceBadgeAlerts.length} Under-Market Badge${priceBadgeAlerts.length > 1 ? "s" : ""} Detected`, emoji: true } },
            ];
            for (const a of priceBadgeAlerts.slice(0, 10)) {
              const kmStr = a.km ? `${(a.km / 1000).toFixed(0)}k km` : "? km";
              blocks.push({
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*${a.badge}* — ${a.year} ${a.make} ${a.model} ${a.variant}\n$${a.price.toLocaleString()} · ${kmStr} · ${a.state}\n<${a.url}|View on Carsales>`,
                },
              });
            }
            if (priceBadgeAlerts.length > 10) {
              blocks.push({ type: "section", text: { type: "mrkdwn", text: `_...and ${priceBadgeAlerts.length - 10} more_` } });
            }
            await fetch(SLACK_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ blocks }),
            });
            console.log(`[PRICE BADGE] Sent Slack alert for ${priceBadgeAlerts.length} under-market listings`);
          } catch (slackErr) {
            console.error("[PRICE BADGE] Slack alert failed:", slackErr);
          }
        }

        // Update final state
        if (isFinished) {
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "done",
              completed_at: new Date().toISOString(),
              items_fetched: offset,
              locked_until: null,
              lock_token: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", run.id);

          runResults.push({ 
            run_id: run.run_id,
            source: runSource,
            status: "done", 
            items: itemsFetchedThisRun 
          });
        } else {
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "fetching",
              items_fetched: offset,
              locked_until: null,
              lock_token: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", run.id);

          runResults.push({ 
            run_id: run.run_id,
            source: runSource,
            status: "partial", 
            items: itemsFetchedThisRun,
            reason: `time_budget_at_offset_${offset}`
          });
        }

        totalNew += runNew;
        totalUpdated += runUpdated;
        totalErrors += runErrors;
        runsProcessed++;

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[${runSource}] Error processing run ${run.run_id}:`, errorMsg);

        await supabase
          .from("apify_runs_queue")
          .update({ 
            last_error: errorMsg,
            locked_until: null,
            lock_token: null,
            updated_at: now.toISOString()
          })
          .eq("id", run.id);

        totalErrors++;
        runResults.push({ run_id: run.run_id, source: runSource, status: "error", reason: errorMsg });
      }
    }

    const results = {
      runs_processed: runsProcessed,
      new_listings: totalNew,
      updated_listings: totalUpdated,
      errors: totalErrors,
      run_results: runResults,
      elapsed_ms: Date.now() - startTime,
    };

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-fetch",
      success: true,
      result: results,
      run_date: now.toISOString().split("T")[0],
    });

    console.log("Apify fetch worker complete:", results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Apify fetch worker error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-fetch",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
