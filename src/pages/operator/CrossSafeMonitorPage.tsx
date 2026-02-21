import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Play, Clock, CheckCircle2, XCircle, AlertTriangle, PauseCircle,
  ArrowRight, Loader2
} from "lucide-react";
import { toast } from "sonner";

interface JobSummary {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  parked: number;
}

interface RecentJob {
  id: string;
  type: string;
  source: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  attempts: number;
  result: any;
}

interface Heartbeat {
  cron_name: string;
  last_seen_at: string;
  last_ok: boolean;
  note: string | null;
}

interface LifecycleSummary {
  NEW: number;
  STALE: number;
  DEAD: number;
  WATCH: number;
  AVOID: number;
}

export default function CrossSafeMonitorPage() {
  const [jobSummary, setJobSummary] = useState<JobSummary | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [lifecycle, setLifecycle] = useState<LifecycleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, recentRes, heartbeatRes, lifecycleRes] = await Promise.all([
        // Job counts by status (last 24h)
        supabase
          .from("crosssafe_jobs" as any)
          .select("status")
          .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()),
        // Recent jobs
        supabase
          .from("crosssafe_jobs" as any)
          .select("id, type, source, status, created_at, started_at, finished_at, error, attempts, result")
          .order("created_at", { ascending: false })
          .limit(20),
        // Heartbeats
        supabase
          .from("cron_heartbeat")
          .select("*")
          .in("cron_name", ["crosssafe-worker", "crosssafe-scheduler", "pickles-ingest-cron", "pickles-replication-cron"])
          .order("last_seen_at", { ascending: false }),
        // Lifecycle counts
        supabase
          .from("vehicle_listings")
          .select("lifecycle_state"),
      ]);

      // Summarize jobs
      const counts: JobSummary = { queued: 0, running: 0, succeeded: 0, failed: 0, parked: 0 };
      for (const row of (jobsRes.data || []) as any[]) {
        const s = row.status as keyof JobSummary;
        if (s in counts) counts[s]++;
      }
      setJobSummary(counts);
      setRecentJobs((recentRes.data as any[]) || []);
      setHeartbeats((heartbeatRes.data as Heartbeat[]) || []);

      // Lifecycle
      const lc: LifecycleSummary = { NEW: 0, STALE: 0, DEAD: 0, WATCH: 0, AVOID: 0 };
      for (const row of (lifecycleRes.data || []) as any[]) {
        const s = row.lifecycle_state as keyof LifecycleSummary;
        if (s in lc) lc[s]++;
      }
      setLifecycle(lc);
    } catch (err) {
      console.error("Failed to fetch CrossSafe data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const enqueueJob = async (type: string, source: string, payload: any = {}) => {
    setSubmitting(type);
    try {
      const { error } = await supabase.from("crosssafe_jobs" as any).insert({
        type,
        source,
        payload,
        priority: 10,
      });
      if (error) throw error;
      toast.success(`Job enqueued: ${type} / ${source}`);
      fetchData();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setSubmitting(null);
    }
  };

  const enqueueUrl = async () => {
    if (!urlInput.trim()) return;
    await enqueueJob("url_ingest", "manual", { url: urlInput.trim() });
    setUrlInput("");
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "queued": return <Clock className="h-4 w-4 text-yellow-500" />;
      case "running": return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "succeeded": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
      case "parked": return <PauseCircle className="h-4 w-4 text-orange-500" />;
      default: return null;
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      queued: "outline",
      running: "default",
      succeeded: "secondary",
      failed: "destructive",
      parked: "destructive",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const ago = (ts: string | null) => {
    if (!ts) return "—";
    const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  if (loading && !jobSummary) {
    return (
      <div className="container py-6 space-y-6">
        <h1 className="text-2xl font-bold">CrossSafe Monitor</h1>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">CrossSafe Monitor</h1>
          <p className="text-muted-foreground text-sm">Job queue, heartbeats, lifecycle — last 24h</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── JOB SUMMARY ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(["queued", "running", "succeeded", "failed", "parked"] as const).map((s) => (
          <Card key={s}>
            <CardContent className="pt-6 flex items-center gap-3">
              {statusIcon(s)}
              <div>
                <div className="text-2xl font-bold font-mono">{jobSummary?.[s] ?? 0}</div>
                <div className="text-xs text-muted-foreground capitalize">{s}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── LIFECYCLE SUMMARY ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Inventory Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 flex-wrap">
            {lifecycle && Object.entries(lifecycle).map(([state, count]) => (
              <div key={state} className="text-center">
                <div className="text-xl font-bold font-mono">{count}</div>
                <div className="text-xs text-muted-foreground">{state}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── QUICK ACTIONS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Manual Run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => enqueueJob("source_refresh", "pickles")}
                disabled={!!submitting}
              >
                <Play className="h-3 w-3 mr-1" /> Pickles Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => enqueueJob("source_refresh", "grays")}
                disabled={!!submitting}
              >
                <Play className="h-3 w-3 mr-1" /> Grays Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => enqueueJob("lifecycle_sweep", "system")}
                disabled={!!submitting}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Lifecycle Sweep
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Test URL Ingest</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Paste a listing URL..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enqueueUrl()}
              />
              <Button size="sm" onClick={enqueueUrl} disabled={!urlInput.trim() || !!submitting}>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── HEARTBEATS ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Heartbeats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {heartbeats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No heartbeat data yet</p>
            ) : heartbeats.map((hb) => (
              <div key={hb.cron_name} className="flex items-center gap-3 text-sm">
                {hb.last_ok
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <AlertTriangle className="h-4 w-4 text-red-500" />
                }
                <span className="font-mono min-w-[200px]">{hb.cron_name}</span>
                <span className="text-muted-foreground">{ago(hb.last_seen_at)}</span>
                {hb.note && <span className="text-muted-foreground text-xs truncate max-w-[300px]">{hb.note}</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── RECENT JOBS ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs border-b">
                  <th className="text-left py-2 pr-2">Status</th>
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-left py-2 pr-2">Source</th>
                  <th className="text-left py-2 pr-2">Created</th>
                  <th className="text-left py-2 pr-2">Duration</th>
                  <th className="text-left py-2 pr-2">Attempts</th>
                  <th className="text-left py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id} className="border-b border-border/50">
                    <td className="py-2 pr-2">{statusBadge(job.status)}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{job.type}</td>
                    <td className="py-2 pr-2">{job.source}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{ago(job.created_at)}</td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      {job.started_at && job.finished_at
                        ? `${Math.round((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000)}s`
                        : "—"
                      }
                    </td>
                    <td className="py-2 pr-2 font-mono">{job.attempts}</td>
                    <td className="py-2 text-xs text-red-500 truncate max-w-[200px]">{job.error || ""}</td>
                  </tr>
                ))}
                {recentJobs.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No jobs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
