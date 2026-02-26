import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { RefreshCw, Plus, ExternalLink, TrendingDown, Sparkles, Clock, Filter, ArrowUpDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

type FeedItem = {
  id: string;
  mandate_id: string;
  source: string;
  listing_id: string;
  source_url: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_price: number | null;
  price_changed_at: string | null;
  price_delta: number | null;
  score: number | null;
  expected_margin: number | null;
  under_buy: number | null;
  anchor_context: any;
  created_at: string;
};

type Mandate = {
  id: string;
  name: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  price_max: number | null;
  priority: string;
  run_frequency_minutes: number;
  source_mask: string[];
  last_run_at: string | null;
  next_run_at: string | null;
  is_active: boolean;
};

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useMandates() {
  return useQuery({
    queryKey: ["mandates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("active_mandates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Mandate[];
    },
  });
}

function useFeedItems(mandateId: string | null, sourceFilter: string | null) {
  return useQuery({
    queryKey: ["mandate-feed", mandateId, sourceFilter],
    queryFn: async () => {
      let q = supabase
        .from("mandate_feed_items")
        .select("*")
        .order("expected_margin", { ascending: false, nullsFirst: false })
        .order("score", { ascending: false, nullsFirst: false })
        .order("first_seen_at", { ascending: false })
        .limit(500);

      if (mandateId && mandateId !== "all") {
        q = q.eq("mandate_id", mandateId);
      }
      if (sourceFilter && sourceFilter !== "all") {
        q = q.eq("source", sourceFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as FeedItem[];
    },
    refetchInterval: 60_000,
  });
}

// ─── Components ──────────────────────────────────────────────────────────────

function CreateMandateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    make: "",
    model: "",
    variant_family: "",
    year_min: "",
    year_max: "",
    km_max: "",
    price_max: "",
    priority: "med",
    run_frequency_minutes: "240",
    source_mask: ["pickles", "toyota"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("active_mandates").insert({
        name: form.name || `${form.make} ${form.model}`.trim(),
        make: form.make.toUpperCase(),
        model: form.model.toUpperCase(),
        variant_family: form.variant_family || null,
        year_min: form.year_min ? parseInt(form.year_min) : null,
        year_max: form.year_max ? parseInt(form.year_max) : null,
        km_max: form.km_max ? parseInt(form.km_max) : null,
        price_max: form.price_max ? parseInt(form.price_max) : null,
        priority: form.priority,
        run_frequency_minutes: parseInt(form.run_frequency_minutes),
        source_mask: form.source_mask,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mandate created");
      setOpen(false);
      onCreated();
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Mandate</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Mandate</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Make</Label>
              <Input placeholder="TOYOTA" value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} />
            </div>
            <div>
              <Label>Model</Label>
              <Input placeholder="HIACE" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Name (optional)</Label>
            <Input placeholder="HiAce Commuter <20k <$80k" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Year Min</Label>
              <Input type="number" placeholder="2018" value={form.year_min} onChange={e => setForm(f => ({ ...f, year_min: e.target.value }))} />
            </div>
            <div>
              <Label>Year Max</Label>
              <Input type="number" placeholder="2024" value={form.year_max} onChange={e => setForm(f => ({ ...f, year_max: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>KM Max</Label>
              <Input type="number" placeholder="200000" value={form.km_max} onChange={e => setForm(f => ({ ...f, km_max: e.target.value }))} />
            </div>
            <div>
              <Label>Price Max</Label>
              <Input type="number" placeholder="80000" value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="med">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequency</Label>
              <Select value={form.run_frequency_minutes} onValueChange={v => setForm(f => ({ ...f, run_frequency_minutes: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">Every 15m</SelectItem>
                  <SelectItem value="60">Hourly</SelectItem>
                  <SelectItem value="240">Every 4h</SelectItem>
                  <SelectItem value="720">Every 12h</SelectItem>
                  <SelectItem value="1440">Daily</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!form.make || !form.model || createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Mandate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const priceDropped = item.price_delta && item.price_delta < 0;
  const isNew = item.first_seen_at && (Date.now() - new Date(item.first_seen_at).getTime()) < 24 * 60 * 60 * 1000;

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">
                {item.year} {item.make} {item.model}
              </span>
              {item.variant && (
                <Badge variant="outline" className="text-xs">{item.variant}</Badge>
              )}
              {isNew && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                  <Sparkles className="h-3 w-3 mr-0.5" /> NEW
                </Badge>
              )}
              {priceDropped && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                  <TrendingDown className="h-3 w-3 mr-0.5" /> ${Math.abs(item.price_delta!).toLocaleString()}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{item.km ? `${(item.km / 1000).toFixed(0)}k km` : "—"}</span>
              <span>{item.location || "—"}</span>
              <Badge variant="secondary" className="text-xs">{item.source}</Badge>
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(item.first_seen_at), { addSuffix: true })}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold text-lg">
              {item.asking_price ? `$${item.asking_price.toLocaleString()}` : "No price"}
            </div>
            {item.expected_margin != null && (
              <div className={`text-xs font-medium ${item.expected_margin > 0 ? "text-green-400" : "text-red-400"}`}>
                margin: ${item.expected_margin.toLocaleString()}
              </div>
            )}
            {item.score != null && (
              <div className="text-xs text-muted-foreground">score: {item.score}</div>
            )}
          </div>
        </div>
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
          >
            View listing <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MandateFeedPage() {
  const qc = useQueryClient();
  const [mandateFilter, setMandateFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showNewOnly, setShowNewOnly] = useState(false);
  const [showPriceDrops, setShowPriceDrops] = useState(false);

  const { data: mandates, isLoading: mandatesLoading } = useMandates();
  const { data: feedItems, isLoading: feedLoading, refetch: refetchFeed } = useFeedItems(
    mandateFilter,
    sourceFilter,
  );

  const triggerRun = useMutation({
    mutationFn: async () => {
      const resp = await supabase.functions.invoke("run-mandates");
      if (resp.error) throw resp.error;
      return resp.data;
    },
    onSuccess: (d) => {
      toast.success(`Mandates executed: ${d.mandates_executed}, listings: ${d.listings_upserted}`);
      refetchFeed();
    },
    onError: (e) => toast.error(`Run failed: ${e.message}`),
  });

  const filteredItems = useMemo(() => {
    if (!feedItems) return [];
    let items = feedItems;
    if (showNewOnly) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      items = items.filter(i => new Date(i.first_seen_at).getTime() > cutoff);
    }
    if (showPriceDrops) {
      items = items.filter(i => i.price_delta && i.price_delta < 0);
    }
    return items;
  }, [feedItems, showNewOnly, showPriceDrops]);

  const activeMandateCount = mandates?.filter(m => m.is_active).length ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mandate Feed</h1>
          <p className="text-sm text-muted-foreground">
            {activeMandateCount} active mandate{activeMandateCount !== 1 ? "s" : ""} · {filteredItems.length} listings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateMandateDialog onCreated={() => qc.invalidateQueries({ queryKey: ["mandates"] })} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerRun.mutate()}
            disabled={triggerRun.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${triggerRun.isPending ? "animate-spin" : ""}`} />
            Run Now
          </Button>
        </div>
      </div>

      {/* Active Mandates Summary */}
      {mandates && mandates.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          {mandates.filter(m => m.is_active).map(m => (
            <Badge
              key={m.id}
              variant={mandateFilter === m.id ? "default" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setMandateFilter(mandateFilter === m.id ? "all" : m.id)}
            >
              {m.name}
              {m.last_run_at && (
                <span className="ml-1 opacity-60">
                  · {formatDistanceToNow(new Date(m.last_run_at), { addSuffix: true })}
                </span>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="pickles">Pickles</SelectItem>
            <SelectItem value="toyota">Toyota</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={showNewOnly ? "default" : "outline"}
          className="h-8 text-xs"
          onClick={() => setShowNewOnly(!showNewOnly)}
        >
          <Sparkles className="h-3 w-3 mr-1" /> New Today
        </Button>
        <Button
          size="sm"
          variant={showPriceDrops ? "default" : "outline"}
          className="h-8 text-xs"
          onClick={() => setShowPriceDrops(!showPriceDrops)}
        >
          <TrendingDown className="h-3 w-3 mr-1" /> Price Drops
        </Button>
      </div>

      <Separator className="mb-4" />

      {/* Feed */}
      {feedLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading feed...</div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {mandates?.length === 0
                ? "No mandates yet. Create one to start hunting."
                : "No listings match your filters. Try running mandates or adjusting filters."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {filteredItems.map(item => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
