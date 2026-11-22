import { z } from "zod";

const number = z.number().finite().nullable().optional();
const text = z.string().nullable().optional();
const car = { year: z.number(), make: z.string(), model: z.string(), badge: text, km: number };
const comparableSchema = z.object({ year: number, make: text, model: text, badge: text, km: number, price: number, url: text });
export const stockItemSchema = z.object({
  stock_id: z.string(), stock_no: text, ...car, days_in_stock: z.number().nonnegative(),
  stage: z.enum(["Good", "Watch", "Act", "Exit"]),
  asking_price: number, asking_gap: number, buy_price: number, floor: number,
  cost_gap: number, no_floor: z.boolean().optional(), floor_km: number, floor_car_url: text,
  comp_count: number, next_comps: z.array(comparableSchema).nullable().optional(),
  floor_moved: text, floor_first: number,
});
export const auctionItemSchema = z.object({
  ...car, title: text, state: text,
  closes_at: z.string().refine(value => Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)),
  closes_in_min: number, group: z.enum(["Today", "Tomorrow"]).optional(), auction_house: z.string(),
  lot: z.union([z.string(), z.number()]), current_bid: number, floor: number, max_bid: number, url: text,
  no_floor: z.boolean().optional(), comp_count: number, max_bid_basis: text,
  reason: text, under_floor_label: z.boolean().optional(),
});
export type StockItem = z.infer<typeof stockItemSchema>;
export type AuctionItem = z.infer<typeof auctionItemSchema>;
export type Comparable = z.infer<typeof comparableSchema>;
export type AuctionFeed = { Today: AuctionItem[]; Tomorrow: AuctionItem[] };
export const stockSchema = z.object({ items: z.array(stockItemSchema), money_hidden: z.boolean().optional() }).transform(v => v.items.map(row => ({
  ...row,
  ...(row.no_floor ? { floor: null, cost_gap: null, asking_gap: null, next_comps: null } : {}),
  ...(v.money_hidden ? { asking_price: null, asking_gap: null, buy_price: null, floor: null, cost_gap: null, floor_first: null, next_comps: row.no_floor ? null : row.next_comps?.map(comp => ({ ...comp, price: null })) } : {}),
})));
export const auctionsSchema = z.object({ groups: z.object({ Today: z.array(auctionItemSchema), Tomorrow: z.array(auctionItemSchema) }), money_hidden: z.boolean().optional() }).transform(v => {
  const protect = (rows: AuctionItem[]) => rows.map(row => ({ ...row,
    ...(row.no_floor ? { floor: null, max_bid: null, max_bid_basis: null, under_floor_label: false } : {}),
    ...(v.money_hidden ? { current_bid: null, floor: null, max_bid: null, max_bid_basis: null, under_floor_label: false } : {}),
  }));
  return { Today: protect(v.groups.Today), Tomorrow: protect(v.groups.Tomorrow) };
});

export const yardMoney = (value: number | null | undefined) => value == null ? "" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value);
export function stockGap(item: StockItem, field: "cost_gap" | "asking_gap" = "cost_gap"): string {
  // Format the supplied gap only; do not subtract any prices.
  const gap = item[field];
  if (item.no_floor || gap == null) return "";
  const amount = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", notation: Math.abs(gap) >= 1000 ? "compact" : "standard", maximumFractionDigits: Math.abs(gap) >= 1000 ? 1 : 0 }).format(Math.abs(gap)).replace("K", "k");
  return `${amount} ${gap < 0 ? "under floor" : gap > 0 ? "over floor" : "at floor"}`;
}
export function floorMoved(value: string | null | undefined): boolean { return value != null && value !== "same"; }
export function sortStock(rows: StockItem[], order: "action" | "oldest"): StockItem[] {
  const priority = { Exit: 0, Act: 1, Watch: 2, Good: 3 };
  return [...rows].sort((a, b) => order === "oldest" ? b.days_in_stock - a.days_in_stock : priority[a.stage] - priority[b.stage] || (b.cost_gap ?? -Infinity) - (a.cost_gap ?? -Infinity) || b.days_in_stock - a.days_in_stock);
}
export function auctionGroups(feed: AuctionFeed): { label: string; rows: AuctionItem[] }[] {
  return [{ label: "Today", rows: feed.Today }, { label: "Tomorrow", rows: feed.Tomorrow }].filter(group => group.rows.length > 0);
}
export function countdown(closes: string, now: Date): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(closes) - now.getTime()) / 60000));
  return minutes === 0 ? "Closed" : `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}
export function wholesaleStockLink(stock: string): string { return `/portal/wholesale/start?stock_no=${encodeURIComponent(stock)}`; }
export function exampleYard(now = new Date()): { stock: StockItem[]; auctions: AuctionFeed } {
  return {
    stock: [
      { stock_id: "example-stock-1", stock_no: "EX-104", year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 84200, days_in_stock: 96, stage: "Exit", asking_price: 32000, floor: 29900, asking_gap: 2100, cost_gap: 2100, floor_moved: "down", floor_km: 81000, floor_car_url: "https://example.com/floor-car", next_comps: [{ year: 2020, km: 79000, price: 30900, url: "https://example.com/comparable-car" }] },
      { stock_id: "example-stock-2", stock_no: "EX-108", year: 2019, make: "Mazda", model: "CX-5", badge: "Maxx Sport", km: 96500, days_in_stock: 65, stage: "Act", asking_price: null, floor: 23990, cost_gap: 800 },
      { stock_id: "example-stock-3", stock_no: "EX-112", year: 2021, make: "Hyundai", model: "i30", badge: "Active", km: 56000, days_in_stock: 42, stage: "Watch", asking_price: null, floor: 19900, cost_gap: -800 },
      { stock_id: "example-stock-4", stock_no: "EX-116", year: 2022, make: "Kia", model: "Sportage", badge: "Si", km: 43000, days_in_stock: 18, stage: "Good", asking_price: null, floor: 28900, cost_gap: 0 },
    ],
    auctions: {
      Today: [{ year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 82000, closes_at: new Date(now.getTime() + 3600_000).toISOString(), auction_house: "Pickles", lot: "EX-21", current_bid: 21800, floor: 29900, max_bid: 25500, max_bid_basis: "Example sales history", under_floor_label: true }],
      Tomorrow: [{ year: 2019, make: "Mazda", model: "CX-5", badge: "Maxx Sport", km: 92000, closes_at: new Date(now.getTime() + 24 * 3600_000).toISOString(), auction_house: "Manheim", lot: "EX-45", current_bid: 17000, floor: 23990, max_bid: 19500 }],
    },
  };
}