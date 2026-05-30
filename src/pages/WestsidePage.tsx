import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink, RefreshCw, Loader2, Car, TrendingDown, Activity, LogOut } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const MIKE_EMAIL = "mike.simmons@westsideauto.com.au";

interface Listing {
  id: string; source_listing_id: string; listing_url: string;
  title: string | null; make: string | null; model: string | null; variant: string | null;
  year: number | null; km: number | null; price: number | null;
  body_type: string | null; stock_no: string | null;
  first_seen_at: string; last_seen_at: string; status: string; gone_at: string | null;
}
interface HistoryEvent {
  id: string; source_listing_id: string; event_type: string;
  prev_price: number | null; new_price: number | null; occurred_at: string;
}
interface Snapshot {
  id: string; received_at: string;
  listings_in: number; new_count: number; price_drop_count: number; gone_count: number; relisted_count: number;
}

const fmtMoney = (n: number | null) => n == null ? "—" : `$${n.toLocaleString()}`;
const fmtKm = (n: number | null) => n == null ? "—" : `${Math.round(n / 1000)}k`;

export default function WestsidePage() {
  const { user, isLoading } = useAuth();
  useEffect(() => { document.title = "Westside Auto | Live stock view"; }, []);

  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [l, e, s] = await Promise.all([
      supabase.from("westside_mike_listings").select("*").order("price", { ascending: false }),
      supabase.from("westside_mike_listing_history").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("westside_mike_snapshots").select("*").order("created_at", { ascending: false }).limit(10),
    ]);
    setListings((l.data as Listing[]) || []);
    setEvents((e.data as HistoryEvent[]) || []);
    setSnapshots((s.data as Snapshot[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);

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
  const lastSnapshot = snapshots[0];

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="max-w-md w-full"><CardContent className="pt-6 space-y-2 text-center">
          <h1 className="text-xl font-bold">Westside Auto</h1>
          <p className="text-sm text-muted-foreground">This is a private view. Please use the sign-in link sent to you.</p>
        </CardContent></Card>
      </div>
    );
  }

  if (user.email?.toLowerCase() !== MIKE_EMAIL) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="max-w-md w-full"><CardContent className="pt-6 space-y-3 text-center">
          <h1 className="text-xl font-bold">Not authorised</h1>
          <p className="text-sm text-muted-foreground">This view is only available to Mike at Westside Auto.</p>
          <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
            <LogOut className="h-3 w-3 mr-1" /> Sign out
          </Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" />
              Westside Auto — Live Stock
            </h1>
            <p className="text-sm text-muted-foreground">Hi Mike — your active inventory, price moves and sold-through tracker. Updated every 6 hours.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            <div className="text-xs text-muted-foreground">Recent price drops</div>
          </CardContent></Card>
        </div>

        {lastSnapshot && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Activity className="h-3 w-3" />
            Last refresh {formatDistanceToNow(new Date(lastSnapshot.received_at), { addSuffix: true })}
          </div>
        )}

        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="drops">Price drops ({priceDropEvents.length})</TabsTrigger>
            <TabsTrigger value="gone">Sold ({gone.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-3">
            <Input placeholder="Search make / model / stock #…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>KM</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead className="hidden md:table-cell">Stock</TableHead>
                    <TableHead className="hidden lg:table-cell">First seen</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filtered.map(l => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{l.year} {l.make} {l.model}</div>
                          {l.variant && <div className="text-xs text-muted-foreground">{l.variant}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtKm(l.km)}</TableCell>
                        <TableCell className="text-sm font-semibold">{fmtMoney(l.price)}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs">{l.stock_no || l.source_listing_id}</TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(l.first_seen_at), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <a href={l.listing_url} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm"><ExternalLink className="h-3 w-3" /></Button>
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No listings match.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="drops">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>Vehicle</TableHead>
                  <TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Delta</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {priceDropEvents.map(ev => {
                    const l = listings.find(x => x.source_listing_id === ev.source_listing_id);
                    return (
                      <TableRow key={ev.id}>
                        <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(ev.occurred_at), { addSuffix: true })}</TableCell>
                        <TableCell className="text-sm">{l ? `${l.year} ${l.make} ${l.model}` : ev.source_listing_id}</TableCell>
                        <TableCell className="text-sm">{fmtMoney(ev.prev_price)}</TableCell>
                        <TableCell className="text-sm font-semibold">{fmtMoney(ev.new_price)}</TableCell>
                        <TableCell className="text-sm text-amber-600 flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />{fmtMoney(((ev.new_price ?? 0) - (ev.prev_price ?? 0)))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {priceDropEvents.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No price drops tracked yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="gone">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Gone</TableHead><TableHead>Vehicle</TableHead>
                  <TableHead>Last price</TableHead><TableHead>KM</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {gone.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">{l.gone_at ? formatDistanceToNow(new Date(l.gone_at), { addSuffix: true }) : "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{l.year} {l.make} {l.model}</div>
                        {l.variant && <div className="text-xs text-muted-foreground">{l.variant}</div>}
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{fmtMoney(l.price)}</TableCell>
                      <TableCell className="text-sm">{fmtKm(l.km)}</TableCell>
                    </TableRow>
                  ))}
                  {gone.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">Nothing marked sold yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        <Badge variant="outline" className="text-[10px]">Read-only view · powered by Carbitrage</Badge>
      </div>
    </div>
  );
}
