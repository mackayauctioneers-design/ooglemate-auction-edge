import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts } from "@/hooks/useAccounts";
import { useAuth } from "@/contexts/AuthContext";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { createDealFromOpportunity } from "@/hooks/useDeals";
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
import { Card, CardContent } from "@/components/ui/card";
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
  ChevronDown,
  ChevronUp,
  FileText,
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
  transmission: string | null;
  body_type: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  source_searched: string | null;
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

function BandBadge({ band, type }: { band: string; type: "km" | "price" }) {
  const goodLabel = type === "price" ? "below" : "inside";
  const styles: Record<string, string> = {
    [goodLabel]: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    near: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    outside: "bg-destructive/15 text-destructive border-destructive/30",
    above: "bg-destructive/15 text-destructive border-destructive/30",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={styles[band] || styles.unknown}>
      {band}
    </Badge>
  );
}

function WhyMatchedPanel({ reasons }: { reasons: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(reasons || {});
  const positiveEntries = entries.filter(([, v]) => v.includes("(+") && !v.includes("(+0)"));
  const neutralEntries = entries.filter(([, v]) => v.includes("(+0)") || !v.includes("(+"));
  const preview = positiveEntries.slice(0, 2);

  return (
    <div className="space-y-1">
      {preview.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="text-[10px] leading-tight block w-fit">
          {value}
        </Badge>
      ))}
      {entries.length > 2 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Less" : `+${entries.length - 2} more`}
        </button>
      )}
      {expanded && (
        <div className="space-y-1 mt-1">
          {positiveEntries.slice(2).map(([key, value]) => (
            <Badge key={key} variant="secondary" className="text-[10px] leading-tight block w-fit">
              {value}
            </Badge>
          ))}
          {neutralEntries.map(([key, value]) => (
            <Badge key={key} variant="outline" className="text-[10px] leading-tight block w-fit text-muted-foreground">
              {value}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatchesInboxPage() {
  useDocumentTitle(0);
  const { data: accounts } = useAccounts();
  const { currentUser } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const [opportunities, setOpportunities] = useState<MatchedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"open" | "dismissed" | "actioned" | "all">("open");
  const [existingDealMap, setExistingDealMap] = useState<Record<string, string>>({});
  const [creatingDeal, setCreatingDeal] = useState<string | null>(null);

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

      // Check which opportunities already have deals
      const { data: deals } = await supabase
        .from("deal_truth_ledger")
        .select("id, matched_opportunity_id")
        .eq("account_id", selectedAccountId)
        .not("matched_opportunity_id", "is", null);

      const map: Record<string, string> = {};
      (deals || []).forEach((d: any) => {
        if (d.matched_opportunity_id) map[d.matched_opportunity_id] = d.id;
      });
      setExistingDealMap(map);
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

  const updateStatus = async (id: string, newStatus: "dismissed" | "actioned") => {
    try {
      const { error } = await supabase
        .from("matched_opportunities_v1")
        .update({ status: newStatus })
        .eq("id", id);
      if (error) throw error;
      setOpportunities((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o))
      );
      toast.success(newStatus === "dismissed" ? "Dismissed" : "Sent to Dave");
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const handleCreateDeal = async (opp: MatchedOpportunity) => {
    setCreatingDeal(opp.id);
    try {
      const deal = await createDealFromOpportunity(opp, currentUser?.email || currentUser?.dealer_name || "unknown");
      setExistingDealMap((prev) => ({ ...prev, [opp.id]: deal.id }));
      toast.success("Deal created — redirecting to deal page");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("duplicate")) {
        toast.error("A deal already exists for this opportunity");
      } else {
        toast.error("Failed to create deal: " + msg);
      }
    } finally {
      setCreatingDeal(null);
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
              Supply surfaced by proven sales truth — identity-aligned scoring v1.5
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSelector value={selectedAccountId} onChange={setSelectedAccountId} />
            <Button onClick={runMatchEngine} disabled={running || !selectedAccountId} size="sm">
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Run Match Engine
            </Button>
            <Button variant="outline" size="sm" onClick={fetchOpportunities} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
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
              <div className="text-xs text-muted-foreground">High Score (80+)</div>
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
                {opportunities.filter((o) => o.status === "actioned").length}
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
              <h3 className="font-medium text-foreground mb-1">No matches found</h3>
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
                  <TableHead>Bands</TableHead>
                  <TableHead className="hidden md:table-cell">Identity</TableHead>
                  <TableHead className="hidden lg:table-cell">Why Matched</TableHead>
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
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                        <TrendingUp className="h-3 w-3" />
                        {opp.sales_count} proven sales
                      </div>
                      <a
                        href={opp.url_canonical}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                      >
                        View listing <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {opp.km != null ? `${Math.round(opp.km / 1000)}k` : "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {opp.asking_price != null ? `$${opp.asking_price.toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <BandBadge band={opp.km_band} type="km" />
                        <BandBadge band={opp.price_band} type="price" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {opp.transmission && (
                          <Badge variant="outline" className="text-[10px]">
                            {opp.transmission}
                          </Badge>
                        )}
                        {opp.body_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {opp.body_type}
                          </Badge>
                        )}
                        {opp.fuel_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {opp.fuel_type}
                          </Badge>
                        )}
                        {opp.source_searched && (
                          <Badge variant="outline" className="text-[10px] bg-muted">
                            {opp.source_searched}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <WhyMatchedPanel reasons={opp.reasons} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Create Deal / Open Deal */}
                        {existingDealMap[opp.id] ? (
                          <Link to={`/deals/${existingDealMap[opp.id]}`}>
                            <Button variant="outline" size="sm" title="Open Deal">
                              <FileText className="h-3 w-3 mr-1" />
                              <span className="hidden sm:inline text-xs">Deal</span>
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleCreateDeal(opp)}
                            disabled={creatingDeal === opp.id}
                            title="Create Deal"
                          >
                            {creatingDeal === opp.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <FileText className="h-3 w-3 mr-1" />
                                <span className="hidden sm:inline text-xs">Deal</span>
                              </>
                            )}
                          </Button>
                        )}
                        {opp.status === "open" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateStatus(opp.id, "actioned")}
                              title="Alert Dave"
                            >
                              <Bell className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateStatus(opp.id, "dismissed")}
                              title="Dismiss"
                            >
                              <XCircle className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </>
                        )}
                        {opp.status !== "open" && !existingDealMap[opp.id] && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {opp.status}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Guiding principle */}
        <div className="text-xs text-muted-foreground text-center py-2">
          Cars do not have universal value. These matches are based solely on what you've proven you can sell.
        </div>
      </div>
    </AppLayout>
  );
}
