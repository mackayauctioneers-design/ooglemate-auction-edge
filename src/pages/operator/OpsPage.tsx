import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorGuard } from '@/components/guards/OperatorGuard';

type Task = {
  task_id: string;
  task_type: string;
  title: string;
  priority: string;
  assigned_worker: string | null;
  status: string;
  started_at: string | null;
  created_at: string;
  last_log_message: string | null;
};

type Worker = {
  worker_name: string;
  worker_category: string;
  status: string;
  concurrency_limit: number;
  running_count: number;
  queued_count: number;
  last_heartbeat_at: string | null;
  last_success_at: string | null;
  last_failure_at?: string | null;
};

type TaskLog = {
  log_id?: string;
  task_id: string;
  level: string;
  message: string;
  created_at: string;
};

const groupLabels: Record<string, string> = {
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
  needs_human: 'Needs Human',
};

const WATCHER_WORKERS = new Set([
  'worker-heartbeat-check',
  'worker-gmail-invoice-watcher',
  'worker-autograb-health',
  'worker-carbitrage-ingestion',
]);

const DATA_WORKERS = new Set([
  'worker-invoice-parser',
  'worker-rego2stock-prepare',
  'worker-duplicate-detection',
]);

const DATA_TASK_TYPES = ['invoice_parse', 'rego2stock_prepare', 'duplicate_detection'];

function fmtTime(ts: string | null | undefined) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function OpsPageInner() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [watcherLogs, setWatcherLogs] = useState<TaskLog[]>([]);

  useEffect(() => {
    const load = async () => {
      const [taskResp, workerResp, logsResp] = await Promise.all([
        (supabase as any)
          .from('tasks')
          .select('task_id,task_type,title,priority,assigned_worker,status,started_at,created_at,last_log_message')
          .order('created_at', { ascending: false })
          .limit(200),
        (supabase as any).from('ops_worker_health').select('*').order('worker_name'),
        (supabase as any)
          .from('task_logs')
          .select('task_id,level,message,created_at')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (taskResp.data) setTasks(taskResp.data as Task[]);
      if (workerResp.data) setWorkers(workerResp.data as Worker[]);
      if (logsResp.data) setWatcherLogs(logsResp.data as TaskLog[]);
    };
    load();

    const channel = supabase
      .channel('ops-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_logs' }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const groups = useMemo(
    () => ({
      running: tasks.filter((t) => t.status === 'running'),
      queued: tasks.filter((t) => ['pending', 'assigned', 'retrying', 'waiting'].includes(t.status)),
      failed: tasks.filter((t) => t.status === 'failed'),
      needs_human: tasks.filter((t) => t.status === 'needs_human'),
    }),
    [tasks],
  );

  const stats = useMemo(() => {
    const succeeded = tasks.filter((t) => t.status === 'succeeded').length;
    return {
      total: tasks.length,
      running: groups.running.length,
      queued: groups.queued.length,
      failed: groups.failed.length,
      needs_human: groups.needs_human.length,
      succeeded,
    };
  }, [tasks, groups]);

  const watcherFleet = useMemo(
    () => workers.filter((w) => WATCHER_WORKERS.has(w.worker_name) || w.worker_category === 'watcher'),
    [workers],
  );

  const watcherTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.assigned_worker && WATCHER_WORKERS.has(t.assigned_worker)) ids.add(t.task_id);
    }
    return ids;
  }, [tasks]);

  const watcherActivity = useMemo(
    () => watcherLogs.filter((l) => watcherTaskIds.has(l.task_id)).slice(0, 25),
    [watcherLogs, watcherTaskIds],
  );

  const dataFleet = useMemo(
    () => workers.filter((w) => DATA_WORKERS.has(w.worker_name) || w.worker_category === 'data'),
    [workers],
  );

  const dataCounts = useMemo(() => {
    const counts: Record<string, number> = { invoice_parse: 0, rego2stock_prepare: 0, duplicate_detection: 0 };
    for (const t of tasks) {
      if (counts[t.task_type] !== undefined) counts[t.task_type] += 1;
    }
    return counts;
  }, [tasks]);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Ops Dashboard</h1>
        <p className="text-sm text-muted-foreground">Phase 2B — task OS with watchers + data pipeline.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'Total (recent)', value: stats.total },
          { label: 'Running', value: stats.running },
          { label: 'Queued', value: stats.queued },
          { label: 'Succeeded', value: stats.succeeded },
          { label: 'Failed', value: stats.failed },
          { label: 'Needs Human', value: stats.needs_human },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-semibold mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Watcher fleet */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-medium mb-3">Watcher Fleet</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {watcherFleet.map((worker) => {
            const stale =
              worker.last_heartbeat_at &&
              Date.now() - Date.parse(worker.last_heartbeat_at) > 15 * 60 * 1000;
            return (
              <div key={worker.worker_name} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{worker.worker_name}</div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      stale ? 'bg-destructive/20 text-destructive' : 'bg-muted'
                    }`}
                  >
                    {stale ? 'stale' : worker.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {worker.worker_category} · cap {worker.concurrency_limit}
                </p>
                <p className="text-xs text-muted-foreground">
                  Running {worker.running_count}/{worker.concurrency_limit} · Queued {worker.queued_count}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last heartbeat: {fmtTime(worker.last_heartbeat_at)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last success: {fmtTime(worker.last_success_at)}
                </p>
              </div>
            );
          })}
          {!watcherFleet.length && (
            <p className="text-xs text-muted-foreground">No watcher workers registered.</p>
          )}
        </div>
      </section>

      {/* Watcher activity */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-medium mb-3">Watcher Activity</h2>
        <div className="space-y-2 max-h-96 overflow-auto">
          {watcherActivity.map((log, i) => (
            <div
              key={`${log.task_id}-${log.created_at}-${i}`}
              className="rounded-md border border-border p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    log.level === 'error'
                      ? 'bg-destructive/20 text-destructive'
                      : log.level === 'warn'
                      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                      : 'bg-muted'
                  }`}
                >
                  {log.level}
                </span>
                <span className="text-muted-foreground">{fmtTime(log.created_at)}</span>
              </div>
              <p className="mt-1 break-words">{log.message}</p>
              <p className="text-muted-foreground truncate">task: {log.task_id}</p>
            </div>
          ))}
          {!watcherActivity.length && (
            <p className="text-xs text-muted-foreground">No recent watcher activity.</p>
          )}
        </div>
      </section>

      {/* Task groups */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {Object.entries(groups).map(([key, group]) => (
          <section key={key} className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-medium mb-3">
              {groupLabels[key]} ({group.length})
            </h2>
            <div className="space-y-2 max-h-96 overflow-auto">
              {group.map((task) => (
                <div key={task.task_id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{task.title}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted">{task.priority}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {task.task_type} · {task.assigned_worker || 'unassigned'} · {task.status}
                  </p>
                  <p className="text-xs text-muted-foreground">Started: {fmtTime(task.started_at)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    Last log: {task.last_log_message || 'No logs yet'}
                  </p>
                </div>
              ))}
              {!group.length && <p className="text-xs text-muted-foreground">Nothing here.</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function OpsPage() {
  return (
    <OperatorGuard>
      <OpsPageInner />
    </OperatorGuard>
  );
}
