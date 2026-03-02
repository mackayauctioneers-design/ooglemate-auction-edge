/**
 * Per-source Lindy extraction prompts.
 *
 * Each prompt is tuned to that site's DOM structure and tells Lindy
 * exactly what to pull from the search results page.
 */

import type { SearchTarget } from "./buildSearchUrls.ts";

/**
 * Returns the extraction prompt Lindy uses when browsing a given source.
 */
export function getExtractionPrompt(target: SearchTarget): string {
  const base = EXTRACTION_PROMPTS[target.source];
  return `${base}\n\nPage URL: ${target.url}`;
}

const SHARED_RULES = `
RULES:
- Extract ONLY listings visible on this page (do not follow pagination links).
- For price: digits only — strip "$", ",", "AUD", spaces. If price shows as "POA" or is missing, use null.
- For odometer: digits only — strip "km", ",", spaces. If missing, use null.
- For listing_id: extract the source-native ad ID from the URL or page (e.g. "OAG-AD-21234567").
- For variant: extract trim/grade if shown (e.g. "SR5", "Ateco", "ZX"). Use null if not shown.
- Return a JSON array. Each element must match this shape exactly:
  {
    "make": string,
    "model": string,
    "year": string,
    "variant": string | null,
    "odometer_km": string | null,
    "price_asking": string | null,
    "listing_url": string,
    "listing_id": string,
    "image_url": string | null
  }
- For image_url: extract the primary listing photo URL (the first/main image). If no image is visible or the URL is embedded in JS, use null.
- If a listing is missing make, model, or year — skip it entirely.
- Do not include dealer ads for new vehicles (condition must be "Used").
`.trim();

const EXTRACTION_PROMPTS: Record<"carsales" | "carsguide" | "gumtree" | "drive", string> = {

  carsales: `
You are extracting used car listings from a Carsales.com.au search results page.

Each listing card contains:
- Title: usually "{Year} {Make} {Model} {Variant}" (e.g. "2021 Toyota HiLux SR5")
- Price: shown as "$42,500" or "Price on Application"
- Odometer: shown as "87,000 km"
- Listing URL: the href on the listing card title link (starts with /cars/details/)
  → Prepend "https://www.carsales.com.au" to make it absolute.
- Listing ID: the segment after /details/ in the URL (e.g. "OAG-AD-21234567")

${SHARED_RULES}
`.trim(),

  carsguide: `
You are extracting used car listings from a CarsGuide.com.au search results page.

Each listing card contains:
- Title: usually "{Year} {Make} {Model} {Variant}" (e.g. "2020 Ford Ranger XLT")
- Price: shown as "$38,990" or "Contact dealer"
- Odometer: shown as "62,000 km" or "62k km"
- Listing URL: the href on the listing card (starts with /cars/ or /buy-a-car/)
  → Prepend "https://www.carsguide.com.au" if relative.
- Listing ID: extract the numeric or slug ID from the URL path

${SHARED_RULES}
`.trim(),

  gumtree: `
You are extracting used car listings from a Gumtree.com.au search results page.

Each listing card contains:
- Title: usually "{Year} {Make} {Model} {Variant}" (e.g. "2019 Mazda CX-5 Touring")
- Price: shown as "$29,990" or "Contact seller"
- Odometer: shown as "45,000 km" — may be in a specs row below the title
- Listing URL: the href on the listing card (starts with /s-ad/)
  → Prepend "https://www.gumtree.com.au" if relative.
- Listing ID: the numeric segment at the end of the URL path (e.g. "1316547890")

${SHARED_RULES}
`.trim(),

  drive: `
You are extracting used car listings from a Drive.com.au search results page.

Each listing card contains:
- Title: usually "{Year} {Make} {Model} {Variant}" (e.g. "2021 Toyota HiLux SR5")
- Price: shown as "$42,500" or "Price on Application"
- Odometer: shown as "87,000 km"
- Listing URL: the href on the listing card (contains /cars-for-sale/ or /car/)
  → Prepend "https://www.drive.com.au" if relative.
- Listing ID: extract the numeric or slug ID from the URL path

${SHARED_RULES}
`.trim(),
};
