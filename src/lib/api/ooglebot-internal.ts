import { supabase } from "@/integrations/supabase/client";

// ─── Source Allowlist & Config ───────────────────────────────────────────────

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
const TIER0_LIMIT = 100;
const TIER1_LIMIT = 50;

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
  state: string | null;
  auction_house: string | null;
  status: string | null;
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
  yearMin: number | null;
  yearMax: number | null;
  kmMax: number | null;
  priceMax: number | null;
}

// ─── Toyota Prado Special-Case Models ────────────────────────────────────────

/** Models where the user intent (e.g. "Prado") may be split across model + variant_raw */
const TOYOTA_MODEL_SPLITS: Record<string, { modelPatterns: string[]; variantFallback: string }> = {
  prado: {
    modelPatterns: ["%prado%"],
    variantFallback: "%prado%",
  },
  "landcruiser prado": {
    modelPatterns: ["%prado%"],
    variantFallback: "%prado%",
  },
};

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

  return { make, model, yearMin, yearMax, kmMax, priceMax };
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
  const isToyotaPrado = isToyotaPradoSearch(parsed);

  let q = supabase
    .from("vehicle_listings")
    .select("id, make, model, variant_raw, year, km, asking_price, source, source_class, listing_url, location, state, auction_house, status, last_seen_at")
    .in("source", AUCTION_SOURCE_ALLOWLIST)
    .gte("last_seen_at", recencyCutoff)
    .not("status", "eq", "sold")
    .ilike("make", `%${parsed.make}%`)
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(TIER0_LIMIT);

  // Model matching — with Toyota Prado special case and LandCruiser exclusion
  if (parsed.model) {
    if (isToyotaPrado) {
      // Prado split: model contains "prado" OR (model contains "landcruiser" AND variant_raw contains "prado")
      q = q.or(`model.ilike.%prado%,and(model.ilike.%landcruiser%,variant_raw.ilike.%prado%)`);
    } else if (isToyotaLandCruiserNotPrado(parsed)) {
      // LandCruiser (non-Prado): must contain "landcruiser" but NOT "prado"
      q = q.ilike("model", `%${parsed.model}%`).not("model", "ilike", "%prado%");
    } else {
      q = q.ilike("model", `%${parsed.model}%`);
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
  return (data || []) as InternalMatch[];
}

// ─── Tier 1: Internal Retail / Other ─────────────────────────────────────────

async function searchInternalRetailTier(parsed: ParsedIntent): Promise<InternalMatch[]> {
  const recencyCutoff = new Date(Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const isToyotaPrado = isToyotaPradoSearch(parsed);

  // Blocklist filter: not in auction allowlist AND not in blocklist
  const allExcluded = [...AUCTION_SOURCE_ALLOWLIST, ...SOURCE_BLOCKLIST];

  let q = supabase
    .from("vehicle_listings")
    .select("id, make, model, variant_raw, year, km, asking_price, source, source_class, listing_url, location, state, auction_house, status, last_seen_at")
    .gte("last_seen_at", recencyCutoff)
    .not("status", "eq", "sold")
    .ilike("make", `%${parsed.make}%`)
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(TIER1_LIMIT);

  // Exclude auction sources (they're in Tier 0) and blocklisted sources
  for (const src of allExcluded) {
    q = q.not("source", "eq", src);
  }

  if (parsed.model) {
    if (isToyotaPrado) {
      q = q.or(`model.ilike.%prado%,and(model.ilike.%landcruiser%,variant_raw.ilike.%prado%)`);
    } else {
      q = q.ilike("model", `%${parsed.model}%`);
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
  return (data || []) as InternalMatch[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isToyotaPradoSearch(parsed: ParsedIntent): boolean {
  const make = (parsed.make || "").toLowerCase();
  const model = (parsed.model || "").toLowerCase();
  return make === "toyota" && (model.includes("prado") || model === "landcruiser prado");
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
