import { z } from "zod";

export const DESK_BASE_URL = "https://srv1422435.hstgr.cloud/api/carbitrage/desk";

const optionalNumber = z.number().finite().nullable().optional();
const optionalText = z.string().nullable().optional();
export const queueItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  year: z.number(), make: z.string(), model: z.string(), badge: optionalText,
  km: optionalNumber, state: optionalText, source: z.string(),
  channel: z.enum(["retail", "auction"]).optional(),
  asking_price: optionalNumber, current_bid: optionalNumber,
  found_at: z.string().datetime({ offset: true }), ad_url: optionalText,
  reason: z.string(), tier: z.enum(["BUY", "WATCH", "PASS"]),
  no_floor: z.boolean().optional(),
  floor_car_price: optionalNumber, floor_car_km: optionalNumber,
  comparable_count: optionalNumber, cautious_buy: optionalNumber,
});
export type QueueItem = z.infer<typeof queueItemSchema>;
export const queueSchema = z.union([
  z.array(queueItemSchema),
  z.object({ rows: z.array(queueItemSchema) }).transform((v) => v.rows),
  z.object({ queue: z.array(queueItemSchema) }).transform((v) => v.queue),
  z.object({ items: z.array(queueItemSchema) }).transform((v) => v.items),
]);

const shapeSchema = z.object({
  shape: z.string(), sold_count: z.number().int().nonnegative(),
  median_days_to_sell: optionalNumber, gross_band: optionalText,
});
const breakdownSchema = z.object({ label: z.string(), count: optionalNumber, band: optionalText });
export const dnaSchema = z.object({
  sales_count: z.number().int().nonnegative(),
  date_from: optionalText, date_to: optionalText, refreshed_at: optionalText,
  winning_shapes: z.array(shapeSchema),
  avoid: z.array(z.union([z.string(), z.object({ shape: z.string(), reason: optionalText })])).optional(),
  where_you_buy: z.array(breakdownSchema).optional(),
  who_you_sell_to: z.array(breakdownSchema).optional(),
});
export type DeskDna = z.infer<typeof dnaSchema>;

export function isDeskPreview(host: string, dev = false): boolean {
  if (host === "carbitrage.com.au" || host === "www.carbitrage.com.au" || host === "ooglemate-auction-edge.lovable.app") return false;
  return dev && (host === "localhost" || host === "127.0.0.1") ||
    /^(?:id-preview--|preview--)92b962ba-8cbd-4e77-b734-dd01c5a9be50\.lovable\.app$/.test(host) ||
    /(^|--)92b962ba-8cbd-4e77-b734-dd01c5a9be50\.lovableproject\.(app|com)$/.test(host);
}

export function confidenceLabel(count: number): string {
  return count >= 5 ? "High" : count >= 3 ? "Medium" : "worth re-testing";
}
export function sydneyDay(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export function isAuction(item: QueueItem): boolean {
  return item.channel ? item.channel === "auction" : /pickles|slattery|manheim|grays|auction/i.test(item.source);
}
export function filterQueue(items: QueueItem[], channel: "all" | "retail" | "auction", today: boolean, now = new Date()): QueueItem[] {
  return items.filter((item) => (channel === "all" || isAuction(item) === (channel === "auction")) && (!today || sydneyDay(item.found_at) === sydneyDay(now)));
}
export function safeAdUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { const url = new URL(raw); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
export function floorFigures(item: QueueItem) {
  return item.no_floor ? null : { price: item.floor_car_price, km: item.floor_car_km, count: item.comparable_count, buy: item.cautious_buy };
}

export function exampleDesk(now = new Date()): { queue: QueueItem[]; dna: DeskDna } {
  const found = new Date(now.getTime() - 45 * 60_000).toISOString();
  return {
    queue: [
      { id: "example-1", year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 84200, state: "NSW", source: "Carsales", channel: "retail", asking_price: 26990, current_bid: null, found_at: found, reason: "This shape has sold consistently in your example sales history, with a short time to sell.", tier: "BUY", floor_car_price: 29900, floor_car_km: 81000, comparable_count: 8, cautious_buy: 25500 },
      { id: "example-2", year: 2019, make: "Mazda", model: "CX-5", badge: "Maxx Sport", km: 96500, state: "VIC", source: "Pickles", channel: "auction", current_bid: 16800, asking_price: null, found_at: found, reason: "Your example history shows repeat demand for this shape. Watch the bid against the supplied buy figure.", tier: "WATCH", floor_car_price: 23990, floor_car_km: 92000, comparable_count: 6, cautious_buy: 19500 },
      { id: "example-3", year: 2018, make: "Subaru", model: "Forester", badge: "2.5i", km: 121000, state: "QLD", source: "Gumtree", channel: "retail", asking_price: 18900, found_at: new Date(now.getTime() - 48 * 3600_000).toISOString(), reason: "A small sample in the example history; more comparable evidence is needed.", tier: "PASS", no_floor: true, cautious_buy: null },
    ],
    dna: { sales_count: 48, date_from: "2026-02-01", date_to: "2026-10-31", refreshed_at: found,
      winning_shapes: [
        { shape: "Toyota RAV4 · GX", sold_count: 9, median_days_to_sell: 18, gross_band: "$3k–$5k" },
        { shape: "Mazda CX-5 · Maxx Sport", sold_count: 7, median_days_to_sell: 21, gross_band: "$2k–$4k" },
        { shape: "Toyota Corolla · Ascent", sold_count: 6, median_days_to_sell: 15, gross_band: "$2k–$3k" },
        { shape: "Hyundai i30 · Active", sold_count: 4, median_days_to_sell: 23, gross_band: "$2k–$3k" },
        { shape: "Kia Sportage · Si", sold_count: 3, median_days_to_sell: 26, gross_band: "$2k–$4k" },
        { shape: "Subaru Forester · 2.5i", sold_count: 2, median_days_to_sell: 32, gross_band: null },
      ], avoid: [{ shape: "High-km luxury sedans", reason: "Longer holding times in the example history" }],
      where_you_buy: [{ label: "Auctions", count: 29 }, { label: "Retail", count: 19 }],
      who_you_sell_to: [{ label: "NSW", count: 31 }, { label: "QLD", count: 17 }],
    },
  };
}