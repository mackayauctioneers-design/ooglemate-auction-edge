import { useEffect, useState, useCallback, useMemo } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExternalLink, RefreshCw, Loader2, Eye, Mail, TrendingDown, Car, Activity, ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { MikeReplacementHunt } from "@/components/operator/MikeReplacementHunt";

interface Listing {
  id: string;
  source_listing_id: string;
  listing_url: string;
  title: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
  colour: string | null;
  stock_no: string | null;
  photos: any;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  gone_at: string | null;
  missed_snapshots: number;
}

interface HistoryEvent {
  id: string;
  source_listing_id: string;
  event_type: string;
  prev_price: number | null;
  new_price: number | null;
  prev_km: number | null;
  new_km: number | null;
  occurred_at: string;
  days_on_lot: number | null;
}

interface Snapshot {
  id: string;
  received_at: string;
  listings_in: number;
  new_count: number;
  price_drop_count: number;
  gone_count: number;
  relisted_count: number;
  notes: string | null;
  source: string | null;
}

const MIKE_EMAIL = "mike.simmons@westsideauto.com.au";

function fmtMoney(n: number | null) {
  return n == null ? "—" : `$${n.toLocaleString()}`;
}
function fmtKm(n: number | null) {
  return n == null ? "—" : `${Math.round(n / 1000)}k`;
}

export default function WestsideMikePage() {
  useEffect(() => { document.title = "Mike @ Westside | Operator"; }, []);

  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [l, e, s] = await Promise.all([
      supabase.from("westside_mike_listings").select("*").order("price", { ascending: false }),
      supabase.from("westside_mike_listing_history").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("westside_mike_snapshots").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    setListings((l.data as Listing[]) || []);
    setEvents((e.data as HistoryEvent[]) || []);
    setSnapshots((s.data as Snapshot[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => listings.filter(l => l.status === "ACTIVE"), [listings]);
  const gone = useMemo(() => listings.filter(l => l.status === "GONE"), [listings]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter(l =>
      [l.make, l.model, l.variant, l.title, l.stock_no, l.source_listing_id]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    );
  }, [active, search]);

  const totalValue = active.reduce((s, l) => s + (l.price || 0), 0);
  const avgPrice = active.length ? totalValue / active.length : 0;
  const priceDropEvents = events.filter(e => e.event_type === "PRICE_DROP");
  const goneEvents = events.filter(e => e.event_type === "GONE");
  const lastSnapshot = snapshots[0];

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" />
              Mike @ Westside Auto
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Mail className="h-3 w-3" />
              <span>{MIKE_EMAIL}</span>
              <Badge variant="outline" className="text-[10px]">buyer contact (watch only)</Badge>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              All listings end in $95 — Mike's fingerprint. Arby pushes every 6 hours.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4 pb-3 px-4">
            <div className="text-2xl font-bold">{active.length}</div>
            <div className="text-xs text-muted-foreground">Active listings</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4">
            <div className="text-2xl font-bold">{fmtMoney(Math.round(totalValue))}</div>
            <div className="text-xs text-muted-foreground">Stock value</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4">
            <div className="text-2xl font-bold">{fmtMoney(Math.round(avgPrice))}</div>
            <div className="text-xs text-muted-foreground">Avg price</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4">
            <div className="text-2xl font-bold text-amber-600">{priceDropEvents.length}</div>
            <div className="text-xs text-muted-foreground">Price drops (recent)</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4">
            <div className="text-2xl font-bold text-emerald-600">{goneEvents.length}</div>
            <div className="text-xs text-muted-foreground">Sold → replace</div>
          </CardContent></Card>
        </div>

        {lastSnapshot && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Activity className="h-3 w-3" />
            Last push {formatDistanceToNow(new Date(lastSnapshot.received_at), { addSuffix: true })}
            — in: {lastSnapshot.listings_in}, new: {lastSnapshot.new_count}, drops: {lastSnapshot.price_drop_count}, gone: {lastSnapshot.gone_count}
          </div>
        )}

        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="drops">Price drops ({priceDropEvents.length})</TabsTrigger>
            <TabsTrigger value="gone">Sold / replace ({gone.length})</TabsTrigger>
            <TabsTrigger value="snapshots">Push history</TabsTrigger>
          </TabsList>

          {/* Active */}
          <TabsContent value="active" className="space-y-3">
            <Input
              placeholder="Search make / model / stock #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>KM</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead className="hidden md:table-cell">Body</TableHead>
                      <TableHead className="hidden md:table-cell">Stock</TableHead>
                      <TableHead className="hidden lg:table-cell">First seen</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(l => {
                      const isOpen = expanded.has(l.id);
                      return (
                        <>
                          <TableRow key={l.id} className="cursor-pointer" onClick={() => toggle(l.id)}>
                            <TableCell className="w-8">
                              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-sm">
                                {l.year} {l.make} {l.model}
                              </div>
                              {l.variant && <div className="text-xs text-muted-foreground">{l.variant}</div>}
                            </TableCell>
                            <TableCell className="text-sm">{fmtKm(l.km)}</TableCell>
                            <TableCell className="text-sm font-semibold">{fmtMoney(l.price)}</TableCell>
                            <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{l.body_type || "—"}</TableCell>
                            <TableCell className="hidden md:table-cell text-xs">{l.stock_no || l.source_listing_id}</TableCell>
                            <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(l.first_seen_at), { addSuffix: true })}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => toggle(l.id)} title="Find replacements">
                                  <Crosshair className="h-3 w-3" />
                                </Button>
                                <a href={l.listing_url} target="_blank" rel="noopener noreferrer">
                                  <Button variant="ghost" size="sm">
                                    <ExternalLink className="h-3 w-3" />
                                  </Button>
                                </a>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow key={l.id + "-exp"}>
                              <TableCell colSpan={8} className="p-0">
                                <MikeReplacementHunt
                                  make={l.make}
                                  model={l.model}
                                  year={l.year}
                                  km={l.km}
                                  mikePrice={l.price}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No listings match.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Drops */}
          <TabsContent value="drops">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Delta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceDropEvents.map(ev => {
                    const l = listings.find(x => x.source_listing_id === ev.source_listing_id);
                    return (
                      <TableRow key={ev.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(ev.occurred_at), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm">
                          {l ? `${l.year} ${l.make} ${l.model}` : ev.source_listing_id}
                        </TableCell>
                        <TableCell className="text-sm">{fmtMoney(ev.prev_price)}</TableCell>
                        <TableCell className="text-sm font-semibold">{fmtMoney(ev.new_price)}</TableCell>
                        <TableCell className="text-sm text-amber-600 flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {fmtMoney(((ev.new_price ?? 0) - (ev.prev_price ?? 0)))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {priceDropEvents.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No price drops yet — Arby is still seeding history.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Gone */}
          <TabsContent value="gone">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gone</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Last price</TableHead>
                    <TableHead>KM</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gone.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.gone_at ? formatDistanceToNow(new Date(l.gone_at), { addSuffix: true }) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{l.year} {l.make} {l.model}</div>
                        {l.variant && <div className="text-xs text-muted-foreground">{l.variant}</div>}
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{fmtMoney(l.price)}</TableCell>
                      <TableCell className="text-sm">{fmtKm(l.km)}</TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                          <Eye className="h-3 w-3 mr-1" /> Replace
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {gone.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nothing gone yet. Replacement hunts will appear here.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Snapshots */}
          <TabsContent value="snapshots">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pushed</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>New</TableHead>
                    <TableHead>Drops</TableHead>
                    <TableHead>Gone</TableHead>
                    <TableHead>Relisted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">{formatDistanceToNow(new Date(s.received_at), { addSuffix: true })}</TableCell>
                      <TableCell>{s.listings_in}</TableCell>
                      <TableCell>{s.new_count}</TableCell>
                      <TableCell>{s.price_drop_count}</TableCell>
                      <TableCell>{s.gone_count}</TableCell>
                      <TableCell>{s.relisted_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </OperatorLayout>
  );
}
