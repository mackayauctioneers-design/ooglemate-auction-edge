import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts } from "@/hooks/useAccounts";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Target,
  XCircle,
  Bell,
  Zap,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface MatchedOpportunity {
  id: string;
  account_id: string;
  listing_norm_id: string;
  url_canonical: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  fingerprint_make: string;
  fingerprint_model: string;
  sales_count: number;
  km_band: string;
  price_band: string;
  match_score: number;
  reasons: Record<string, string>;
  status: string;
  created_at: string;
}

function ScoreBadge({ score }: { score: number }) {
  const variant =
    score >= 80
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
      : score >= 70
        ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";

  return (
    <Badge variant="outline" className={variant}>
      {score}/100
    </Badge>
  );
}

function KmBandBadge({ band }: { band: string }) {
  const styles: Record<string, string> = {
    inside: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    near: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    outside: "bg-destructive/15 text-destructive border-destructive/30",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={styles[band] || styles.unknown}>
      {band}
    </Badge>
  );
}

function PriceBandBadge({ band }: { band: string }) {
  const styles: Record<string, string> = {
    below: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    near: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    above: "bg-destructive/15 text-destructive border-destructive/30",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={styles[band] || styles.unknown}>
      {band}
    </Badge>
  );
}

export default function MatchesInboxPage() {
  useDocumentTitle(0);
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // Auto-select first account
  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const [opportunities, setOpportunities] = useState<MatchedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"open" | "dismissed" | "actioned" | "all">("open");

  const fetchOpportunities = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    try {
      let query = supabase
        .from("matched_opportunities_v1")
        .select("*")
        .eq("account_id", selectedAccountId)
        .order("match_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setOpportunities((data as MatchedOpportunity[]) || []);
    } catch (err) {
      console.error("Failed to load opportunities:", err);
      toast.error("Failed to load matched opportunities");
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, statusFilter]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const runMatchEngine = async () => {
    if (!selectedAccountId) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "fingerprint-match-run",
        { body: { account_id: selectedAccountId } }
      );
      if (error) throw error;
      toast.success(
        `Match engine complete: ${data?.matched ?? 0} matched, ${data?.skipped ?? 0} skipped`
      );
      fetchOpportunities();
    } catch (err) {
      toast.error(
        "Match engine failed: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    } finally {
      setRunning(false);
    }
  };

  const updateStatus = async (
    id: string,
    newStatus: "dismissed" | "actioned"
  ) => {
    try {
      const { error } = await supabase
        .from("matched_opportunities_v1")
        .update({ status: newStatus })
        .eq("id", id);
      if (error) throw error;
      setOpportunities((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o))
      );
      toast.success(
        newStatus === "dismissed" ? "Dismissed" : "Sent to Dave"
      );
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const openCount = opportunities.filter((o) => o.status === "open").length;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <Target className="h-6 w-6 text-primary" />
              Matches Inbox
            </h1>
            <p className="text-sm text-muted-foreground">
              Fingerprint-matched opportunities from normalized listings
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSelector value={selectedAccountId} onChange={setSelectedAccountId} />
            <Button
              onClick={runMatchEngine}
              disabled={running || !selectedAccountId}
              size="sm"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Run Match Engine
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchOpportunities}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold">{openCount}</div>
              <div className="text-xs text-muted-foreground">Open Matches</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold">
                {opportunities.filter((o) => o.match_score >= 80).length}
              </div>
              <div className="text-xs text-muted-foreground">
                High Score (80+)
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold">
                {opportunities.filter((o) => o.price_band === "below").length}
              </div>
              <div className="text-xs text-muted-foreground">Below Median</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold">
                {
                  opportunities.filter((o) => o.status === "actioned")
                    .length
                }
              </div>
              <div className="text-xs text-muted-foreground">Actioned</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {(["open", "dismissed", "actioned", "all"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "open" ? "Open" : s === "dismissed" ? "Dismissed" : s === "actioned" ? "Actioned" : "All"}
              {s === "open" && openCount > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {openCount}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : opportunities.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-medium text-foreground mb-1">
                No matches found
              </h3>
              <p className="text-sm text-muted-foreground">
                {statusFilter === "open"
                  ? "Run the match engine to generate opportunities from your sales fingerprints."
                  : `No ${statusFilter} opportunities.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Score</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="hidden sm:table-cell">KM</TableHead>
                  <TableHead className="hidden sm:table-cell">Price</TableHead>
                  <TableHead>KM Band</TableHead>
                  <TableHead>Price Band</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Sales Count
                  </TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((opp) => (
                  <TableRow key={opp.id}>
                    <TableCell>
                      <ScoreBadge score={opp.match_score} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">
                        {opp.year} {opp.make} {opp.model}
                      </div>
                      <a
                        href={opp.url_canonical}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                      >
                        View listing{" "}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {opp.km != null
                        ? `${Math.round(opp.km / 1000)}k`
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {opp.asking_price != null
                        ? `$${opp.asking_price.toLocaleString()}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <KmBandBadge band={opp.km_band} />
                    </TableCell>
                    <TableCell>
                      <PriceBandBadge band={opp.price_band} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1 text-sm">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        {opp.sales_count}
                      </div>
                    </TableCell>
                    <TableCell>
                      {opp.status === "open" ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              updateStatus(opp.id, "actioned")
                            }
                            title="Alert Dave"
                          >
                            <Bell className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              updateStatus(opp.id, "dismissed")
                            }
                            title="Dismiss"
                          >
                            <XCircle className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs capitalize"
                        >
                          {opp.status}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Why it matched - tooltip/expandable for first visible opportunity */}
        {opportunities.length > 0 && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Match Reasoning (top result)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(opportunities[0].reasons || {}).map(
                  ([key, value]) => (
                    <Badge
                      key={key}
                      variant="secondary"
                      className="text-xs"
                    >
                      {value}
                    </Badge>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
