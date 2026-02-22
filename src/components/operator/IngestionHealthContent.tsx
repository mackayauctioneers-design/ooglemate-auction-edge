import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, XCircle, MapPin, Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IngestionSourceHealthGrid } from "./IngestionSourceHealthGrid";

interface TrapStat {
  region_id: string;
  enabled_count: number;
  total_count: number;
}

interface CrawlStats {
  vehicles_found: number;
  vehicles_ingested: number;
  vehicles_dropped: number;
  crawl_runs: number;
}

interface JobQueue {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface DropReason {
  drop_reason: string;
  count: number;
}

interface BenchmarkCoverage {
  region_id: string;
  total_deals: number;
  benchmarked: number;
  coverage_pct: number;
}

interface NswRegionalRun {
  source: string;
  created: number;
  updated: number;
  dropped: number;
  dropReasons: Record<string, number>;
  runAt: string;
}

interface AuctionSourceStat {
  source_key: string;
  display_name: string;
  platform: string;
  region_hint: string;
  enabled: boolean;
  last_success_at: string | null;
  last_lots_found: number | null;
  today_runs: number;
  today_created: number;
  today_updated: number;
  today_dropped: number;
}

interface V2Adoption {
  total: number;
  v2: number;
  v2_pct: number;
}

interface SalesSyncHealth {
  total_rows: number;
  latest_sale_date: string | null;
  latest_updated_at: string | null;
  sync_freshness_hours: number | null;
  status: "empty" | "broken" | "fresh" | "stale" | "critical";
}

interface BenchmarkSummary {
  total_deals: number;
  benchmarked: number;
  coverage_pct: number;
  by_region: Array<{
    region_id: string;
    total_deals: number;
    benchmarked: number;
    coverage_pct: number;
  }>;
}

interface BuyWindowSummary {
  total: number;
  auctions: number;
  traps: number;
  unassigned: number;
  assigned: number;
  top_unassigned: Array<{
    id: string;
    source_class: string;
    source: string;
    make: string;
    model: string;
    variant: string;
    year: number;
    km: number;
    location: string;
    buy_window_at: string;
    watch_reason: string;
    watch_confidence: string;
    listing_url: string;
  }>;
}

interface HealthData {
  traps: TrapStat[];
  crawlToday: CrawlStats | null;
  clearanceToday: number;
  fingerprintsToday: number;
  jobQueue: JobQueue | null;
  dropReasons: DropReason[];
  benchmarkCoverage: BenchmarkCoverage[];
  nswRegionalRuns: NswRegionalRun[];
  auctionSources: AuctionSourceStat[];
  v2Adoption: V2Adoption | null;
  benchmarkSummary: BenchmarkSummary | null;
  buyWindow: BuyWindowSummary | null;
  salesSync: SalesSyncHealth | null;
  lastRefresh: Date;
}

/**
 * Reusable Ingestion Health content component.
 * Used by both operator and legacy pages.
 */
export function IngestionHealthContent() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const [trapsRes, crawlRes, clearanceRes, fingerprintsRes, jobQueueRes, dropReasonsRes, benchmarkRes, nswRegionalRes, auctionSourcesRes, v2AdoptionRes, benchmarkSummaryRes, buyWindowRes, salesSyncRes] = await Promise.all([
        supabase.rpc('get_nsw_trap_stats' as never),
        supabase.rpc('get_nsw_crawl_today' as never),
        supabase.rpc('get_clearance_today' as never),
        supabase.rpc('get_fingerprints_today' as never),
        supabase.rpc('get_job_queue_stats' as never),
        supabase.rpc('get_top_drop_reasons' as never),
        supabase.rpc('get_benchmark_coverage' as never),
        // Fetch NSW regional auction runs from ingestion_runs
        supabase
          .from('ingestion_runs')
          .select('source, lots_created, lots_updated, started_at, metadata')
          .like('source', 'nsw-regional-%')
          .gte('started_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .order('started_at', { ascending: false }),
        // Fetch auction sources with stats
        supabase.rpc('get_auction_source_stats' as never),
        // v2 adoption and benchmark summary
        supabase.rpc('get_fingerprint_v2_adoption' as never),
        supabase.rpc('get_benchmark_coverage_summary' as never),
        supabase.rpc('get_buy_window_summary' as never),
        // Sales sync health
        supabase.rpc('get_sales_sync_health' as never),
      ]);

      // Parse NSW regional runs
      const nswRegionalRuns: NswRegionalRun[] = [];
      if (nswRegionalRes.data) {
        const runsBySource: Record<string, NswRegionalRun> = {};
        for (const run of nswRegionalRes.data as { source: string; lots_created: number; lots_updated: number; started_at: string; metadata: Record<string, unknown> }[]) {
          const sourceKey = run.source.replace('nsw-regional-', '');
          if (!runsBySource[sourceKey]) {
            const meta = run.metadata || {};
            runsBySource[sourceKey] = {
              source: sourceKey,
              created: run.lots_created || 0,
              updated: run.lots_updated || 0,
              dropped: (meta.dropped as number) || 0,
              dropReasons: (meta.dropReasons as Record<string, number>) || {},
              runAt: run.started_at,
            };
          } else {
            // Aggregate if multiple runs per source today
            const meta = run.metadata || {};
            runsBySource[sourceKey].created += run.lots_created || 0;
            runsBySource[sourceKey].updated += run.lots_updated || 0;
            runsBySource[sourceKey].dropped += (meta.dropped as number) || 0;
            // Merge drop reasons
            const newReasons = (meta.dropReasons as Record<string, number>) || {};
            for (const [k, v] of Object.entries(newReasons)) {
              runsBySource[sourceKey].dropReasons[k] = (runsBySource[sourceKey].dropReasons[k] || 0) + v;
            }
          }
        }
        nswRegionalRuns.push(...Object.values(runsBySource));
      }

      setHealth({
        traps: (trapsRes.data as TrapStat[]) || [],
        crawlToday: (crawlRes.data as CrawlStats[])?.[0] || null,
        clearanceToday: (clearanceRes.data as { count: number }[])?.[0]?.count || 0,
        fingerprintsToday: (fingerprintsRes.data as { count: number }[])?.[0]?.count || 0,
        jobQueue: (jobQueueRes.data as JobQueue[])?.[0] || null,
        dropReasons: (dropReasonsRes.data as DropReason[]) || [],
        benchmarkCoverage: (benchmarkRes.data as BenchmarkCoverage[]) || [],
        nswRegionalRuns,
        auctionSources: (auctionSourcesRes.data as AuctionSourceStat[]) || [],
        v2Adoption: (v2AdoptionRes.data as V2Adoption[])?.[0] || null,
        benchmarkSummary: (benchmarkSummaryRes.data as BenchmarkSummary[])?.[0] || null,
        buyWindow: (buyWindowRes.data as BuyWindowSummary[])?.[0] || null,
        salesSync: (salesSyncRes.data as SalesSyncHealth[])?.[0] || null,
        lastRefresh: new Date(),
      });
    } catch (err) {
      console.error("Failed to fetch health data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalEnabled = health?.traps.reduce((sum, r) => sum + r.enabled_count, 0) || 0;

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">NSW Ingestion Health</h1>
          <p className="text-muted-foreground text-sm">
            Daily crawl status and pipeline metrics
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && !health ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* Ingestion Source Health Grid */}
          <IngestionSourceHealthGrid />

          {/* Job Queue Status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Job Queue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <span className="font-mono">{health?.jobQueue?.pending || 0}</span>
                  <span className="text-muted-foreground text-sm">pending</span>
                </div>
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
                  <span className="font-mono">{health?.jobQueue?.processing || 0}</span>
                  <span className="text-muted-foreground text-sm">processing</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="font-mono">{health?.jobQueue?.completed || 0}</span>
                  <span className="text-muted-foreground text-sm">completed</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="font-mono">{health?.jobQueue?.failed || 0}</span>
                  <span className="text-muted-foreground text-sm">failed</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Traps by Region */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Total Enabled</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{totalEnabled}</div>
                <p className="text-muted-foreground text-sm">NSW traps</p>
              </CardContent>
            </Card>
            {health?.traps.map((r) => (
              <Card key={r.region_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{r.region_id.replace(/_/g, " ")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold">{r.enabled_count}</span>
                    <span className="text-muted-foreground text-sm">/ {r.total_count}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Crawl Stats Today */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Vehicles Found</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">
                  {health?.crawlToday?.vehicles_found || 0}
                </div>
                <p className="text-muted-foreground text-sm">today</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ingested</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {health?.crawlToday?.vehicles_ingested || 0}
                </div>
                <p className="text-muted-foreground text-sm">new/updated</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Dropped</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-500">
                  {health?.crawlToday?.vehicles_dropped || 0}
                </div>
                <p className="text-muted-foreground text-sm">quality gate</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Crawl Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {health?.crawlToday?.crawl_runs || 0}
                </div>
                <p className="text-muted-foreground text-sm">today</p>
              </CardContent>
            </Card>
          </div>

          {/* Machine Fed Cards: v2 Adoption & Benchmark Coverage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fingerprint v2 Adoption */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Fingerprint v2 Adoption</CardTitle>
              </CardHeader>
              <CardContent>
                {health?.v2Adoption ? (
                  <div className="space-y-2">
                    <div className="text-3xl font-semibold">
                      {health.v2Adoption.v2_pct}%
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {health.v2Adoption.v2.toLocaleString()} / {health.v2Adoption.total.toLocaleString()} dealer-grade listings
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No data</div>
                )}
              </CardContent>
            </Card>

            {/* Benchmark Coverage */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Benchmark Coverage</CardTitle>
              </CardHeader>
              <CardContent>
                {health?.benchmarkSummary ? (
                  <div className="space-y-3">
                    <div className="text-3xl font-semibold">
                      {health.benchmarkSummary.coverage_pct}%
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {health.benchmarkSummary.benchmarked.toLocaleString()} / {health.benchmarkSummary.total_deals.toLocaleString()} trap deals benchmarked
                    </div>

                    {/* Mini region breakdown (top 5) */}
                    <div className="space-y-2 pt-2">
                      {(Array.isArray(health.benchmarkSummary.by_region) ? health.benchmarkSummary.by_region : [])
                        .slice(0, 5)
                        .map((r) => (
                          <div key={r.region_id} className="flex items-center justify-between text-sm">
                            <div className="text-muted-foreground">
                              {String(r.region_id || '').replace(/_/g, ' ')}
                            </div>
                            <div className="font-medium">
                              {r.coverage_pct}% ({r.benchmarked}/{r.total_deals})
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No data</div>
                )}
              </CardContent>
            </Card>

            {/* Sales Sync Health */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Sales Sync Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {health?.salesSync ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-2xl font-semibold">
                        {health.salesSync.status.toUpperCase()}
                      </div>
                      <Badge
                        className={
                          health.salesSync.status === "fresh"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                            : health.salesSync.status === "stale"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
                            : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
                        }
                        variant="outline"
                      >
                        {health.salesSync.sync_freshness_hours !== null
                          ? `${health.salesSync.sync_freshness_hours}h old`
                          : "—"}
                      </Badge>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      Rows: {health.salesSync.total_rows?.toLocaleString() ?? "—"}
                    </div>

                    <div className="text-sm text-muted-foreground">
                      Latest sale date:{" "}
                      {health.salesSync.latest_sale_date
                        ? new Date(health.salesSync.latest_sale_date).toLocaleDateString()
                        : "—"}
                    </div>

                    <div className="text-sm text-muted-foreground">
                      Last sync:{" "}
                      {health.salesSync.latest_updated_at
                        ? new Date(health.salesSync.latest_updated_at).toLocaleString()
                        : "—"}
                    </div>

                    {(health.salesSync.status === "stale" ||
                      health.salesSync.status === "critical" ||
                      health.salesSync.status === "empty" ||
                      health.salesSync.status === "broken") && (
                      <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-200">
                        Sales data is not fresh. Bob's "last equivalent sale" may be wrong
                        until the sync runs.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No data</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Buy Window */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Buy Window</CardTitle>
            </CardHeader>
            <CardContent>
              {health?.buyWindow ? (
                <div className="space-y-3">
                  <div className="text-3xl font-semibold">
                    {health.buyWindow.total ?? 0}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>Auctions: <span className="font-medium">{health.buyWindow.auctions ?? 0}</span></div>
                    <div>Traps: <span className="font-medium">{health.buyWindow.traps ?? 0}</span></div>
                    <div>Unassigned: <span className="font-medium">{health.buyWindow.unassigned ?? 0}</span></div>
                    <div>Assigned: <span className="font-medium">{health.buyWindow.assigned ?? 0}</span></div>
                  </div>

                  {Array.isArray(health.buyWindow.top_unassigned) && health.buyWindow.top_unassigned.length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <div className="text-xs text-muted-foreground mb-2">
                        Top unassigned (latest first)
                      </div>
                      <div className="space-y-2">
                        {health.buyWindow.top_unassigned.slice(0, 5).map((x) => (
                          <div key={x.id} className="text-sm">
                            <div className="font-medium">
                              {x.year} {x.make} {x.model} {x.variant ? `(${x.variant})` : ''}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {x.source_class === 'auction' ? 'Auction' : 'Trap'} • {x.location || '—'} • {x.watch_confidence || '—'} • {x.watch_reason || '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No data</div>
              )}
            </CardContent>
          </Card>

          {/* Drop Reasons & Pipeline Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Drop Reasons</CardTitle>
              </CardHeader>
              <CardContent>
                {health?.dropReasons.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No drops today</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {health?.dropReasons.map((d) => (
                      <Badge key={d.drop_reason} variant="secondary">
                        {d.drop_reason.replace(/_/g, " ")}: {d.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pipeline Outputs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Clearance events</span>
                  <span className="font-mono">{health?.clearanceToday || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Fingerprint outcomes</span>
                  <span className="font-mono">{health?.fingerprintsToday || 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* NSW Regional Auctions */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">NSW Regional Auctions</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">
                Today's ingestion from F3, Valley, and other regional sources
              </p>
            </CardHeader>
            <CardContent>
              {health?.nswRegionalRuns.length === 0 ? (
                <p className="text-muted-foreground text-sm">No regional auction runs today</p>
              ) : (
                <div className="space-y-4">
                  {health?.nswRegionalRuns.map((run) => (
                    <div key={run.source} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium uppercase">{run.source}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(run.runAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Created</span>
                          <span className="font-mono text-green-600">{run.created}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Updated</span>
                          <span className="font-mono">{run.updated}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Dropped</span>
                          <span className="font-mono text-orange-500">{run.dropped}</span>
                        </div>
                      </div>
                      {Object.keys(run.dropReasons).length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {Object.entries(run.dropReasons).map(([reason, count]) => (
                            <Badge key={reason} variant="outline" className="text-xs">
                              {reason.replace(/_/g, ' ')}: {count}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Auction Sources Registry */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Gavel className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Auction Sources</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">
                BidsOnline and custom auction feeds
              </p>
            </CardHeader>
            <CardContent>
              {health?.auctionSources.length === 0 ? (
                <p className="text-muted-foreground text-sm">No auction sources configured</p>
              ) : (
                <div className="space-y-3">
                  {health?.auctionSources.map((src) => (
                    <div key={src.source_key} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{src.display_name}</span>
                          <Badge variant={src.enabled ? "default" : "secondary"} className="text-xs">
                            {src.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <Badge variant="outline" className="text-xs">{src.platform}</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {src.region_hint.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Today Runs</span>
                          <span className="font-mono">{src.today_runs}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Created</span>
                          <span className="font-mono text-green-600">{src.today_created}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Updated</span>
                          <span className="font-mono">{src.today_updated}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground text-xs">Dropped</span>
                          <span className="font-mono text-orange-500">{src.today_dropped}</span>
                        </div>
                      </div>
                      {src.last_success_at && (
                        <div className="text-xs text-muted-foreground">
                          Last success: {new Date(src.last_success_at).toLocaleString()} ({src.last_lots_found ?? 0} lots)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Benchmark Coverage */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Benchmark Coverage</CardTitle>
              <p className="text-xs text-muted-foreground">
                % of trap_deals with fingerprint_price populated (enables deal alerts)
              </p>
            </CardHeader>
            <CardContent>
              {health?.benchmarkCoverage.length === 0 ? (
                <p className="text-muted-foreground text-sm">No trap deals yet</p>
              ) : (
                <div className="space-y-3">
                  {health?.benchmarkCoverage.map((bc) => (
                    <div key={bc.region_id} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{bc.region_id.replace(/_/g, " ")}</span>
                        <span className="font-mono">
                          {bc.benchmarked} / {bc.total_deals} ({bc.coverage_pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all ${
                            bc.coverage_pct >= 50 ? 'bg-green-500' : 
                            bc.coverage_pct >= 20 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(bc.coverage_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stabilization Notice */}
          <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    Feeding Mode Active
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    No new parsers or regions for 7–14 days. Focus on stability and data quality.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-right">
            Last refresh: {health?.lastRefresh.toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}
