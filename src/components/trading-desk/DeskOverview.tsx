import { ArrowUpRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { useListingStats } from '@/hooks/useListingStats';
import { OogleVal } from '@/portal/desk/OogleVal';
import { safeAdUrl } from '@/portal/desk/data';
import { findsByDay, findsBySource, marketTickerFigures, type DeskFind } from './deskPresentation';

export function MarketTicker({ now }: { now: number }) {
  const { data, isError } = useListingStats();
  const figures = data ? marketTickerFigures(data) : [];
  const minutes = data ? Math.max(0, Math.floor((now - Date.parse(data.last_updated)) / 60000)) : null;
  return <section aria-label="Live market ticker" className="flex min-h-10 min-w-0 items-center gap-5 border-y border-border bg-muted/40 px-3 py-2 text-xs">
    <span className="flex shrink-0 items-center gap-2 font-semibold"><span className={`h-2 w-2 rounded-full ${data ? 'bg-desk-positive animate-pulse motion-reduce:animate-none' : 'bg-muted-foreground'}`} />{data ? 'Live' : 'Market'}</span>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">{figures.map(({label, value}) => <span key={label} className="flex items-center gap-2 text-muted-foreground"><strong className="font-mono font-semibold tabular-nums text-foreground">{value.toLocaleString('en-AU')}</strong>{label}</span>)}{!data ? <span className="text-muted-foreground">{isError ? 'Live figures temporarily unavailable' : 'Connecting to the market…'}</span> : null}</div>
    {minutes !== null ? <span className="shrink-0 text-[10px] text-muted-foreground">Updated {minutes} min ago</span> : null}
  </section>;
}

const tooltipStyle = { background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: 4 };

export function DeskCharts({ rows, now }: { rows: DeskFind[]; now: number }) {
  const daily = findsByDay(rows, new Date(now));
  const sources = findsBySource(rows);
  if (!daily.length && !sources.length) return null;
  return <div className="grid min-w-0 gap-5 sm:grid-cols-2">
    {daily.length ? <section className="min-w-0 border-b border-border pb-3"><div className="mb-3"><h2 className="text-sm font-semibold">New finds by day</h2><p className="mt-1 text-xs text-muted-foreground">Last 7 days · loaded finds</p></div><div className="h-36 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={daily} margin={{ left: -28, right: 4, top: 6, bottom: 0 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} /><Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} /><Bar dataKey="count" name="Finds" fill="hsl(var(--desk-positive))" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section> : null}
    {sources.length ? <section className="min-w-0 border-b border-border pb-3"><div className="mb-3"><h2 className="text-sm font-semibold">Finds by source</h2><p className="mt-1 text-xs text-muted-foreground">Loaded finds · all sources</p></div><div className="h-36 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={sources.slice(0, 6)} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}><XAxis type="number" allowDecimals={false} hide /><YAxis dataKey="source" type="category" width={85} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} /><Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} /><Bar dataKey="count" name="Finds" fill="hsl(var(--desk-information))" radius={[0, 3, 3, 0]} maxBarSize={12} label={{ position: 'right', fill: 'hsl(var(--foreground))', fontSize: 10 }} isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section> : null}
  </div>;
}

export function DeskValuation() {
  return <aside aria-label="Value a car" className="desk-valuation order-first min-w-0 self-start border-border lg:order-last lg:max-h-[420px] lg:overflow-y-auto lg:border-l lg:pl-5 lg:pr-1"><OogleVal requireDetailsState={false} allowExampleFallback={false} renderCar={(item, rank) => {
    const url = safeAdUrl(item.ad_url);
    return <li key={item.id} className="border-b border-border py-2 text-sm"><p className="font-medium">{rank}. {[item.year, item.make, item.model, item.badge].filter(Boolean).join(' ')}</p>{url ? <Button asChild variant="link" size="sm" className="px-0"><a href={url} target="_blank" rel="noopener noreferrer">{item.source}<ArrowUpRight /></a></Button> : null}</li>;
  }} /></aside>;
}