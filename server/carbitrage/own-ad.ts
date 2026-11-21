/**
 * Spot the selling dealer's own advert inside a guide, so buyers never get its link.
 * The market engine can do this when it is given the ad link or asking price. This is the
 * backstop for when that guard does not run, and for a round odometer such as 60,000,
 * which that guard misses.
 */

/** Kilometres either side of this car still count as the same odometer, including a round reading. */
export const OWN_AD_KM_WINDOW = 500;
/** Dollars either side of the asking price still count as that advert, or 1% on a dearer car. */
const PRICE_CLOSE_DOLLARS = 500;

export interface OwnAdHint {
  link?: string;
  price?: number;
}

export interface AdLike {
  link?: string | null;
  url?: string | null;
  price_ex_gov?: number | null;
  km?: number | null;
}

/** Host and path only, so a tracking query or a www prefix still matches the same ad. */
export function linkKey(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export function linksMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = linkKey(a);
  const right = linkKey(b);
  return left != null && right != null && left === right;
}

/** Close enough to the asking price to be the same advert: $500, or 1% on a dearer car. */
export function priceIsClose(adPrice: number, asking: number): boolean {
  if (!(adPrice > 0) || !(asking > 0)) return false;
  return Math.abs(adPrice - asking) <= Math.max(PRICE_CLOSE_DOLLARS, asking * 0.01);
}

/**
 * Same odometer, including when the advert prints a round thousand (60,000) and the car is
 * within 500 km of it. The market engine's own guard skips those round readings.
 */
export function kmIsClose(adKm: number | null | undefined, carKm: number): boolean {
  if (adKm == null || !Number.isFinite(adKm) || !Number.isFinite(carKm)) return false;
  return Math.abs(adKm - carKm) <= OWN_AD_KM_WINDOW;
}

/** Link match on its own, or asking price and kilometres together. Either one is enough to drop the ad. */
export function isLikelyOwnAd(ad: AdLike, carKm: number, own: OwnAdHint | null | undefined): boolean {
  if (!own) return false;
  const link = ad.link ?? ad.url ?? null;
  if (own.link && link && linksMatch(own.link, link)) return true;
  if (own.price != null && own.price > 0 && ad.price_ex_gov != null && priceIsClose(ad.price_ex_gov, own.price) && kmIsClose(ad.km, carKm)) return true;
  return false;
}

/** Optional ad link and asking price from the dealer. A bad link is ignored, not an error. */
export function parseOwnAd(body: Record<string, unknown>): OwnAdHint | undefined {
  const linkRaw = typeof body.adLink === "string" ? body.adLink.trim() : typeof body.link === "string" ? body.link.trim() : "";
  let link: string | undefined;
  if (linkRaw) {
    try {
      const url = new URL(linkRaw);
      if (url.protocol === "http:" || url.protocol === "https:") link = url.toString().slice(0, 500);
    } catch {
      link = undefined;
    }
  }
  const rawPrice = body.askingPrice ?? body.price;
  const priceNum = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? Number(rawPrice.replace(/[^0-9.]/g, "")) : NaN;
  const price = Number.isFinite(priceNum) && priceNum > 0 && priceNum <= 2_000_000 ? Math.round(priceNum) : undefined;
  if (!link && price == null) return undefined;
  return { ...(link ? { link } : {}), ...(price != null ? { price } : {}) };
}
