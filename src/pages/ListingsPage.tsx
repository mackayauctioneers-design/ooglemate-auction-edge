import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, Check, Gavel, Store, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import carbitrageLogo from "@/assets/carbitrage-logo.jpg";
import { useListingStats } from "@/hooks/useListingStats";

const number = new Intl.NumberFormat("en-AU");
const states = ["VIC", "NSW", "WA", "QLD", "SA", "TAS", "ACT", "NT"];

export default function ListingsPage() {
  const { data, isPending, isError } = useListingStats();
  const [animatedCount, setAnimatedCount] = useState(0);
  const [, setClock] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Live market | Carbitrage";
    const interval = window.setInterval(() => setClock((tick) => tick + 1), 60000);
    return () => { document.title = previousTitle; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!data) return;
    const target = data.total_live_listings;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedCount(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 1100, 1);
      setAnimatedCount(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [data?.total_live_listings]);

  const source = data?.by_source;
  const sources = source ? [
    ["Carsales", source.carsales], ["Dealer websites", source.dealer_sites],
    ["Autotrader", source.autotrader], ["Gumtree (dealer)", source.gumtree_dealer],
    ["Other portals", source.other_portals], ["Pickles", source.auctions.pickles],
    ["Grays", source.auctions.grays], ["United", source.auctions.united_auctions],
    ["Slattery", source.auctions.slattery], ["Auto Auctions", source.auctions.auto_auctions],
    ["Manheim", source.auctions.manheim],
  ].filter((row): row is [string, number] => typeof row[1] === "number" && row[1] > 0) : [];
  const sourceMax = Math.max(1, ...sources.map((row) => row[1]));
  const makes = [...(data?.top_makes ?? [])].sort((a, b) => b.count - a.count).slice(0, 20);
  const makeMax = Math.max(1, ...makes.map((row) => row.count));
  const updated = data ? new Date(data.last_updated) : null;

  return (
    <div className="dark live-market min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <nav aria-label="Main navigation" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="Carbitrage home">
            <img src={carbitrageLogo} alt="" className="h-10 w-12 rounded-sm object-cover" />
            <span className="text-xl font-semibold">Carbitrage<span className="text-primary">.</span></span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-4">
            <Button asChild variant="ghost" size="sm"><Link to="/listings" aria-current="page">Live market</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/portal/login">Sign in</Link></Button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section className="border-b border-border pb-8 pt-9 sm:pb-12 sm:pt-14">
          <div className="mb-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="uppercase">Australian market / live overview</span>
            {data && !isError && <span className="flex items-center gap-2 text-primary"><span className="h-2 w-2 rounded-full bg-primary motion-safe:animate-pulse" />Live</span>}
          </div>
          {isPending ? <Skeleton className="mb-4 h-24 w-64 max-w-full" /> : isError || !data ? (
            <p role="alert" className="py-8 text-xl">Live figures temporarily unavailable</p>
          ) : <div className="font-mono text-[64px] font-semibold leading-none tabular-nums sm:text-[88px]" aria-label={`${number.format(data.total_live_listings)} live listings`}><span aria-hidden="true">{number.format(animatedCount)}</span></div>}
          <h1 className="mt-4 max-w-xl text-2xl font-medium leading-tight sm:text-4xl">live car listings,<br className="sm:hidden" /> tracked every day</h1>
          {data && !isError && <>
            <p className="mt-4 text-base text-primary"><span className="font-mono font-semibold">+{number.format(data.added_last_24h)}</span> new in the last 24 hours</p>
            <p className="mt-3 text-xs text-muted-foreground">Updated {updated && formatDistanceToNow(updated, { addSuffix: true })} · Sydney time{updated && <span className="ml-1">({new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }).format(updated)})</span>}</p>
          </>}
        </section>

        {isPending ? <div aria-label="Loading live figures" aria-busy="true" className="grid gap-4 py-6 sm:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-32" />)}<Skeleton className="h-80 sm:col-span-3" /></div> : data && !isError ? <>
          <section aria-label="Market totals" className="grid gap-3 py-6 sm:grid-cols-3 sm:gap-4 sm:py-8">
            {[
              { label: "Dealer ads", value: data.retail_dealer_listings, icon: Store, caption: "Retail dealer listings" },
              { label: "Open auction lots", value: data.auction_lots_open, icon: Gavel, caption: "Across Australian auction houses" },
              { label: "Wholesale price points", value: data.wholesale_price_points.total, icon: TrendingUp, caption: `plus ${number.format(data.wholesale_price_points.auction_bid_observations)} auction bids tracked` },
            ].map((stat) => <div key={stat.label} className="rounded-md border border-border bg-card p-5"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{stat.label}</span><stat.icon className="h-4 w-4 text-primary" /></div><p className="mt-3 font-mono text-3xl font-semibold tabular-nums">{number.format(stat.value)}</p><p className="mt-2 text-xs text-muted-foreground">{stat.caption}</p></div>)}
          </section>

          <section className="grid gap-9 border-b border-border pb-9 sm:grid-cols-[1.6fr_1fr] sm:gap-14 sm:pb-12">
            <div><h2 className="mb-6 text-lg font-semibold">Where it comes from</h2><div className="space-y-4">{sources.map(([label, value]) => <div key={label}><div className="mb-2 flex justify-between gap-3 text-sm"><span>{label}</span><span className="font-mono tabular-nums">{number.format(value)}</span></div><div className="h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary" style={{ width: `${value / sourceMax * 100}%` }} /></div></div>)}</div></div>
            <div><h2 className="mb-6 text-lg font-semibold">By state</h2><div className="grid grid-cols-2 gap-x-6 sm:grid-cols-1">{states.map((state) => <div key={state} className="flex justify-between gap-2 border-b border-border py-3 text-sm"><span className="text-muted-foreground">{state}</span><span className="font-mono tabular-nums">{data.by_state[state] == null ? "—" : number.format(data.by_state[state])}</span></div>)}</div></div>
          </section>

          <section className="border-b border-border py-9 sm:py-12"><h2 className="mb-6 text-lg font-semibold">Top makes</h2><ol className="grid gap-x-12 gap-y-4 sm:grid-cols-2">{makes.map((row, index) => <li key={row.make} className="grid grid-cols-[1.5rem_1fr] gap-3"><span className="pt-0.5 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><div><div className="mb-2 flex justify-between gap-2 text-sm"><span>{row.make}</span><span className="font-mono tabular-nums">{number.format(row.count)}</span></div><div className="h-1 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-market-secondary" style={{ width: `${row.count / makeMax * 100}%` }} /></div></div></li>)}</ol></section>

          <section className="flex flex-wrap items-end justify-between gap-4 border-b border-border py-9 sm:py-12"><div><h2 className="mb-3 text-sm text-muted-foreground">Late-model focus</h2><p className="text-2xl font-medium sm:text-3xl"><span className="font-mono text-primary">{data.total_live_listings > 0 ? `${Math.round(data.by_year_band["2020_plus"] / data.total_live_listings * 100)}%` : "—"}</span> are 2020 or newer</p></div><p className="font-mono text-xs text-muted-foreground">{number.format(data.by_year_band["2020_plus"])} late-model listings</p></section>
        </> : null}

        <section className="py-10 sm:py-12"><h2 className="text-xl font-semibold">Why dealers are switching</h2><ul className="my-6 space-y-4">{["Real dealer and auction prices, not estimates", "Live floor price on any rego in under a minute", "Built by dealers, for dealers"].map((point) => <li key={point} className="flex items-start gap-3 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{point}</li>)}</ul><Button asChild size="lg"><Link to="/valo">Get a valuation<ArrowUpRight /></Link></Button></section>
      </main>
      <footer className="border-t border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-xs text-muted-foreground sm:px-8"><span className="font-semibold text-foreground">Carbitrage.</span><p className="max-w-lg">Counts are live, deduplicated across sources (each car counted once). Private sellers excluded.</p></div></footer>
    </div>
  );
}