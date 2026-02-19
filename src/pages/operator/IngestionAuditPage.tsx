import { useEffect, useState } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle, Clock, Database, Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";

interface SourceRow {
  source: string;
  total: number;
  active: number;
  added_24h: number;
  updated_24h: number;
  older_30d: number;
  last_scrape: string | null;
  zombie_pct: number;
}

interface CreditRow {
  function_name: string;
  total_credits: number;
  total_calls: number;
  avg_per_call: number;
}

export default function IngestionAuditPage() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [totals, setTotals] = useState({ total: 0, active: 0, added_24h: 0, updated_24h: 0, older_30d: 0, credits_7d: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Ingestion Audit | Operator";
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Server-side aggregation — no row limit issues
      const { data: raw, error } = await supabase.rpc("rpc_ingestion_audit_sources" as any);
      
      if (error || !raw) {
        console.error("RPC failed, falling back:", error);
        await fetchFallback();
        return;
      }

      const rows = raw as SourceRow[];
      setSources(rows);
      setTotals({
        total: rows.reduce((s, r) => s + r.total, 0),
        active: rows.reduce((s, r) => s + r.active, 0),
        added_24h: rows.reduce((s, r) => s + r.added_24h, 0),
        updated_24h: rows.reduce((s, r) => s + r.updated_24h, 0),
        older_30d: rows.reduce((s, r) => s + r.older_30d, 0),
        credits_7d: 0,
      });

      // Firecrawl credit log
      const now = Date.now();
      const day = 86400000;
      const { data: creditData } = await supabase
        .from("firecrawl_credit_log")
        .select("function_name, estimated_credits, created_at")
        .gte("created_at", new Date(now - 7 * day).toISOString());

      if (creditData) {
        const byFn: Record<string, { total: number; calls: number }> = {};
        let total7d = 0;
        for (const c of creditData) {
          const fn = c.function_name || "unknown";
          if (!byFn[fn]) byFn[fn] = { total: 0, calls: 0 };
          const est = (c.estimated_credits as number) || 1;
          byFn[fn].total += est;
          byFn[fn].calls++;
          total7d += est;
        }
        setCredits(
          Object.entries(byFn)
            .map(([function_name, v]) => ({
              function_name,
              total_credits: v.total,
              total_calls: v.calls,
              avg_per_call: Math.round((v.total / v.calls) * 10) / 10,
            }))
            .sort((a, b) => b.total_credits - a.total_credits)
        );
        setTotals(prev => ({ ...prev, credits_7d: total7d }));
      }
    } catch {
      await fetchFallback();
    } finally {
      setLoading(false);
    }
  };

  const fetchFallback = async () => {
    // Pull all listings with minimal fields
    const { data: listings } = await supabase
      .from("vehicle_listings")
      .select("source, status, first_seen_at, last_seen_at")
      .limit(10000);

    if (!listings) { setLoading(false); return; }

    const now = Date.now();
    const day = 86400000;
    const cutoff24h = new Date(now - day).toISOString();
    const cutoff30d = new Date(now - 30 * day).toISOString();

    const bySource: Record<string, { total: number; active: number; added_24h: number; updated_24h: number; older_30d: number; last_scrape: string | null }> = {};

    for (const l of listings) {
      const s = l.source || "unknown";
      if (!bySource[s]) bySource[s] = { total: 0, active: 0, added_24h: 0, updated_24h: 0, older_30d: 0, last_scrape: null };
      const b = bySource[s];
      b.total++;
      if (l.status === "catalogue" || l.status === "listed") b.active++;
      if (l.first_seen_at && l.first_seen_at > cutoff24h) b.added_24h++;
      if (l.last_seen_at && l.last_seen_at > cutoff24h) b.updated_24h++;
      if (l.first_seen_at && l.first_seen_at < cutoff30d) b.older_30d++;
      if (!b.last_scrape || (l.last_seen_at && l.last_seen_at > b.last_scrape)) b.last_scrape = l.last_seen_at;
    }

    const rows: SourceRow[] = Object.entries(bySource)
      .map(([source, b]) => ({
        source,
        ...b,
        zombie_pct: b.total > 0 ? Math.round((b.older_30d / b.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    setSources(rows);

    setTotals({
      total: rows.reduce((s, r) => s + r.total, 0),
      active: rows.reduce((s, r) => s + r.active, 0),
      added_24h: rows.reduce((s, r) => s + r.added_24h, 0),
      updated_24h: rows.reduce((s, r) => s + r.updated_24h, 0),
      older_30d: rows.reduce((s, r) => s + r.older_30d, 0),
      credits_7d: 0,
    });

    // Firecrawl credit log
    const { data: creditData } = await supabase
      .from("firecrawl_credit_log")
      .select("function_name, estimated_credits, created_at")
      .gte("created_at", new Date(now - 7 * day).toISOString());

    if (creditData) {
      const byFn: Record<string, { total: number; calls: number }> = {};
      let total7d = 0;
      for (const c of creditData) {
        const fn = c.function_name || "unknown";
        if (!byFn[fn]) byFn[fn] = { total: 0, calls: 0 };
        const est = (c.estimated_credits as number) || 1;
        byFn[fn].total += est;
        byFn[fn].calls++;
        total7d += est;
      }
      setCredits(
        Object.entries(byFn)
          .map(([function_name, v]) => ({
            function_name,
            total_credits: v.total,
            total_calls: v.calls,
            avg_per_call: Math.round((v.total / v.calls) * 10) / 10,
          }))
          .sort((a, b) => b.total_credits - a.total_credits)
      );
      setTotals(prev => ({ ...prev, credits_7d: total7d }));
    }
  };

  useEffect(() => { fetchData(); }, []);

  const staleBadge = (lastScrape: string | null) => {
    if (!lastScrape) return <Badge variant="destructive">Never</Badge>;
    const hours = (Date.now() - new Date(lastScrape).getTime()) / 3600000;
    if (hours < 6) return <Badge className="bg-green-600 text-white">Live</Badge>;
    if (hours < 24) return <Badge className="bg-yellow-500 text-black">Stale</Badge>;
    if (hours < 72) return <Badge className="bg-orange-500 text-white">Cold</Badge>;
    return <Badge variant="destructive">Dead</Badge>;
  };

  return (
    <OperatorLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ingestion Audit</h1>
            <p className="text-sm text-muted-foreground">Visibility into scrape health, coverage, and credit usage</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* ── SUMMARY CARDS ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard icon={Database} label="Total Listings" value={totals.total} loading={loading} />
          <SummaryCard icon={CheckCircle} label="Active" value={totals.active} loading={loading} color="text-green-500" />
          <SummaryCard icon={Zap} label="Added 24h" value={totals.added_24h} loading={loading} color="text-blue-500" />
          <SummaryCard icon={RefreshCw} label="Updated 24h" value={totals.updated_24h} loading={loading} color="text-blue-500" />
          <SummaryCard icon={AlertTriangle} label="Zombies (30d+)" value={totals.older_30d} loading={loading} color="text-red-500" />
          <SummaryCard icon={Zap} label="Credits 7d" value={totals.credits_7d} loading={loading} color="text-amber-500" />
        </div>

        {/* ── PER-SOURCE TABLE ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Source Breakdown</CardTitle>
            <CardDescription>Per-source listing counts and freshness</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">+24h</TableHead>
                    <TableHead className="text-right">Updated 24h</TableHead>
                    <TableHead className="text-right">30d+ Zombie</TableHead>
                    <TableHead className="text-right">Zombie %</TableHead>
                    <TableHead>Last Scrape</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map(s => (
                    <TableRow key={s.source}>
                      <TableCell className="font-mono text-xs">{s.source}</TableCell>
                      <TableCell className="text-right">{s.total}</TableCell>
                      <TableCell className="text-right">{s.active}</TableCell>
                      <TableCell className="text-right">{s.added_24h}</TableCell>
                      <TableCell className="text-right">{s.updated_24h}</TableCell>
                      <TableCell className="text-right">{s.older_30d}</TableCell>
                      <TableCell className="text-right">
                        <span className={s.zombie_pct > 50 ? "text-red-500 font-semibold" : ""}>{s.zombie_pct}%</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.last_scrape ? (
                          <span title={format(new Date(s.last_scrape), "PPpp")}>
                            {formatDistanceToNow(new Date(s.last_scrape), { addSuffix: true })}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>{staleBadge(s.last_scrape)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ── FIRECRAWL CREDIT USAGE ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Firecrawl Credit Usage (7 days)</CardTitle>
            <CardDescription>Credits consumed per function</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : credits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No credit usage recorded in the last 7 days.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Function</TableHead>
                    <TableHead className="text-right">Total Credits</TableHead>
                    <TableHead className="text-right">Total Calls</TableHead>
                    <TableHead className="text-right">Avg/Call</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.map(c => (
                    <TableRow key={c.function_name}>
                      <TableCell className="font-mono text-xs">{c.function_name}</TableCell>
                      <TableCell className="text-right font-semibold">{c.total_credits}</TableCell>
                      <TableCell className="text-right">{c.total_calls}</TableCell>
                      <TableCell className="text-right">{c.avg_per_call}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}

function SummaryCard({ icon: Icon, label, value, loading, color }: { icon: any; label: string; value: number; loading: boolean; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col items-center gap-1">
        <Icon className={`h-5 w-5 ${color || "text-muted-foreground"}`} />
        {loading ? <Skeleton className="h-7 w-16" /> : <span className="text-xl font-bold">{value.toLocaleString()}</span>}
        <span className="text-xs text-muted-foreground text-center">{label}</span>
      </CardContent>
    </Card>
  );
}
