import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Target } from "lucide-react";
import { toast } from "sonner";

interface FingerprintMetric {
  id: string;
  platform_class: string;
  account_id: string | null;
  matches_detected: number;
  matches_reviewed: number;
  matches_approved: number;
  matches_purchased: number;
  matches_closed: number;
  matches_profitable: number;
  matches_lossmaking: number;
  avg_expected_margin: number;
  avg_realized_margin: number;
  avg_days_to_sell: number;
  approval_rate: number;
  purchase_rate: number;
  profit_hit_rate: number;
  false_signal_rate: number;
  fingerprint_accuracy_score: number;
  governance_status: string;
  last_recomputed_at: string | null;
}

type SortField = "fingerprint_accuracy_score" | "matches_detected" | "profit_hit_rate" | "avg_realized_margin" | "matches_purchased";

export default function FingerprintPerformancePage() {
  const [metrics, setMetrics] = useState<FingerprintMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [sortField, setSortField] = useState<SortField>("fingerprint_accuracy_score");
  const [sortAsc, setSortAsc] = useState(false);

  async function loadMetrics() {
    setLoading(true);
    const { data, error } = await supabase
      .from("fingerprint_performance_metrics")
      .select("*")
      .order("fingerprint_accuracy_score", { ascending: false })
      .limit(500);

    if (error) {
      toast.error("Failed to load metrics");
      console.error(error);
    } else {
      setMetrics((data || []) as unknown as FingerprintMetric[]);
    }
    setLoading(false);
  }

  async function triggerRecompute() {
    setRecomputing(true);
    try {
      const { data, error } = await supabase.functions.invoke("recompute-fingerprint-performance");
      if (error) throw error;
      toast.success(`Recomputed ${data?.metrics_computed || 0} fingerprints`);
      await loadMetrics();
    } catch (err: any) {
      toast.error(err.message || "Recompute failed");
    }
    setRecomputing(false);
  }

  useEffect(() => { loadMetrics(); }, []);

  const sorted = [...metrics].sort((a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function handleSort(field: SortField) {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  }

  // Summary stats
  const total = metrics.length;
  const highPerf = metrics.filter(m => m.fingerprint_accuracy_score >= 70).length;
  const weak = metrics.filter(m => m.governance_status === "weak" || m.governance_status === "review_required").length;
  const avgAccuracy = total > 0 ? Math.round(metrics.reduce((s, m) => s + m.fingerprint_accuracy_score, 0) / total) : 0;

  // Top dealer by avg accuracy
  const byAccount: Record<string, { sum: number; count: number }> = {};
  for (const m of metrics) {
    const key = m.account_id || "unassigned";
    if (!byAccount[key]) byAccount[key] = { sum: 0, count: 0 };
    byAccount[key].sum += m.fingerprint_accuracy_score;
    byAccount[key].count++;
  }
  let topDealer = "—";
  let topDealerScore = 0;
  for (const [k, v] of Object.entries(byAccount)) {
    const avg = v.sum / v.count;
    if (avg > topDealerScore && k !== "unassigned") { topDealerScore = avg; topDealer = k.slice(0, 8) + "…"; }
  }

  function govBadge(status: string) {
    if (status === "weak") return <Badge variant="destructive" className="text-xs">Weak</Badge>;
    if (status === "review_required") return <Badge className="bg-amber-600 text-xs">Review</Badge>;
    return <Badge variant="secondary" className="text-xs">Active</Badge>;
  }

  function accuracyColor(score: number): string {
    if (score >= 70) return "text-emerald-400 font-bold";
    if (score >= 40) return "text-foreground";
    if (score >= 25) return "text-amber-400";
    return "text-red-400 font-bold";
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fingerprint Performance</h1>
          <p className="text-sm text-muted-foreground">Closed-loop accuracy: which fingerprints actually make money</p>
        </div>
        <Button onClick={triggerRecompute} disabled={recomputing} size="sm" variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${recomputing ? "animate-spin" : ""}`} />
          {recomputing ? "Recomputing…" : "Recompute Now"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">Total Fingerprints</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><div className="text-2xl font-bold">{total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> High Performing</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><div className="text-2xl font-bold text-emerald-400">{highPerf}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Weak</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><div className="text-2xl font-bold text-red-400">{weak}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Avg Accuracy</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><div className="text-2xl font-bold">{avgAccuracy}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Top Dealer</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><div className="text-lg font-bold truncate">{topDealer} ({Math.round(topDealerScore)})</div></CardContent>
        </Card>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-muted-foreground text-center py-12">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-muted-foreground text-center py-12">No fingerprint metrics yet. Click "Recompute Now" to generate.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[180px]">Fingerprint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("matches_detected")}>Detected</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("matches_purchased")}>Purchased</TableHead>
                <TableHead>Profitable</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("profit_hit_rate")}>Hit Rate</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("avg_realized_margin")}>Avg Margin</TableHead>
                <TableHead>Avg Days</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("fingerprint_accuracy_score")}>Accuracy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m) => (
                <TableRow key={m.id} className={m.governance_status !== "active" ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">{m.platform_class}</TableCell>
                  <TableCell>{govBadge(m.governance_status)}</TableCell>
                  <TableCell>{m.matches_detected}</TableCell>
                  <TableCell>{m.matches_purchased}</TableCell>
                  <TableCell>
                    <span className="text-emerald-400">{m.matches_profitable}</span>
                    {m.matches_lossmaking > 0 && <span className="text-red-400 ml-1">/ {m.matches_lossmaking}</span>}
                  </TableCell>
                  <TableCell>{(m.profit_hit_rate * 100).toFixed(0)}%</TableCell>
                  <TableCell className={m.avg_realized_margin > 0 ? "text-emerald-400" : "text-red-400"}>
                    ${m.avg_realized_margin.toLocaleString()}
                  </TableCell>
                  <TableCell>{m.avg_days_to_sell > 0 ? `${m.avg_days_to_sell}d` : "—"}</TableCell>
                  <TableCell className={accuracyColor(m.fingerprint_accuracy_score)}>
                    {m.fingerprint_accuracy_score}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
