import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock, Pause, Play, Zap, FlaskConical, Settings2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AuctionScheduleEditor } from "@/components/auction/AuctionScheduleEditor";
import { AuctionTuneDrawer } from "@/components/auction/AuctionTuneDrawer";

type Row = {
  source_key: string;
  display_name: string;
  platform: string;
  enabled: boolean;
  preflight_status: string | null;
  last_crawl_success_at: string | null;
  last_crawl_fail_at: string | null;
  consecutive_crawl_failures: number;
  last_lots_found: number | null;
  last_crawl_error: string | null;
  auto_disabled_at: string | null;
  auto_disabled_reason: string | null;
  schedule_enabled: boolean;
  schedule_paused: boolean;
  schedule_pause_reason: string | null;
  schedule_time_local: string;
  schedule_days: string[];
  last_scheduled_run_at: string | null;
};

type EventRow = {
  id: string;
  source_key: string;
  event_type: string;
  message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

function statusBadge(r: Row) {
  if (!r.enabled) return <Badge variant="destructive">Disabled</Badge>;
  if (r.consecutive_crawl_failures >= 1) return <Badge variant="secondary">Flaky</Badge>;
  return <Badge className="bg-green-600">Healthy</Badge>;
}

function scheduleBadge(r: Row) {
  if (!r.schedule_enabled) return null;
  if (r.schedule_paused) return <Badge variant="secondary">Paused</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" />
      {r.schedule_time_local}
    </Badge>
  );
}

function eventBadge(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("disabled")) return <Badge variant="destructive">disabled</Badge>;
  if (t.includes("fail")) return <Badge variant="destructive">fail</Badge>;
  if (t.includes("success")) return <Badge className="bg-emerald-600/20 text-emerald-400">success</Badge>;
  if (t.includes("run_manual")) return <Badge variant="outline">manual run</Badge>;
  if (t.includes("dry_run")) return <Badge variant="outline">dry run</Badge>;
  if (t.includes("reenabled")) return <Badge className="bg-blue-600/20 text-blue-300">re-enabled</Badge>;
  return <Badge variant="secondary">{type}</Badge>;
}

// NSW pack source keys
const NSW_PACK_KEYS = [
  "auto_auctions_aav",
  "f3_motor_auctions",
  "pickles_nsw",
  "manheim_nsw",
  "valley_auctions",
];

export function AuctionSourcesHealthCard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Events drawer state
  const [openSourceKey, setOpenSourceKey] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Dry run result drawer
  const [dryRunResult, setDryRunResult] = useState<{
    source_key: string;
    sample_count: number;
    year_gate: { kept: number; dropped: number; minYear: number };
    sample: unknown[];
    raw: unknown;
  } | null>(null);

  // Tune drawer state
  const [tuneOpen, setTuneOpen] = useState(false);
  const [tuneSrc, setTuneSrc] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_auction_sources_health" as never);
    if (!error) setRows((data as Row[]) || []);
    setLoading(false);
  }

  async function reenable(sourceKey: string) {
    setActionLoading(sourceKey);
    await supabase.rpc("reenable_auction_source" as never, {
      p_source_key: sourceKey,
      p_reason: "UI re-enable",
    } as never);
    await load();
    setActionLoading(null);
  }

  async function runNow(sourceKey: string) {
    setActionLoading(sourceKey);
    toast.info("Running live ingest…");
    try {
      const { data, error } = await supabase.functions.invoke("auction-run-now", {
        body: { source_key: sourceKey, debug: false },
      });
      if (error) throw error;
      toast.success(`Run complete: ${data?.result?.lots_found ?? "?"} lots`);
      console.log("[auction-run-now]", data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Run failed: ${msg}`);
    }
    await load();
    setActionLoading(null);
  }

  async function dryRun(sourceKey: string) {
    setActionLoading(sourceKey);
    toast.info("Running dry run…");
    try {
      const { data, error } = await supabase.functions.invoke("auction-dry-run", {
        body: { source_key: sourceKey },
      });
      if (error) throw error;
      toast.success(`Dry run: ${data?.sample_count ?? 0} sample rows (minYear ${data?.year_gate?.minYear})`);
      console.log("[auction-dry-run]", data);
      setDryRunResult(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Dry run failed: ${msg}`);
    }
    setActionLoading(null);
  }

  async function toggleSchedule(sourceKey: string, currentEnabled: boolean) {
    setActionLoading(sourceKey);
    await supabase
      .from("auction_sources")
      .update({ schedule_enabled: !currentEnabled })
      .eq("source_key", sourceKey);
    toast.success(!currentEnabled ? "Schedule enabled" : "Schedule disabled");
    await load();
    setActionLoading(null);
  }

  async function togglePause(sourceKey: string, currentPaused: boolean) {
    setActionLoading(sourceKey);
    await supabase
      .from("auction_sources")
      .update({
        schedule_paused: !currentPaused,
        schedule_pause_reason: !currentPaused ? "Paused by operator" : null,
      })
      .eq("source_key", sourceKey);
    toast.success(!currentPaused ? "Paused" : "Resumed");
    await load();
    setActionLoading(null);
  }

  async function enableNswPack() {
    try {
      const { error } = await supabase
        .from("auction_sources")
        .update({
          schedule_enabled: true,
          schedule_paused: false,
          schedule_tz: "Australia/Sydney",
          schedule_days: ["MON", "TUE", "WED", "THU", "FRI"],
          schedule_time_local: "07:05",
          schedule_min_interval_minutes: 60,
        })
        .in("source_key", NSW_PACK_KEYS);

      if (error) throw error;
      toast.success("NSW pack scheduling enabled");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`NSW pack failed: ${msg}`);
    }
  }

  async function loadEvents(sourceKey: string) {
    setEventsLoading(true);
    setEvents([]);
    const { data, error } = await supabase.rpc("get_auction_source_events" as never, {
      p_source_key: sourceKey,
      p_limit: 25,
    } as never);
    if (!error) setEvents((data as EventRow[]) || []);
    setEventsLoading(false);
  }

  function openEvents(sourceKey: string) {
    setOpenSourceKey(sourceKey);
    loadEvents(sourceKey);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Auction Sources Health</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="default" size="sm" onClick={() => navigate("/operator/auctions/add")}>
              <Plus className="h-4 w-4 mr-1" />
              Add Source
            </Button>
            <Button variant="secondary" size="sm" onClick={enableNswPack}>
              <Zap className="h-4 w-4 mr-1" />
              Enable NSW Pack
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No auction sources configured.</div>
          ) : (
            <div className="space-y-4">
              {rows.map((r) => (
                <div key={r.source_key} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium">
                      {r.display_name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({r.source_key})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusBadge(r)}
                      <Badge variant="outline">{r.platform}</Badge>
                      {r.preflight_status && (
                        <Badge variant="outline">{r.preflight_status}</Badge>
                      )}
                      {scheduleBadge(r)}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      Last success:{" "}
                      <span className="text-muted-foreground">
                        {r.last_crawl_success_at
                          ? new Date(r.last_crawl_success_at).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                    <div>
                      Last lots:{" "}
                      <span className="text-muted-foreground">
                        {r.last_lots_found ?? "—"}
                      </span>
                    </div>
                    <div>
                      Fail streak:{" "}
                      <span className="text-muted-foreground">
                        {r.consecutive_crawl_failures}
                      </span>
                    </div>
                    <div>
                      Last fail:{" "}
                      <span className="text-muted-foreground">
                        {r.last_crawl_fail_at
                          ? new Date(r.last_crawl_fail_at).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {r.last_crawl_error && (
                    <div className="mt-2 text-xs text-destructive truncate">
                      Last error: {r.last_crawl_error}
                    </div>
                  )}

                  {r.auto_disabled_reason && (
                    <div className="mt-1 text-xs text-destructive">
                      Auto-disabled: {r.auto_disabled_reason}
                    </div>
                  )}

                  {/* Run actions */}
                  <div className="mt-3 flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => dryRun(r.source_key)}
                      disabled={actionLoading === r.source_key}
                    >
                      <FlaskConical className="h-4 w-4 mr-1" />
                      Dry Run
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runNow(r.source_key)}
                      disabled={actionLoading === r.source_key}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Run Now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEvents(r.source_key)}
                    >
                      View Events
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTuneSrc(r);
                        setTuneOpen(true);
                      }}
                    >
                      <Settings2 className="h-4 w-4 mr-1" />
                      Tune
                    </Button>
                    {!r.enabled && (
                      <Button
                        size="sm"
                        variant="action"
                        onClick={() => reenable(r.source_key)}
                        disabled={actionLoading === r.source_key}
                      >
                        Re-enable
                      </Button>
                    )}
                  </div>

                  {/* Schedule controls */}
                  <div className="mt-2 flex gap-2 flex-wrap border-t pt-2">
                    <Button
                      size="sm"
                      variant={r.schedule_enabled ? "default" : "outline"}
                      onClick={() => toggleSchedule(r.source_key, r.schedule_enabled)}
                      disabled={actionLoading === r.source_key}
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      {r.schedule_enabled ? "Schedule ON" : "Schedule OFF"}
                    </Button>
                    {r.schedule_enabled && (
                      <Button
                        size="sm"
                        variant={r.schedule_paused ? "destructive" : "outline"}
                        onClick={() => togglePause(r.source_key, r.schedule_paused)}
                        disabled={actionLoading === r.source_key}
                      >
                        {r.schedule_paused ? (
                          <>
                            <Play className="h-3 w-3 mr-1" /> Resume
                          </>
                        ) : (
                          <>
                            <Pause className="h-3 w-3 mr-1" /> Pause
                          </>
                        )}
                      </Button>
                    )}
                    {r.last_scheduled_run_at && (
                      <span className="text-xs text-muted-foreground self-center">
                        Last scheduled: {new Date(r.last_scheduled_run_at).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Schedule Editor */}
                  <div className="mt-3">
                    <AuctionScheduleEditor
                      source_key={r.source_key}
                      schedule_enabled={r.schedule_enabled}
                      schedule_paused={r.schedule_paused}
                      schedule_days={r.schedule_days}
                      schedule_time_local={r.schedule_time_local}
                      schedule_min_interval_minutes={60}
                      onSaved={load}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Events Drawer */}
      <Dialog open={!!openSourceKey} onOpenChange={(v) => !v && setOpenSourceKey(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Auction Source Events</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Source: <span className="font-mono">{openSourceKey}</span>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => openSourceKey && loadEvents(openSourceKey)}
              disabled={eventsLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${eventsLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {eventsLoading ? (
            <div className="text-sm text-muted-foreground">Loading events…</div>
          ) : events.length === 0 ? (
            <div className="text-sm text-muted-foreground">No events yet.</div>
          ) : (
            <ScrollArea className="h-[420px] pr-2">
              <div className="space-y-3">
                {events.map((e) => (
                  <div key={e.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {eventBadge(e.event_type)}
                        <div className="text-sm font-medium">{e.message || "—"}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </div>
                    </div>

                    {e.meta && (
                      <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(e.meta, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Dry Run Result Drawer */}
      <Dialog open={!!dryRunResult} onOpenChange={(v) => !v && setDryRunResult(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Dry Run Results</DialogTitle>
          </DialogHeader>

          {dryRunResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap text-sm">
                <Badge variant="outline">Source: {dryRunResult.source_key}</Badge>
                <Badge variant="secondary">Samples: {dryRunResult.sample_count}</Badge>
                <Badge className="bg-green-600/20 text-green-400">
                  Kept: {dryRunResult.year_gate.kept}
                </Badge>
                <Badge variant="destructive">
                  Dropped: {dryRunResult.year_gate.dropped}
                </Badge>
                <span className="text-muted-foreground">
                  Min year: {dryRunResult.year_gate.minYear}
                </span>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Sample Lots (first 10)</div>
                <ScrollArea className="h-[300px]">
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto">
                    {JSON.stringify(dryRunResult.sample, null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Show raw debug payload
                </summary>
                <ScrollArea className="h-[200px] mt-2">
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto">
                    {JSON.stringify(dryRunResult.raw, null, 2)}
                  </pre>
                </ScrollArea>
              </details>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tune Drawer */}
      <AuctionTuneDrawer
        open={tuneOpen}
        onOpenChange={setTuneOpen}
        src={tuneSrc}
        onRefresh={load}
      />
    </>
  );
}
