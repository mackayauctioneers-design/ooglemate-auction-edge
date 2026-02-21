/**
 * SHARED SLUG PARSER — Extracts make/model/variant from auction URL slugs
 * 
 * Used by: pickles-ingest-cron, grays-stub-ingest, pickles-buynow-radar, crosssafe-worker
 * 
 * This replaces all inline MULTI_WORD_MODELS maps.
 * Model resolution is done via taxonomy DB tables, not hardcoded maps.
 */

// ─── Hardcoded multi-word model map (used ONLY for slug parsing pre-DB) ─────
// This is the SINGLE source of truth for slug-based model detection.
// All ingestion paths import from here. No duplicates allowed.
export const MULTI_WORD_MODELS: Record<string, string[]> = {
  "landcruiser": ["prado"],
  "pajero": ["sport"],
  "bt": ["50"],
  "d": ["max"],
  "mu": ["x"],
  "cx": ["3", "5", "8", "9", "30", "50", "60"],
  "x": ["trail"],
  "rav": ["4"],
  "eclipse": ["cross"],
  "santa": ["fe"],
  "range": ["rover"],
  "yaris": ["cross"],
  "outlander": ["phev"],
  "discovery": ["sport"],
  "tiguan": ["allspace"],
  "t": ["cross", "roc"],
};

export type SlugParseResult = {
  year: number;
  make: string;
  model: string;
  variant: string;
  lotId: string;
};

/**
 * Parse a Pickles-style URL slug: /2018-toyota-landcruiser-prado-gxl/25084830
 * Returns null if slug doesn't match.
 */
export function parseAuctionSlug(url: string, pattern?: RegExp): SlugParseResult | null {
  const re = pattern || /\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i;
  const match = url.match(re);
  if (!match) return null;

  const year = parseInt(match[1]);
  const make = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
  const modelParts = match[3].split("-");

  let modelWordCount = 1;
  const firstPart = modelParts[0].toLowerCase();
  if (MULTI_WORD_MODELS[firstPart] && modelParts.length > 1) {
    const nextPart = modelParts[1].toLowerCase();
    if (MULTI_WORD_MODELS[firstPart].includes(nextPart)) {
      modelWordCount = 2;
    }
  }

  const model = modelParts
    .slice(0, modelWordCount)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  const variant = modelParts
    .slice(modelWordCount)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  const lotId = match[4] || "";

  return { year, make, model, variant, lotId };
}

/**
 * Parse a Grays-style URL slug: /lot/0001-10352288/motor-vehicles/2015-toyota-hilux-sr
 */
export function parseGraysSlug(url: string): Omit<SlugParseResult, "lotId"> & { lotId: string | null } | null {
  const slugMatch = url.match(/\/lot\/([^\/]+)\/[^\/]+\/(\d{4})-([a-z]+)-([a-z0-9-]+)/i);
  if (!slugMatch) return null;

  const lotIdRaw = slugMatch[1]; // e.g. "0001-10352288"
  const year = parseInt(slugMatch[2]);
  const make = slugMatch[3].charAt(0).toUpperCase() + slugMatch[3].slice(1).toLowerCase();
  const modelParts = slugMatch[4].split("-");

  let modelWordCount = 1;
  const firstPart = modelParts[0].toLowerCase();
  if (MULTI_WORD_MODELS[firstPart] && modelParts.length > 1) {
    const nextPart = modelParts[1].toLowerCase();
    if (MULTI_WORD_MODELS[firstPart].includes(nextPart)) {
      modelWordCount = 2;
    }
  }

  const model = modelParts
    .slice(0, modelWordCount)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  const variant = modelParts
    .slice(modelWordCount)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  return { year, make, model, variant, lotId: lotIdRaw };
}
