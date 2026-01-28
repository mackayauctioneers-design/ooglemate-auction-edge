import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Database, TrendingUp, AlertCircle, Clock } from "lucide-react";

interface IngestRun {
  id: string;
  source: string;
  region: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  pages_fetched: number;
  stubs_found: number;
  stubs_created: number;
  stubs_updated: number;
  exceptions_queued: number;
  deep_fetches_triggered: number;
}

interface StubStats {
  total: number;
  pending: number;
  matched: number;
  enriched: number;
  exception: number;
  identity_high: number;
  fingerprint_high: number;
  fingerprint_med: number;
  fingerprint_low: number;
}

export function StubIngestMetrics() {
  const { data: recentRuns } = useQuery({
    queryKey: ["stub-ingest-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stub_ingest_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(5);
      
      if (error) throw error;
      return data as IngestRun[];
    },
  });

  const { data: stubStats } = useQuery({
    queryKey: ["stub-anchor-stats"],
    queryFn: async () => {
      // Get status counts using raw query approach
      const { data: statusData } = await supabase
        .from("stub_anchors")
        .select("status, identity_confidence, fingerprint_confidence")
        .limit(10000);
      
      const stats: StubStats = {
        total: statusData?.length || 0,
        pending: 0,
        matched: 0,
        enriched: 0,
        exception: 0,
        identity_high: 0,
        fingerprint_high: 0,
        fingerprint_med: 0,
        fingerprint_low: 0,
      };

      statusData?.forEach((row: Record<string, string>) => {
        if (row.status === "pending") stats.pending++;
        if (row.status === "matched") stats.matched++;
        if (row.status === "enriched") stats.enriched++;
        if (row.status === "exception") stats.exception++;
        if (row.identity_confidence === "high") stats.identity_high++;
        if (row.fingerprint_confidence === "high") stats.fingerprint_high++;
        if (row.fingerprint_confidence === "med") stats.fingerprint_med++;
        if (row.fingerprint_confidence === "low") stats.fingerprint_low++;
      });

      return stats;
    },
  });

  const latestRun = recentRuns?.[0];

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <span className="text-2xl font-bold">{stubStats?.total || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Total Anchors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              <span className="text-2xl font-bold">{stubStats?.pending || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Pending Match</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <span className="text-2xl font-bold">{stubStats?.matched || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Hunt Matched</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-2xl font-bold">{stubStats?.exception || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Exceptions</p>
          </CardContent>
        </Card>
      </div>

      {/* Confidence Distribution */}
      {stubStats && stubStats.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Fingerprint Confidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="w-16">High</Badge>
              <Progress 
                value={(stubStats.fingerprint_high / stubStats.total) * 100} 
                className="flex-1"
              />
              <span className="text-sm w-12 text-right">{stubStats.fingerprint_high}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="w-16">Med</Badge>
              <Progress 
                value={(stubStats.fingerprint_med / stubStats.total) * 100} 
                className="flex-1"
              />
              <span className="text-sm w-12 text-right">{stubStats.fingerprint_med}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="w-16">Low</Badge>
              <Progress 
                value={(stubStats.fingerprint_low / stubStats.total) * 100} 
                className="flex-1"
              />
              <span className="text-sm w-12 text-right">{stubStats.fingerprint_low}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Identity verified: {stubStats.identity_high} / {stubStats.total}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Latest Run */}
      {latestRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              Latest Ingest Run
              <Badge variant={latestRun.status === "completed" ? "default" : "secondary"}>
                {latestRun.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Region:</span> {latestRun.region}
              </div>
              <div>
                <span className="text-muted-foreground">Pages:</span> {latestRun.pages_fetched}
              </div>
              <div>
                <span className="text-muted-foreground">Found:</span> {latestRun.stubs_found}
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span> {latestRun.stubs_created}
              </div>
              <div>
                <span className="text-muted-foreground">Updated:</span> {latestRun.stubs_updated}
              </div>
              <div>
                <span className="text-muted-foreground">Exceptions:</span> {latestRun.exceptions_queued}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {new Date(latestRun.started_at).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
