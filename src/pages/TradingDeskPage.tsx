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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ExternalLink, Loader2, RefreshCw, Zap, FileText,
  AlertTriangle, ChevronDown, ChevronUp, DollarSign,
} from "lucide-react";
import { toast } from "sonner";

interface Opportunity {
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
  status: string;
  created_at: string;
  transmission: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  source_searched: string | null;
  anchor_buy_price: number | null;
  anchor_sell_price: number | null;
  anchor_profit: number | null;
  anchor_days_to_sell: number | null;
  median_sell_price: number | null;
}

// ── Score badge ──
function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 85
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
      : score >= 70
        ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{score}</Badge>;
}

// ── Anchor sale mini-card ──
function AnchorSale({ opp }: { opp: Opportunity }) {
  const [open, setOpen] = useState(false);
  if (!opp.anchor_buy_price && !opp.anchor_sell_price && !opp.median_sell_price) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const hasFull = opp.anchor_buy_price && opp.anchor_sell_price;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-primary hover:underline flex items-center gap-0.5"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {hasFull ? "Anchor sale" : "Median"}
      </button>
      {open && (
        <div className="mt-1 p-2 rounded bg-muted/40 text-xs space-y-0.5">
          {hasFull ? (
            <>
              <div>Bought: <span className="font-medium">${opp.anchor_buy_price!.toLocaleString()}</span></div>
              <div>Sold: <span className="font-medium">${opp.anchor_sell_price!.toLocaleString()}</span></div>
              <div>Profit: <span className="font-semibold text-emerald-600">${opp.anchor_profit?.toLocaleString() ?? "—"}</span></div>
              {opp.anchor_days_to_sell != null && (
                <div>Days to sell: {opp.anchor_days_to_sell}</div>
              )}
            </>
          ) : (
            <div>Median sell: <span className="font-medium">${opp.median_sell_price?.toLocaleString()}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TradingDeskPage() {
  useDocumentTitle(0);
  const { data: accounts } = useAccounts();
  const { currentUser } = useAuth();
  const [accountId, setAccountId] = useState("");
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [existingDealMap, setExistingDealMap] = useState<Record<string, string>>({});
  const [creatingDeal, setCreatingDeal] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | "auction">("all");

  useEffect(() => {
    if (accounts?.length && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      let q = supabase
        .from("matched_opportunities_v1")
        .select("*")
        .eq("account_id", accountId)
        .eq("status", "open")
        .gte("match_score", 70)
        .order("match_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);

      if (sourceFilter === "auction") {
        q = q.in("source_searched", ["pickles", "grays", "manheim", "slattery"]);
      }

      const { data, error } = await q;
      if (error) throw error;
      setOpps((data as Opportunity[]) || []);

      // Deal lookup
      const { data: deals } = await supabase
        .from("deal_truth_ledger")
        .select("id, matched_opportunity_id")
        .eq("account_id", accountId)
        .not("matched_opportunity_id", "is", null);
      const map: Record<string, string> = {};
      (deals || []).forEach((d: any) => {
        if (d.matched_opportunity_id) map[d.matched_opportunity_id] = d.id;
      });
      setExistingDealMap(map);
    } catch (err) {
      toast.error("Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [accountId, sourceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runEngine = async () => {
    if (!accountId) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("fingerprint-match-run", {
        body: { account_id: accountId },
      });
      if (error) throw error;
      toast.success(`${data?.matched ?? 0} matches found`);
      fetchData();
    } catch (err) {
      toast.error("Match engine failed");
    } finally {
      setRunning(false);
    }
  };

  const dismiss = async (id: string) => {
    await supabase.from("matched_opportunities_v1").update({ status: "dismissed" }).eq("id", id);
    setOpps((prev) => prev.filter((o) => o.id !== id));
    toast.success("Dismissed");
  };

  const handleCreateDeal = async (opp: Opportunity) => {
    setCreatingDeal(opp.id);
    try {
      const deal = await createDealFromOpportunity(opp as any, currentUser?.email || "unknown");
      setExistingDealMap((prev) => ({ ...prev, [opp.id]: deal.id }));
      toast.success("Deal created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreatingDeal(null);
    }
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-primary" />
              Trading Desk
            </h1>
            <p className="text-sm text-muted-foreground">
              Fingerprint-backed buy opportunities — score ≥ 70
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSelector value={accountId} onChange={setAccountId} />
            <Button onClick={runEngine} disabled={running || !accountId} size="sm">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
              Scan
            </Button>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3 px-4"><div className="text-2xl font-bold">{opps.length}</div><div className="text-xs text-muted-foreground">Open</div></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4"><div className="text-2xl font-bold">{opps.filter(o => o.match_score >= 85).length}</div><div className="text-xs text-muted-foreground">High Conviction (85+)</div></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4"><div className="text-2xl font-bold">{opps.filter(o => o.price_band === "below").length}</div><div className="text-xs text-muted-foreground">Below Median</div></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 px-4"><div className="text-2xl font-bold">{opps.filter(o => ["pickles","grays","manheim","slattery"].includes(o.source_searched || "")).length}</div><div className="text-xs text-muted-foreground">Auction</div></CardContent></Card>
        </div>

        {/* Source filter */}
        <div className="flex gap-2">
          <Button variant={sourceFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setSourceFilter("all")}>All Sources</Button>
          <Button variant={sourceFilter === "auction" ? "default" : "outline"} size="sm" onClick={() => setSourceFilter("auction")}>Auctions Only</Button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : opps.length === 0 ? (
          <Card><CardContent className="py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-medium mb-1">No opportunities above threshold</h3>
            <p className="text-sm text-muted-foreground">Hit Scan to run the matching engine.</p>
          </CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Score</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="hidden sm:table-cell">KM</TableHead>
                  <TableHead className="hidden sm:table-cell">Asking</TableHead>
                  <TableHead className="hidden sm:table-cell">Sales</TableHead>
                  <TableHead className="hidden md:table-cell">Anchor Sale</TableHead>
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opps.map((opp) => (
                  <TableRow key={opp.id}>
                    <TableCell><ScoreBadge score={opp.match_score} /></TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{opp.year} {opp.make} {opp.model}</div>
                      {opp.transmission && <span className="text-[10px] text-muted-foreground">{opp.transmission}</span>}
                      {opp.drive_type && <span className="text-[10px] text-muted-foreground ml-1">· {opp.drive_type}</span>}
                      <a href={opp.url_canonical} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                        View listing <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {opp.km != null ? `${Math.round(opp.km / 1000)}k` : "—"}
                      <div className="mt-0.5">
                        <Badge variant="outline" className={`text-[10px] ${opp.km_band === "inside" ? "text-emerald-600 border-emerald-500/30" : opp.km_band === "near" ? "text-amber-600 border-amber-500/30" : "text-muted-foreground"}`}>
                          {opp.km_band}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {opp.asking_price != null ? `$${opp.asking_price.toLocaleString()}` : "—"}
                      <div className="mt-0.5">
                        <Badge variant="outline" className={`text-[10px] ${opp.price_band === "below" ? "text-emerald-600 border-emerald-500/30" : opp.price_band === "near" ? "text-amber-600 border-amber-500/30" : "text-muted-foreground"}`}>
                          {opp.price_band}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm font-medium">{opp.sales_count}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <AnchorSale opp={opp} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className="text-[10px]">{opp.source_searched || "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {existingDealMap[opp.id] ? (
                          <Link to={`/deals/${existingDealMap[opp.id]}`}>
                            <Button variant="outline" size="sm"><FileText className="h-3 w-3 mr-1" /><span className="hidden sm:inline text-xs">Deal</span></Button>
                          </Link>
                        ) : (
                          <Button variant="default" size="sm" onClick={() => handleCreateDeal(opp)} disabled={creatingDeal === opp.id}>
                            {creatingDeal === opp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><FileText className="h-3 w-3 mr-1" /><span className="hidden sm:inline text-xs">Deal</span></>}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => dismiss(opp.id)} className="text-muted-foreground hover:text-destructive">✕</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
