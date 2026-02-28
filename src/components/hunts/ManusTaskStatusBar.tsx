import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle, Bot, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow, parseISO } from "date-fns";

interface ManusTask {
  id: string;
  manus_task_id: string;
  source_url: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  results: unknown;
}

interface ManusTaskStatusBarProps {
  /** Poll by hunt_id (hunt flow) */
  huntId?: string;
  /** Poll by search_session_id (OogleBot flow) */
  sessionId?: string;
  /** Called when all tasks reach a terminal state */
  onComplete?: (totalResults: number) => void;
  /** Show expanded task list by default */
  defaultExpanded?: boolean;
}

const POLL_INTERVAL_MS = 8000;
const INITIAL_DELAY_MS = 3000;

function taskResultCount(task: ManusTask): number {
  if (!task.results) return 0;
  if (Array.isArray(task.results)) return task.results.length;
  return 0;
}

function statusLabel(status: string) {
  switch (status) {
    case "pending":  return { text: "Searching…",  color: "bg-blue-500/10 text-blue-600 border-blue-500/30",    icon: <Loader2 className="h-3 w-3 animate-spin" /> };
    case "complete": return { text: "Done",         color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: <CheckCircle2 className="h-3 w-3" /> };
    case "failed":   return { text: "Failed",       color: "bg-red-500/10 text-red-600 border-red-500/30",       icon: <XCircle className="h-3 w-3" /> };
    default:         return { text: status,         color: "bg-muted text-muted-foreground",                     icon: null };
  }
}

function sourceName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0].charAt(0).toUpperCase() + host.split(".")[0].slice(1);
  } catch {
    return url;
  }
}

export function ManusTaskStatusBar({
  huntId,
  sessionId,
  onComplete,
  defaultExpanded = false,
}: ManusTaskStatusBarProps) {
  const [tasks, setTasks] = useState<ManusTask[]>([]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visible, setVisible] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    if (!huntId && !sessionId) return;

    let query = supabase
      .from("manus_search_tasks")
      .select("id, manus_task_id, source_url, status, created_at, completed_at, results")
      .order("created_at", { ascending: true });

    if (huntId) query = (query as any).eq("hunt_id", huntId);
    if (sessionId) query = (query as any).eq("search_session_id", sessionId);

    // Only look at tasks from the last 30 minutes to avoid showing stale history
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    query = (query as any).gte("created_at", cutoff);

    const { data } = await query;
    if (!data || data.length === 0) return;

    setTasks(data as ManusTask[]);
    setVisible(true);

    const pending = data.filter((t: ManusTask) => t.status === "pending").length;

    if (pending === 0 && !completedRef.current) {
      completedRef.current = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      const totalResults = data.reduce((sum: number, t: ManusTask) => sum + taskResultCount(t), 0);
      onComplete?.(totalResults);
    }
  }, [huntId, sessionId, onComplete]);

  // Start polling
  useEffect(() => {
    if (!huntId && !sessionId) return;
    completedRef.current = false;

    const timeout = setTimeout(() => {
      fetchTasks();
      pollRef.current = setInterval(fetchTasks, POLL_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      clearTimeout(timeout);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [huntId, sessionId, fetchTasks]);

  if (!visible || tasks.length === 0) return null;

  const pending = tasks.filter(t => t.status === "pending").length;
  const complete = tasks.filter(t => t.status === "complete").length;
  const failed = tasks.filter(t => t.status === "failed").length;
  const total = tasks.length;
  const totalResults = tasks.reduce((sum, t) => sum + taskResultCount(t), 0);
  const allDone = pending === 0;
  const progressPct = total > 0 ? Math.round((complete + failed) / total * 100) : 0;

  return (
    <div className={`rounded-lg border text-sm transition-all ${allDone ? "border-emerald-200/60 bg-emerald-500/5" : "border-blue-200/60 bg-blue-500/5"}`}>
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Bot className={`h-4 w-4 shrink-0 ${allDone ? "text-emerald-600" : "text-blue-600"}`} />

        <div className="flex-1 min-w-0">
          {allDone ? (
            <span className="font-medium text-emerald-700">
              Manus search complete — {totalResults} result{totalResults !== 1 ? "s" : ""} from {complete} site{complete !== 1 ? "s" : ""}
              {failed > 0 && <span className="text-red-500 ml-2">({failed} failed)</span>}
            </span>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
                <span className="font-medium text-blue-700">
                  Manus searching {pending} of {total} site{total !== 1 ? "s" : ""}…
                </span>
                {complete > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {complete} done · {totalResults} result{totalResults !== 1 ? "s" : ""} so far
                  </span>
                )}
              </div>
              {/* Progress bar */}
              <div className="h-1 bg-blue-100 rounded-full overflow-hidden w-full">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Expanded task list */}
      {expanded && (
        <div className="border-t border-border/50 divide-y divide-border/30">
          {tasks.map(task => {
            const { text, color, icon } = statusLabel(task.status);
            const resultCount = taskResultCount(task);
            return (
              <div key={task.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <Badge variant="outline" className={`flex items-center gap-1 ${color} text-xs px-1.5 py-0.5 shrink-0`}>
                  {icon}
                  {text}
                </Badge>
                <span className="flex-1 text-muted-foreground truncate">{sourceName(task.source_url)}</span>
                {task.status === "complete" && (
                  <span className="text-emerald-600 font-medium shrink-0">{resultCount} result{resultCount !== 1 ? "s" : ""}</span>
                )}
                {task.status === "pending" && (
                  <span className="text-muted-foreground shrink-0">
                    started {formatDistanceToNow(parseISO(task.created_at), { addSuffix: true })}
                  </span>
                )}
                {task.completed_at && task.status === "complete" && (
                  <span className="text-muted-foreground shrink-0">
                    {formatDistanceToNow(parseISO(task.completed_at), { addSuffix: true })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
