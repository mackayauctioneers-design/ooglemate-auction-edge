import { z } from "zod";
import { sydneyDay } from "./data.ts";

const number = z.number().finite().nullable().optional();
const text = z.string().nullable().optional();
const car = { year: z.number(), make: z.string(), model: z.string(), badge: text, km: number };
const comparableSchema = z.object({ ...car, price: number, ad_url: text });
export const stockItemSchema = z.object({
  stock_no: z.string(), ...car, days_in_stock: z.number().nonnegative(),
  stage: z.enum(["Good", "Watch", "Act", "Exit"]),
  asking_price: number, floor_price: number, gap: number, gap_label: text,
  floor_dropped: z.boolean().optional(),
  floor_car: comparableSchema.nullable().optional(),
  comparables: z.array(comparableSchema).optional(),
});
export const auctionItemSchema = z.object({
  id: z.union([z.string(), z.number()]), ...car,
  closes_at: z.string().datetime({ offset: true }), auction_house: z.string(),
  lot: z.union([z.string(), z.number()]), current_bid: number, floor_price: number, max_bid: number, ad_url: text,
});
export type StockItem = z.infer<typeof stockItemSchema>;
export type AuctionItem = z.infer<typeof auctionItemSchema>;
export type Comparable = z.infer<typeof comparableSchema>;
export const stockSchema = z.union([z.array(stockItemSchema), z.object({ rows: z.array(stockItemSchema) }).transform(v => v.rows), z.object({ stock: z.array(stockItemSchema) }).transform(v => v.stock), z.object({ items: z.array(stockItemSchema) }).transform(v => v.items)]);
export const auctionsSchema = z.union([z.array(auctionItemSchema), z.object({ rows: z.array(auctionItemSchema) }).transform(v => v.rows), z.object({ auctions: z.array(auctionItemSchema) }).transform(v => v.auctions), z.object({ items: z.array(auctionItemSchema) }).transform(v => v.items)]);

export const yardMoney = (value: number | null | undefined) => value == null ? "" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value);
export function stockGap(item: StockItem): string {
  // The server owns the gap. Never derive it from asking and floor prices.
  if (item.asking_price == null || item.floor_price == null) return "";
  if (item.gap_label) return item.gap_label;
  if (item.gap == null) return "";
  const amount = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", notation: Math.abs(item.gap) >= 1000 ? "compact" : "standard", maximumFractionDigits: Math.abs(item.gap) >= 1000 ? 1 : 0 }).format(Math.abs(item.gap)).replace("K", "k");
  return `${amount} ${item.gap < 0 ? "under" : item.gap > 0 ? "over" : "at floor"}`;
}
export function sortStock(rows: StockItem[], order: "action" | "oldest"): StockItem[] {
  return [...rows].sort((a, b) => order === "oldest" ? b.days_in_stock - a.days_in_stock : (b.gap ?? -Infinity) - (a.gap ?? -Infinity) || b.days_in_stock - a.days_in_stock);
}
export function auctionGroups(rows: AuctionItem[], now: Date): { label: string; rows: AuctionItem[] }[] {
  const today = sydneyDay(now);
  const tomorrow = sydneyDay(new Date(now.getTime() + 24 * 3600_000));
  const upcoming = rows.filter(row => { const ms = Date.parse(row.closes_at) - now.getTime(); return ms > 0 && ms <= 48 * 3600_000; }).sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at));
  return [{ label: "Today", rows: upcoming.filter(row => sydneyDay(row.closes_at) === today) }, { label: "Tomorrow", rows: upcoming.filter(row => sydneyDay(row.closes_at) === tomorrow) }, { label: "Next 48 hours", rows: upcoming.filter(row => ![today, tomorrow].includes(sydneyDay(row.closes_at))) }].filter(group => group.rows.length > 0);
}
export function countdown(closes: string, now: Date): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(closes) - now.getTime()) / 60000));
  return minutes === 0 ? "Closed" : `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}
export function wholesaleStockLink(stock: string): string { return `/portal/wholesale/start?stock_no=${encodeURIComponent(stock)}`; }
export function exampleYard(now = new Date()): { stock: StockItem[]; auctions: AuctionItem[] } {
  return {
    stock: [
      { stock_no: "EX-104", year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 84200, days_in_stock: 96, stage: "Exit", asking_price: 32000, floor_price: 29900, gap: 2100, floor_dropped: true, floor_car: { year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 81000, price: 29900, ad_url: "https://example.com/floor-car" }, comparables: [{ year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 79000, price: 30900, ad_url: "https://example.com/comparable-car" }] },
      { stock_no: "EX-108", year: 2019, make: "Mazda", model: "CX-5", badge: "Maxx Sport", km: 96500, days_in_stock: 65, stage: "Act", asking_price: 24790, floor_price: 23990, gap: 800 },
      { stock_no: "EX-112", year: 2021, make: "Hyundai", model: "i30", badge: "Active", km: 56000, days_in_stock: 42, stage: "Watch", asking_price: 19100, floor_price: 19900, gap: -800 },
      { stock_no: "EX-116", year: 2022, make: "Kia", model: "Sportage", badge: "Si", km: 43000, days_in_stock: 18, stage: "Good", asking_price: 28900, floor_price: 28900, gap: 0 },
    ],
    auctions: [
      { id: "example-lot-1", year: 2020, make: "Toyota", model: "RAV4", badge: "GX", km: 82000, closes_at: new Date(now.getTime() + 3600_000).toISOString(), auction_house: "Pickles", lot: "EX-21", current_bid: 21800, floor_price: 29900, max_bid: 25500 },
      { id: "example-lot-2", year: 2019, make: "Mazda", model: "CX-5", badge: "Maxx Sport", km: 92000, closes_at: new Date(now.getTime() + 24 * 3600_000).toISOString(), auction_house: "Manheim", lot: "EX-45", current_bid: 17000, floor_price: 23990, max_bid: 19500 },
    ],
  };
}