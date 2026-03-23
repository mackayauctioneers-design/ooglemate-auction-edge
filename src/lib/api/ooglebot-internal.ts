import { supabase } from "@/integrations/supabase/client";
import { extractSeries } from "@/utils/derivePlatform";

// ─── Source Allowlist & Config ───────────────────────────────────────────────

/** Only these lifecycle states are considered live inventory */
const ACTIVE_LIFECYCLE = ["NEW", "ACTIVE", "WATCH", "BUY", "RELISTED"];

/** Only these sources are considered valid auction inventory */
const AUCTION_SOURCE_ALLOWLIST = [
  "pickles",
  "manheim",
  "slattery",
  "grays",
  "uaa_nsw",
  "auto_auctions_aav",
  "auto_auctions",
  "f3",
];

/** These sources are permanently dead — never query them */
const SOURCE_BLOCKLIST = ["pickles_crawl"];

/** Listings older than this are excluded */
const RECENCY_DAYS = 14;

/** If Tier 0 has at least this many results, block outward search */
const OUTWARD_GATE_THRESHOLD = 3;

/** Maximum results per tier */
const TIER0_LIMIT = 300;
const TIER1_LIMIT = 300;

const SUB_BADGE_QUALIFIERS = ["HI-RIDER", "HIRIDER", "HI RIDER", "WILDTRAK", "RAPTOR", "SPORT"];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InternalMatch {
  id: string;
  make: string;
  model: string;
  variant_raw: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  source: string;
  source_class: string | null;
  listing_url: string | null;
  location: string | null;
  auction_house: string | null;
  listing_type: string | null;
  last_seen_at: string | null;
}

export interface TieredSearchResult {
  tier0_auctions: InternalMatch[];
  tier1_internal: InternalMatch[];
  outward_allowed: boolean;
  outward_reason: string;
  parsed_intent: ParsedIntent;
  duration_ms: number;
}

export interface ParsedIntent {
  make: string | null;
  model: string | null;
  badge: string | null;
  yearMin: number | null;
  yearMax: number | null;
  kmMax: number | null;
  priceMax: number | null;
}


// ─── Query Parser ────────────────────────────────────────────────────────────

export function parseSearchQuery(query: string): ParsedIntent {
  const q = query.trim();

  // Extract KM first — MUST have an explicit km/kms/klm unit suffix.
  let kmMax: number | null = null;
  const kmMatch = q.match(/(?:under|below|<|less than)\s*([\d,]+)\s*k?\s*(?:klms|klm|kms|km)/i);
  if (kmMatch) {
    let kmVal = parseFloat(kmMatch[1].replace(/,/g, ""));
    if (/\d+k\s*(?:klms|klm|kms|km)/i.test(kmMatch[0]) && kmVal < 1000) kmVal *= 1000;
    kmMax = Math.round(kmVal);
  } else if (/\blow\s*km\b/i.test(q)) {
    kmMax = 80000;
  }

  // Extract price ceiling.
  let priceMax: number | null = null;
  const explicitPriceMatch = q.match(/(?:\$|under\s+\$|below\s+\$|budget|price|cost|max)\s*\$?\s*([\d,]+)\s*k?\b/i);
  if (explicitPriceMatch) {
    let val = parseFloat(explicitPriceMatch[1].replace(/,/g, ""));
    if (explicitPriceMatch[0].toLowerCase().includes("k") && val < 1000) val *= 1000;
    priceMax = Math.round(val);
  } else if (!kmMax) {
    const bareMatch = q.match(/(?:under|below|<|less than)\s*([\d,]+)\s*(k?)\b(?!\s*(?:klms|klm|kms|km))/i);
    if (bareMatch) {
      let val = parseFloat(bareMatch[1].replace(/,/g, ""));
      if (bareMatch[2]?.toLowerCase() === "k" && val < 1000) val *= 1000;
      priceMax = Math.round(val);
    }
  }

  // Extract year(s)
  let yearMin: number | null = null;
  let yearMax: number | null = null;
  const yearRangeMatch = q.match(/\b(20[1-2]\d)\s*[-–]\s*(20[2-3]\d)\b/);
  if (yearRangeMatch) {
    yearMin = parseInt(yearRangeMatch[1], 10);
    yearMax = parseInt(yearRangeMatch[2], 10);
  } else {
    const yearMatch = q.match(/\b(20[1-2]\d)\b/);
    if (yearMatch) {
      yearMin = parseInt(yearMatch[1], 10);
    }
  }

  // Extract make/model
  const cleaned = q
    .replace(/(?:under|below|budget|max|less than)\s*\$?\s*[\d,]+\s*k?\b/gi, "")
    .replace(/(?:under|below|<|less than)\s*[\d,]+\s*km/gi, "")
    .replace(/\b20[1-3]\d\b/g, "")
    .replace(/\b(?:australia|wholesale|low\s*km|cheap|cheapest|best|national|nationally)\b/gi, "")
    .replace(/[^\w\s-]/g, "")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const make = words.length > 0 ? words[0] : null;
  const model = words.length > 1 ? words.slice(1).join(" ") : null;

  return { make, model, badge: null, yearMin, yearMax, kmMax, priceMax };
}

// ─── Core Search: Tiered Auction-First ───────────────────────────────────────

/**
 * Commercial-grade tiered search.
 * Tier 0: Auction inventory (allowlisted sources, recency-gated)
 * Tier 1: All other internal inventory
 * Outward gate: blocked if Tier 0 >= OUTWARD_GATE_THRESHOLD
 */
export async function searchTiered(query: string, structuredOverride?: Partial<ParsedIntent>): Promise<TieredSearchResult> {
  const startMs = performance.now();
  const textParsed = parseSearchQuery(query);
  // Structured overrides take priority over text parsing
  const parsed: ParsedIntent = {
    make: structuredOverride?.make || textParsed.make,
    model: structuredOverride?.model || textParsed.model,
    badge: structuredOverride?.badge || textParsed.badge,
    yearMin: structuredOverride?.yearMin ?? textParsed.yearMin,
    yearMax: structuredOverride?.yearMax ?? textParsed.yearMax,
    kmMax: structuredOverride?.kmMax ?? textParsed.kmMax,
    priceMax: structuredOverride?.priceMax ?? textParsed.priceMax,
  };

  if (!parsed.make) {
    return {
      tier0_auctions: [],
      tier1_internal: [],
      outward_allowed: true,
      outward_reason: "no_make_parsed",
      parsed_intent: parsed,
      duration_ms: 0,
    };
  }

  // Run Tier 0 and Tier 1 in parallel
  const [tier0, tier1] = await Promise.all([
    searchAuctionTier(parsed),
    searchInternalRetailTier(parsed),
  ]);

  const outward_allowed = tier0.length < OUTWARD_GATE_THRESHOLD;
  const outward_reason = outward_allowed
    ? `tier0_count=${tier0.length}<${OUTWARD_GATE_THRESHOLD}`
    : `tier0_count=${tier0.length}>=${OUTWARD_GATE_THRESHOLD}`;

  const duration_ms = Math.round(performance.now() - startMs);

  // Audit log (fire-and-forget)
  supabase
    .from("search_audit_log")
    .insert({
      raw_query: query,
      parsed_intent: parsed as any,
      tier0_count: tier0.length,
      tier1_count: tier1.length,
      outward_triggered: false, // caller decides; this records the search itself
      outward_reason,
      duration_ms,
    })
    .then(({ error }) => {
      if (error) console.error("Audit log insert error:", error);
    });

  return {
    tier0_auctions: tier0,
    tier1_internal: tier1,
    outward_allowed,
    outward_reason,
    parsed_intent: parsed,
    duration_ms,
  };
}

// ─── Tier 0: Auction Sources ─────────────────────────────────────────────────

async function searchAuctionTier(parsed: ParsedIntent): Promise<InternalMatch[]> {
  const recencyCutoff = new Date(Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from("market_listings")
    .select("id, make, model, variant_raw, year, km, asking_price, source, source_class, listing_url, location, auction_house, listing_type, last_seen_at, lifecycle_status, is_historical_result")
    .in("source", AUCTION_SOURCE_ALLOWLIST)
    .in("lifecycle_status", ACTIVE_LIFECYCLE)
    .eq("is_historical_result", false)
    .gte("last_seen_at", recencyCutoff)
    .ilike("make", `%${parsed.make}%`)
    .order("last_seen_at", { ascending: false })
    .limit(TIER0_LIMIT);

  // Model matching — use normalized model (series stripped) for LC queries
  if (parsed.model) {
    const queryModel = normalizeModelForQuery(parsed.make || "", parsed.model);
    if (isToyotaLandCruiserNotPrado(parsed)) {
      q = q.ilike("model", `%${queryModel}%`).not("model", "ilike", "%prado%");
    } else {
      q = q.ilike("model", `%${queryModel}%`);
    }
  }

  if (parsed.yearMin) q = q.gte("year", parsed.yearMin);
  if (parsed.yearMax) q = q.lte("year", parsed.yearMax);
  if (parsed.kmMax) q = q.lte("km", parsed.kmMax);
  if (parsed.priceMax) q = q.lte("asking_price", parsed.priceMax);

  const { data, error } = await q;
  if (error) {
    console.error("Tier 0 auction search error:", error);
    return [];
  }

  return applyBadgeFilter(applySeriesGate((data || []) as InternalMatch[], parsed), parsed.badge);
}

// ─── Tier 1: Internal Retail / Other ─────────────────────────────────────────

async function searchInternalRetailTier(parsed: ParsedIntent): Promise<InternalMatch[]> {
  const recencyCutoff = new Date(Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  
  // Blocklist filter: not in auction allowlist AND not in blocklist
  const allExcluded = [...AUCTION_SOURCE_ALLOWLIST, ...SOURCE_BLOCKLIST];

  let q = supabase
    .from("market_listings")
    .select("id, make, model, variant_raw, year, km, asking_price, source, source_class, listing_url, location, auction_house, listing_type, last_seen_at, lifecycle_status")
    .in("lifecycle_status", ACTIVE_LIFECYCLE)
    .gte("last_seen_at", recencyCutoff)
    .ilike("make", `%${parsed.make}%`)
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(TIER1_LIMIT);

  // Exclude auction sources (they're in Tier 0) and blocklisted sources
  for (const src of allExcluded) {
    q = q.not("source", "eq", src);
  }

  // Model matching — use normalized model (series stripped) for LC queries
  if (parsed.model) {
    const queryModel = normalizeModelForQuery(parsed.make || "", parsed.model);
    if (isToyotaLandCruiserNotPrado(parsed)) {
      q = q.ilike("model", `%${queryModel}%`).not("model", "ilike", "%prado%");
    } else {
      q = q.ilike("model", `%${queryModel}%`);
    }
  }

  if (parsed.yearMin) q = q.gte("year", parsed.yearMin);
  if (parsed.yearMax) q = q.lte("year", parsed.yearMax);
  if (parsed.kmMax) q = q.lte("km", parsed.kmMax);
  if (parsed.priceMax) q = q.lte("asking_price", parsed.priceMax);

  const { data, error } = await q;
  if (error) {
    console.error("Tier 1 internal search error:", error);
    return [];
  }

  return applyBadgeFilter(applySeriesGate((data || []) as InternalMatch[], parsed), parsed.badge);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isToyotaLandCruiserNotPrado(parsed: ParsedIntent): boolean {
  const make = (parsed.make || "").toLowerCase();
  const model = (parsed.model || "").toLowerCase();
  return make === "toyota" && model.includes("landcruiser") && !model.includes("prado");
}

/** Detect which series a listing belongs to (LC + Prado + Ranger + Patrol) */
function detectListingSeries(l: InternalMatch): string | null {
  const text = [l.model, l.variant_raw, l.id, l.listing_url]
    .filter(Boolean).join(" ").toUpperCase();
  // Prado must be checked FIRST
  if (text.includes("PRADO")) {
    if (/\b250\b|PRADO[\-_\s]?250/.test(text)) return "PRADO_250";
    if (/\b150\b|PRADO[\-_\s]?150/.test(text)) return "PRADO_150";
    return null; // Prado but unknown generation
  }
  if (/\b7[0689]\b/.test(text) || /70[\-_\s]?SERIES|LANDCRUISER70|LC7[0689]/.test(text) || /\bWORKMATE\b/.test(text)) return "LC70";
  if (/\b300\b/.test(text) || /GR[\-_\s]?SPORT|GR[\-_\s]?S\b|LC300/.test(text)) return "LC300";
  if (/\b200\b/.test(text) || /LC200/.test(text)) return "LC200";
  if (/NEXT[\-_\s]?GEN|NEXTGEN|\bV6\b|RANGER[\-_\s]?PY/.test(text)) return "RANGER_PY";
  if (/\bY62\b/.test(text)) return "PATROL_Y62";
  if (/\bY61\b|\bGU\b/.test(text)) return "PATROL_Y61";
  return null;
}

/** Strip LC series numbers from model string so DB query fetches all generations */
function normalizeModelForQuery(make: string, model: string): string {
  const intentSeries = extractSeries(make, model);
  if (!intentSeries?.startsWith("LC")) return model;
  return model.replace(/\b(7[0689]|200|300)\b/gi, "").replace(/\s+/g, " ").trim();
}

function applyBadgeFilter(results: InternalMatch[], badge: string | null): InternalMatch[] {
  if (!badge) return results;

  const badgeUpper = badge.trim().toUpperCase().replace(/[^A-Z0-9\s\-]/g, "").replace(/\s+/g, " ");
  const badgeNorm = badgeUpper.replace(/[\s\-]/g, "");
  const badgeRe = new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
  const badgeHasQualifier = (q: string) => badgeNorm.includes(q.replace(/[\s\-]/g, ""));

  return results.filter((r) => {
    const variant = r.variant_raw;
    if (!variant) return false;

    const allText = [variant, r.model, r.listing_url]
      .filter(Boolean)
      .join(" ")
      .toUpperCase()
      .replace(/[\s\-]/g, "");

    for (const qual of SUB_BADGE_QUALIFIERS) {
      const qualNorm = qual.replace(/[\s\-]/g, "");
      if (allText.includes(qualNorm) && !badgeHasQualifier(qual)) return false;
    }

    const vNorm = variant.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
    return vNorm === badgeUpper || badgeRe.test(variant);
  });
}

/** Apply series gate post-filter */
function applySeriesGate(results: InternalMatch[], parsed: ParsedIntent): InternalMatch[] {
  const intentSeries = extractSeries(parsed.make || "", parsed.model || "");
  if (!intentSeries) return results;

  const intentIsLC = intentSeries.startsWith("LC");
  const intentIsPrado = intentSeries.startsWith("PRADO");

  return results.filter((l) => {
    const text = [l.model, l.variant_raw, l.listing_url, l.id]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();

    // Hard model-family gate: Prado must never appear in LandCruiser results, and vice versa.
    if (intentIsLC && text.includes("PRADO")) return false;
    if (intentIsPrado && !text.includes("PRADO")) return false;

    // Toyota OEM sometimes stores LC70 rows as generic LANDCRUISER/GXL with no explicit series.
    // For explicit LC300 searches, exclude those ambiguous generic Toyota rows unless they carry a positive LC300 signal.
    if (
      intentSeries === "LC300" &&
      l.source === "toyota" &&
      (l.model || "").toUpperCase() === "LANDCRUISER" &&
      !/\b300\b|LC300|FJA300R|GR[\-_\s]?SPORT|GR[\-_\s]?S\b/.test(text)
    ) return false;

    const ls = detectListingSeries(l);
    // If we detected a specific series, it must match intent
    if (ls !== null) return ls === intentSeries;
    // Unknown series: reject. If the user asked for a specific generation,
    // ambiguous listings without identifiable series markers should not appear.
    return false;
  });
}

// ─── Legacy API (backwards-compatible) ───────────────────────────────────────

/**
 * @deprecated Use searchTiered() instead. Kept for backward compatibility.
 */
export async function searchInternalInventory(query: string): Promise<InternalMatch[]> {
  const result = await searchTiered(query);
  return [...result.tier0_auctions, ...result.tier1_internal];
}

/**
 * Check dealer_specs for matching specs the dealer has configured.
 */
export async function searchDealerSpecs(query: string): Promise<{ id: string; name: string; make: string; model: string; dealer_name: string }[]> {
  const parsed = parseSearchQuery(query);
  if (!parsed.make) return [];

  let q = supabase
    .from("dealer_specs")
    .select("id, name, make, model, dealer_name")
    .ilike("make", `%${parsed.make}%`)
    .eq("enabled", true)
    .is("deleted_at", null)
    .limit(10);

  if (parsed.model) {
    q = q.ilike("model", `%${parsed.model}%`);
  }

  const { data, error } = await q;
  if (error) {
    console.error("Dealer specs search error:", error);
    return [];
  }
  return data || [];
}
