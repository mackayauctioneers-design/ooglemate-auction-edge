// Trading Desk freshness rules: 120-day price anchors, best-fit eligibility, auction end + stale expiry, Sydney end labels.
// Pure module (no Deno/npm imports): shared by edge functions, the desk page and node tests.

export const ANCHOR_MAX_AGE_DAYS = 120;
/** Daily-refreshed auction feeds: a listing not seen for this long is treated as gone. */
export const AUCTION_STALE_HOURS = 36;
export const DAILY_AUCTION_SOURCES = ["manheim", "slattery", "pickles", "grays", "f3", "auto_auctions", "vma", "bidsonline"];
const DAY = 86_400_000;

export const anchorCutoff = (now: Date = new Date()) => new Date(now.getTime() - ANCHOR_MAX_AGE_DAYS * DAY);

/** A sale may price an anchor only when it sold within the last 120 days. Null/invalid dates never price. */
export function isFreshSale(soldAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!soldAt) return false;
  const t = Date.parse(soldAt);
  return Number.isFinite(t) && t >= anchorCutoff(now).getTime() && t <= now.getTime() + DAY;
}

const ANCHOR_FIELDS = ["anchor_sale_id", "anchor_sale_buy_price", "anchor_sale_sell_price", "anchor_sale_profit", "anchor_sale_sold_at", "anchor_sale_km", "anchor_sale_trim_class"] as const;

/** Blanks an anchor older than 120 days (or undated). Sets anchor_trend_only when a stale anchor was removed. */
export function blankStaleAnchor<T extends Record<string, unknown>>(opp: T, now: Date = new Date()): T & { anchor_trend_only?: boolean } {
  const hasAnchor = ANCHOR_FIELDS.some((k) => opp[k] != null);
  if (!hasAnchor || isFreshSale(opp.anchor_sale_sold_at as string | null, now)) return opp;
  const out: Record<string, unknown> = { ...opp, anchor_trend_only: true };
  for (const k of ANCHOR_FIELDS) out[k] = null;
  return out as T & { anchor_trend_only: boolean };
}

/** Yards with at least one own sale in the last 120 days. Only these can be best fit. */
export function eligibleYards(salesByAccount: Record<string, { sold_at?: string | null }[]>, now: Date = new Date()): Set<string> {
  const out = new Set<string>();
  for (const [id, sales] of Object.entries(salesByAccount)) if (sales.some((s) => isFreshSale(s.sold_at, now))) out.add(id);
  return out;
}

/** First ranked match whose yard is eligible; the rest (in order) become alternatives. */
export function chooseBestFit<M extends { account_id: string }>(ranked: M[], eligible: Set<string>): { best: M | null; alts: M[] } {
  const i = ranked.findIndex((m) => eligible.has(m.account_id));
  if (i < 0) return { best: null, alts: [] };
  return { best: ranked[i], alts: ranked.filter((_, j) => j !== i) };
}

export type ListingState = { status?: string | null; sold_detected_at?: string | null; last_seen_at?: string | null; auction_datetime?: string | null };
export type ExpiryReason = "auction_ended" | "source_gone" | "source_stale";

/** Why a desk find should be expired, or null. listing undefined = no listing row known (not judged). */
export function expiryReason(
  opp: { listing_source?: unknown; auction_datetime?: unknown },
  listing: ListingState | undefined,
  now: Date = new Date(),
): ExpiryReason | null {
  const end = (opp.auction_datetime as string | null) ?? listing?.auction_datetime ?? null;
  if (end && Number.isFinite(Date.parse(end)) && Date.parse(end) < now.getTime()) return "auction_ended";
  if (!listing) return null;
  if (listing.sold_detected_at) return "source_gone";
  if (listing.status && !["active", "catalogue", "listed"].includes(listing.status)) return "source_gone";
  const src = String(opp.listing_source ?? "").toLowerCase();
  if (DAILY_AUCTION_SOURCES.includes(src) && listing.last_seen_at) {
    if (now.getTime() - Date.parse(listing.last_seen_at) > AUCTION_STALE_HOURS * 3_600_000) return "source_stale";
  }
  return null;
}

/** "Ends Tue 25 Nov 7:30pm" in Sydney time. Null when no/invalid end. */
export function formatAuctionEnd(iso: string | null | undefined): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `Ends ${String(parts.weekday).slice(0, 3)} ${parts.day} ${String(parts.month).slice(0, 3)} ${parts.hour}:${parts.minute}${String(parts.dayPeriod).toLowerCase().replace(/\./g, "")}`;
}

/** Slattery lot URL -> auction event id (one page fetch per event gives every lot's close time). */
export function slatteryAuctionId(url: string | null | undefined): string | null {
  const m = /[?&]auctionId=(\d+)/.exec(url ?? "");
  return m ? m[1] : null;
}

/** Parses a Slattery auction page: asset id -> closesAt (UTC), plus earliest/latest closes seen. Lots close staggered, so unlisted lots fall back to the latest close (never hides a live lot early). */
export function parseSlatteryCloses(html: string): { byAsset: Record<string, string>; earliest: string | null; latest: string | null } {
  const text = html.replace(/\\"/g, '"');
  const byAsset: Record<string, string> = {};
  let earliest: string | null = null;
  let latest: string | null = null;
  const re = /"closesAt":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"/g;
  for (let m; (m = re.exec(text));) {
    const close = m[1];
    if (!earliest || close < earliest) earliest = close;
    if (!latest || close > latest) latest = close;
    const before = text.slice(Math.max(0, m.index - 1500), m.index);
    const ids = [...before.matchAll(/"(?:id|assetId)":(\d{5,7})\b/g)];
    if (ids.length) byAsset[ids[ids.length - 1][1]] = close;
  }
  return { byAsset, earliest, latest };
}

/** One Manheim sale from source_coverage.sales: { sale, lots, closes_at }. */
export type CoverageSale = { sale?: string | null; lots?: number | null; closes_at?: string | null };
export type SaleListing = ListingState & { event_id?: string | null; auction_location?: string | null; location?: string | null };
const saleKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** closes_at of the first sale whose name matches one of the candidate names (case/punctuation-insensitive). */
export function saleCloseFor(names: unknown[], sales: CoverageSale[] | null | undefined): string | null {
  if (!Array.isArray(sales)) return null;
  for (const n of names) {
    const k = saleKey(n);
    if (!k) continue;
    const hit = sales.find((s) => saleKey(s?.sale) === k && typeof s.closes_at === "string" && Number.isFinite(Date.parse(s.closes_at)));
    if (hit) return hit.closes_at as string;
  }
  return null;
}

/** Manheim lots carry no per-lot end: fill auction_datetime from the sale's close in the latest manheim coverage row.
 *  A real per-lot end (on the find or its listing) is never overwritten. */
export function withManheimEnd<T extends Record<string, unknown>>(opp: T, listing: SaleListing | undefined, sales: CoverageSale[] | null | undefined): T {
  if (String(opp.listing_source ?? "").toLowerCase() !== "manheim") return opp;
  if (opp.auction_datetime || listing?.auction_datetime) return opp;
  const end = saleCloseFor([opp.sale_name, listing?.event_id, listing?.auction_location, listing?.location], sales);
  return end ? { ...opp, auction_datetime: end } : opp;
}

export const needsManheimEnd = (o: Record<string, unknown>) => String(o.listing_source ?? "").toLowerCase() === "manheim" && !o.auction_datetime;
