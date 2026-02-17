import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { usePlatformClusters, PlatformCluster, ClusterMatch } from "@/hooks/usePlatformClusters";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Crosshair, ExternalLink, TrendingUp, AlertTriangle,
  MapPin, RefreshCw, Eye, XCircle, RotateCcw, Layers, DollarSign, Hash,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* ── Cluster Header ── */
function ClusterHeader({ cluster }: { cluster: PlatformCluster }) {
  const yearLabel = cluster.year_min === cluster.year_max
    ? `${cluster.year_min}`
    : `${cluster.year_min}–${cluster.year_max}`;
  const title = `${yearLabel} ${cluster.make} ${cluster.model} ${cluster.generation}`;
  const driveLabel = cluster.drivetrain !== "UNKNOWN" ? cluster.drivetrain : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-base">{title}</h3>
        <div className="flex items-center gap-1.5">
          {driveLabel && (
            <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-700 border-sky-300">{driveLabel}</Badge>
          )}
          <Badge variant="secondary" className="text-xs">
            <Hash className="h-3 w-3 mr-0.5" />{cluster.total_flips} flips
          </Badge>
        </div>
      </div>
      {/* Cluster metrics */}
      <div className="flex items-center gap-4 text-xs flex-wrap">
        {cluster.median_buy_price != null && (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <DollarSign className="h-3 w-3" />Med Buy: <strong className="text-foreground">${Number(cluster.median_buy_price).toLocaleString()}</strong>
          </span>
        )}
        {cluster.median_sell_price != null && (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            Med Sell: <strong className="text-foreground">${Number(cluster.median_sell_price).toLocaleString()}</strong>
          </span>
        )}
        {cluster.median_profit != null && (
          <span className="flex items-center gap-0.5 text-green-700 bg-green-500/10 rounded px-1.5 py-0.5">
            <TrendingUp className="h-3 w-3" />Med Profit: <strong>${Number(cluster.median_profit).toLocaleString()}</strong>
          </span>
        )}
        {cluster.median_km != null && (
          <span className="text-muted-foreground">Med KM: <strong className="text-foreground">{Math.round(Number(cluster.median_km) / 1000)}k</strong></span>
        )}
      </div>
    </div>
  );
}

/* ── Match Card ── */
function MatchCard({ match, medianBuy }: { match: ClusterMatch; medianBuy: number | null }) {
  const label = [match.year, match.make, match.model, match.variant].filter(Boolean).join(" ");
  const daysListed = match.first_seen_at
    ? Math.floor((Date.now() - new Date(match.first_seen_at).getTime()) / 86400000)
    : null;
  const source = match.source?.replace("dealer_site:", "").replace("_crawl", "").replace(/_/g, " ") || "Unknown";

  const tierColors = {
    CODE_RED: "border-red-500 bg-red-500/5",
    HIGH: "border-amber-500 bg-amber-500/5",
    NORMAL: "",
  };

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors gap-3 ${tierColors[match.alert_tier]}`}>
      <div className="space-y-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {match.alert_tier === "CODE_RED" && (
            <Badge className="bg-red-600 text-white text-[10px] px-1.5 py-0">CODE RED</Badge>
          )}
          {match.alert_tier === "HIGH" && (
            <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">HIGH</Badge>
          )}
          <p className="text-sm font-medium truncate">{label}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {match.km != null && <span>{Math.round(match.km / 1000)}k km</span>}
          {match.drivetrain && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">{match.drivetrain.toUpperCase()}</Badge>
          )}
          <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{source}</span>
          {daysListed != null && <span>{daysListed}d listed</span>}
        </div>
        {medianBuy != null && match.price != null && match.price < Number(medianBuy) && (
          <p className="text-[10px] text-green-600 mt-0.5">
            ${(Number(medianBuy) - match.price).toLocaleString()} under median buy
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-sm font-bold">
            {match.price ? `$${match.price.toLocaleString()}` : "N/A"}
          </p>
          {match.est_profit != null && match.est_profit > 0 && (
            <p className="text-xs text-green-600 flex items-center gap-0.5 justify-end">
              <TrendingUp className="h-3 w-3" />
              ~${match.est_profit.toLocaleString()} est.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Watch">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" title="Dismiss">
            <XCircle className="h-3.5 w-3.5" />
          </Button>
          {match.url && (
            <Button size="icon" variant="ghost" className="h-7 w-7" asChild title="Open listing">
              <a href={match.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Page ── */
export default function BuyAgainTargetsPage() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [seeding, setSeeding] = useState(false);

  if (!accountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setAccountId(mackay?.id || accounts[0].id);
  }

  const { groups, isLoading, refetch, dismissCluster, clearDismissed, dismissedCount } = usePlatformClusters(accountId);

  const withMatches = groups.filter((g) => g.matches.length > 0);
  const withoutMatches = groups.filter((g) => g.matches.length === 0);

  const handleSeedClusters = async () => {
    if (!accountId) return;
    setSeeding(true);
    try {
      const { error } = await supabase.rpc("rebuild_platform_clusters", { p_account_id: accountId });
      if (error) throw error;
      toast.success("Platform clusters rebuilt");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to rebuild clusters");
    } finally {
      setSeeding(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6" />
              Platform Clusters
            </h1>
            <p className="text-sm text-muted-foreground">
              Grouped by generation + drivetrain — top 3 cheapest live listings per platform.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dismissedCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDismissed} className="text-muted-foreground">
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Restore {dismissedCount}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleSeedClusters} disabled={seeding || !accountId}>
              <Crosshair className={`h-4 w-4 mr-1.5 ${seeding ? "animate-spin" : ""}`} />
              Seed Clusters
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <AccountSelector value={accountId} onChange={setAccountId} />
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No platform clusters yet</p>
            <p className="text-sm mt-1">Click "Seed Clusters" to build from sales history.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {withMatches.map((g) => (
              <Card key={g.cluster.id} className={
                g.matches.some(m => m.alert_tier === "CODE_RED")
                  ? "border-red-500/40"
                  : g.matches.some(m => m.alert_tier === "HIGH")
                    ? "border-amber-500/30"
                    : "border-primary/20"
              }>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <ClusterHeader cluster={g.cluster} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" title="Dismiss cluster">
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Dismiss this cluster?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will hide the {g.cluster.generation} {g.cluster.make} {g.cluster.model} cluster. You can restore later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => dismissCluster(g.cluster.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Dismiss
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.matches.map((m) => (
                    <MatchCard key={m.id} match={m} medianBuy={g.cluster.median_buy_price} />
                  ))}
                </CardContent>
              </Card>
            ))}

            {withoutMatches.length > 0 && (
              <div className="space-y-2 pt-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  No Current Matches ({withoutMatches.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {withoutMatches.map((g) => {
                    const c = g.cluster;
                    const yearLabel = c.year_min === c.year_max ? `${c.year_min}` : `${c.year_min}–${c.year_max}`;
                    return (
                      <div key={c.id} className="p-3 rounded-lg border bg-muted/30 text-sm">
                        <span className="font-medium">{yearLabel} {c.make} {c.model} {c.generation}</span>
                        <span className="text-muted-foreground ml-2">
                          ({c.total_flips} flips · med profit ${Number(c.median_profit || 0).toLocaleString()})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
