import { useState, useEffect } from "react";
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
  DollarSign, Clock, Package, Zap, Bell, Upload, Loader2, Users, ArrowRight
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
}

function generateDemoIntelligence(make: string, model: string, variant: string): DemoIntelligence {
  const seed = (make + model + variant).length;
  const base = 30000 + seed * 1200;
  const avgRetail = Math.round(base + Math.random() * 15000);
  const wholesaleMin = Math.round(avgRetail * 0.78);
  const wholesaleMax = Math.round(avgRetail * 0.88);
  const avgMargin = Math.round(avgRetail * (0.06 + Math.random() * 0.06));
  const avgDaysToSell = Math.round(14 + Math.random() * 28);
  const currentListings = Math.round(40 + Math.random() * 150);
  return { make, model, variant, avgRetail, wholesaleMin, wholesaleMax, avgMargin, avgDaysToSell, currentListings };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DemoDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Dealer data
  const [dealers, setDealers] = useState<DealerProfile[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [fingerprints, setFingerprints] = useState<Fingerprint[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(true);
  const [loadingFingerprints, setLoadingFingerprints] = useState(false);

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
    const loadDealers = async () => {
      const { data } = await supabase
        .from("dealer_profiles")
        .select("id, dealer_name, region_id")
        .order("dealer_name");
      setDealers(data || []);
      if (data && data.length > 0) {
        setSelectedDealerId(data[0].id);
      }
      setLoadingDealers(false);
    };
    loadDealers();
  }, []);

  // Load fingerprints when dealer changes
  useEffect(() => {
    if (!selectedDealerId) return;
    const loadFingerprints = async () => {
      setLoadingFingerprints(true);
      const { data } = await supabase
        .from("dealer_fingerprints")
        .select("id, make, model, avg_profit, sales_count, profit_score, fingerprint_priority, avg_days_to_sell, year_min, year_max, min_km, max_km, alert_enabled")
        .eq("dealer_profile_id", selectedDealerId)
        .eq("is_active", true)
        .order("profit_score", { ascending: false });
      setFingerprints(data || []);
      setLoadingFingerprints(false);
    };
    loadFingerprints();
  }, [selectedDealerId]);

  const selectedDealer = dealers.find((d) => d.id === selectedDealerId);
  const highPriority = fingerprints.filter((f) => f.fingerprint_priority === "high");
  const mediumPriority = fingerprints.filter((f) => f.fingerprint_priority === "medium");

  // Derive makes/models from fingerprints for search
  const fingerprintMakes = [...new Set(fingerprints.map((f) => f.make))];
  const fingerprintModels = make
    ? [...new Set(fingerprints.filter((f) => f.make === make).map((f) => f.model))]
    : [];

  const handleSearch = async () => {
    if (!make || !model) {
      toast.error("Please select Make and Model");
      return;
    }
    if (searchCount >= SEARCH_LIMIT) {
      toast.error("Demo search limit reached. Upload your sales data to unlock unlimited searches.");
      return;
    }
    setSearching(true);
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id,
        vehicle_search: { make, model, variant, yearMin, yearMax, kmMax, dealer_id: selectedDealerId },
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
    setIntelligence(generateDemoIntelligence(make, model, variant));
    setSearchCount((c) => c + 1);
    setAlertEnabled(false);
    setSearching(false);
  };

  const handleEnableAlert = async () => {
    setAlertEnabled(true);
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id,
        vehicle_search: { make, model, action: "enable_alert" },
        clicked_alert: true,
      });
    }
    toast.success("You will be notified when this vehicle appears below market value.");
  };

  const handleUploadClick = async () => {
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id,
        vehicle_search: { action: "clicked_upload" },
        clicked_upload: true,
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
            <br />
            Upload your own sales data to unlock dealer-specific opportunities.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* ── Dealer Selector ──────────────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-primary" />
              Select Dealer Profile
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Browse existing dealer intelligence profiles
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Dealer</Label>
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
              {selectedDealer && (
                <div className="flex items-end">
                  <Button variant="outline" onClick={handleViewOpportunityFeed}>
                    <Target className="w-4 h-4 mr-2" />
                    View Opportunity Feed
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Fingerprints from selected dealer ────────────────────── */}
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
                {selectedDealer?.dealer_name} — Dealer Profit Fingerprints
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {highPriority.length} high-priority &middot; {mediumPriority.length} medium-priority fingerprints
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
                  {mediumPriority.length > 8 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      + {mediumPriority.length - 8} more medium-priority fingerprints
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border bg-card">
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No fingerprints found for this dealer. Upload sales data to generate intelligence.</p>
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
                ? `Search from ${selectedDealer?.dealer_name}'s fingerprint vehicles, or enter any make/model`
                : "Search a vehicle you trade — Example: Hilux SR5, Ranger Wildtrak, Prado GXL"}
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
              {searching ? "Searching market..." : "Search Vehicle"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Vehicle Intelligence Report ──────────────────────────── */}
        {intelligence && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="w-5 h-5 text-primary" />
                Vehicle Intelligence Report
              </CardTitle>
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
                  <div className="text-xs text-muted-foreground">Typical Dealer Margin</div>
                  <div className="text-lg font-bold text-emerald-400">{fmt(intelligence.avgMargin)}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <Clock className="w-5 h-5 mx-auto mb-1 text-blue-400" />
                  <div className="text-xs text-muted-foreground">Avg Days To Sell</div>
                  <div className="text-lg font-bold text-foreground">{intelligence.avgDaysToSell}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <Package className="w-5 h-5 mx-auto mb-1 text-purple-400" />
                  <div className="text-xs text-muted-foreground">Currently Listed</div>
                  <div className="text-lg font-bold text-foreground">{intelligence.currentListings}</div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-4">
                <Button
                  variant={alertEnabled ? "outline" : "default"}
                  onClick={handleEnableAlert}
                  disabled={alertEnabled}
                >
                  <Bell className="w-4 h-4 mr-2" />
                  {alertEnabled ? "Alert Enabled" : "Enable Buy Alerts"}
                </Button>
                {alertEnabled && (
                  <span className="text-sm text-emerald-400">
                    ✓ You will be notified when this vehicle appears below market value.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Opportunity Preview (3 results, locked) ──────────────── */}
        {intelligence && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Live Market Opportunities
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Cars currently matching this vehicle: <span className="font-bold text-foreground">12</span>
              </p>
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
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { vehicle: `2021 ${make} ${model}`, price: Math.round(intelligence.wholesaleMax * 0.95), margin: Math.round(intelligence.avgMargin * 1.1), source: "Carsales" },
                      { vehicle: `2020 ${make} ${model}`, price: Math.round(intelligence.wholesaleMin * 1.02), margin: intelligence.avgMargin, source: "Autotrader" },
                      { vehicle: `2022 ${make} ${model}`, price: Math.round(intelligence.wholesaleMax * 1.05), margin: Math.round(intelligence.avgMargin * 0.75), source: "Pickles" },
                    ].map((opp, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-3 px-3 font-medium text-foreground">{opp.vehicle}</td>
                        <td className="py-3 px-3 text-right text-foreground">{fmt(opp.price)}</td>
                        <td className="py-3 px-3 text-right text-muted-foreground">{fmt(opp.price + opp.margin)}</td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-400">{fmt(opp.margin)}</td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="text-xs">{opp.source}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 bg-muted/30 rounded-lg p-4 text-center">
                <Lock className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">9 additional opportunities</span> hidden in demo mode.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload your sales data to unlock the full opportunity feed.
                </p>
              </div>
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
