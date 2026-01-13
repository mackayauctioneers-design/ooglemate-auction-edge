import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Sparkles, ExternalLink, Play, CheckCircle, AlertTriangle } from "lucide-react";
import { RequireAuth } from "@/components/guards/RequireAuth";

type TabStatus = "todo" | "in_progress" | "done" | "blocked";

type VATask = {
  id: string;
  created_at: string;
  updated_at: string;
  status: TabStatus;
  priority: "normal" | "high";
  listing_uuid: string;
  task_type: string;
  assigned_to: string | null;
  due_at: string | null;
  note: string | null;
  watch_reason: string | null;
  watch_confidence: string | null;
  buy_window_at: string | null;
  attempt_count: number | null;
  listing_url: string | null;
};

type ListingMini = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_used: string | null;
  km: number | null;
  source: string | null;
  source_class: string | null;
  attempt_stage: string | null;
  asking_price: number | null;
  location: string | null;
};

export default function VATasksPage() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabStatus>("todo");
  const [spawning, setSpawning] = useState(false);

  const [tasks, setTasks] = useState<VATask[]>([]);
  const [listingMap, setListingMap] = useState<Record<string, ListingMini>>({});
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});

  const tabs: { key: TabStatus; label: string }[] = [
    { key: "todo", label: "To Do" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
    { key: "blocked", label: "Blocked" },
  ];

  async function fetchTasks() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("va_tasks")
        .select("*")
        .eq("status", activeTab)
        .order("priority", { ascending: true })
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(200);

      if (error) throw error;

      const rows = (data as VATask[]) || [];
      // client sort: high first
      rows.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1));
      setTasks(rows);

      // load linked listings
      const listingIds = [...new Set(rows.map(r => r.listing_uuid))];
      if (listingIds.length) {
        const lr = await supabase
          .from("vehicle_listings")
          .select("id,year,make,model,variant_used,km,source,source_class,attempt_stage,asking_price,location")
          .in("id", listingIds);

        if (!lr.error && lr.data) {
          const map: Record<string, ListingMini> = {};
          (lr.data as ListingMini[]).forEach(l => (map[l.id] = l));
          setListingMap(map);
        }
      } else {
        setListingMap({});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error("Failed to load tasks: " + msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeTab]);

  async function updateTaskStatus(taskId: string, newStatus: TabStatus) {
    try {
      const noteText = taskNotes[taskId] ?? null;
      const { error } = await supabase
        .from("va_tasks")
        .update({ status: newStatus, note: noteText, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (error) throw error;
      toast.success(`Task marked ${newStatus}`);
      fetchTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error("Failed to update task: " + msg);
    }
  }

  async function spawnTasks() {
    setSpawning(true);
    try {
      const { data, error } = await supabase.rpc("spawn_va_tasks_for_buy_window", { p_hours: 48 });
      if (error) throw error;
      const count = (data as { created_count: number }[])?.[0]?.created_count ?? 0;
      toast.success(`Spawned ${count} VA tasks`);
      fetchTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error("Failed to spawn tasks: " + msg);
    } finally {
      setSpawning(false);
    }
  }

  const rows = useMemo(() => {
    return tasks.map(t => ({ task: t, listing: listingMap[t.listing_uuid] || null }));
  }, [tasks, listingMap]);

  function fmtVehicle(l: ListingMini | null) {
    if (!l) return "Unknown vehicle";
    const v = l.variant_used ? ` (${l.variant_used})` : "";
    return `${l.year ?? "—"} ${l.make ?? "—"} ${l.model ?? "—"}${v}`;
  }

  function fmtSource(l: ListingMini | null) {
    if (!l) return "—";
    const src = (l.source || "unknown").replace(/^trap_/, "").replace(/_/g, " ");
    const run = l.attempt_stage ? ` • ${l.attempt_stage}` : "";
    return `${src}${run}`;
  }

  return (
    <RequireAuth>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">VA Task Queue</h1>
            <p className="text-muted-foreground">
              Delegation tasks auto-spawned from BUY_WINDOW listings
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchTasks} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {isAdmin && (
              <Button onClick={spawnTasks} disabled={spawning}>
                <Sparkles className="h-4 w-4 mr-2" />
                {spawning ? "Spawning..." : "Spawn Tasks Now"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-b pb-2">
          {tabs.map(tab => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading tasks...</div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-muted-foreground">
              No tasks in "{activeTab}".
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map(({ task, listing }) => (
              <Card key={task.id} className={task.priority === "high" ? "border-orange-500/50" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>
                          {task.priority.toUpperCase()}
                        </Badge>
                        <Badge variant="outline">{task.watch_confidence || "—"}</Badge>
                        <span className="text-sm text-muted-foreground">{fmtSource(listing)}</span>
                      </CardTitle>
                      <div className="mt-1 font-medium">{fmtVehicle(listing)}</div>
                      {task.watch_reason && (
                        <div className="text-sm text-muted-foreground mt-1">
                          Reason: {task.watch_reason}
                        </div>
                      )}
                    </div>

                    {task.listing_url ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(task.listing_url!, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View Listing
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>Price: {listing?.asking_price ? `$${listing.asking_price.toLocaleString()}` : "—"}</div>
                    <div>KM: {listing?.km ? listing.km.toLocaleString() : "—"}</div>
                    <div>Location: {listing?.location || "—"}</div>
                    <div>Attempt: {task.attempt_count ?? "—"}</div>
                  </div>

                  <Textarea
                    placeholder="VA notes (reserve/guide/buy range, who to call, etc)"
                    value={taskNotes[task.id] ?? task.note ?? ""}
                    onChange={(e) =>
                      setTaskNotes(prev => ({ ...prev, [task.id]: e.target.value }))
                    }
                    rows={2}
                  />

                  <div className="flex flex-wrap gap-2">
                    {activeTab === "todo" && (
                      <Button size="sm" onClick={() => updateTaskStatus(task.id, "in_progress")}>
                        <Play className="h-4 w-4 mr-1" /> Start
                      </Button>
                    )}
                    {(activeTab === "todo" || activeTab === "in_progress") && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => updateTaskStatus(task.id, "done")}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Done
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task.id, "blocked")}>
                          <AlertTriangle className="h-4 w-4 mr-1" /> Blocked
                        </Button>
                      </>
                    )}
                    {activeTab === "blocked" && (
                      <Button size="sm" variant="secondary" onClick={() => updateTaskStatus(task.id, "todo")}>
                        Reopen
                      </Button>
                    )}
                    {activeTab === "done" && (
                      <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task.id, "todo")}>
                        Reopen
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
