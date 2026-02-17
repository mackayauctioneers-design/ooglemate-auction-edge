import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { useBuyAgainTargets, ProfitPattern, LiveMatch } from "@/hooks/useBuyAgainTargets";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Crosshair, ExternalLink, TrendingUp,
  MapPin, RefreshCw, Eye, XCircle, RotateCcw, DollarSign, BarChart3,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/* ── Pattern Header ── */
function PatternHeader({ pattern }: { pattern: ProfitPattern }) {
  const yearLabel = pattern.year_min === pattern.year_max
    ? `${pattern.year_min}`
    : `${pattern.year_min}–${pattern.year_max}`;
  const kmLabel = pattern.km_max >= 999999
    ? `${Math.round(pattern.km_min / 1000)}k+`
    : `${Math.round(pattern.km_min / 1000)}–${Math.round(pattern.km_max / 1000)}k`;
  const trimLabel = pattern.trim_class.replace(/_/g, " ");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-base">
          {yearLabel} {pattern.make} {pattern.model} {trimLabel}
        </h3>
      </div>
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <BarChart3 className="h-3 w-3" />
          Flips: <strong className="text-foreground">{pattern.total_flips}</strong>
        </span>
        <span className="flex items-center gap-0.5 text-green-700 bg-green-500/10 rounded px-1.5 py-0.5">
          <TrendingUp className="h-3 w-3" />
          Med Profit: <strong>${pattern.median_profit.toLocaleString()}</strong>
        </span>
        <span className="text-muted-foreground">
          Med Buy: <strong className="text-foreground">${pattern.median_buy_price.toLocaleString()}</strong>
        </span>
        <span className="text-muted-foreground">
          Med Sell: <strong className="text-foreground">${pattern.median_sell_price.toLocaleString()}</strong>
        </span>
        <Badge variant="outline" className="text-[10px]">KM: {kmLabel}</Badge>
      </div>
    </div>
  );
}

/* ── Match Card ── */
function MatchCard({ match }: { match: LiveMatch }) {
  const label = [match.year, match.make, match.model, match.variant].filter(Boolean).join(" ");
  const daysListed = match.first_seen_at
    ? Math.floor((Date.now() - new Date(match.first_seen_at).getTime()) / 86400000)
    : null;
  const source = match.source?.replace("dealer_site:", "").replace("_crawl", "").replace(/_/g, " ") || "Unknown";

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors gap-3">
      <div className="space-y-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{label}</p>
          {match.match_type === "exact" ? (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-500/10 text-green-700 border-green-300 shrink-0">
              EXACT
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-sky-500/10 text-sky-700 border-sky-300 shrink-0">
              ⬆ UPGRADE
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {match.km != null && <span>{Math.round(match.km / 1000)}k km</span>}
          {match.drivetrain && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">{match.drivetrain.toUpperCase()}</Badge>
          )}
          <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{source}</span>
          {daysListed != null && <span>{daysListed}d listed</span>}
        </div>
        {match.under_median_buy != null && match.under_median_buy > 0 && (
          <p className="text-[10px] text-green-600 mt-0.5">
            ${match.under_median_buy.toLocaleString()} under median buy
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

  if (!accountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setAccountId(mackay?.id || accounts[0].id);
  }

  const { groups, isLoading, refetch, dismissPattern, clearDismissed, dismissedCount } = useBuyAgainTargets(accountId);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Crosshair className="h-6 w-6" />
              Buy Again Targets
            </h1>
            <p className="text-sm text-muted-foreground">
              Pattern-based replication — profitable trading bands matched to live supply.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dismissedCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDismissed} className="text-muted-foreground">
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Restore {dismissedCount}
              </Button>
            )}
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
            <Crosshair className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No tradable patterns found</p>
            <p className="text-sm mt-1">Need profitable sales data with enough volume to form patterns.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {groups.length} tradable patterns · {groups.reduce((t, g) => t + g.matches.length, 0)} live matches
            </p>
            {groups.map((g) => (
              <Card key={g.pattern.id} className="border-primary/20">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <PatternHeader pattern={g.pattern} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" title="Dismiss">
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Dismiss this pattern?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will hide {g.pattern.make} {g.pattern.model} {g.pattern.trim_class.replace(/_/g, " ")}. You can restore later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => dismissPattern(g.pattern.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Dismiss
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.matches.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
