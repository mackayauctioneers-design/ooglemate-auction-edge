import type { CarParams, GuideReply } from "../wholesale/api.ts";
import { DESK_BASE_URL, type QueueItem } from "./data.ts";

export type ValuationInput = { rego: string; state: string; year: string; make: string; model: string; badge: string; km: string };
export function valuationParams(input: ValuationInput, mode: "rego" | "details"): (Partial<CarParams> & { km: number }) | null {
  const km = Number(input.km.replace(/,/g, ""));
  if (!input.km.trim() || !Number.isFinite(km) || km < 0 || !input.state) return null;
  if (mode === "rego") return input.rego.trim() ? { rego: input.rego.trim().toUpperCase(), state: input.state, km } : null;
  if (!/^\d{4}$/.test(input.year) || !input.make.trim() || !input.model.trim() || !input.badge.trim()) return null;
  return { year: input.year, make: input.make.trim(), model: input.model.trim(), badge: input.badge.trim(), state: input.state, km };
}
export function guidePollDelay(reply: GuideReply | null): number | null {
  const check = reply?.guide?.live_check;
  if (check?.state === "checking") return (Math.max(check.poll_after_s, 20) + 1) * 1000;
  // Held replies have no guide/live_check; the existing guide's minimum interval applies
  // only when the server explicitly says a live search is running.
  if (reply?.held && /live search is running/i.test(reply.reason ?? "")) return 21000;
  return null;
}
export function canSendValuation(reply: GuideReply | null, example = false): boolean {
  return Boolean(!example && reply && !reply.held && reply.guide?.floor_car && Number.isFinite(reply.guide.floor_dollars) && Number.isFinite(reply.guide.floor_car.price_ex_gov) && reply.guide.live_check?.state !== "checking");
}
export function valuationStartLink(reply: GuideReply): string {
  const car = reply.car;
  const query = new URLSearchParams({ rego: car.rego ?? "", state: car.state, year: String(car.year), make: car.make, model: car.model, badge: car.badge, km: String(car.km) });
  return `/portal/wholesale/start?${query}`;
}
export function shapeQueueUrl(car: GuideReply["car"]): string {
  return `${DESK_BASE_URL}/queue?${new URLSearchParams({ shape: [car.make, car.model, car.badge, car.year].join(",") })}`;
}
export function relatedCars(rows: QueueItem[]): QueueItem[] { return rows.slice(0, 3); }