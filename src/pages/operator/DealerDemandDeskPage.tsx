import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Search, ExternalLink, Phone, ShoppingCart, Send, X, RefreshCw, Clock, CheckCircle } from "lucide-react";

// ── Types ──

interface DealerDemand {
  id: string;
  dealer_name: string;
  buyer_name: string | null;
  make: string;
  model: string;
  engine: string | null;
  colour: string | null;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  price_max: number | null;
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

// ── Demand Form ──

function DemandForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    dealer_name: "",
    buyer_name: "",
    make: "",
    model: "",
    engine: "",
    colour: "",
    year_min: "",
    year_max: "",
    km_max: "",
    price_max: "",
    urgency: "normal",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

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
          engine: form.engine || null,
          colour: form.colour || null,
          year_min: form.year_min ? parseInt(form.year_min) : null,
          year_max: form.year_max ? parseInt(form.year_max) : null,
          km_max: form.km_max ? parseInt(form.km_max) : null,
          price_max: form.price_max ? parseInt(form.price_max) : null,
          urgency: form.urgency,
          notes: form.notes || null,
        } as any)
        .select()
        .single();

      if (error) throw error;

      toast.success("Demand created — searching now...");

      // Trigger search immediately
      supabase.functions.invoke("check-internal-demand", {
        body: { demand_id: (demand as any).id },
      }).then(({ data }) => {
        if (data?.total > 0) {
          toast.success(`Found ${data.total} matches (${data.internal_matches} internal, ${data.openclaw_matches} OpenClaw)`);
        } else {
          toast.info("No matches found yet — will keep searching");
        }
        onCreated();
      }).catch(() => {
        onCreated();
      });

      setForm({ dealer_name: "", buyer_name: "", make: "", model: "", engine: "", colour: "", year_min: "", year_max: "", km_max: "", price_max: "", urgency: "normal", notes: "" });
    } catch (err: any) {
      toast.error(err.message || "Failed to create demand");
    }
    setSubmitting(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Demand
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Dealer *</Label>
            <Input value={form.dealer_name} onChange={e => setForm(f => ({ ...f, dealer_name: e.target.value }))} placeholder="Westside Wholesale" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Buyer</Label>
            <Input value={form.buyer_name} onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))} placeholder="Mike" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Make *</Label>
            <Input value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} placeholder="Toyota" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Model *</Label>
            <Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="LandCruiser" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Engine</Label>
            <Input value={form.engine} onChange={e => setForm(f => ({ ...f, engine: e.target.value }))} placeholder="4 cylinder" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Colour</Label>
            <Input value={form.colour} onChange={e => setForm(f => ({ ...f, colour: e.target.value }))} placeholder="White" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Year Min</Label>
            <Input type="number" value={form.year_min} onChange={e => setForm(f => ({ ...f, year_min: e.target.value }))} placeholder="2018" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Year Max</Label>
            <Input type="number" value={form.year_max} onChange={e => setForm(f => ({ ...f, year_max: e.target.value }))} placeholder="2024" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">KM Max</Label>
            <Input type="number" value={form.km_max} onChange={e => setForm(f => ({ ...f, km_max: e.target.value }))} placeholder="80000" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Price Max</Label>
            <Input type="number" value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} placeholder="75000" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Urgency</Label>
            <Select value={form.urgency} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">🔥 Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="4WD only, no salvage" className="h-8 text-sm" />
          </div>
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <Button type="submit" disabled={submitting} size="sm">
              <Search className="h-4 w-4 mr-1" />
              {submitting ? "Searching..." : "Create & Search"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Urgency Badge ──

function urgencyBadge(u: string) {
  if (u === "urgent") return <Badge variant="destructive" className="text-xs">🔥 Urgent</Badge>;
  if (u === "high") return <Badge className="bg-amber-600 text-xs">High</Badge>;
  if (u === "low") return <Badge variant="secondary" className="text-xs">Low</Badge>;
  return <Badge variant="outline" className="text-xs">Normal</Badge>;
}

function statusBadge(s: string) {
  if (s === "open") return <Badge variant="outline" className="text-xs border-emerald-500 text-emerald-400">Open</Badge>;
  if (s === "filled") return <Badge className="bg-emerald-600 text-xs">Filled</Badge>;
  if (s === "closed") return <Badge variant="secondary" className="text-xs">Closed</Badge>;
  return <Badge variant="outline" className="text-xs">{s}</Badge>;
}

// ── Main Page ──

export default function DealerDemandDeskPage() {
  const [demands, setDemands] = useState<DealerDemand[]>([]);
  const [opps, setOpps] = useState<DemandOpportunity[]>([]);
  const [selectedDemand, setSelectedDemand] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState<string | null>(null);

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
      toast.success(`Search complete: ${data?.total || 0} matches`);
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
  }

  async function closeDemand(demandId: string) {
    await supabase.from("dealer_demands").update({ status: "closed", updated_at: new Date().toISOString() } as any).eq("id", demandId);
    await loadDemands();
  }

  useEffect(() => { loadDemands(); }, []);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dealer Demand Desk</h1>
        <p className="text-sm text-muted-foreground">Capture dealer requests → auto-search inventory → find matches → close deals</p>
      </div>

      <DemandForm onCreated={loadDemands} />

      {/* Active Demands */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Active Demands</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : demands.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No demands yet. Create one above.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Dealer</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Matches</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {demands.map(d => (
                  <TableRow
                    key={d.id}
                    className={`cursor-pointer ${selectedDemand === d.id ? "bg-primary/10" : ""}`}
                    onClick={() => loadOpps(d.id)}
                  >
                    <TableCell>
                      <div className="font-medium text-sm">{d.dealer_name}</div>
                      {d.buyer_name && <div className="text-xs text-muted-foreground">{d.buyer_name}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{d.make} {d.model}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[d.engine, d.colour, d.year_min && d.year_max ? `${d.year_min}–${d.year_max}` : d.year_min || d.year_max, d.km_max ? `≤${(d.km_max / 1000).toFixed(0)}k km` : ""].filter(Boolean).join(" · ")}
                    </TableCell>
                    <TableCell>{d.price_max ? `$${d.price_max.toLocaleString()}` : "—"}</TableCell>
                    <TableCell>{urgencyBadge(d.urgency)}</TableCell>
                    <TableCell>{statusBadge(d.status)}</TableCell>
                    <TableCell>
                      <span className={d.matches_found > 0 ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                        {d.matches_found}
                      </span>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => reSearch(d.id)} disabled={searching === d.id} className="h-7 px-2">
                          <RefreshCw className={`h-3 w-3 ${searching === d.id ? "animate-spin" : ""}`} />
                        </Button>
                        {d.status === "open" && (
                          <Button variant="ghost" size="sm" onClick={() => closeDemand(d.id)} className="h-7 px-2">
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Opportunity Results */}
      {selectedDemand && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Matches for: {demands.find(d => d.id === selectedDemand)?.make} {demands.find(d => d.id === selectedDemand)?.model}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({demands.find(d => d.id === selectedDemand)?.dealer_name})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {opps.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No matches found. Try re-searching or broadening criteria.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Score</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>KM</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opps.map(o => (
                    <TableRow key={o.id} className={o.score && o.score >= 70 ? "bg-emerald-500/5" : ""}>
                      <TableCell>
                        <span className={`font-bold ${o.score && o.score >= 80 ? "text-emerald-400" : o.score && o.score >= 60 ? "text-foreground" : "text-muted-foreground"}`}>
                          {o.score || 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{o.year || "?"} {o.make} {o.model}</div>
                        {o.colour && <div className="text-xs text-muted-foreground">{o.colour}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{o.km ? `${o.km.toLocaleString()} km` : "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{o.price ? `$${o.price.toLocaleString()}` : "—"}</TableCell>
                      <TableCell className="text-sm">{o.location || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{o.source}</Badge></TableCell>
                      <TableCell><Badge variant={o.status === "sent" ? "default" : "outline"} className="text-xs">{o.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {o.listing_url && (
                            <Button variant="ghost" size="sm" asChild className="h-7 px-2">
                              <a href={o.listing_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" /></a>
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "called")} className="h-7 px-2" title="Mark as called">
                            <Phone className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "sent")} className="h-7 px-2" title="Send to dealer">
                            <Send className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "bought")} className="h-7 px-2 text-emerald-400" title="Mark as bought">
                            <ShoppingCart className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => updateOppStatus(o.id, "ignored")} className="h-7 px-2 text-muted-foreground" title="Ignore">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
