import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
};

const groupLabels: Record<string, string> = {
  running: 'Running Tasks',
  queued: 'Queued Tasks',
  failed: 'Failed Tasks',
  needs_human: 'Needs Human',
};

export default function OpsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    const load = async () => {
      const [taskResp, workerResp] = await Promise.all([
        (supabase as any)
          .from('tasks')
          .select('task_id,task_type,title,priority,assigned_worker,status,started_at,created_at,last_log_message')
          .order('created_at', { ascending: false })
          .limit(100),
        (supabase as any).from('ops_worker_health').select('*').order('worker_name'),
      ]);
      if (taskResp.data) setTasks(taskResp.data as Task[]);
      if (workerResp.data) setWorkers(workerResp.data as Worker[]);
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

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Ops Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {Object.entries(groups).map(([key, group]) => (
          <section key={key} className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-medium mb-3">
              {groupLabels[key]} ({group.length})
            </h2>
            <div className="space-y-2">
              {group.map((task) => (
                <div key={task.task_id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{task.title}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted">{task.priority}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {task.task_type} · {task.assigned_worker || 'unassigned'} · {task.status}
                  </p>
                  <p className="text-xs text-muted-foreground">Started: {task.started_at || '—'}</p>
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

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-medium mb-3">Worker Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {workers.map((worker) => (
            <div key={worker.worker_name} className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">{worker.worker_name}</div>
              <p className="text-xs text-muted-foreground">
                {worker.worker_category} · {worker.status}
              </p>
              <p className="text-xs text-muted-foreground">
                Running {worker.running_count}/{worker.concurrency_limit} · Queued {worker.queued_count}
              </p>
              <p className="text-xs text-muted-foreground">
                Last heartbeat: {worker.last_heartbeat_at || '—'} · Last success: {worker.last_success_at || '—'}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
