import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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

function eventBadge(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("disabled")) return <Badge variant="destructive">disabled</Badge>;
  if (t.includes("fail")) return <Badge variant="destructive">fail</Badge>;
  if (t.includes("success")) return <Badge className="bg-emerald-600/20 text-emerald-400">success</Badge>;
  if (t.includes("run_manual")) return <Badge variant="outline">manual run</Badge>;
  if (t.includes("reenabled")) return <Badge className="bg-blue-600/20 text-blue-300">re-enabled</Badge>;
  return <Badge variant="secondary">{type}</Badge>;
}

export function AuctionSourcesHealthCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Events drawer state
  const [openSourceKey, setOpenSourceKey] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

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

  async function runNow(sourceKey: string, debug = true) {
    setActionLoading(sourceKey);
    await supabase.functions.invoke("auction-run-now", {
      body: { source_key: sourceKey, debug },
    });
    await load();
    setActionLoading(null);
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Auction Sources Health</CardTitle>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No auction sources configured.</div>
          ) : (
            <div className="space-y-3">
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

                  <div className="mt-3 flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runNow(r.source_key, true)}
                      disabled={actionLoading === r.source_key}
                    >
                      Run Now (Debug)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runNow(r.source_key, false)}
                      disabled={actionLoading === r.source_key}
                    >
                      Run Now (Live)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEvents(r.source_key)}
                    >
                      View Events
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
    </>
  );
}
