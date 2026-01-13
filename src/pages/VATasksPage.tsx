import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Play, CheckCircle, AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface VATask {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  priority: string;
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
  // Joined from vehicle_listings
  vehicle_listings?: {
    make: string;
    model: string;
    variant_used: string | null;
    year: number;
    km: number | null;
    source: string;
    source_class: string;
    attempt_stage: string | null;
    asking_price: number | null;
    location: string | null;
  } | null;
}

type TabStatus = "todo" | "in_progress" | "done" | "blocked";

export default function VATasksPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<VATask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabStatus>("todo");
  const [spawning, setSpawning] = useState(false);
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    fetchTasks();
  }, [user, activeTab]);

  async function fetchTasks() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("va_tasks")
        .select(`
          *,
          vehicle_listings (
            make, model, variant_used, year, km, source, source_class, attempt_stage, asking_price, location
          )
        `)
        .eq("status", activeTab)
        .order("priority", { ascending: false })
        .order("due_at", { ascending: true })
        .limit(100);

      if (error) throw error;
      setTasks((data as VATask[]) || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Failed to load tasks: " + msg);
    } finally {
      setLoading(false);
    }
  }

  async function updateTaskStatus(taskId: string, newStatus: TabStatus) {
    try {
      const noteText = taskNotes[taskId] || null;
      const { error } = await supabase
        .from("va_tasks")
        .update({ 
          status: newStatus,
          note: noteText,
          updated_at: new Date().toISOString()
        })
        .eq("id", taskId);

      if (error) throw error;
      toast.success(`Task marked as ${newStatus}`);
      fetchTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Failed to update task: " + msg);
    }
  }

  async function spawnTasks() {
    setSpawning(true);
    try {
      const { data, error } = await supabase.rpc("spawn_va_tasks_for_buy_window", { p_hours: 48 });
      if (error) throw error;
      const count = data?.[0]?.created_count ?? 0;
      toast.success(`Spawned ${count} new VA tasks`);
      fetchTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Failed to spawn tasks: " + msg);
    } finally {
      setSpawning(false);
    }
  }

  const tabs: { key: TabStatus; label: string }[] = [
    { key: "todo", label: "To Do" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
    { key: "blocked", label: "Blocked" },
  ];

  function formatVehicle(t: VATask): string {
    const vl = t.vehicle_listings;
    if (!vl) return "Unknown vehicle";
    const variant = vl.variant_used ? ` ${vl.variant_used}` : "";
    return `${vl.year} ${vl.make} ${vl.model}${variant}`;
  }

  function formatSource(t: VATask): string {
    const vl = t.vehicle_listings;
    if (!vl) return t.task_type;
    const src = vl.source || "unknown";
    const run = vl.attempt_stage ? ` (${vl.attempt_stage})` : "";
    return `${src}${run}`;
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">VA Task Queue</h1>
          <p className="text-muted-foreground">Vehicle delegation tasks from BUY_WINDOW listings</p>
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

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {tabs.map((tab) => (
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

      {/* Task List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No tasks with status "{activeTab}"
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <Card key={task.id} className={task.priority === "high" ? "border-orange-500/50" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>
                        {task.priority.toUpperCase()}
                      </Badge>
                      <Badge variant="outline">{task.watch_confidence || "—"}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatSource(task)}
                      </span>
                    </div>
                    <CardTitle className="text-lg">{formatVehicle(task)}</CardTitle>
                  </div>
                  {task.listing_url && (
                    <a
                      href={task.listing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 text-sm"
                    >
                      View Listing <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Price:</span>{" "}
                    {task.vehicle_listings?.asking_price
                      ? `$${task.vehicle_listings.asking_price.toLocaleString()}`
                      : "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">KM:</span>{" "}
                    {task.vehicle_listings?.km
                      ? task.vehicle_listings.km.toLocaleString()
                      : "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>{" "}
                    {task.vehicle_listings?.location || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Attempt:</span>{" "}
                    {task.attempt_count ?? "—"}
                  </div>
                </div>

                {task.watch_reason && (
                  <div className="text-sm text-muted-foreground italic">
                    Reason: {task.watch_reason}
                  </div>
                )}

                <div className="space-y-2">
                  <Textarea
                    placeholder="Add notes about this task..."
                    value={taskNotes[task.id] ?? task.note ?? ""}
                    onChange={(e) =>
                      setTaskNotes((prev) => ({ ...prev, [task.id]: e.target.value }))
                    }
                    rows={2}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {activeTab === "todo" && (
                    <Button size="sm" onClick={() => updateTaskStatus(task.id, "in_progress")}>
                      <Play className="h-4 w-4 mr-1" /> Start
                    </Button>
                  )}
                  {(activeTab === "todo" || activeTab === "in_progress") && (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => updateTaskStatus(task.id, "done")}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" /> Done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateTaskStatus(task.id, "blocked")}
                      >
                        <AlertTriangle className="h-4 w-4 mr-1" /> Blocked
                      </Button>
                    </>
                  )}
                  {activeTab === "blocked" && (
                    <Button size="sm" onClick={() => updateTaskStatus(task.id, "todo")}>
                      Reopen
                    </Button>
                  )}
                  {activeTab === "done" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateTaskStatus(task.id, "todo")}
                    >
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
  );
}
