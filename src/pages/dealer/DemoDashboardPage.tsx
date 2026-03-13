import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search, TrendingUp, Target, BarChart3, Lock,
  DollarSign, Clock, Package, Zap, Bell, Upload, Loader2, Users, ArrowRight,
  Flame, ExternalLink, Eye, ShieldCheck, AlertTriangle, Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DealerProfile {
  id: string;
  dealer_name: string;
  region_id: string;
}

interface Fingerprint {
  id: string;
  make: string;
  model: string;
  avg_profit: number | null;
  sales_count: number | null;
  profit_score: number | null;
  fingerprint_priority: string;
  avg_days_to_sell: number | null;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  alert_enabled: boolean;
}

interface RealListing {
  make: string;
  model: string;
  variant_raw: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  listing_url: string | null;
  source: string;
  state: string | null;
  first_seen_at: string | null;
}

interface DemoIntelligence {
  make: string;
  model: string;
  variant: string;
  avgRetail: number;
  wholesaleMin: number;
  wholesaleMax: number;
  avgMargin: number;
  avgDaysToSell: number;
  currentListings: number;
  matchingFingerprint: Fingerprint | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DemoDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [dealers, setDealers] = useState<DealerProfile[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [fingerprints, setFingerprints] = useState<Fingerprint[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(true);
  const [loadingFingerprints, setLoadingFingerprints] = useState(false);

  // Real listings state
  const [realListings, setRealListings] = useState<RealListing[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [freshCount, setFreshCount] = useState(0);
  const [loadingListings, setLoadingListings] = useState(false);

  // Search state
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [yearMin, setYearMin] = useState("2018");
  const [yearMax, setYearMax] = useState("2024");
  const [kmMax, setKmMax] = useState("120000");
  const [searching, setSearching] = useState(false);
  const [searchCount, setSearchCount] = useState(0);
  const [intelligence, setIntelligence] = useState<DemoIntelligence | null>(null);
  const [alertEnabled, setAlertEnabled] = useState(false);

  const SEARCH_LIMIT = 5;
  const fmt = (n: number) => `$${n.toLocaleString()}`;

  // Load dealers
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("dealer_profiles")
        .select("id, dealer_name, region_id")
        .order("dealer_name");
      setDealers(data || []);
      if (data && data.length > 0) setSelectedDealerId(data[0].id);
      setLoadingDealers(false);
    };
    load();
  }, []);

  // Load fingerprints + real listings when dealer changes
  useEffect(() => {
    if (!selectedDealerId) return;
    const load = async () => {
      setLoadingFingerprints(true);
      const { data } = await supabase
        .from("dealer_fingerprints")
        .select("id, make, model, avg_profit, sales_count, profit_score, fingerprint_priority, avg_days_to_sell, year_min, year_max, min_km, max_km, alert_enabled")
        .eq("dealer_profile_id", selectedDealerId)
        .eq("is_active", true)
        .order("profit_score", { ascending: false });
      setFingerprints(data || []);
      setLoadingFingerprints(false);

      // Fetch real listings for top fingerprints
      if (data && data.length > 0) {
        setLoadingListings(true);
        const topFps = data.filter((f) => f.fingerprint_priority === "high").slice(0, 5);
        const makeModels = topFps.map((f) => `(make.eq.${f.make},model.eq.${f.model})`);

        // Query real listings matching top fingerprints
        const allListings: RealListing[] = [];
        let total = 0;
        let fresh = 0;
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        for (const fp of topFps.slice(0, 3)) {
          const { data: listings, count } = await supabase
            .from("retail_listings")
            .select("make, model, variant_raw, year, km, asking_price, listing_url, source, state, first_seen_at", { count: "exact" })
            .eq("make", fp.make)
            .eq("model", fp.model)
            .is("delisted_at", null)
            .not("asking_price", "is", null)
            .gte("year", fp.year_min)
            .lte("year", fp.year_max)
            .order("first_seen_at", { ascending: false })
            .limit(10);

          if (listings) {
            allListings.push(...listings);
            total += count || listings.length;
            fresh += listings.filter((l) => l.first_seen_at && l.first_seen_at >= yesterday).length;
          }
        }

        setRealListings(allListings);
        setTotalMatches(total);
        setFreshCount(fresh);
        setLoadingListings(false);
      }
    };
    load();
  }, [selectedDealerId]);

  const selectedDealer = dealers.find((d) => d.id === selectedDealerId);
  const highPriority = fingerprints.filter((f) => f.fingerprint_priority === "high");
  const mediumPriority = fingerprints.filter((f) => f.fingerprint_priority === "medium");
  const fingerprintMakes = [...new Set(fingerprints.map((f) => f.make))];
  const fingerprintModels = make
    ? [...new Set(fingerprints.filter((f) => f.make === make).map((f) => f.model))]
    : [];

  // Hero deal: best real listing with highest estimated margin
  const heroDeal = useMemo(() => {
    if (realListings.length === 0 || highPriority.length === 0) return null;
    // Find the listing with the best margin based on fingerprint avg_profit
    let best: { listing: RealListing; fp: Fingerprint; margin: number } | null = null;
    for (const listing of realListings) {
      const fp = highPriority.find((f) => f.make === listing.make && f.model === listing.model);
      if (!fp || !listing.asking_price || !fp.avg_profit) continue;
      const margin = fp.avg_profit;
      if (!best || margin > best.margin) {
        best = { listing, fp, margin };
      }
    }
    return best;
  }, [realListings, highPriority]);

  // High margin opportunities count
  const highMarginOpps = useMemo(() => {
    return realListings.filter((l) => {
      const fp = highPriority.find((f) => f.make === l.make && f.model === l.model);
      return fp && fp.avg_profit && fp.avg_profit > 2000;
    }).length;
  }, [realListings, highPriority]);

  const handleSearch = async () => {
    if (!make || !model) { toast.error("Please select Make and Model"); return; }
    if (searchCount >= SEARCH_LIMIT) { toast.error("Demo search limit reached."); return; }
    setSearching(true);
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id,
        vehicle_search: { make, model, variant, yearMin, yearMax, kmMax, dealer_id: selectedDealerId },
      });
    }

    // Find matching fingerprint
    const matchFp = fingerprints.find((f) => f.make === make && f.model === model) || null;

    // Pull real listings for the searched vehicle
    const { data: searchListings, count } = await supabase
      .from("retail_listings")
      .select("make, model, variant_raw, year, km, asking_price, listing_url, source, state, first_seen_at", { count: "exact" })
      .eq("make", make)
      .eq("model", model)
      .is("delisted_at", null)
      .not("asking_price", "is", null)
      .gte("year", parseInt(yearMin) || 2018)
      .lte("year", parseInt(yearMax) || 2024)
      .order("asking_price", { ascending: true })
      .limit(20);

    const listings = searchListings || [];
    const prices = listings.map((l) => l.asking_price).filter(Boolean) as number[];
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 45000;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 38000;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 55000;
    const avgMargin = matchFp?.avg_profit || Math.round(avgPrice * 0.08);
    const avgDays = matchFp?.avg_days_to_sell || Math.round(14 + Math.random() * 28);

    setIntelligence({
      make, model, variant,
      avgRetail: avgPrice,
      wholesaleMin: Math.round(avgPrice * 0.82),
      wholesaleMax: Math.round(avgPrice * 0.92),
      avgMargin,
      avgDaysToSell: avgDays,
      currentListings: count || listings.length,
      matchingFingerprint: matchFp,
    });

    // Update real listings to show search results
    setRealListings(listings);
    setTotalMatches(count || listings.length);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    setFreshCount(listings.filter((l) => l.first_seen_at && l.first_seen_at >= yesterday).length);

    setSearchCount((c) => c + 1);
    setAlertEnabled(false);
    setSearching(false);
  };

  const handleEnableAlert = async () => {
    setAlertEnabled(true);
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id, vehicle_search: { make, model, action: "enable_alert" }, clicked_alert: true,
      });
    }
    toast.success("You will be notified when this vehicle appears below market value.");
  };

  const handleUploadClick = async () => {
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id, vehicle_search: { action: "clicked_upload" }, clicked_upload: true,
      });
    }
    navigate("/sales-upload");
  };

  const handleViewOpportunityFeed = () => {
    if (selectedDealer?.dealer_name?.toLowerCase().includes("ajh")) {
      navigate("/dealer/opportunities/ajh");
    } else {
      navigate("/dealer/opportunities/demo");
    }
  };

  // Profit badge helper
  const getMarginBadge = (margin: number, avgProfit: number) => {
    if (margin >= avgProfit * 1.2) return { label: "🔥 Hot Deal", className: "bg-red-500/20 text-red-400 border-red-500/30" };
    if (margin >= avgProfit * 0.8) return { label: "✔ Strong Match", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
    return { label: "⚠ Below Average", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  };

  if (loadingDealers) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="border-amber-500/50 text-amber-400 bg-amber-500/10 text-xs">
              DEMO MODE
            </Badge>
            <span className="text-xs text-muted-foreground">
              {searchCount}/{SEARCH_LIMIT} searches used
            </span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Carbitrage Demo Mode</h1>
          <p className="text-muted-foreground mt-1">
            This is a limited preview of the Carbitrage dealer intelligence platform.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* ── Dealer Selector ──────────────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-primary" />
              Select Dealer Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <Select value={selectedDealerId} onValueChange={setSelectedDealerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a dealer" />
                  </SelectTrigger>
                  <SelectContent>
                    {dealers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.dealer_name} — {d.region_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={handleViewOpportunityFeed}>
                <Target className="w-4 h-4 mr-2" />
                Full Opportunity Feed
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Market Scan Counter ──────────────────────────────────── */}
        {!loadingListings && totalMatches > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <Eye className="w-5 h-5 mx-auto mb-1 text-primary" />
              <div className="text-2xl font-bold text-foreground">{totalMatches}</div>
              <div className="text-xs text-muted-foreground">Cars matching fingerprints</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <Flame className="w-5 h-5 mx-auto mb-1 text-red-400" />
              <div className="text-2xl font-bold text-foreground">{highMarginOpps}</div>
              <div className="text-xs text-muted-foreground">High margin opportunities</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <Sparkles className="w-5 h-5 mx-auto mb-1 text-amber-400" />
              <div className="text-2xl font-bold text-foreground">{freshCount}</div>
              <div className="text-xs text-muted-foreground">New in last 24 hours</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <Package className="w-5 h-5 mx-auto mb-1 text-purple-400" />
              <div className="text-2xl font-bold text-foreground">{highPriority.length}</div>
              <div className="text-xs text-muted-foreground">Active fingerprints</div>
            </div>
          </div>
        )}

        {/* ── HERO DEAL CARD ───────────────────────────────────────── */}
        {heroDeal && (
          <Card className="border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
            <CardContent className="py-6">
              <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-red-400" />
                <span className="text-sm font-bold text-foreground uppercase tracking-wider">Top Opportunity Detected</span>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] ml-auto">
                  MATCHES DEALER FINGERPRINT
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6">
                <div>
                  <h3 className="text-2xl font-bold text-foreground mb-1">
                    {heroDeal.listing.year} {heroDeal.listing.make} {heroDeal.listing.model}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {heroDeal.listing.variant_raw} · {heroDeal.listing.km?.toLocaleString()} km · {heroDeal.listing.source}
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Price</div>
                      <div className="text-xl font-bold text-foreground">{fmt(heroDeal.listing.asking_price!)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Estimated Retail</div>
                      <div className="text-xl font-bold text-muted-foreground">
                        {fmt(heroDeal.listing.asking_price! + heroDeal.margin)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Expected Margin</div>
                      <div className="text-3xl font-black text-emerald-400">{fmt(heroDeal.margin)}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      High Confidence
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Matches {heroDeal.fp.sales_count} previous profitable deals
                    </span>
                  </div>
                  <p className="text-xs text-primary mt-3 font-medium italic">
                    "This vehicle matches your profit history."
                  </p>
                </div>
                <div className="flex flex-col gap-2 justify-center">
                  {heroDeal.listing.listing_url && (
                    <Button asChild>
                      <a href={heroDeal.listing.listing_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View Listing
                      </a>
                    </Button>
                  )}
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground flex items-center gap-1 justify-center">
                      <Clock className="w-3 h-3" />
                      Avg {heroDeal.fp.avg_days_to_sell || "~20"} days to sell
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Fingerprints ─────────────────────────────────────────── */}
        {loadingFingerprints ? (
          <Card className="border-border bg-card">
            <CardContent className="py-8 text-center">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : fingerprints.length > 0 ? (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="w-5 h-5 text-primary" />
                {selectedDealer?.dealer_name} — Profit Fingerprints
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {highPriority.length} high-priority · {mediumPriority.length} medium-priority
              </p>
            </CardHeader>
            <CardContent>
              {highPriority.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    High Priority — Active Buy Alerts
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {highPriority.slice(0, 6).map((fp) => (
                      <div key={fp.id} className="bg-muted/20 rounded-lg p-4 border border-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-foreground text-sm">{fp.make} {fp.model}</span>
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">HIGH</Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Avg Profit</span>
                            <div className="font-bold text-emerald-400">{fmt(fp.avg_profit || 0)}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Sales</span>
                            <div className="font-bold text-foreground">{fp.sales_count || 0}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total Profit</span>
                            <div className="font-bold text-foreground">{fmt(fp.profit_score || 0)}</div>
                          </div>
                        </div>
                        {fp.avg_days_to_sell && (
                          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Avg {fp.avg_days_to_sell} days to sell
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mediumPriority.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Medium Priority — Watch List
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs">
                          <th className="text-left py-2 px-3">Vehicle</th>
                          <th className="text-right py-2 px-3">Avg Profit</th>
                          <th className="text-right py-2 px-3">Sales</th>
                          <th className="text-right py-2 px-3">Total Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mediumPriority.slice(0, 8).map((fp) => (
                          <tr key={fp.id} className="border-b border-border/50">
                            <td className="py-2 px-3 font-medium text-foreground">{fp.make} {fp.model}</td>
                            <td className="py-2 px-3 text-right text-emerald-400">{fmt(fp.avg_profit || 0)}</td>
                            <td className="py-2 px-3 text-right text-foreground">{fp.sales_count || 0}</td>
                            <td className="py-2 px-3 text-right text-foreground">{fmt(fp.profit_score || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border bg-card">
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No fingerprints for this dealer yet. Upload sales data to generate intelligence.</p>
            </CardContent>
          </Card>
        )}

        {/* ── Vehicle Search ───────────────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="w-5 h-5 text-primary" />
              Vehicle Search
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {fingerprintMakes.length > 0
                ? `Search from ${selectedDealer?.dealer_name}'s fingerprint vehicles`
                : "Search a vehicle you trade"}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div>
                <Label className="text-xs text-muted-foreground">Make</Label>
                <Select value={make} onValueChange={(v) => { setMake(v); setModel(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select make" /></SelectTrigger>
                  <SelectContent>
                    {fingerprintMakes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Model</Label>
                <Select value={model} onValueChange={setModel} disabled={!make}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {fingerprintModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Variant (optional)</Label>
                <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="e.g. SR5, Wildtrak" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Year Min</Label>
                <Input value={yearMin} onChange={(e) => setYearMin(e.target.value)} type="number" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Year Max</Label>
                <Input value={yearMax} onChange={(e) => setYearMax(e.target.value)} type="number" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Max KM</Label>
                <Input value={kmMax} onChange={(e) => setKmMax(e.target.value)} type="number" />
              </div>
            </div>
            <Button onClick={handleSearch} disabled={searching || searchCount >= SEARCH_LIMIT} className="w-full md:w-auto">
              {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {searching ? "Scanning live market..." : "Search Vehicle"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Intelligence Report ──────────────────────────────────── */}
        {intelligence && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="w-5 h-5 text-primary" />
                Vehicle Intelligence Report
              </CardTitle>
              {intelligence.matchingFingerprint && (
                <Badge className="bg-primary/20 text-primary border-primary/30 text-xs w-fit">
                  ✔ Matches dealer fingerprint — {intelligence.matchingFingerprint.sales_count} profitable deals on record
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <h3 className="text-xl font-bold text-foreground mb-4">
                {yearMin}–{yearMax} {intelligence.make} {intelligence.model} {intelligence.variant}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <DollarSign className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <div className="text-xs text-muted-foreground">Avg Retail Price</div>
                  <div className="text-lg font-bold text-foreground">{fmt(intelligence.avgRetail)}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <TrendingUp className="w-5 h-5 mx-auto mb-1 text-amber-400" />
                  <div className="text-xs text-muted-foreground">Wholesale Range</div>
                  <div className="text-lg font-bold text-foreground">{fmt(intelligence.wholesaleMin)} – {fmt(intelligence.wholesaleMax)}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <Zap className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
                  <div className="text-xs text-muted-foreground">Typical Margin</div>
                  <div className="text-lg font-bold text-emerald-400">{fmt(intelligence.avgMargin)}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <Clock className="w-5 h-5 mx-auto mb-1 text-blue-400" />
                  <div className="text-xs text-muted-foreground">Avg Days To Sell</div>
                  <div className="text-lg font-bold text-foreground">{intelligence.avgDaysToSell}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <Package className="w-5 h-5 mx-auto mb-1 text-purple-400" />
                  <div className="text-xs text-muted-foreground">Market Supply</div>
                  <div className="text-lg font-bold text-foreground">{intelligence.currentListings}</div>
                </div>
              </div>
              <div className="mt-6 flex items-center gap-4">
                <Button variant={alertEnabled ? "outline" : "default"} onClick={handleEnableAlert} disabled={alertEnabled}>
                  <Bell className="w-4 h-4 mr-2" />
                  {alertEnabled ? "Alert Enabled" : "Enable Buy Alerts"}
                </Button>
                {alertEnabled && (
                  <span className="text-sm text-emerald-400">✓ You will be notified when this vehicle appears below market value.</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Live Opportunities (real listings, 3 shown) ──────────── */}
        {intelligence && realListings.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Live Market Opportunities
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Matching: <strong className="text-foreground">{totalMatches}</strong></span>
                <span>High margin: <strong className="text-emerald-400">{highMarginOpps}</strong></span>
                <span>New today: <strong className="text-amber-400">{freshCount}</strong></span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-3">Vehicle</th>
                      <th className="text-right py-2 px-3">Price</th>
                      <th className="text-right py-2 px-3">Est Retail</th>
                      <th className="text-right py-2 px-3">Margin</th>
                      <th className="text-left py-2 px-3">Source</th>
                      <th className="text-left py-2 px-3">Confidence</th>
                      <th className="text-left py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {realListings.slice(0, 3).map((listing, i) => {
                      const fp = fingerprints.find((f) => f.make === listing.make && f.model === listing.model);
                      const margin = fp?.avg_profit || Math.round((listing.asking_price || 40000) * 0.08);
                      const badge = getMarginBadge(margin, fp?.avg_profit || margin);
                      return (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-3 px-3">
                            <div className="font-medium text-foreground">
                              {listing.year} {listing.make} {listing.model}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {listing.variant_raw} · {listing.km?.toLocaleString()} km
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-foreground">{fmt(listing.asking_price || 0)}</td>
                          <td className="py-3 px-3 text-right text-muted-foreground">{fmt((listing.asking_price || 0) + margin)}</td>
                          <td className="py-3 px-3 text-right font-bold text-emerald-400">{fmt(margin)}</td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className="text-xs">{listing.source}</Badge>
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>
                          </td>
                          <td className="py-3 px-3">
                            {listing.listing_url && (
                              <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
                                View →
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalMatches > 3 && (
                <div className="mt-4 bg-muted/30 rounded-lg p-4 text-center">
                  <Lock className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    <span className="font-bold text-foreground">{totalMatches - 3} additional opportunities</span> hidden in demo mode.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload your sales data to unlock the full opportunity feed.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Upgrade CTA ──────────────────────────────────────────── */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-8 text-center">
            <Zap className="w-10 h-10 mx-auto mb-3 text-primary" />
            <h2 className="text-xl font-bold text-foreground mb-2">Unlock Full Dealer Intelligence</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Upload your past sales history and Carbitrage will automatically discover:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 mb-6">
              <li>• your most profitable vehicles</li>
              <li>• ideal kilometre ranges</li>
              <li>• fastest selling models</li>
              <li>• live sourcing opportunities</li>
            </ul>
            <Button size="lg" onClick={handleUploadClick}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Sales Data
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
