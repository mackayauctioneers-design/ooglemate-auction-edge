import { useState, useMemo } from "react";
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
  DollarSign, Clock, Package, Zap, Bell, Upload, Loader2, ArrowRight,
  Flame, Eye, ShieldCheck, Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Synthetic demo data ────────────────────────────────────────────────────

const DEMO_DEALER_NAME = "ABC Motors";

interface DemoFingerprint {
  id: string;
  make: string;
  model: string;
  avg_profit: number;
  sales_count: number;
  profit_score: number;
  fingerprint_priority: "high" | "medium";
  avg_days_to_sell: number;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  alert_enabled: boolean;
}

const DEMO_FINGERPRINTS: DemoFingerprint[] = [
  { id: "d1", make: "Toyota", model: "HiLux", avg_profit: 4200, sales_count: 18, profit_score: 75600, fingerprint_priority: "high", avg_days_to_sell: 16, year_min: 2018, year_max: 2024, min_km: 20000, max_km: 120000, alert_enabled: true },
  { id: "d2", make: "Ford", model: "Ranger", avg_profit: 3800, sales_count: 14, profit_score: 53200, fingerprint_priority: "high", avg_days_to_sell: 19, year_min: 2019, year_max: 2024, min_km: 15000, max_km: 100000, alert_enabled: true },
  { id: "d3", make: "Mazda", model: "BT-50", avg_profit: 3500, sales_count: 9, profit_score: 31500, fingerprint_priority: "high", avg_days_to_sell: 22, year_min: 2019, year_max: 2024, min_km: 20000, max_km: 110000, alert_enabled: true },
  { id: "d4", make: "Toyota", model: "LandCruiser", avg_profit: 6100, sales_count: 6, profit_score: 36600, fingerprint_priority: "high", avg_days_to_sell: 12, year_min: 2017, year_max: 2023, min_km: 30000, max_km: 150000, alert_enabled: true },
  { id: "d5", make: "Hyundai", model: "Tucson", avg_profit: 2800, sales_count: 7, profit_score: 19600, fingerprint_priority: "medium", avg_days_to_sell: 24, year_min: 2019, year_max: 2024, min_km: 15000, max_km: 90000, alert_enabled: false },
  { id: "d6", make: "Kia", model: "Sportage", avg_profit: 2600, sales_count: 5, profit_score: 13000, fingerprint_priority: "medium", avg_days_to_sell: 27, year_min: 2020, year_max: 2024, min_km: 10000, max_km: 80000, alert_enabled: false },
  { id: "d7", make: "Mitsubishi", model: "Triton", avg_profit: 3100, sales_count: 8, profit_score: 24800, fingerprint_priority: "medium", avg_days_to_sell: 21, year_min: 2018, year_max: 2024, min_km: 20000, max_km: 120000, alert_enabled: false },
  { id: "d8", make: "Isuzu", model: "D-MAX", avg_profit: 3400, sales_count: 6, profit_score: 20400, fingerprint_priority: "medium", avg_days_to_sell: 20, year_min: 2019, year_max: 2024, min_km: 15000, max_km: 100000, alert_enabled: false },
];

// Synthetic hero deal (no real listing data needed)
const DEMO_HERO = {
  year: 2022,
  make: "Toyota",
  model: "HiLux",
  variant: "SR5 Auto 4x4",
  km: 42000,
  price: 46990,
  source: "Auction",
  margin: 4200,
  salesCount: 18,
  avgDays: 16,
};

// ─── Component ──────────────────────────────────────────────────────────────

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
  matchingFingerprint: DemoFingerprint | null;
}

export default function DemoDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

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

  // Listings from search
  const [searchListings, setSearchListings] = useState<any[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchFresh, setSearchFresh] = useState(0);

  const SEARCH_LIMIT = 5;
  const fmt = (n: number) => `$${n.toLocaleString()}`;

  const highPriority = DEMO_FINGERPRINTS.filter((f) => f.fingerprint_priority === "high");
  const mediumPriority = DEMO_FINGERPRINTS.filter((f) => f.fingerprint_priority === "medium");
  const fingerprintMakes = [...new Set(DEMO_FINGERPRINTS.map((f) => f.make))];
  const fingerprintModels = make
    ? [...new Set(DEMO_FINGERPRINTS.filter((f) => f.make === make).map((f) => f.model))]
    : [];

  const handleSearch = async () => {
    if (!make || !model) { toast.error("Please select Make and Model"); return; }
    if (searchCount >= SEARCH_LIMIT) { toast.error("Demo search limit reached."); return; }
    setSearching(true);
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id,
        vehicle_search: { make, model, variant, yearMin, yearMax, kmMax },
      });
    }

    const matchFp = DEMO_FINGERPRINTS.find((f) => f.make === make && f.model === model) || null;

    // Pull real market listings (public market data, not dealer-specific)
    const { data: listings, count } = await supabase
      .from("retail_listings")
      .select("make, model, variant_raw, year, km, asking_price, source, state, first_seen_at", { count: "exact" })
      .eq("make", make)
      .eq("model", model)
      .is("delisted_at", null)
      .not("asking_price", "is", null)
      .gte("year", parseInt(yearMin) || 2018)
      .lte("year", parseInt(yearMax) || 2024)
      .order("asking_price", { ascending: true })
      .limit(20);

    const rows = listings || [];
    const prices = rows.map((l) => l.asking_price).filter(Boolean) as number[];
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 45000;
    const avgMargin = matchFp?.avg_profit || Math.round(avgPrice * 0.08);
    const avgDays = matchFp?.avg_days_to_sell || Math.round(14 + Math.random() * 28);

    setIntelligence({
      make, model, variant,
      avgRetail: avgPrice,
      wholesaleMin: Math.round(avgPrice * 0.82),
      wholesaleMax: Math.round(avgPrice * 0.92),
      avgMargin,
      avgDaysToSell: avgDays,
      currentListings: count || rows.length,
      matchingFingerprint: matchFp,
    });

    // Show anonymised listings (strip URLs)
    setSearchListings(rows.slice(0, 3).map((l) => ({ ...l, listing_url: null })));
    setSearchTotal(count || rows.length);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    setSearchFresh(rows.filter((l) => l.first_seen_at && l.first_seen_at >= yesterday).length);

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
      navigate("/sales-upload");
    } else {
      navigate("/auth");
    }
  };

  const getMarginBadge = (margin: number, avgProfit: number) => {
    if (margin >= avgProfit * 1.2) return { label: "🔥 Hot Deal", className: "bg-red-500/20 text-red-400 border-red-500/30" };
    if (margin >= avgProfit * 0.8) return { label: "✔ Strong Match", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
    return { label: "⚠ Below Average", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  };

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
            See what Carbitrage does for a sample dealer — <strong className="text-foreground">{DEMO_DEALER_NAME}</strong>
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* ── Market Scan Counter ──────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <Eye className="w-5 h-5 mx-auto mb-1 text-primary" />
            <div className="text-2xl font-bold text-foreground">247</div>
            <div className="text-xs text-muted-foreground">Cars matching fingerprints</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <Flame className="w-5 h-5 mx-auto mb-1 text-red-400" />
            <div className="text-2xl font-bold text-foreground">18</div>
            <div className="text-xs text-muted-foreground">High margin opportunities</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <Sparkles className="w-5 h-5 mx-auto mb-1 text-amber-400" />
            <div className="text-2xl font-bold text-foreground">9</div>
            <div className="text-xs text-muted-foreground">New in last 24 hours</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <Package className="w-5 h-5 mx-auto mb-1 text-purple-400" />
            <div className="text-2xl font-bold text-foreground">{highPriority.length}</div>
            <div className="text-xs text-muted-foreground">Active fingerprints</div>
          </div>
        </div>

        {/* ── HERO DEAL CARD ───────────────────────────────────────── */}
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
                  {DEMO_HERO.year} {DEMO_HERO.make} {DEMO_HERO.model}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {DEMO_HERO.variant} · {DEMO_HERO.km.toLocaleString()} km · {DEMO_HERO.source}
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Price</div>
                    <div className="text-xl font-bold text-foreground">{fmt(DEMO_HERO.price)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Estimated Retail</div>
                    <div className="text-xl font-bold text-muted-foreground">{fmt(DEMO_HERO.price + DEMO_HERO.margin)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Expected Margin</div>
                    <div className="text-3xl font-black text-emerald-400">{fmt(DEMO_HERO.margin)}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                    <ShieldCheck className="w-3 h-3 mr-1" />
                    High Confidence
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Matches {DEMO_HERO.salesCount} previous profitable deals
                  </span>
                </div>
                <p className="text-xs text-primary mt-3 font-medium italic">
                  "This vehicle matches your profit history."
                </p>
              </div>
              <div className="flex flex-col gap-2 justify-center">
                <Button variant="outline" disabled>
                  <Lock className="w-4 h-4 mr-2" />
                  View Listing
                </Button>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground flex items-center gap-1 justify-center">
                    <Clock className="w-3 h-3" />
                    Avg {DEMO_HERO.avgDays} days to sell
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Fingerprints ─────────────────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5 text-primary" />
              {DEMO_DEALER_NAME} — Profit Fingerprints
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
                  {highPriority.map((fp) => (
                    <div key={fp.id} className="bg-muted/20 rounded-lg p-4 border border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-foreground text-sm">{fp.make} {fp.model}</span>
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">HIGH</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Avg Profit</span>
                          <div className="font-bold text-emerald-400">{fmt(fp.avg_profit)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Sales</span>
                          <div className="font-bold text-foreground">{fp.sales_count}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Total Profit</span>
                          <div className="font-bold text-foreground">{fmt(fp.profit_score)}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Avg {fp.avg_days_to_sell} days to sell
                      </div>
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
                      {mediumPriority.map((fp) => (
                        <tr key={fp.id} className="border-b border-border/50">
                          <td className="py-2 px-3 font-medium text-foreground">{fp.make} {fp.model}</td>
                          <td className="py-2 px-3 text-right text-emerald-400">{fmt(fp.avg_profit)}</td>
                          <td className="py-2 px-3 text-right text-foreground">{fp.sales_count}</td>
                          <td className="py-2 px-3 text-right text-foreground">{fmt(fp.profit_score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Vehicle Search ───────────────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="w-5 h-5 text-primary" />
              Vehicle Search
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Search from {DEMO_DEALER_NAME}'s fingerprint vehicles
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

        {/* ── Live Opportunities (anonymised, no URLs) ─────────────── */}
        {intelligence && searchListings.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Live Market Opportunities
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Matching: <strong className="text-foreground">{searchTotal}</strong></span>
                <span>New today: <strong className="text-amber-400">{searchFresh}</strong></span>
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
                    </tr>
                  </thead>
                  <tbody>
                    {searchListings.map((listing: any, i: number) => {
                      const fp = DEMO_FINGERPRINTS.find((f) => f.make === listing.make && f.model === listing.model);
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {searchTotal > 3 && (
                <div className="mt-4 bg-muted/30 rounded-lg p-4 text-center">
                  <Lock className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    <span className="font-bold text-foreground">{searchTotal - 3} additional opportunities</span> hidden in demo mode.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {user ? "Upload your sales data to unlock the full opportunity feed." : "Create a free account to unlock the full opportunity feed."}
                  </p>
                  {!user && (
                    <Button size="sm" className="mt-3" onClick={() => navigate("/auth")}>
                      <Zap className="w-3 h-3 mr-1" /> Sign Up Free
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Upgrade CTA ──────────────────────────────────────────── */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-8 text-center">
            <Zap className="w-10 h-10 mx-auto mb-3 text-primary" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              {user ? "Unlock Full Dealer Intelligence" : "Ready to Get Started?"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              {user
                ? "Upload your past sales history and Carbitrage will automatically discover:"
                : "Create your free account to unlock the full Carbitrage platform:"}
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 mb-6">
              <li>• your most profitable vehicles</li>
              <li>• ideal kilometre ranges</li>
              <li>• fastest selling models</li>
              <li>• live sourcing opportunities</li>
            </ul>
            {user ? (
              <Button size="lg" onClick={handleUploadClick}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Sales Data
              </Button>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button size="lg" onClick={() => navigate("/auth")}>
                  <Zap className="w-4 h-4 mr-2" />
                  Create Free Account
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate("/auth")}>
                  Already have an account? Log in
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
