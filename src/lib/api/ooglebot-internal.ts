import { supabase } from "@/integrations/supabase/client";

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

/**
 * Parse a free-text query into structured fields for matching.
 * e.g. "Isuzu D-MAX 2024 under 55000" → { make: "isuzu", model: "d-max", yearMin: 2024, priceMax: 55000 }
 */
export function parseSearchQuery(query: string): {
  make: string | null;
  model: string | null;
  yearMin: number | null;
  yearMax: number | null;
  kmMax: number | null;
  priceMax: number | null;
} {
  const q = query.trim();
  
  // Extract price ceiling: "under 55000", "below 80k", "< $55,000", "budget 55000"
  let priceMax: number | null = null;
  const priceMatch = q.match(/(?:under|below|budget|max|<|less than)\s*\$?\s*([\d,]+)\s*k?\b/i);
  if (priceMatch) {
    let val = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (priceMatch[0].toLowerCase().includes("k") && val < 1000) val *= 1000;
    priceMax = val;
  }

  // Extract KM: "under 40000km", "low km", "<20000km"
  let kmMax: number | null = null;
  const kmMatch = q.match(/(?:under|below|<|less than)\s*([\d,]+)\s*km/i);
  if (kmMatch) {
    kmMax = parseInt(kmMatch[1].replace(/,/g, ""), 10);
  }

  // Extract year(s): "2024", "2022-2025"
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

  // Extract make/model: strip out numbers, price/km phrases, and common words
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

/**
 * Search our own vehicle_listings database for matches.
 */
export async function searchInternalInventory(query: string): Promise<InternalMatch[]> {
  const parsed = parseSearchQuery(query);
  
  if (!parsed.make) return [];

  let q = supabase
    .from("vehicle_listings")
    .select("id, make, model, variant_raw, year, km, asking_price, source, source_class, listing_url, location, state, auction_house, status, last_seen_at")
    .ilike("make", `%${parsed.make}%`)
    .not("status", "eq", "sold")
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(20);

  if (parsed.model) {
    q = q.ilike("model", `%${parsed.model}%`);
  }
  if (parsed.yearMin) {
    q = q.gte("year", parsed.yearMin);
  }
  if (parsed.yearMax) {
    q = q.lte("year", parsed.yearMax);
  }
  if (parsed.kmMax) {
    q = q.lte("km", parsed.kmMax);
  }
  if (parsed.priceMax) {
    q = q.lte("asking_price", parsed.priceMax);
  }

  const { data, error } = await q;

  if (error) {
    console.error("Internal search error:", error);
    return [];
  }

  return (data || []) as InternalMatch[];
}

/**
 * Also check dealer_specs for any matching specs the dealer has configured.
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
