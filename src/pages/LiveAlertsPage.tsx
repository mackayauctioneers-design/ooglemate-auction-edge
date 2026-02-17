import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Flame, RefreshCw, Zap, TrendingUp, AlertTriangle, Target, Repeat } from "lucide-react";
import { toast } from "sonner";

const TIER_CONFIG: Record<string, { color: string; label: string; icon: typeof Flame }> = {
  HIGH: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "HIGH", icon: Flame },
  MEDIUM: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "MED", icon: Zap },
  LOW: { color: "bg-muted text-muted-foreground border-border", label: "LOW", icon: AlertTriangle },
};

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Target }> = {
  replication: { label: "Replication", icon: Repeat },
  winner_replication: { label: "Winner Match", icon: Target },
  retail_deviation: { label: "Under Market", icon: TrendingUp },
};

function fmtMoney(n: number | null | undefined): string {
  if (!n) return "$0";
  return "$" + Math.round(Number(n)).toLocaleString();
}

export default function LiveAlertsPage() {
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [isRunning, setIsRunning] = useState(false);

  const { data: opportunities, isLoading, refetch } = useQuery({
    queryKey: ["live-alerts-opportunities", tierFilter, sourceFilter],
    queryFn: async () => {
      let query = supabase
        .from("opportunities")
        .select("*")
        .order("priority_level", { ascending: true })
        .order("confidence_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (tierFilter !== "all") {
        query = query.eq("confidence_tier", tierFilter);
      }
      if (sourceFilter !== "all") {
        query = query.eq("source_type", sourceFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const runScanNow = async () => {
    setIsRunning(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pickles-buynow-radar?force=true`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ max_ai_calls: 10 }),
        }
      );
      const result = await res.json();
      if (result.ok) {
        toast.success(
          `Scan complete: ${result.urls_found ?? 0} found, ${result.detail_fetched ?? 0} detail pages, ${result.opportunities ?? 0} opportunities, ${result.slack_sent ?? 0} Slack alerts`
        );
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

  const totalOpps = opportunities?.length || 0;
  const p1Count = opportunities?.filter((o: any) => o.priority_level === 1).length || 0;
  const winnerCount = opportunities?.filter((o: any) => o.source_type === "winner_replication").length || 0;

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
              Pickles Buy Now radar — replication, winner matches &amp; under-market signals
            </p>
          </div>
          <Button onClick={runScanNow} disabled={isRunning} variant="default">
            <RefreshCw className={`h-4 w-4 mr-2 ${isRunning ? "animate-spin" : ""}`} />
            {isRunning ? "Scanning…" : "Run Radar"}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-primary">{totalOpps}</p>
              <p className="text-xs text-muted-foreground">Total Opportunities</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-destructive">{p1Count}</p>
              <p className="text-xs text-muted-foreground">CODE RED (P1)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">{winnerCount}</p>
              <p className="text-xs text-muted-foreground">Winner Matches</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Confidence:</span>
                <Select value={tierFilter} onValueChange={setTierFilter}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="HIGH">HIGH</SelectItem>
                    <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                    <SelectItem value="LOW">LOW</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Source:</span>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="replication">Replication</SelectItem>
                    <SelectItem value="winner_replication">Winner Match</SelectItem>
                    <SelectItem value="retail_deviation">Under Market</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Opportunities List */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Matched Opportunities
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !opportunities?.length ? (
            <Card className="py-12">
              <CardContent className="text-center">
                <Flame className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium">No opportunities yet</h3>
                <p className="text-muted-foreground mt-1">
                  Run the radar to scan Pickles Buy Now listings against your sales truth &amp; winners watchlist
                </p>
                <Button className="mt-4" onClick={runScanNow} disabled={isRunning}>
                  Run Radar Now
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {opportunities.map((opp: any) => {
                const tier = TIER_CONFIG[opp.confidence_tier] || TIER_CONFIG.LOW;
                const TierIcon = tier.icon;
                const source = SOURCE_CONFIG[opp.source_type] || { label: opp.source_type, icon: Zap };
                const SourceIcon = source.icon;
                const delta = Number(opp.deviation || opp.retail_gap || 0);
                const isCodeRed = opp.priority_level === 1;

                return (
                  <Card key={opp.id} className={`hover:border-primary/30 transition-colors ${isCodeRed ? "border-destructive/40 bg-destructive/5" : ""}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {isCodeRed && (
                              <Badge variant="destructive" className="text-xs">
                                🔴 CODE RED
                              </Badge>
                            )}
                            <Badge variant="outline" className={tier.color}>
                              <TierIcon className="h-3 w-3 mr-1" />
                              {tier.label}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              <SourceIcon className="h-3 w-3 mr-1" />
                              {source.label}
                            </Badge>
                            {opp.variant && (
                              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                {opp.variant}
                              </Badge>
                            )}
                            {opp.drivetrain && (
                              <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-600 border-sky-300">
                                {opp.drivetrain}
                              </Badge>
                            )}
                          </div>
                          <h3 className="font-semibold text-foreground">
                            {opp.year ?? "?"} {opp.make} {opp.model} {opp.variant || ""}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            {opp.kms && <span>{Number(opp.kms).toLocaleString()} km</span>}
                            {opp.location && <span>{opp.location}</span>}
                          </div>
                          {opp.notes && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{opp.notes}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-bold text-foreground">
                            {fmtMoney(opp.buy_price)}
                          </p>
                          {opp.dealer_median_price && (
                            <p className="text-xs text-muted-foreground">
                              Hist. buy: {fmtMoney(opp.dealer_median_price)}
                            </p>
                          )}
                          {opp.retail_median_price && (
                            <p className="text-xs text-muted-foreground">
                              Retail: {fmtMoney(opp.retail_median_price)}
                            </p>
                          )}
                          {delta > 0 && (
                            <p className="text-sm font-semibold text-emerald-400 mt-1">
                              +{fmtMoney(delta)} edge
                            </p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {opp.listing_url && (
                            <a href={opp.listing_url} target="_blank" rel="noopener noreferrer">
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
      </div>
    </AppLayout>
  );
}