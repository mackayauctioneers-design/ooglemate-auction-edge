/**
 * ExtractionSchema — the canonical shape Lindy must return per listing.
 *
 * All fields are strings from the browser (Lindy can't do type coercion).
 * Numeric parsing happens in normalizeExtractedListing() before scoring.
 */
export interface RawExtractedListing {
  // ── Identity (required for scoring) ──────────────────────────────────────
  make:         string;        // "Toyota"
  model:        string;        // "HiLux"
  year:         string;        // "2021"
  variant:      string | null; // "SR5 Double Cab" — optional, boosts confidence
  odometer_km:  string;        // "87000" — digits only, no "km" suffix

  // ── Price (required for ceiling gate + margin score) ──────────────────────
  price_asking: string;        // "42500" — digits only, no "$" or ","

  // ── Provenance (required for dedup + webhook routing) ─────────────────────
  listing_url:  string;        // full canonical URL of the individual listing
  listing_id:   string;        // source-native ID (e.g. "OAG-AD-21234567")

  // ── Injected by dispatch loop (not extracted from page) ───────────────────
  source:       "carsales" | "carsguide" | "gumtree";
  state:        string | null; // "NSW" — from intent, not scraped
}

/**
 * NormalizedListing — after parseFloat/parseInt coercion.
 * This is what matchListingToFingerprint() receives.
 */
export interface NormalizedListing {
  make:         string;
  model:        string;
  year:         number | null;
  variant:      string | null;
  odometer_km:  number | null;
  price_asking: number | null;
  listing_url:  string;
  listing_id:   string;
  source:       string;
  state:        string | null;
}

export function normalizeExtractedListing(raw: RawExtractedListing): NormalizedListing {
  return {
    make:         raw.make.trim(),
    model:        raw.model.trim(),
    year:         parseIntOrNull(raw.year),
    variant:      raw.variant?.trim() ?? null,
    odometer_km:  parseIntOrNull(raw.odometer_km),
    price_asking: parseIntOrNull(raw.price_asking),
    listing_url:  raw.listing_url.trim(),
    listing_id:   raw.listing_id.trim(),
    source:       raw.source,
    state:        raw.state?.toUpperCase() ?? null,
  };
}

function parseIntOrNull(val: string | null | undefined): number | null {
  if (!val) return null;
  // Strip everything except digits and decimal point
  const cleaned = val.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n);
}
