/**
 * URL Builder — Carsales, CarsGuide, Gumtree
 *
 * Deterministic URL construction from ParsedIntent.
 * No API keys or IDs needed — all three use text slugs in URLs.
 */

import type { ParsedIntent } from "../outward-search/types.ts";

export interface SearchTarget {
  source: "carsales" | "carsguide" | "gumtree";
  url: string;
  page: number;
}

// ─── Slug helpers ────────────────────────────────────────────────────────────

/** Generic slug: lowercase, hyphens, no special chars */
function slugify(str: string): string {
  return str
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
}

/** Carsales slug: PascalCase, no spaces/hyphens (e.g. "Land Cruiser" → "LandCruiser") */
function carsalesSlug(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join("");
}

// ─── Carsales ────────────────────────────────────────────────────────────────
// q=Make.Toyota Model.Camry YearFrom.2018 YearTo.2022 OdometerTo.120000 State.NSW
// Slugs are PascalCase, space-separated filter tokens.

function buildCarsalesUrls(intent: ParsedIntent, maxPages: number): SearchTarget[] {
  const filters: string[] = [];

  if (intent.make) filters.push(`Make.${carsalesSlug(intent.make)}`);
  if (intent.model) filters.push(`Model.${carsalesSlug(intent.model)}`);
  if (intent.year_min) filters.push(`YearFrom.${intent.year_min}`);
  if (intent.year_max) filters.push(`YearTo.${intent.year_max}`);
  if (intent.max_km) filters.push(`OdometerTo.${intent.max_km}`);
  if (intent.state) filters.push(`State.${intent.state.toUpperCase()}`);

  const q = encodeURIComponent(filters.join(" "));
  const base = `https://www.carsales.com.au/cars/used/?q=${q}&sort=Price`;

  return Array.from({ length: maxPages }, (_, i) => ({
    source: "carsales" as const,
    url: i === 0 ? base : `${base}&offset=${i * 12}`,
    page: i + 1,
  }));
}

// ─── CarsGuide ───────────────────────────────────────────────────────────────
// Path: /buy-a-car/used/{make}/{model}/
// Query: YearFrom, YearTo, KmMax, State, sortBy

function buildCarsguideUrls(intent: ParsedIntent, maxPages: number): SearchTarget[] {
  const pathParts = ["", "buy-a-car", "used"];

  if (intent.make) pathParts.push(slugify(intent.make));
  if (intent.model) pathParts.push(slugify(intent.model));

  const params = new URLSearchParams();
  if (intent.year_min) params.set("YearFrom", String(intent.year_min));
  if (intent.year_max) params.set("YearTo", String(intent.year_max));
  if (intent.max_km) params.set("KmMax", String(intent.max_km));
  if (intent.state) params.set("State", intent.state.toUpperCase());
  params.set("sortBy", "price-asc");

  const base = `https://www.carsguide.com.au${pathParts.join("/")}/?${params}`;

  return Array.from({ length: maxPages }, (_, i) => ({
    source: "carsguide" as const,
    url: i === 0 ? base : `${base}&page=${i + 1}`,
    page: i + 1,
  }));
}

// ─── Gumtree ─────────────────────────────────────────────────────────────────
// Path: /s-cars-vans-utes/{location}/carmake-{make}/carmodel-{make}_{model}/c18320
// No price/odometer URL params — post-fetch ceiling gate handles filtering.

const GUMTREE_STATE_SLUGS: Record<string, string> = {
  NSW: "sydney",
  VIC: "melbourne",
  QLD: "brisbane",
  WA: "perth",
  SA: "adelaide",
  TAS: "hobart",
  ACT: "canberra",
  NT: "darwin",
};

function buildGumtreeUrls(intent: ParsedIntent, maxPages: number): SearchTarget[] {
  const location = intent.state
    ? (GUMTREE_STATE_SLUGS[intent.state.toUpperCase()] ?? "australia")
    : "australia";

  const pathParts = ["", "s-cars-vans-utes", location];

  if (intent.make) {
    const makeSlug = slugify(intent.make);
    pathParts.push(`carmake-${makeSlug}`);

    if (intent.model) {
      const modelSlug = slugify(intent.model);
      pathParts.push(`carmodel-${makeSlug}_${modelSlug}`);
    }
  }

  pathParts.push("c18320");

  const params = new URLSearchParams({ pageSize: "96" });
  if (intent.year_min) params.set("caryear", String(intent.year_min));

  const base = `https://www.gumtree.com.au${pathParts.join("/")}?${params}`;

  return Array.from({ length: maxPages }, (_, i) => ({
    source: "gumtree" as const,
    url: i === 0 ? base : `${base}&page=${i + 1}`,
    page: i + 1,
  }));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildSearchUrls(
  intent: ParsedIntent,
  sources: Array<"carsales" | "carsguide" | "gumtree"> = ["carsales", "carsguide", "gumtree"],
  maxPages = 2,
): SearchTarget[] {
  const builders: Record<string, () => SearchTarget[]> = {
    carsales: () => buildCarsalesUrls(intent, maxPages),
    carsguide: () => buildCarsguideUrls(intent, maxPages),
    gumtree: () => buildGumtreeUrls(intent, maxPages),
  };

  return sources.flatMap((s) => builders[s]());
}
