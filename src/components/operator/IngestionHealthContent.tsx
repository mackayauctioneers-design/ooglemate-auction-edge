import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

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

interface HealthData {
  traps: TrapStat[];
  crawlToday: CrawlStats | null;
  clearanceToday: number;
  fingerprintsToday: number;
  jobQueue: JobQueue | null;
  dropReasons: DropReason[];
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
      const [trapsRes, crawlRes, clearanceRes, fingerprintsRes, jobQueueRes, dropReasonsRes] = await Promise.all([
        supabase.rpc('get_nsw_trap_stats' as never),
        supabase.rpc('get_nsw_crawl_today' as never),
        supabase.rpc('get_clearance_today' as never),
        supabase.rpc('get_fingerprints_today' as never),
        supabase.rpc('get_job_queue_stats' as never),
        supabase.rpc('get_top_drop_reasons' as never),
      ]);

      setHealth({
        traps: (trapsRes.data as TrapStat[]) || [],
        crawlToday: (crawlRes.data as CrawlStats[])?.[0] || null,
        clearanceToday: (clearanceRes.data as { count: number }[])?.[0]?.count || 0,
        fingerprintsToday: (fingerprintsRes.data as { count: number }[])?.[0]?.count || 0,
        jobQueue: (jobQueueRes.data as JobQueue[])?.[0] || null,
        dropReasons: (dropReasonsRes.data as DropReason[]) || [],
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
