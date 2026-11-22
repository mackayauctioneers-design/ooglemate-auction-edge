import { z } from "zod";
import { DESK_BASE_URL } from "./data.ts";

const count = z.number().int().nonnegative().nullable().optional();
export const summarySchema = z.object({
  scanned_today: count, matched_to_you: count, buy_ready: count,
  stock_over_market: count, auctions_closing_today: count,
}).refine((row) => Object.values(row).some((value) => value != null), "No counters supplied");
export type DeskSummary = z.infer<typeof summarySchema>;
const eventSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  time: z.string().datetime({ offset: true }),
  event: z.string().min(1),
  car_url: z.string().nullable().optional(),
});
export const activitySchema = z.union([
  z.array(eventSchema),
  z.object({ rows: z.array(eventSchema) }).transform((body) => body.rows),
  z.object({ events: z.array(eventSchema) }).transform((body) => body.events),
]);
export type WorkerEvent = z.infer<typeof eventSchema>;
export const ACTIVITY_POLL_MS = 60_000;
export function activityUrl(since: string) {
  return `${DESK_BASE_URL}/activity?${new URLSearchParams({ since })}`;
}
export function eventKey(row: WorkerEvent) { return row.id == null ? `${row.time}:${row.event}:${row.car_url ?? ""}` : String(row.id); }
export function mergeActivity(previous: WorkerEvent[], incoming: WorkerEvent[]) {
  const rows = new Map(previous.map((row) => [eventKey(row), row]));
  incoming.forEach((row) => rows.set(eventKey(row), row));
  return [...rows.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
export function activityTime(time: string) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }).format(new Date(time));
}
export function updatedMinutes(updatedAt: number, now = Date.now()) { return Math.max(0, Math.floor((now - updatedAt) / 60_000)); }
export function exampleActivity(now = new Date()): { summary: DeskSummary; activity: WorkerEvent[] } {
  return {
    summary: { scanned_today: 1248, matched_to_you: 12, buy_ready: 3, stock_over_market: 2, auctions_closing_today: 4 },
    activity: [
      { id: "example-scan", time: new Date(now.getTime() - 60_000).toISOString(), event: "Checked new listings for cars matching your winning shapes." },
      { id: "example-match", time: new Date(now.getTime() - 4 * 60_000).toISOString(), event: "Found a Toyota RAV4 GX matching your buying profile." },
      { id: "example-floor", time: new Date(now.getTime() - 9 * 60_000).toISOString(), event: "Refreshed comparable cars for your in-stock Mazda CX-5." },
    ],
  };
}