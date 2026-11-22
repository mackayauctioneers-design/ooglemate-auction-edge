import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Eye, LayoutDashboard, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import logo from "@/assets/carbitrage-logo.jpg";
import { confidenceLabel, filterQueue, floorFigures, isAuction, safeAdUrl, type DeskDna, type QueueItem } from "./data";
import { useDeskFeed, type DeskPanel } from "./useDeskFeed";
import { StockPanel, AuctionsPanel } from "./YardPanels";

const money = (n: number | null | undefined) => n == null ? "Price restricted" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
const distance = (n: number | null | undefined) => n == null ? "km unavailable" : `${n.toLocaleString("en-AU")} km`;
function date(value: string | null | undefined, time = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", ...(time ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : { year: "numeric" }) }).format(new Date(value));
}
function ExampleBanner() { return <p className="mb-4 border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground" role="status">Example data: not your yard</p>; }
function PanelStatus<T>({ panel }: { panel: DeskPanel<T> }) {
  return panel.loading ? <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Loading your desk…</p> : <p className="py-8 text-sm text-muted-foreground" role="status">Your desk is being set up</p>;
}
function CarCard({ item, rank }: { item: QueueItem; rank: number }) {
  const floor = floorFigures(item);
  const url = safeAdUrl(item.ad_url);
  return <li className="rounded-md border border-border bg-background p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="mb-2 text-xs text-muted-foreground">#{rank} · {item.source} · {item.state ?? "State unavailable"}</p>
        <h3 className="break-words text-lg font-semibold leading-snug">{item.year} {item.make} {item.model}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{[item.badge, distance(item.km)].filter(Boolean).join(" · ")}</p>
      </div>
      <span className={`shrink-0 rounded-sm px-2 py-1 text-xs font-semibold ${item.tier === "BUY" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{item.tier}</span>
    </div>
    <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
      <div><p className="text-xs text-muted-foreground">{isAuction(item) ? "Current bid" : "Asking price"}</p><p className="text-xl font-semibold tabular-nums">{money(isAuction(item) ? item.current_bid : item.asking_price)}</p></div>
      <p className="text-xs text-muted-foreground">Found {date(item.found_at, true)}</p>
    </div>
    <p className="my-4 text-sm leading-relaxed"><span className="font-semibold">Why you: </span>{item.reason}</p>
    <div className="border-y border-border bg-muted/40 py-3">
      {!floor ? <p className="text-sm text-muted-foreground">No reliable floor yet</p> : <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div><dt className="text-xs text-muted-foreground">Floor car</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{money(floor.price)}</dd><dd className="text-xs text-muted-foreground">{distance(floor.km)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Cautious buy</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{money(floor.buy)}</dd><dd className="text-xs text-muted-foreground">{floor.count == null ? "Comparable count unavailable" : `${floor.count} comparable cars`}</dd></div>
      </dl>}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1.5">{[{ label: "Buy", Icon: Check }, { label: "Watch", Icon: Eye }, { label: "Pass", Icon: X }].map(({ label, Icon }) => <span key={label} title="Coming soon" className="inline-flex" tabIndex={0} aria-label={`${label} — coming soon`}><Button disabled variant="outline" size="sm"><Icon />{label}</Button></span>)}</div>
      {url ? <Button asChild variant="link" size="sm"><a href={url} target="_blank" rel="noopener noreferrer">View ad<ArrowUpRight /></a></Button> : <span className="text-xs text-muted-foreground">Ad link unavailable</span>}
    </div>
  </li>;
}
function DnaContent({ data }: { data: DeskDna }) {
  return <>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Built from {data.sales_count} of your sales, {date(data.date_from)} – {date(data.date_to)}. Last refreshed {date(data.refreshed_at, true)}.</p>
    <h3 className="mb-1 mt-6 text-sm font-semibold">Winning shapes</h3>
    {data.winning_shapes.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No winning shapes yet</p> : <ol className="divide-y divide-border">{data.winning_shapes.slice(0, 6).map((shape, i) => <li key={`${shape.shape}-${i}`} className="py-4">
      <p className="break-words text-sm font-semibold">{shape.shape}</p>
      <p className="mt-1 text-xs text-muted-foreground">{shape.sold_count} sold · {shape.median_days_to_sell == null ? "Days unavailable" : `${shape.median_days_to_sell} median days to sell`}</p>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs"><span>{shape.gross_band ?? "Gross restricted"}</span><span className="text-muted-foreground">{confidenceLabel(shape.sold_count)}</span></div>
    </li>)}</ol>}
    {data.avoid && data.avoid.length > 0 ? <section className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-semibold">Avoid</h3><ul className="mt-2 space-y-3">{data.avoid.map((row, i) => <li key={i} className="text-sm">{typeof row === "string" ? row : <>{row.shape}{row.reason ? <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p> : null}</>}</li>)}</ul></section> : null}
    {([{ title: "Where you buy", rows: data.where_you_buy }, { title: "Who you sell to", rows: data.who_you_sell_to }]).map(({ title, rows }) => rows && rows.length > 0 ? <section key={title} className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 space-y-2">{rows.map((row, i) => <div key={i} className="flex justify-between gap-3 text-sm"><dt className="min-w-0 break-words">{row.label}</dt><dd className="shrink-0 text-muted-foreground">{row.band ?? (row.count == null ? "Count unavailable" : `${row.count} sales`)}</dd></div>)}</dl></section> : null)}
  </>;
}
export default function DeskPage() {
  const { queue, dna, stock, auctions } = useDeskFeed();
  const [channel, setChannel] = useState<"all" | "retail" | "auction">("all");
  const [today, setToday] = useState(false);
  const filtered = filterQueue(queue.data ?? [], channel, today);
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border"><div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-4 sm:px-6"><Link to="/portal/desk" aria-label="Carbitrage desk"><img src={logo} alt="Carbitrage" className="h-12 w-auto object-contain" /></Link><span className="text-sm font-medium text-muted-foreground">Your trading desk</span></div></header>
    <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[140px_minmax(0,1fr)_minmax(280px,340px)]">
      <nav aria-label="Desk navigation" className="flex gap-2 lg:flex-col"><Button asChild variant="navActive"><Link to="/portal/desk"><LayoutDashboard />Desk</Link></Button><Button asChild variant="nav"><Link to="/listings">Live market<ArrowUpRight /></Link></Button></nav>
      <main className="min-w-0"><h1 className="text-2xl font-semibold">Next cars to buy</h1>
        <div className="my-5 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1" aria-label="Source filters">{([{ key: "all", label: "All" }, { key: "retail", label: "Retail" }, { key: "auction", label: "Auctions" }] as const).map((filter) => <Button key={filter.key} size="sm" variant={channel === filter.key ? "default" : "ghost"} aria-pressed={channel === filter.key} onClick={() => setChannel(filter.key)}>{filter.label}</Button>)}</div><label className="flex items-center gap-2 text-sm"><Checkbox checked={today} onCheckedChange={(value) => setToday(value === true)} />New today</label></div>
        {queue.example ? <ExampleBanner /> : null}
        {queue.loading || !queue.data ? <PanelStatus panel={queue} /> : filtered.length === 0 ? <p className="py-8 text-sm text-muted-foreground">No cars in this view</p> : <ol className="space-y-4">{filtered.map((item) => <CarCard key={item.id} item={item} rank={(queue.data ?? []).indexOf(item) + 1} />)}</ol>}
      </main>
      <aside aria-label="Your DNA" className="min-w-0 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><h2 className="mb-4 text-xl font-semibold">Your DNA</h2>{dna.example ? <ExampleBanner /> : null}{dna.loading || !dna.data ? <PanelStatus panel={dna} /> : <DnaContent data={dna.data} />}</aside>
      <div className="min-w-0 space-y-8 lg:col-span-2 lg:col-start-2"><StockPanel panel={stock} /><AuctionsPanel panel={auctions} /></div>
    </div>
  </div>;
}