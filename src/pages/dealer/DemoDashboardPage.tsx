import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search, TrendingUp, Target, BarChart3, ArrowRight, Lock,
  DollarSign, Clock, Package, Zap, Bell, Upload, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Demo Data ──────────────────────────────────────────────────────────────

const DEMO_MAKES = ["Toyota", "BMW", "Mercedes-Benz", "Ford", "Volkswagen", "Hyundai", "Kia", "Mazda", "Land Rover", "Nissan"];

const DEMO_MODELS: Record<string, string[]> = {
  Toyota: ["Hilux", "Prado", "RAV4", "Corolla", "Camry", "Fortuner"],
  BMW: ["X5", "X3", "X1", "3 Series", "5 Series"],
  "Mercedes-Benz": ["GLE", "GLC", "C-Class", "A-Class", "GLA"],
  Ford: ["Ranger", "Everest", "Mustang", "Focus"],
  Volkswagen: ["Amarok", "Tiguan", "Golf", "T-Roc"],
  Hyundai: ["Tucson", "Santa Fe", "i30", "Kona"],
  Kia: ["Sportage", "Sorento", "Cerato", "Seltos"],
  Mazda: ["CX-5", "CX-9", "BT-50", "Mazda3"],
  "Land Rover": ["Range Rover Evoque", "Discovery Sport", "Defender"],
  Nissan: ["Navara", "X-Trail", "Patrol", "Qashqai"],
};

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

const DEMO_FINGERPRINT = {
  make: "Toyota",
  model: "Hilux SR5",
  avgProfit: 4300,
  bestKmRange: "40k–90k",
  avgDaysToSell: 18,
  salesCount: 12,
};

const DEMO_OPPORTUNITIES = [
  { vehicle: "2021 Hilux SR5", price: 45900, estRetail: 50800, margin: 4900, source: "Carsales" },
  { vehicle: "2020 Hilux SR5", price: 43700, estRetail: 48000, margin: 4300, source: "Autotrader" },
  { vehicle: "2022 Hilux SR5", price: 49200, estRetail: 52500, margin: 3300, source: "Pickles" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function DemoDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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

    // Track demo usage
    if (user) {
      await supabase.from("demo_usage").insert({
        user_id: user.id,
        vehicle_search: { make, model, variant, yearMin, yearMax, kmMax },
      });
    }

    // Simulate search delay
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

  const fmt = (n: number) => `$${n.toLocaleString()}`;

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
        {/* ── Section 1: Vehicle Search ─────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="w-5 h-5 text-primary" />
              Vehicle Search
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Search a vehicle you trade — Example: Hilux SR5, Ranger Wildtrak, Prado GXL
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div>
                <Label className="text-xs text-muted-foreground">Make</Label>
                <Select value={make} onValueChange={(v) => { setMake(v); setModel(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select make" /></SelectTrigger>
                  <SelectContent>
                    {DEMO_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Model</Label>
                <Select value={model} onValueChange={setModel} disabled={!make}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {(DEMO_MODELS[make] || []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
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

        {/* ── Section 2: Vehicle Intelligence Report ──────────────── */}
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

              {/* Enable Alert Button */}
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

        {/* ── Section 3: Opportunity Feed Preview ─────────────────── */}
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
                    {DEMO_OPPORTUNITIES.map((opp, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-3 px-3 font-medium text-foreground">{opp.vehicle}</td>
                        <td className="py-3 px-3 text-right text-foreground">{fmt(opp.price)}</td>
                        <td className="py-3 px-3 text-right text-muted-foreground">{fmt(opp.estRetail)}</td>
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

        {/* ── Section 4: Fingerprint Example ──────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5 text-primary" />
              Dealer Profit Fingerprint Example
            </CardTitle>
            <p className="text-sm text-muted-foreground">This uses demo data.</p>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/20 rounded-lg p-5 border border-border">
              <h3 className="text-lg font-bold text-foreground mb-4">{DEMO_FINGERPRINT.make} {DEMO_FINGERPRINT.model}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Average Profit</div>
                  <div className="text-lg font-bold text-emerald-400">{fmt(DEMO_FINGERPRINT.avgProfit)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Best KM Range</div>
                  <div className="text-lg font-bold text-foreground">{DEMO_FINGERPRINT.bestKmRange}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Avg Days To Sell</div>
                  <div className="text-lg font-bold text-foreground">{DEMO_FINGERPRINT.avgDaysToSell}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Successful Sales</div>
                  <div className="text-lg font-bold text-foreground">{DEMO_FINGERPRINT.salesCount}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Section 5: Upgrade CTA ──────────────────────────────── */}
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
