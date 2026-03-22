
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
  colour?: string;
  drivetrain?: string;
  seller_name_raw?: string;
  seller_type?: string;
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

function normalizeCarsalesBadgeCandidate(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const normalized = trimmed.toUpperCase();
    if (normalized === "BETA" || normalized === "ALPHA" || normalized === "TEST") {
      return undefined;
    }

    return trimmed;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      normalizeCarsalesBadgeCandidate(record.label) ||
      normalizeCarsalesBadgeCandidate(record.title) ||
      normalizeCarsalesBadgeCandidate(record.text) ||
      normalizeCarsalesBadgeCandidate(record.value) ||
      normalizeCarsalesBadgeCandidate(record.assessment)
    );
  }

  return undefined;
}

function pickCarsalesPriceBadge(item: Record<string, unknown>, merlinBadge?: string): string | undefined {
  const candidates: unknown[] = [
    item.priceAssessment,
    item.priceLabel,
    item.priceRating,
    item.priceInsight,
    item.priceBadge,
    item.dealRating,
    merlinBadge,
  ];

  for (const candidate of candidates) {
    const badge = normalizeCarsalesBadgeCandidate(candidate);
    if (badge) return badge;
  }

  return undefined;
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

    // ── Extract enrichment fields that Autotrader provides ──
    const transmission = ((item.transmission || vehicle.transmission || "") as string).toUpperCase().trim();
    const fuelType = ((item.fuel_type || item.fuelType || vehicle.fuel_type || "") as string).toUpperCase().trim();
    const bodyType = ((item.body_type || item.bodyType || vehicle.body_type || "") as string).toUpperCase().trim();
    const colour = ((item.colour_body || item.colour || vehicle.colour || "") as string).toUpperCase().trim();
    const drivetrain = ((item.drive || item.drivetrain || vehicle.drivetrain || "") as string).toUpperCase().trim();
    const sellerName = (item.seller_name || item.dealer_name || "") as string;

    return {
      source: "autotrader",
      source_listing_id: listingId,
      listing_url: fullUrl,
      year, make, model,
      variant_raw: variant || undefined,
      km, asking_price: price,
      state: state || undefined,
      suburb: suburb || undefined,
      ...(transmission ? { transmission } : {}),
      ...(fuelType ? { fuel_type: fuelType } : {}),
      ...(bodyType ? { body_type: bodyType } : {}),
      ...(colour ? { colour } : {}),
      ...(drivetrain ? { drivetrain } : {}),
      ...(sellerName ? { seller_name_raw: sellerName } : {}),
      seller_type: 'dealer', // Autotrader is dealer-only
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
  km?: number; bodyType?: string; fuel?: string; transmission?: string; priceBadge?: string; colour?: string;
} {
  const result: { km?: number; bodyType?: string; fuel?: string; transmission?: string; priceBadge?: string; colour?: string } = {};
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
      } else if (title === "colour" || title === "color" || title === "exterior colour") {
        result.colour = value;
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
      if (sub.colour && !result.colour) result.colour = sub.colour;
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
    if (sub.colour && !result.colour) result.colour = sub.colour;
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

    // Price badge: prefer actual Carsales assessment fields and ignore placeholder labels like "BETA"
    const priceBadge = pickCarsalesPriceBadge(item, merlin.priceBadge);

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
      // Pass through extracted fields — flat Carsales fields first, then Merlin tree fallback
      ...(((item.fuelType || item.fuel_type || item.fuel || "") as string).trim() || merlin.fuel
        ? { fuel_type: ((item.fuelType || item.fuel_type || item.fuel || "") as string).trim().toUpperCase() || merlin.fuel }
        : {}),
      ...(((item.transmission || "") as string).trim() || merlin.transmission
        ? { transmission: ((item.transmission || "") as string).trim().toUpperCase() || merlin.transmission }
        : {}),
      ...(((item.bodyType || item.body_type || "") as string).trim() || merlin.bodyType
        ? { body_type: ((item.bodyType || item.body_type || "") as string).trim().toUpperCase() || merlin.bodyType }
        : {}),
      ...(((item.colour || item.color || item.exteriorColour || "") as string).trim() || merlin.colour
        ? { colour: ((item.colour || item.color || item.exteriorColour || "") as string).trim().toUpperCase() || merlin.colour }
        : {}),
      // Seller classification: parse URL for /dealer/ vs /private/, fallback to payload fields
      ...classifySellerType('carsales', fullUrl, item),
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
      ...classifySellerType('gumtree', fullUrl, item),
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
      ...classifySellerType(mappedSource, url, item),
    };
  } catch { return null; }
}

// ─── FB MARKETPLACE MAPPER ─────────────────────────────────────
// Actor: memo23/facebook-marketplace-cheerio
// Key fields: id, listingUrl, marketplace_listing_title, listing_price,
//   location.reverse_geocode, moreDetails.attribute_data[], primary_listing_photo
function mapFbMarketplaceItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = rawItem;

    const listingId = String(item.id || "");
    if (!listingId) return null;

    // Title: marketplace_listing_title or moreDetails.marketplace_listing_title
    const moreDetails = (item.moreDetails || {}) as Record<string, unknown>;
    const title = (
      (item.marketplace_listing_title as string) ||
      (moreDetails.marketplace_listing_title as string) ||
      (moreDetails.base_marketplace_listing_title as string) ||
      ""
    ).trim();

    // Extract vehicle attributes from moreDetails.attribute_data[]
    const attrData = (moreDetails.attribute_data || []) as Array<Record<string, unknown>>;
    const attrs: Record<string, string> = {};
    for (const attr of attrData) {
      const name = ((attr.attribute_name || "") as string).toLowerCase();
      const label = ((attr.label || attr.value || "") as string);
      if (name && label) attrs[name] = label;
    }

    // Year — from attributes or title
    let year = 0;
    if (attrs.year) year = parseInt(attrs.year, 10) || 0;
    if (!year) {
      const ym = title.match(/\b(20[0-2]\d)\b/);
      if (ym) year = parseInt(ym[1], 10);
    }
    if (!year || year < 2000) return null;

    // Make/Model — from attributes or title parse
    let make = (attrs.make || attrs.manufacturer || "").toUpperCase().trim();
    let model = (attrs.model || "").toUpperCase().trim();

    if (!make || !model) {
      const titleNoYear = title.replace(/^\d{4}\s+/, "").trim();
      const parts = titleNoYear.split(/\s+/);
      if (parts.length >= 2) {
        if (!make) make = (parts[0] || "").toUpperCase();
        if (!model) model = (parts[1] || "").toUpperCase();
      }
    }
    if (!make || !model) return null;

    // Variant from remaining title
    const titleAfterMakeModel = title
      .replace(/^\d{4}\s+/i, "")
      .replace(new RegExp(`^${make}\\s+${model}\\s*`, "i"), "")
      .trim()
      .toUpperCase();
    const variant = (attrs.trim || attrs.variant || "").toUpperCase().trim() || titleAfterMakeModel || undefined;

    // Price — from listing_price object
    let price = 0;
    const listingPrice = (item.listing_price || moreDetails.listing_price) as Record<string, unknown> | undefined;
    if (listingPrice) {
      const amt = listingPrice.amount;
      if (typeof amt === "number") price = amt;
      else if (typeof amt === "string") price = parseFloat(amt.replace(/[^0-9.]/g, "")) || 0;
    }
    // Fallback: flat price field
    if (!price && typeof item.price === "number") price = item.price;
    if (!price && typeof item.price === "string") {
      price = parseInt((item.price as string).replace(/[^0-9]/g, ""), 10) || 0;
    }
    if (!price || price < 1000 || price > 500000) return null;

    // KM — from attributes
    let km: number | undefined;
    const rawKm = attrs.mileage || attrs.odometer || attrs.kilometres || attrs.km;
    if (rawKm) {
      const parsed = parseInt(rawKm.replace(/[^0-9]/g, ""), 10);
      if (parsed > 0) km = parsed;
    }

    // Location — from location.reverse_geocode
    let suburb = "";
    let state = "";
    const loc = item.location as Record<string, unknown> | undefined;
    if (loc) {
      const rg = loc.reverse_geocode as Record<string, unknown> | undefined;
      if (rg) {
        state = ((rg.state || "") as string).toUpperCase().trim();
        const cityPage = rg.city_page as Record<string, unknown> | undefined;
        suburb = ((rg.city || cityPage?.display_name || "") as string).trim();
      }
    }
    // Fallback from moreDetails.location_text
    if (!suburb) {
      suburb = ((moreDetails.location_text || "") as string).trim();
    }

    // Map AU state codes (FB uses ISO like "AU-NSW")
    if (state.startsWith("AU-")) state = state.replace("AU-", "");

    // URL
    const url = ((item.listingUrl || item.url || "") as string).trim()
      || `https://www.facebook.com/marketplace/item/${listingId}/`;

    // Image
    let imageUrl = "";
    const photo = item.primary_listing_photo as Record<string, unknown> | undefined;
    if (photo) {
      imageUrl = ((photo.photo_image_url || photo.uri || "") as string);
    }
    if (!imageUrl) {
      const photos = moreDetails.listing_photos as Array<Record<string, unknown>> | undefined;
      if (photos?.[0]) {
        const img = photos[0].image as Record<string, unknown> | undefined;
        imageUrl = ((img?.uri || "") as string);
      }
    }

    // Sold check
    const isSold = (item.is_sold || moreDetails.is_sold) as boolean;
    if (isSold) return null;

    // Transmission from attributes
    const transmission = (attrs.transmission || "").toUpperCase().trim() || undefined;

    return {
      source_listing_id: `fbm-${listingId}`,
      source: "fb-marketplace",
      title: title || `${year} ${make} ${model}`,
      make,
      model,
      variant: variant || undefined,
      year,
      price,
      km,
      state: state || undefined,
      suburb: suburb || undefined,
      url,
      image_url: imageUrl || undefined,
      seller_type: "private",
      transmission,
    };
  } catch { return null; }
}

// ─── EASYAUTO123 MAPPER ────────────────────────────────────────
/**
 * EasyAuto123 (AP Eagers) Apify actor output.
 * Expected fields: title, price, url/link, year, make, model, variant,
 *   odometer/km/mileage, location, state, image/imageUrl
 */
function mapEasyAutoItem(rawItem: Record<string, unknown>): MappedListing | null {
  try {
    const item = rawItem;

    // Listing ID from URL or id field
    const url = (item.url || item.link || item.detailUrl || "") as string;
    const rawId = (item.id || item.stockNumber || item.stock_number || "") as string;
    const idMatch = url.match(/\/([a-zA-Z0-9-]{6,})\/?(\?|$)/);
    const listingId = String(rawId || idMatch?.[1] || "");
    if (!listingId) return null;

    // Year
    let year = 0;
    if (typeof item.year === "number") year = item.year;
    else if (typeof item.year === "string") year = parseInt(item.year, 10) || 0;
    // Try extracting from title
    if (!year) {
      const title = (item.title || item.name || "") as string;
      const ym = title.match(/\b(20[0-2]\d)\b/);
      if (ym) year = parseInt(ym[1], 10);
    }
    if (!year || year < 2000) return null;

    // Make/Model
    const make = ((item.make || item.brand || "") as string).toUpperCase().trim();
    const model = ((item.model || "") as string).toUpperCase().trim();
    if (!make || !model) return null;

    // Variant
    const variant = ((item.variant || item.badge || item.trim || "") as string).toUpperCase().trim();

    // Price
    let price = 0;
    const rawPrice = item.price || item.askingPrice || item.asking_price;
    if (typeof rawPrice === "number") price = rawPrice;
    else if (typeof rawPrice === "string") {
      const m = rawPrice.replace(/[^0-9]/g, "");
      if (m) price = parseInt(m, 10);
    } else if (rawPrice && typeof rawPrice === "object") {
      const p = rawPrice as Record<string, unknown>;
      price = (p.value || p.amount || p.driveaway || 0) as number;
    }
    if (!price || price < 1000 || price > 500000) return null;

    // KM
    let km: number | undefined;
    const rawKm = item.odometer || item.km || item.mileage || item.kilometres;
    if (typeof rawKm === "number") km = rawKm;
    else if (typeof rawKm === "string") {
      const parsed = parseInt(rawKm.replace(/[^0-9]/g, ""), 10);
      if (parsed > 0) km = parsed;
    }

    // Location
    const location = (item.location || item.suburb || item.dealership || "") as string;
    const stateRaw = (item.state || "") as string;
    let state = stateRaw.toUpperCase().trim();
    if (!state) {
      const stateMatch = location.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/i);
      if (stateMatch) state = stateMatch[1].toUpperCase();
    }

    const fullUrl = url.startsWith("http") ? url
      : url ? `https://www.easyauto123.com.au${url}` : "";
    if (!fullUrl) return null;

    // Transmission / fuel
    const transmission = ((item.transmission || "") as string).toUpperCase().trim() || undefined;
    const fuelType = ((item.fuel || item.fuelType || item.fuel_type || "") as string).toUpperCase().trim() || undefined;

    return {
      source: "easyauto123",
      source_listing_id: `ea-${listingId}`,
      listing_url: fullUrl,
      year, make, model,
      variant_raw: variant || undefined,
      km, asking_price: price,
      state: state || undefined,
      suburb: location || undefined,
      ...(transmission ? { transmission } : {}),
      ...(fuelType ? { fuel_type: fuelType } : {}),
      seller_type: 'dealer', // EasyAuto123 is dealer-only (AP Eagers)
    };
  } catch { return null; }
}

// ─── SELLER TYPE CLASSIFIER ────────────────────────────────────

/**
 * Classify seller_type for a retail listing based on source, URL patterns,
 * and seller metadata. Returns 'dealer', 'private', or undefined.
 *
 * Rules:
 * - autotrader, drive, easyauto, easyauto123, carsguide → always 'dealer' (dealer-only platforms)
 * - carsales → parse URL: /dealer/ = dealer, /private/ = private; fallback to seller fields
 * - gumtree → check seller type fields; default to 'private'
 * - fb-marketplace → always 'private'
 * - ultimate-car → check dealer field
 */
function classifySellerType(
  source: string,
  listingUrl: string,
  rawItem?: Record<string, unknown>
): { seller_type: string; seller_name_raw?: string } {
  const url = (listingUrl || '').toLowerCase();

  // Dealer-only platforms
  if (['autotrader', 'autotrader-uc', 'drive', 'easyauto', 'easyauto123', 'carsguide'].includes(source)) {
    const sellerName = rawItem
      ? ((rawItem.seller_name || rawItem.dealer_name || rawItem.dealer || (rawItem._source as Record<string,unknown>)?.seller_name || '') as string).trim()
      : undefined;
    return { seller_type: 'dealer', ...(sellerName ? { seller_name_raw: sellerName } : {}) };
  }

  // Carsales: URL-based classification
  if (source === 'carsales') {
    // Carsales dealer URLs typically contain /dealer/ or /item/ with dealer context
    // Private URLs contain /private/ segment
    const sellerName = rawItem
      ? ((rawItem.sellerName || rawItem.seller_name || rawItem.dealerName || rawItem.dealer_name || rawItem.dealer || '') as string).trim()
      : undefined;
    if (url.includes('/dealer/') || url.includes('/dealer-')) {
      return { seller_type: 'dealer', ...(sellerName ? { seller_name_raw: sellerName } : {}) };
    }
    if (url.includes('/private/') || url.includes('/private-')) {
      return { seller_type: 'private', ...(sellerName ? { seller_name_raw: sellerName } : {}) };
    }
    // Fallback: check seller metadata from payload
    if (rawItem) {
      const sellerType = ((rawItem.sellerType || rawItem.seller_type || rawItem.listingType || '') as string).toLowerCase();
      if (sellerType.includes('dealer') || sellerType.includes('professional')) {
        return { seller_type: 'dealer', ...(sellerName ? { seller_name_raw: sellerName } : {}) };
      }
      if (sellerType.includes('private') || sellerType.includes('individual')) {
        return { seller_type: 'private', ...(sellerName ? { seller_name_raw: sellerName } : {}) };
      }
      // If there's a dealer/seller name, likely a dealer
      if (sellerName) {
        return { seller_type: 'dealer', seller_name_raw: sellerName };
      }
    }
    // Default carsales to dealer (majority are dealer listings)
    return { seller_type: 'dealer' };
  }

  // Gumtree: mixed platform
  if (source === 'gumtree') {
    if (rawItem) {
      const sellerType = ((rawItem.sellerType || rawItem.seller_type || '') as string).toLowerCase();
      if (sellerType.includes('dealer') || sellerType.includes('professional') || sellerType.includes('business')) {
        return { seller_type: 'dealer' };
      }
    }
    return { seller_type: 'private' };
  }

  // Facebook Marketplace: always private
  if (source === 'fb-marketplace') {
    return { seller_type: 'private' };
  }

  // Ultimate-car: check dealer field
  if (source === 'ultimate-car') {
    const dealer = rawItem ? ((rawItem.dealer || rawItem.dealer_key || '') as string).trim() : '';
    return { seller_type: dealer ? 'dealer' : 'private', ...(dealer ? { seller_name_raw: dealer } : {}) };
  }

  // Unknown source — leave unclassified
  return { seller_type: 'dealer' };
}

// ─── SOURCE ROUTER ─────────────────────────────────────────────

function mapItemForSource(source: string, rawItem: Record<string, unknown>): MappedListing | null {
  switch (source) {
    case "autotrader": return mapAutotraderItem(rawItem);
    case "carsales": return mapCarsalesItem(rawItem);
    case "gumtree": return mapGumtreeItem(rawItem);
    case "slattery": return mapSlatteryItem(rawItem);
    case "ultimate-car": return mapUltimateCarItem(rawItem);
    case "fb-marketplace": return mapFbMarketplaceItem(rawItem);
    case "easyauto": return mapEasyAutoItem(rawItem);
    default: {
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

          // ABORTED runs have no usable data — mark as error and skip
          if (apifyStatus === "ABORTED") {
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

          // FAILED and TIMED-OUT runs still have partial results in their dataset — fetch them
          if (apifyStatus === "FAILED" || apifyStatus === "TIMED-OUT") {
            console.log(`[${runSource}] Run ${run.run_id} ${apifyStatus} but may have partial results — fetching dataset`);
            // Fall through to dataset fetch below
          }

          if (apifyStatus !== "SUCCEEDED" && apifyStatus !== "TIMED-OUT" && apifyStatus !== "FAILED") {
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
        const batchSize = 50;
        
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
                    engine_type: extracted.engine_type || null,
                    engine_confidence: extracted.engine_confidence || 'LOW',
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
                if (resultRow?.id && (extracted.badge || extracted.fuel_type || extracted.drivetrain || extracted.body_type || extracted.engine_type || listing.price_badge || listing.fuel_type || listing.transmission || listing.body_type || listing.colour || listing.seller_type)) {
                  const updateFields: Record<string, unknown> = {};
                  if (extracted.badge) updateFields.badge = extracted.badge;
                  if (extracted.fuel_type || listing.fuel_type) updateFields.fuel_type = extracted.fuel_type || listing.fuel_type;
                  if (extracted.drivetrain || listing.drivetrain) updateFields.drivetrain = extracted.drivetrain || listing.drivetrain;
                  if (extracted.body_type || listing.body_type) updateFields.body_type = extracted.body_type || listing.body_type;
                  if (extracted.engine_type) {
                    updateFields.engine_type = extracted.engine_type;
                    updateFields.engine_confidence = extracted.engine_confidence;
                  }
                  if (listing.transmission) updateFields.transmission = listing.transmission;
                  if (listing.colour) updateFields.colour = listing.colour;
                  if (listing.seller_type) updateFields.seller_type = listing.seller_type;
                  if (listing.seller_name_raw) updateFields.seller_name_raw = listing.seller_name_raw;
                  if (listing.price_badge) updateFields.price_badge = listing.price_badge;
                  if (listing.market_price) updateFields.market_price = listing.market_price;
                  if (listing.price_difference !== undefined) updateFields.price_difference = listing.price_difference;
                  if (listing.price_difference_percent !== undefined) updateFields.price_difference_percent = listing.price_difference_percent;
                  if (listing.market_price_source) updateFields.market_price_source = listing.market_price_source;
                  updateFields.classified_at = new Date().toISOString();
                  updateFields.variant_source = 'extractBadge_v2';
                  await supabase.from("retail_listings").update(updateFields).eq("id", resultRow.id);
                }

                // ── Price badge Slack alert for high-value signals ──
                if (listing.price_badge && resultRow?.is_new) {
                  const badgeLower = listing.price_badge.toLowerCase();
                  const isHighValue = badgeLower.includes("well below") || badgeLower.includes("great price") || badgeLower.includes("below market");
                  const meetsYearThreshold = listing.year && listing.year >= 2020;
                  const meetsKmThreshold = !listing.km || listing.km <= 120000;
                  if (isHighValue && meetsYearThreshold && meetsKmThreshold) {
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

                // ── Insert into cheap_car_queue for Josh verification ──
                if (listing.price_badge && resultRow?.is_new && runSource === "carsales") {
                  const badgeLower = listing.price_badge.toLowerCase();
                  const isCheap = badgeLower.includes("well below") || badgeLower.includes("below market");
                  const yearOk = listing.year && listing.year >= 2020;
                  const kmOk = !listing.km || listing.km <= 120000;
                  if (isCheap && yearOk && kmOk) {
                    const delta = estimateMarketDelta(listing.price_badge, listing.asking_price);
                    const discPct = delta.price_difference_percent || listing.price_difference_percent || null;
                    // Compute deal score inline
                    let dealScore: number | null = null;
                    if (discPct != null) {
                      let ps = 0;
                      if (discPct <= -20) ps = 10;
                      else if (discPct <= -16) ps = 8;
                      else if (discPct <= -12) ps = 6;
                      else if (discPct <= -8) ps = 4;
                      else if (discPct <= -5) ps = 2;
                      dealScore = ps + 1 + 3; // source=carsales(1) + freshness=new(3)
                    }
                    supabase.from("cheap_car_queue").upsert({
                      listing_id: listing.source_listing_id,
                      source: "carsales",
                      source_type: "system",
                      make: listing.make,
                      model: listing.model,
                      variant: listing.variant_raw || null,
                      year: listing.year,
                      km: listing.km || null,
                      price: listing.asking_price,
                      market_price: delta.market_price || listing.market_price || null,
                      discount_pct: discPct,
                      deal_tag: listing.price_badge,
                      location: listing.state || null,
                      listing_url: listing.listing_url,
                      price_badge: listing.price_badge,
                      engine_type: extracted.engine_type || null,
                      fuel_type: extracted.fuel_type || listing.fuel_type || null,
                      transmission: listing.transmission || null,
                      deal_score: dealScore,
                      status: "NEW",
                      josh_verified: false,
                    }, { onConflict: "listing_id" }).then(() => {}).catch((e: unknown) => {
                      console.error("[CHEAP CAR QUEUE] Insert failed:", e);
                    });
                  }
                }
                // ── Record price history snapshot ──
                if (listing.asking_price && listing.source_listing_id) {
                  supabase.from("listing_price_history").insert({
                    listing_id: listing.source_listing_id,
                    source: runSource,
                    price: listing.asking_price,
                    price_badge: listing.price_badge || null,
                    market_price: listing.market_price || null,
                    price_difference_percent: listing.price_difference_percent || null,
                  }).then(() => {}).catch(() => {});
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

    // Update heartbeat with explicit monitoring fields
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "autotrader-fetch",
          last_seen_at: new Date().toISOString(),
          last_ok: totalErrors === 0,
          note: `${runsProcessed} runs: ${totalNew} new, ${totalUpdated} updated, ${totalErrors} errors`,
          rows_inserted: totalNew,
          unique_urls: totalNew + totalUpdated,
        },
        { onConflict: "cron_name" }
      );

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
