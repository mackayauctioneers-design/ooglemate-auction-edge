import { Loader2, Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type TaskStatus = "pending" | "running" | "done" | "error";

export interface ReportTask {
  id: string;
  label: string;
  status: TaskStatus;
}

interface ReportProgressProps {
  tasks: ReportTask[];
  title?: string;
}

export function ReportProgress({ tasks, title = "Building your dealership intelligence report…" }: ReportProgressProps) {
  const completedCount = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{completedCount}/{tasks.length} complete</p>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 text-sm">
            {task.status === "running" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
            {task.status === "done" && <Check className="h-4 w-4 text-primary" />}
            {task.status === "pending" && <Clock className="h-4 w-4 text-muted-foreground/40" />}
            {task.status === "error" && <span className="h-4 w-4 text-destructive">✕</span>}
            <span className={cn(
              task.status === "done" && "text-foreground",
              task.status === "running" && "text-foreground font-medium",
              task.status === "pending" && "text-muted-foreground",
              task.status === "error" && "text-destructive",
            )}>
              {task.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
