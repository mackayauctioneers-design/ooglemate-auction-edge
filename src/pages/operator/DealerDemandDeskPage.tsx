import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Search, ExternalLink, Send, X, RefreshCw, CheckCircle, MapPin, Gauge, DollarSign, Car, Flame, ChevronDown, ChevronRight, ShoppingCart, Wrench, SlidersHorizontal } from "lucide-react";

// ── Types ──

interface DealerDemand {
  id: string;
  dealer_name: string;
  buyer_name: string | null;
  make: string;
  model: string;
  series: string | null;
  body_type: string | null;
  variant: string | null;
  engine: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  colour: string | null;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  price_max: number | null;
  keywords: string | null;
  auction_only: boolean;
  dealer_only: boolean;
  ex_fleet_allowed: boolean;
  urgency: string;
  notes: string | null;
  status: string;
  matches_found: number;
  last_searched_at: string | null;
  created_at: string;
}

interface DemandOpportunity {
  id: string;
  demand_id: string;
  source: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  colour: string | null;
  location: string | null;
  listing_url: string | null;
  score: number | null;
  margin_estimate: number | null;
  status: string;
  created_at: string;
}

// ── Section Header ──

function SectionHeader({ icon: Icon, title, open, onToggle }: { icon: any; title: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-2 w-full text-left py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      <Icon className="h-3.5 w-3.5 text-primary" />
      {title}
    </button>
  );
}

// ── Demand Form ──

function DemandForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    dealer_name: "", buyer_name: "", make: "", model: "",
    series: "", body_type: "", variant: "",
    engine: "", fuel: "", transmission: "", drivetrain: "",
    colour: "", year_min: "", year_max: "", km_max: "", price_max: "",
    keywords: "", urgency: "normal", notes: "",
    auction_only: false, dealer_only: false, ex_fleet_allowed: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [mechOpen, setMechOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.dealer_name || !form.make || !form.model) {
      toast.error("Dealer, Make, and Model are required");
      return;
    }
    setSubmitting(true);
    try {
      const { data: demand, error } = await supabase
        .from("dealer_demands")
        .insert({
          dealer_name: form.dealer_name,
          buyer_name: form.buyer_name || null,
          make: form.make,
          model: form.model,
          series: form.series || null,
          body_type: form.body_type || null,
          variant: form.variant || null,
          engine: form.engine || null,
          fuel: form.fuel || null,
          transmission: form.transmission || null,
          drivetrain: form.drivetrain || null,
          colour: form.colour || null,
          year_min: form.year_min ? parseInt(form.year_min) : null,
          year_max: form.year_max ? parseInt(form.year_max) : null,
          km_max: form.km_max ? parseInt(form.km_max) : null,
          price_max: form.price_max ? parseInt(form.price_max) : null,
          keywords: form.keywords || null,
          urgency: form.urgency,
          notes: form.notes || null,
          auction_only: form.auction_only,
          dealer_only: form.dealer_only,
          ex_fleet_allowed: form.ex_fleet_allowed,
        } as any)
        .select()
        .single();

      if (error) throw error;
      toast.success("Demand created — searching...");

      supabase.functions.invoke("check-internal-demand", {
        body: { demand_id: (demand as any).id },
      }).then(({ data }) => {
        if (data?.total > 0) {
          toast.success(`Found ${data.total} matches (${data.internal_auction || 0} auction, ${data.internal_matches} internal${data.outward_matches ? `, ${data.outward_matches} outward` : ""})`);
        } else {
          toast.info("No matches yet — outward search dispatched");
        }
        onCreated();
      }).catch(() => onCreated());

      setForm({
        dealer_name: "", buyer_name: "", make: "", model: "",
        series: "", body_type: "", variant: "",
        engine: "", fuel: "", transmission: "", drivetrain: "",
        colour: "", year_min: "", year_max: "", km_max: "", price_max: "",
        keywords: "", urgency: "normal", notes: "",
        auction_only: false, dealer_only: false, ex_fleet_allowed: true,
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to create demand");
    }
    setSubmitting(false);
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" /> New Demand
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Dealer + Buyer */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Dealer *</Label>
              <Input value={form.dealer_name} onChange={e => set("dealer_name", e.target.value)} placeholder="Westside Wholesale" className="h-9" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Buyer</Label>
              <Input value={form.buyer_name} onChange={e => set("buyer_name", e.target.value)} placeholder="Mike" className="h-9" />
            </div>
          </div>

          {/* ═══ Section 1: Vehicle Identity (always open) ═══ */}
          <div className="border border-border/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground pb-1">
              <Car className="h-3.5 w-3.5 text-primary" /> Vehicle Identity
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Make *</Label>
                <Input value={form.make} onChange={e => set("make", e.target.value)} placeholder="Toyota" className="h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Model *</Label>
                <Input value={form.model} onChange={e => set("model", e.target.value)} placeholder="LandCruiser" className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Series</Label>
                <Input value={form.series} onChange={e => set("series", e.target.value)} placeholder="79 / 300 / Prado" className="h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Body Type</Label>
                <Select value={form.body_type} onValueChange={v => set("body_type", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="dual_cab">Dual Cab</SelectItem>
                    <SelectItem value="single_cab">Single Cab</SelectItem>
                    <SelectItem value="cab_chassis">Cab Chassis</SelectItem>
                    <SelectItem value="wagon">Wagon</SelectItem>
                    <SelectItem value="ute">Ute</SelectItem>
                    <SelectItem value="suv">SUV</SelectItem>
                    <SelectItem value="sedan">Sedan</SelectItem>
                    <SelectItem value="hatch">Hatch</SelectItem>
                    <SelectItem value="van">Van</SelectItem>
                    <SelectItem value="coupe">Coupe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Variant / Badge</Label>
                <Input value={form.variant} onChange={e => set("variant", e.target.value)} placeholder="GXL / SR5 / VX" className="h-9" />
              </div>
            </div>
          </div>

          {/* ═══ Section 2: Mechanical Spec (collapsible) ═══ */}
          <div className="border border-border/50 rounded-lg p-3 space-y-2">
            <SectionHeader icon={Wrench} title="Mechanical Spec" open={mechOpen} onToggle={() => setMechOpen(!mechOpen)} />
            {mechOpen && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Fuel</Label>
                  <Select value={form.fuel} onValueChange={v => set("fuel", v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="diesel">Diesel</SelectItem>
                      <SelectItem value="petrol">Petrol</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                      <SelectItem value="electric">Electric</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Engine</Label>
                  <Input value={form.engine} onChange={e => set("engine", e.target.value)} placeholder="2.8L 4cyl" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Transmission</Label>
                  <Select value={form.transmission} onValueChange={v => set("transmission", v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="automatic">Automatic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Drivetrain</Label>
                  <Select value={form.drivetrain} onValueChange={v => set("drivetrain", v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      <SelectItem value="4x4">4x4</SelectItem>
                      <SelectItem value="4x2">4x2</SelectItem>
                      <SelectItem value="awd">AWD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* ═══ Section 3: Price / KM / Filters (collapsible) ═══ */}
          <div className="border border-border/50 rounded-lg p-3 space-y-2">
            <SectionHeader icon={SlidersHorizontal} title="Price / KM / Filters" open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
            {filtersOpen && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Colour</Label>
                    <Input value={form.colour} onChange={e => set("colour", e.target.value)} placeholder="White" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">KM Max</Label>
                    <Input type="number" value={form.km_max} onChange={e => set("km_max", e.target.value)} placeholder="40000" className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Year Min</Label>
                    <Input type="number" value={form.year_min} onChange={e => set("year_min", e.target.value)} placeholder="2021" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Year Max</Label>
                    <Input type="number" value={form.year_max} onChange={e => set("year_max", e.target.value)} placeholder="2024" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Price Max</Label>
                    <Input type="number" value={form.price_max} onChange={e => set("price_max", e.target.value)} placeholder="78000" className="h-9" />
                  </div>
                </div>

                {/* Source preferences */}
                <div className="flex flex-wrap gap-4 pt-1">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.auction_only} onCheckedChange={v => set("auction_only", v)} />
                    <Label className="text-xs">Auction only</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.dealer_only} onCheckedChange={v => set("dealer_only", v)} />
                    <Label className="text-xs">Dealer only</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.ex_fleet_allowed} onCheckedChange={v => set("ex_fleet_allowed", v)} />
                    <Label className="text-xs">Ex-fleet OK</Label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Urgency</Label>
                    <Select value={form.urgency} onValueChange={v => set("urgency", v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">🔥 Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Keywords</Label>
                    <Input value={form.keywords} onChange={e => set("keywords", e.target.value)} placeholder="79 series white tray" className="h-9" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <Input value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="4WD only, no salvage, Norweld preferred" className="h-9" />
                </div>
              </div>
            )}
          </div>

          <Button type="submit" disabled={submitting} className="w-full h-10">
            <Search className="h-4 w-4 mr-2" />
            {submitting ? "Searching auction → dealer → classifieds…" : "Create & Search"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Badges ──

function urgencyBadge(u: string) {
  if (u === "urgent") return <Badge variant="destructive" className="text-xs"><Flame className="h-3 w-3 mr-0.5" />Urgent</Badge>;
  if (u === "high") return <Badge className="bg-amber-600 text-xs">High</Badge>;
  if (u === "low") return <Badge variant="secondary" className="text-xs">Low</Badge>;
  return <Badge variant="outline" className="text-xs">Normal</Badge>;
}

function sourceBadge(s: string) {
  const AUCTION = new Set(["pickles", "manheim", "grays", "slattery", "f3", "auto_auctions", "auto_auctions_aav", "uaa_nsw", "vma", "bidsonline"]);
  const isAuction = AUCTION.has(s.toLowerCase());
  if (isAuction) return <Badge className="bg-amber-500/20 text-amber-400 text-xs">🔨 {s}</Badge>;

  const colors: Record<string, string> = {
    internal: "bg-primary/20 text-primary",
    outward_search: "bg-blue-500/20 text-blue-400",
    openclaw: "bg-purple-500/20 text-purple-400",
    dealer_site: "bg-emerald-500/20 text-emerald-400",
  };
  return <Badge variant="outline" className={`text-xs ${colors[s] || ""}`}>{s}</Badge>;
}

// ── Opportunity Card (mobile-first) ──

function OpportunityCard({ opp, onAction }: { opp: DemandOpportunity; onAction: (id: string, status: string) => void }) {
  return (
    <Card className={`${opp.score && opp.score >= 70 ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="font-bold text-sm">
              {opp.year || "?"} {opp.make} {opp.model}
            </div>
            {opp.colour && <span className="text-xs text-muted-foreground">{opp.colour}</span>}
          </div>
          <div className="text-right">
            <div className={`text-lg font-bold ${opp.score && opp.score >= 80 ? "text-emerald-400" : opp.score && opp.score >= 60 ? "text-foreground" : "text-muted-foreground"}`}>
              {opp.score || 0}
            </div>
            <div className="text-xs text-muted-foreground">score</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Gauge className="h-3 w-3" />
            {opp.km ? `${opp.km.toLocaleString()} km` : "—"}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <DollarSign className="h-3 w-3" />
            {opp.price ? `$${opp.price.toLocaleString()}` : "—"}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {opp.location || "—"}
          </div>
          {opp.margin_estimate && opp.margin_estimate > 0 ? (
            <div className="flex items-center gap-1 font-semibold text-emerald-400">
              <DollarSign className="h-3 w-3" />
              ~${opp.margin_estimate.toLocaleString()} margin
            </div>
          ) : (
            <div className="text-muted-foreground">—</div>
          )}
        </div>

        <div className="flex items-center justify-between">
          {sourceBadge(opp.source)}
          <div className="flex gap-1">
            {opp.listing_url && (
              <Button variant="outline" size="sm" asChild className="h-7 px-2 text-xs">
                <a href={opp.listing_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" /> View
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onAction(opp.id, "sent")} className="h-7 px-2 text-xs">
              <Send className="h-3 w-3 mr-1" /> Send
            </Button>
            <Button variant="default" size="sm" onClick={() => onAction(opp.id, "bought")} className="h-7 px-2 text-xs">
              <ShoppingCart className="h-3 w-3 mr-1" /> Buy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onAction(opp.id, "ignored")} className="h-7 px-1 text-xs text-muted-foreground">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──

export default function DealerDemandDeskPage() {
  const [demands, setDemands] = useState<DealerDemand[]>([]);
  const [opps, setOpps] = useState<DemandOpportunity[]>([]);
  const [selectedDemand, setSelectedDemand] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "table">("cards");

  async function loadDemands() {
    const { data } = await supabase
      .from("dealer_demands")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setDemands((data || []) as unknown as DealerDemand[]);
    setLoading(false);
  }

  async function loadOpps(demandId: string) {
    setSelectedDemand(demandId);
    const { data } = await supabase
      .from("demand_opportunities")
      .select("*")
      .eq("demand_id", demandId)
      .neq("status", "ignored")
      .order("score", { ascending: false })
      .limit(100);
    setOpps((data || []) as unknown as DemandOpportunity[]);
  }

  async function reSearch(demandId: string) {
    setSearching(demandId);
    try {
      const { data } = await supabase.functions.invoke("check-internal-demand", {
        body: { demand_id: demandId },
      });
      toast.success(`Search complete: ${data?.total || 0} matches (${data?.internal_auction || 0} auction)`);
      await loadDemands();
      if (selectedDemand === demandId) await loadOpps(demandId);
    } catch {
      toast.error("Search failed");
    }
    setSearching(null);
  }

  async function updateOppStatus(oppId: string, status: string) {
    await supabase.from("demand_opportunities").update({ status } as any).eq("id", oppId);
    if (selectedDemand) await loadOpps(selectedDemand);
    if (status === "bought") toast.success("Marked as bought ✓");
    if (status === "sent") toast.success("Sent to dealer ✓");
  }

  async function closeDemand(demandId: string) {
    await supabase.from("dealer_demands").update({ status: "closed", updated_at: new Date().toISOString() } as any).eq("id", demandId);
    await loadDemands();
    toast.success("Demand closed");
  }

  useEffect(() => { loadDemands(); }, []);

  const selectedDemandObj = demands.find(d => d.id === selectedDemand);

  // Build spec summary for demand table
  function specSummary(d: DealerDemand) {
    const parts = [
      d.series,
      d.body_type?.replace("_", " "),
      d.variant,
      d.fuel,
      d.transmission,
      d.engine,
      d.colour,
      d.km_max ? `≤${Math.round(d.km_max / 1000)}k km` : "",
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "—";
  }

  return (
    <div className="p-3 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" /> Dealer Demand Desk
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">Auction-first sourcing — enter demand → auto-search auction → dealer → classifieds</p>
        </div>
      </div>

      {/* Demand Form */}
      <DemandForm onCreated={loadDemands} />

      {/* Demands List */}
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <CardTitle className="text-base">Active Demands ({demands.filter(d => d.status === "open").length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : demands.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No demands yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 text-xs">
                    <TableHead className="py-2">Dealer</TableHead>
                    <TableHead className="py-2">Vehicle</TableHead>
                    <TableHead className="py-2 hidden md:table-cell">Spec</TableHead>
                    <TableHead className="py-2 hidden md:table-cell">Budget</TableHead>
                    <TableHead className="py-2">Urgency</TableHead>
                    <TableHead className="py-2">Matches</TableHead>
                    <TableHead className="py-2 w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demands.map(d => (
                    <TableRow
                      key={d.id}
                      className={`cursor-pointer text-xs ${selectedDemand === d.id ? "bg-primary/10" : ""} ${d.status !== "open" ? "opacity-50" : ""}`}
                      onClick={() => loadOpps(d.id)}
                    >
                      <TableCell className="py-2">
                        <div className="font-medium">{d.dealer_name}</div>
                        {d.buyer_name && <div className="text-muted-foreground">{d.buyer_name}</div>}
                      </TableCell>
                      <TableCell className="py-2 font-mono">
                        {d.make} {d.model}
                        {d.series ? ` ${d.series}` : ""}
                        {d.variant ? ` ${d.variant}` : ""}
                        {d.auction_only && <Badge variant="outline" className="ml-1 text-[10px] text-amber-400 border-amber-400/30">🔨</Badge>}
                      </TableCell>
                      <TableCell className="py-2 hidden md:table-cell text-muted-foreground">
                        {specSummary(d)}
                      </TableCell>
                      <TableCell className="py-2 hidden md:table-cell">
                        {d.price_max ? `$${d.price_max.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="py-2">{urgencyBadge(d.urgency)}</TableCell>
                      <TableCell className="py-2">
                        <span className={d.matches_found > 0 ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                          {d.matches_found}
                        </span>
                      </TableCell>
                      <TableCell className="py-2" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => reSearch(d.id)} disabled={searching === d.id} className="h-6 w-6 p-0">
                            <RefreshCw className={`h-3 w-3 ${searching === d.id ? "animate-spin" : ""}`} />
                          </Button>
                          {d.status === "open" && (
                            <Button variant="ghost" size="sm" onClick={() => closeDemand(d.id)} className="h-6 w-6 p-0">
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Opportunities */}
      {selectedDemand && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold">
              {selectedDemandObj?.make} {selectedDemandObj?.model}
              {selectedDemandObj?.series ? ` ${selectedDemandObj.series}` : ""}
              {selectedDemandObj?.variant ? ` ${selectedDemandObj.variant}` : ""}
              <span className="font-normal text-muted-foreground ml-2 text-sm">
                — {selectedDemandObj?.dealer_name}
                {selectedDemandObj?.buyer_name ? ` (${selectedDemandObj.buyer_name})` : ""}
              </span>
            </h2>
            <div className="flex gap-1">
              <Button variant={view === "cards" ? "default" : "outline"} size="sm" onClick={() => setView("cards")} className="h-7 text-xs">Cards</Button>
              <Button variant={view === "table" ? "default" : "outline"} size="sm" onClick={() => setView("table")} className="h-7 text-xs">Table</Button>
            </div>
          </div>

          {opps.length === 0 ? (
            <Card><CardContent className="text-center py-8 text-muted-foreground">No matches found. Try re-searching or broadening criteria.</CardContent></Card>
          ) : view === "cards" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {opps.map(o => (
                <OpportunityCard key={o.id} opp={o} onAction={updateOppStatus} />
              ))}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 text-xs">
                    <TableHead className="py-2">Score</TableHead>
                    <TableHead className="py-2">Vehicle</TableHead>
                    <TableHead className="py-2">KM</TableHead>
                    <TableHead className="py-2">Price</TableHead>
                    <TableHead className="py-2">Location</TableHead>
                    <TableHead className="py-2">Margin</TableHead>
                    <TableHead className="py-2">Source</TableHead>
                    <TableHead className="py-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opps.map(o => (
                    <TableRow key={o.id} className="text-xs">
                      <TableCell className={`py-2 font-bold ${o.score && o.score >= 80 ? "text-emerald-400" : ""}`}>{o.score || 0}</TableCell>
                      <TableCell className="py-2">{o.year || "?"} {o.make} {o.model}</TableCell>
                      <TableCell className="py-2">{o.km ? o.km.toLocaleString() : "—"}</TableCell>
                      <TableCell className="py-2 font-mono">{o.price ? `$${o.price.toLocaleString()}` : "—"}</TableCell>
                      <TableCell className="py-2">{o.location || "—"}</TableCell>
                      <TableCell className="py-2 font-mono text-emerald-400">{o.margin_estimate ? `~$${o.margin_estimate.toLocaleString()}` : "—"}</TableCell>
                      <TableCell className="py-2">{sourceBadge(o.source)}</TableCell>
                      <TableCell className="py-2">
                        <div className="flex gap-1">
                          {o.listing_url && (
                            <Button variant="ghost" size="sm" asChild className="h-6 w-6 p-0">
                              <a href={o.listing_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" /></a>
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "sent")} className="h-6 w-6 p-0"><Send className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "bought")} className="h-6 w-6 p-0 text-emerald-400"><ShoppingCart className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "ignored")} className="h-6 w-6 p-0 text-muted-foreground"><X className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
