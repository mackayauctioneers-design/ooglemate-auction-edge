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
  high_confidence: number;
  med_confidence: number;
  low_confidence: number;
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
      // Get status counts
      const { data: statusData } = await supabase
        .from("stub_anchors")
        .select("status, confidence")
        .limit(10000);
      
      const stats: StubStats = {
        total: statusData?.length || 0,
        pending: 0,
        matched: 0,
        enriched: 0,
        exception: 0,
        high_confidence: 0,
        med_confidence: 0,
        low_confidence: 0,
      };

      statusData?.forEach((row) => {
        if (row.status === "pending") stats.pending++;
        if (row.status === "matched") stats.matched++;
        if (row.status === "enriched") stats.enriched++;
        if (row.status === "exception") stats.exception++;
        if (row.confidence === "high") stats.high_confidence++;
        if (row.confidence === "med") stats.med_confidence++;
        if (row.confidence === "low") stats.low_confidence++;
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
              <Clock className="h-4 w-4 text-yellow-500" />
              <span className="text-2xl font-bold">{stubStats?.pending || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Pending Match</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stubStats?.matched || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Hunt Matched</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
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
            <CardTitle className="text-sm">Confidence Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500 w-16">High</Badge>
              <Progress 
                value={(stubStats.high_confidence / stubStats.total) * 100} 
                className="flex-1"
              />
              <span className="text-sm w-12 text-right">{stubStats.high_confidence}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-yellow-500 w-16">Med</Badge>
              <Progress 
                value={(stubStats.med_confidence / stubStats.total) * 100} 
                className="flex-1"
              />
              <span className="text-sm w-12 text-right">{stubStats.med_confidence}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-red-500 w-16">Low</Badge>
              <Progress 
                value={(stubStats.low_confidence / stubStats.total) * 100} 
                className="flex-1"
              />
              <span className="text-sm w-12 text-right">{stubStats.low_confidence}</span>
            </div>
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
