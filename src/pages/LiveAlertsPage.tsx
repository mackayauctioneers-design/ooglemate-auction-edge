import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Flame, RefreshCw, Zap, TrendingUp, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const TIER_CONFIG: Record<string, { color: string; label: string; icon: typeof Flame }> = {
  HIGH: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "HIGH", icon: Flame },
  MED: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "MED", icon: Zap },
  LOW: { color: "bg-muted text-muted-foreground border-border", label: "LOW", icon: AlertTriangle },
};

export default function LiveAlertsPage() {
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [dealerFilter, setDealerFilter] = useState<string>("all");
  const [minProfit, setMinProfit] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);

  const { data: listings, isLoading, refetch } = useQuery({
    queryKey: ["live-alerts", tierFilter, dealerFilter, minProfit],
    queryFn: async () => {
      let query = (supabase as any)
        .from("pickles_buy_now_listings")
        .select("*")
        .not("match_alerted_at", "is", null)
        .order("match_alerted_at", { ascending: false })
        .limit(200);

      if (tierFilter !== "all") {
        query = query.eq("match_tier", tierFilter);
      }
      if (dealerFilter !== "all") {
        query = query.eq("match_dealer_key", dealerFilter);
      }
      if (minProfit > 0) {
        query = query.gte("match_expected_profit", minProfit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Also fetch latest unmatched listings for context
  const { data: recentListings } = useQuery({
    queryKey: ["recent-pickles-listings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pickles_buy_now_listings")
        .select("id, year, make, model, variant, kms, price, location, listing_url, scraped_at, match_tier")
        .order("scraped_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const runScanNow = async () => {
    setIsRunning(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pickles-buy-now-scan?force=true`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const result = await res.json();
      if (result.success) {
        toast.success(`Scan complete: ${result.scraped ?? 0} listings, ${result.matched ?? 0} matches, ${result.alerts ?? 0} alerts`);
        refetch();
      } else {
        toast.error(result.error || "Scan failed");
      }
    } catch (e) {
      toast.error("Failed to run scan");
    } finally {
      setIsRunning(false);
    }
  };

  const matchedCount = listings?.length || 0;
  const totalProfit = listings?.reduce((sum: number, l: any) => sum + (l.match_expected_profit || 0), 0) || 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flame className="h-6 w-6 text-primary" />
              Live Alerts
            </h1>
            <p className="text-muted-foreground text-sm">
              Pickles Buy Now listings matched against Dave &amp; Hardy liquidity profiles
            </p>
          </div>
          <Button onClick={runScanNow} disabled={isRunning} variant="default">
            <RefreshCw className={`h-4 w-4 mr-2 ${isRunning ? "animate-spin" : ""}`} />
            {isRunning ? "Scanning…" : "Run Now"}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-primary">{matchedCount}</p>
              <p className="text-xs text-muted-foreground">Matched Alerts</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">${totalProfit.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Est. Profit</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold">{recentListings?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Recent Listings</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Tier:</span>
                <Select value={tierFilter} onValueChange={setTierFilter}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="HIGH">HIGH</SelectItem>
                    <SelectItem value="MED">MED</SelectItem>
                    <SelectItem value="LOW">LOW</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Dealer:</span>
                <Select value={dealerFilter} onValueChange={setDealerFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Mackay Traders">Dave (Mackay)</SelectItem>
                    <SelectItem value="Hardy Traders">Hardy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <span className="text-sm text-muted-foreground whitespace-nowrap">Min Profit: ${minProfit.toLocaleString()}</span>
                <Slider
                  value={[minProfit]}
                  onValueChange={(v) => setMinProfit(v[0])}
                  min={0}
                  max={20000}
                  step={500}
                  className="flex-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Matched Alerts */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Matched Alerts
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !listings?.length ? (
            <Card className="py-12">
              <CardContent className="text-center">
                <Flame className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium">No alerts yet</h3>
                <p className="text-muted-foreground mt-1">
                  Run the scanner or wait for the next scheduled scan (every 30 minutes, 8am–6pm AEST)
                </p>
                <Button className="mt-4" onClick={runScanNow} disabled={isRunning}>
                  Run Scanner Now
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {listings.map((listing: any) => {
                const tier = TIER_CONFIG[listing.match_tier] || TIER_CONFIG.LOW;
                const TierIcon = tier.icon;
                return (
                  <Card key={listing.id} className="hover:border-primary/30 transition-colors">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className={tier.color}>
                              <TierIcon className="h-3 w-3 mr-1" />
                              {tier.label}
                            </Badge>
                            <Badge variant="secondary">{listing.match_dealer_key}</Badge>
                          </div>
                          <h3 className="font-semibold text-foreground">
                            {listing.year ?? "?"} {listing.make} {listing.model} {listing.variant || ""}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            {listing.kms && <span>{listing.kms.toLocaleString()} km</span>}
                            {listing.location && <span>{listing.location}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-bold text-foreground">
                            ${(listing.price || 0).toLocaleString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Resale: ${(listing.match_expected_resale || 0).toLocaleString()}
                          </p>
                          <p className="text-sm font-semibold text-emerald-400">
                            +${(listing.match_expected_profit || 0).toLocaleString()} est.
                          </p>
                        </div>
                        <div className="shrink-0">
                          {listing.listing_url && (
                            <a href={listing.listing_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm">
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Listings (all) */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Latest Pickles Listings</h2>
          <Card>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2">Vehicle</th>
                      <th className="pb-2">KMs</th>
                      <th className="pb-2">Price</th>
                      <th className="pb-2">Location</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentListings?.slice(0, 20).map((l: any) => (
                      <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 font-medium">
                          {l.year} {l.make} {l.model} {l.variant || ""}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {l.kms ? l.kms.toLocaleString() : "—"}
                        </td>
                        <td className="py-2">${(l.price || 0).toLocaleString()}</td>
                        <td className="py-2 text-muted-foreground">{l.location || "—"}</td>
                        <td className="py-2">
                          {l.match_tier ? (
                            <Badge variant="outline" className={TIER_CONFIG[l.match_tier]?.color || ""}>
                              {l.match_tier}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">No match</span>
                          )}
                        </td>
                        <td className="py-2">
                          {l.listing_url && (
                            <a href={l.listing_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
