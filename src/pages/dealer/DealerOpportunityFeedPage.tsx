import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Shield, Target, TrendingUp, ExternalLink, Eye,
  Zap, BarChart3, Loader2, RefreshCw, Bell, Package, Clock,
  DollarSign, ChevronDown, ChevronUp
} from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ActiveFingerprint {
  id: string;
  fingerprint_id: string;
  make: string;
  model: string;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  avg_profit: number | null;
  sales_count: number | null;
  profit_score: number | null;
  alert_enabled: boolean;
  avg_days_to_sell: number | null;
}

interface MarketListing {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  listing_url: string | null;
  source: string;
  source_type: "retail" | "auction";
  location: string | null;
  first_seen_at: string | null;
  fingerprint_make: string;
  fingerprint_model: string;
  avg_profit: number | null;
  estimated_retail: number | null;
  margin_estimate: number | null;
}

interface MarketSupply {
  make: string;
  model: string;
  total: number;
  retail: number;
  auction: number;
}

// ─── Formatters ─────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const AJH_DEALER_PROFILE_ID = "1fb22da9-37b9-4d95-a3a6-c50e07a4877e";

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-muted text-muted-foreground border-border",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function DealerOpportunityFeedPage() {
  const navigate = useNavigate();
  const [fingerprints, setFingerprints] = useState<ActiveFingerprint[]>([]);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [supply, setSupply] = useState<MarketSupply[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alertToggles, setAlertToggles] = useState<Record<string, boolean>>({});

  const loadData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // 1. Fetch HIGH-priority fingerprints for AJH
      const { data: fps } = await supabase
        .from("dealer_fingerprints")
        .select("id, fingerprint_id, make, model, year_min, year_max, min_km, max_km, avg_profit, sales_count, profit_score, alert_enabled, avg_days_to_sell")
        .eq("dealer_name", "AJH Auto Traders")
        .eq("fingerprint_priority", "high")
        .eq("is_active", true)
        .order("profit_score", { ascending: false });

      const activeFps = (fps || []) as ActiveFingerprint[];
      setFingerprints(activeFps);

      // Initialize alert toggles
      const toggles: Record<string, boolean> = {};
      activeFps.forEach(fp => { toggles[fp.id] = fp.alert_enabled; });
      setAlertToggles(toggles);

      if (activeFps.length === 0) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // 2. Query retail + auction listings matching fingerprint make/models
      const makeModelPairs = [...new Set(activeFps.map(fp => `${fp.make}|${fp.model}`))];
      const makes = [...new Set(activeFps.map(fp => fp.make))];
      const models = [...new Set(activeFps.map(fp => fp.model))];

      const [retailRes, auctionRes] = await Promise.all([
        supabase
          .from("retail_listings")
          .select("id, make, model, variant_raw, year, km, asking_price, listing_url, source, state, first_seen_at")
          .in("make", makes)
          .in("model", models)
          .is("delisted_at", null)
          .order("first_seen_at", { ascending: false })
          .limit(500),
        supabase
          .from("vehicle_listings")
          .select("id, make, model, variant_raw, year, km, listing_url, source, location, first_seen_at, highest_bid")
          .in("make", makes)
          .in("model", models)
          .not("status", "in", '("sold","excluded","delisted")')
          .order("first_seen_at", { ascending: false })
          .limit(200),
      ]);

      // 3. Map & filter listings against fingerprint specs
      const fpLookup = new Map<string, ActiveFingerprint>();
      activeFps.forEach(fp => fpLookup.set(`${fp.make}|${fp.model}`, fp));

      const allListings: MarketListing[] = [];

      // Retail listings
      (retailRes.data || []).forEach((r: any) => {
        const key = `${r.make}|${r.model}`;
        const fp = fpLookup.get(key);
        if (!fp) return;
        if (r.year && (r.year < fp.year_min || r.year > fp.year_max)) return;
        if (r.km && fp.max_km && r.km > fp.max_km * 1.15) return;

        const estimatedRetail = fp.avg_profit && r.asking_price
          ? r.asking_price + (fp.avg_profit ?? 0)
          : null;

        allListings.push({
          id: r.id,
          make: r.make,
          model: r.model,
          variant: r.variant_raw,
          year: r.year,
          km: r.km,
          price: r.asking_price,
          listing_url: r.listing_url,
          source: r.source || "Retail",
          source_type: "retail",
          location: r.state,
          first_seen_at: r.first_seen_at,
          fingerprint_make: fp.make,
          fingerprint_model: fp.model,
          avg_profit: fp.avg_profit,
          estimated_retail: estimatedRetail,
          margin_estimate: fp.avg_profit,
        });
      });

      // Auction listings
      (auctionRes.data || []).forEach((a: any) => {
        const key = `${a.make}|${a.model}`;
        const fp = fpLookup.get(key);
        if (!fp) return;
        if (a.year && (a.year < fp.year_min || a.year > fp.year_max)) return;

        allListings.push({
          id: a.id,
          make: a.make,
          model: a.model,
          variant: a.variant_raw,
          year: a.year,
          km: a.km,
          price: a.highest_bid,
          listing_url: a.listing_url,
          source: a.source || "Auction",
          source_type: "auction",
          location: a.location,
          first_seen_at: a.first_seen_at,
          fingerprint_make: fp.make,
          fingerprint_model: fp.model,
          avg_profit: fp.avg_profit,
          estimated_retail: null,
          margin_estimate: fp.avg_profit,
        });
      });

      // Sort by price (lowest first = best opportunity)
      allListings.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      setListings(allListings);

      // 4. Build supply counts
      const supplyMap = new Map<string, MarketSupply>();
      allListings.forEach(l => {
        const key = `${l.fingerprint_make}|${l.fingerprint_model}`;
        const existing = supplyMap.get(key) || { make: l.fingerprint_make, model: l.fingerprint_model, total: 0, retail: 0, auction: 0 };
        existing.total++;
        if (l.source_type === "retail") existing.retail++;
        else existing.auction++;
        supplyMap.set(key, existing);
      });
      setSupply([...supplyMap.values()].sort((a, b) => b.total - a.total));
    } catch (err) {
      console.error("Failed to load opportunity feed:", err);
      toast.error("Failed to load opportunities");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    document.title = "Opportunity Feed | AJH Auto Traders";
    loadData();
  }, []);

  const toggleAlert = async (fpId: string, enabled: boolean) => {
    setAlertToggles(prev => ({ ...prev, [fpId]: enabled }));
    const { error } = await supabase
      .from("dealer_fingerprints")
      .update({ alert_enabled: enabled } as any)
      .eq("id", fpId);
    if (error) {
      toast.error("Failed to update alert");
      setAlertToggles(prev => ({ ...prev, [fpId]: !enabled }));
    }
  };

  // Stats
  const totalMatches = listings.length;
  const highMarginOpps = listings.filter(l => (l.avg_profit ?? 0) >= 2000).length;
  const auctionMatches = listings.filter(l => l.source_type === "auction").length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Scanning market for opportunities…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3 mb-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={() => loadData(true)}
              disabled={refreshing}
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            AJH Auto Traders — Opportunity Feed
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live vehicles matching your dealer trade fingerprints
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Hero Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Market Matches"
            value={totalMatches.toLocaleString()}
            icon={<Target className="h-4 w-4" />}
            accent
          />
          <StatCard
            label="High Margin"
            value={String(highMarginOpps)}
            icon={<TrendingUp className="h-4 w-4" />}
            accent
          />
          <StatCard
            label="Auction Listings"
            value={String(auctionMatches)}
            icon={<Zap className="h-4 w-4" />}
          />
          <StatCard
            label="Active Fingerprints"
            value={String(fingerprints.length)}
            icon={<Shield className="h-4 w-4" />}
          />
        </div>

        {/* Section 1: Fingerprints Driving Alerts */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-600" />
                <CardTitle className="text-base">Fingerprints Driving Alerts</CardTitle>
              </div>
              <Badge className="bg-green-100 text-green-700 border-green-200">
                {fingerprints.length} active
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">These vehicle patterns trigger buy opportunities based on your proven profit history</p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs">
                    <th className="text-left px-3 py-2 font-medium">Vehicle</th>
                    <th className="text-right px-3 py-2 font-medium">Avg Profit</th>
                    <th className="text-right px-3 py-2 font-medium">Total Profit</th>
                    <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Sales</th>
                    <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Avg Days</th>
                    <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Market</th>
                    <th className="text-center px-3 py-2 font-medium">Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fingerprints.map(fp => {
                    const supplyRow = supply.find(s => s.make === fp.make && s.model === fp.model);
                    return (
                      <tr key={fp.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">{fp.make} {fp.model}</div>
                          <div className="text-xs text-muted-foreground">{fp.year_min}–{fp.year_max}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold" style={{ color: "hsl(142, 71%, 45%)" }}>
                          {fp.avg_profit != null ? fmt(fp.avg_profit) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium" style={{ color: "hsl(142, 71%, 45%)" }}>
                          {fp.profit_score != null ? fmt(fp.profit_score) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground hidden sm:table-cell">{fp.sales_count ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground hidden sm:table-cell">{fp.avg_days_to_sell != null ? `${fp.avg_days_to_sell}d` : "—"}</td>
                        <td className="px-3 py-2.5 text-right hidden md:table-cell">
                          {supplyRow ? (
                            <Badge variant="outline" className="text-xs">
                              {supplyRow.total} listed
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Switch
                            checked={alertToggles[fp.id] ?? fp.alert_enabled}
                            onCheckedChange={(v) => toggleAlert(fp.id, v)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Live Market Matches */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Live Market Matches
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vehicles currently listed that match your dealer trade fingerprints
              </p>
            </div>
            <Badge variant="outline" className="text-sm">
              {totalMatches.toLocaleString()} vehicles
            </Badge>
          </div>

          {listings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>No matching listings found in the current market scan.</p>
                <p className="text-xs mt-1">The system scans continuously — check back soon.</p>
              </CardContent>
            </Card>
          ) : (
            <OpportunityGrid listings={listings} />
          )}
        </div>

        {/* Section 3: Market Supply Insight */}
        {supply.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Market Supply</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">How many units are available for each fingerprint right now</p>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {supply.map(s => (
                  <div key={`${s.make}-${s.model}`} className="rounded-lg border border-border p-3 space-y-1">
                    <p className="font-medium text-sm text-foreground">{s.make} {s.model}</p>
                    <p className="text-2xl font-bold text-foreground">{s.total}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>Retail: {s.retail}</span>
                      <span>·</span>
                      <span>Auction: {s.auction}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 4: Alert Subscriptions Summary */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Alert Subscriptions</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              You will be notified when these vehicles appear below market value.
            </p>
            <div className="flex flex-wrap gap-2">
              {fingerprints.filter(fp => alertToggles[fp.id]).map(fp => (
                <Badge key={fp.id} className="bg-green-100 text-green-700 border-green-200">
                  <Bell className="h-3 w-3 mr-1" />
                  {fp.make} {fp.model}
                </Badge>
              ))}
              {fingerprints.filter(fp => !alertToggles[fp.id]).map(fp => (
                <Badge key={fp.id} variant="outline" className="text-muted-foreground">
                  {fp.make} {fp.model}
                </Badge>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> Dashboard</span>
              <span className="flex items-center gap-1 opacity-50"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Email (coming soon)</span>
              <span className="flex items-center gap-1 opacity-50"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> SMS (coming soon)</span>
              <span className="flex items-center gap-1 opacity-50"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Slack (coming soon)</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, icon, accent = false }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-lg border p-4 space-y-1",
      accent ? "border-green-200 bg-green-50/50" : "border-border bg-card"
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", accent ? "text-green-700" : "text-foreground")}>{value}</p>
    </div>
  );
}

function OpportunityGrid({ listings }: { listings: MarketListing[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? listings : listings.slice(0, 12);

  // Group by fingerprint for visual clarity
  const grouped = useMemo(() => {
    const map = new Map<string, MarketListing[]>();
    displayed.forEach(l => {
      const key = `${l.fingerprint_make} ${l.fingerprint_model}`;
      const arr = map.get(key) || [];
      arr.push(l);
      map.set(key, arr);
    });
    return [...map.entries()];
  }, [displayed]);

  return (
    <div className="space-y-4">
      {grouped.map(([group, items]) => (
        <div key={group} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{group}</h3>
            <Badge variant="outline" className="text-xs">{items.length} matches</Badge>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.slice(0, 6).map(listing => (
              <OpportunityCard key={listing.id} listing={listing} />
            ))}
          </div>
          {items.length > 6 && (
            <p className="text-xs text-muted-foreground pl-1">+ {items.length - 6} more {group} listings</p>
          )}
        </div>
      ))}

      {!showAll && listings.length > 12 && (
        <Button variant="outline" className="w-full" onClick={() => setShowAll(true)}>
          Show all {listings.length} matches
        </Button>
      )}
    </div>
  );
}

function OpportunityCard({ listing }: { listing: MarketListing }) {
  const hasMargin = listing.avg_profit != null && listing.avg_profit > 0;
  const sourceLabel = listing.source.charAt(0).toUpperCase() + listing.source.slice(1).toLowerCase();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground text-sm leading-tight">
            {listing.year} {listing.make} {listing.model}
          </p>
          {listing.variant && (
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{listing.variant}</p>
          )}
        </div>
        <Badge variant="outline" className={cn(
          "text-[10px] shrink-0",
          listing.source_type === "auction" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"
        )}>
          {sourceLabel}
        </Badge>
      </div>

      {/* Key info */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {listing.price != null && (
          <div>
            <span className="text-muted-foreground">Price</span>
            <p className="font-bold text-foreground text-base">{fmt(listing.price)}</p>
          </div>
        )}
        {listing.estimated_retail != null && (
          <div>
            <span className="text-muted-foreground">Est. Retail</span>
            <p className="font-semibold text-foreground text-base">{fmt(listing.estimated_retail)}</p>
          </div>
        )}
        {listing.km != null && (
          <div>
            <span className="text-muted-foreground">KM</span>
            <p className="font-medium text-foreground">{(listing.km / 1000).toFixed(0)}k</p>
          </div>
        )}
        {listing.location && (
          <div>
            <span className="text-muted-foreground">Location</span>
            <p className="font-medium text-foreground">{listing.location}</p>
          </div>
        )}
      </div>

      {/* Margin badge */}
      {hasMargin && (
        <div className="flex items-center gap-1.5 rounded-md bg-green-50 border border-green-200 px-2.5 py-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-green-600" />
          <span className="text-xs font-semibold text-green-700">
            Expected Margin: {fmt(listing.avg_profit!)}
          </span>
        </div>
      )}

      {/* Fingerprint match badge */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Shield className="h-3 w-3" />
        <span>Matches AJH profit profile</span>
        {listing.first_seen_at && (
          <>
            <span className="mx-1">·</span>
            <Clock className="h-3 w-3" />
            <span>{timeAgo(listing.first_seen_at)}</span>
          </>
        )}
      </div>

      {/* CTA */}
      {listing.listing_url && (
        <a
          href={listing.listing_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs">
            <ExternalLink className="h-3 w-3" /> View Listing
          </Button>
        </a>
      )}
    </div>
  );
}
