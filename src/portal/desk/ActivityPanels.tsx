import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeAdUrl } from "./data";
import { activityTime, eventKey, updatedMinutes, type DeskSummary, type WorkerEvent } from "./activityData";
import type { DeskPanel } from "./useDeskFeed";

function ExampleBanner() { return <p className="mb-3 border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground" role="status">Example data: not your yard</p>; }
export function SummaryStrip({ panel }: { panel: DeskPanel<DeskSummary> }) {
  const counters = [
    ["scanned_today", "Scanned today"], ["matched_to_you", "Matched to you"], ["buy_ready", "Buy-ready"],
    ["stock_over_market", "Stock over market"], ["auctions_closing_today", "Auctions closing today"],
  ] as const;
  return <section aria-label="Desk counters" className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-6">
    {panel.example ? <ExampleBanner /> : null}
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-border py-3 sm:grid-cols-3 lg:grid-cols-5">{counters.map(([key, label]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{panel.data?.[key]?.toLocaleString("en-AU") ?? "—"}</dd></div>)}</dl>
    {!panel.data ? <p className="mt-2 text-xs text-muted-foreground" role="status">{panel.loading ? "Loading your desk…" : "Your desk is being set up"}</p> : null}
  </section>;
}
export function WorkerActivity({ panel, updatedAt, now }: { panel: DeskPanel<WorkerEvent[]>; updatedAt: number | null; now: number }) {
  return <section aria-label="Worker activity" className="mt-8 border-t border-border pt-5">
    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-xl font-semibold">Worker activity</h2>{updatedAt != null && !panel.example ? <p className="text-xs text-muted-foreground">Updated {updatedMinutes(updatedAt, now)} min ago</p> : null}</header>
    {panel.example ? <ExampleBanner /> : null}
    {!panel.data ? <p className="py-5 text-sm text-muted-foreground" role="status">{panel.loading ? "Loading activity…" : "Your desk is being set up"}</p> : panel.data.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No recent activity</p> : <ul className="divide-y divide-border">{panel.data.map((row) => {
      const url = safeAdUrl(row.car_url);
      return <li key={eventKey(row)} className="flex items-start gap-3 py-3"><time dateTime={row.time} className="w-20 shrink-0 text-xs leading-5 text-muted-foreground">{activityTime(row.time)}</time><p className="min-w-0 flex-1 break-words text-sm">{row.event}</p>{url ? <Button asChild size="icon" variant="ghost" className="h-7 w-7 shrink-0"><a href={url} target="_blank" rel="noopener noreferrer" aria-label={`View car: ${row.event}`} title="View car"><ArrowUpRight className="h-4 w-4" /></a></Button> : null}</li>;
    })}</ul>}
  </section>;
}