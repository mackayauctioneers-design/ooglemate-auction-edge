import { getSupabaseAdmin } from '../_shared/supabase.js';
import { ACTIVE_STATUSES, CONCURRENCY_LIMITS, createJsonResponse, handleFailure, sortTasks } from '../_shared/task_os.js';
import { WORKER_FUNCTION_MAP } from '../_shared/watchers.js';
import { DATA_WORKER_FUNCTION_MAP } from '../_shared/data_workers.js';
const FN_MAP = { ...WORKER_FUNCTION_MAP, ...DATA_WORKER_FUNCTION_MAP };

async function invokeWorker(functionName, payload) {
  const baseUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${functionName}`;
  const resp = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `${functionName} failed`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return createJsonResponse({ error: 'POST or GET required' }, 405);
  const supabase = getSupabaseAdmin();
  try {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .in('status', ['pending', 'retrying'])
      .lte('scheduled_at', new Date().toISOString());
    if (error) throw error;
    const { data: runningTasks, error: runningError } = await supabase
      .from('tasks')
      .select('assigned_worker,payload,status')
      .eq('status', 'running');
    if (runningError) throw runningError;
    const categoryCounts = { reasoning: 0, browser: 0, watcher: 0, data: 0, exception: 0 };
    for (const task of runningTasks || []) {
      const category = task.payload?.router?.worker_category;
      if (category && categoryCounts[category] !== undefined) categoryCounts[category] += 1;
    }
    const dispatched = [];
    for (const task of sortTasks(tasks || [])) {
      const category = task.payload?.router?.worker_category;
      if (!category || categoryCounts[category] >= CONCURRENCY_LIMITS[category]) continue;
      const lockKey = task.dedupe_key || `${task.task_type}:${task.related_entity_type || 'task'}:${task.related_entity_id || task.task_id}`;
      const { data: existingLock } = await supabase.from('worker_locks').select('*').eq('lock_key', lockKey).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (existingLock) continue;
      await supabase.from('worker_locks').upsert({
        lock_key: lockKey,
        worker_name: task.assigned_worker,
        task_id: task.task_id,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      await supabase.from('tasks').update({ status: 'running', started_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() }).eq('task_id', task.task_id);
      const attemptNo = Number(task.retry_count || 0) + 1;
      const { data: run } = await supabase.from('task_runs').insert({
        task_id: task.task_id,
        worker_name: task.assigned_worker,
        worker_category: category,
        attempt_no: attemptNo,
        status: 'running',
      }).select('*').single();
      try {
        let result;
        const fnName = FN_MAP[task.assigned_worker];
        if (task.payload?.simulate_failure) {
          throw new Error(`Simulated failure for ${task.task_type}`);
        } else if (fnName) {
          result = await invokeWorker(fnName, { task_id: task.task_id, run_id: run.run_id, task });
        } else {
          result = { ok: true, deferred: true, summary: `No worker function mapped for ${task.assigned_worker}; deferred.` };
        }
        await supabase.from('task_runs').update({
          status: 'succeeded',
          completed_at: new Date().toISOString(),
          result_summary: result.summary || 'Task completed',
        }).eq('run_id', run.run_id);
        await supabase.from('tasks').update({
          status: result.deferred ? 'assigned' : 'succeeded',
          completed_at: result.deferred ? null : new Date().toISOString(),
          result_summary: result.summary || 'Task completed',
          last_log_message: result.summary || 'Task completed',
        }).eq('task_id', task.task_id);
        await supabase.from('task_logs').insert({
          task_id: task.task_id,
          run_id: run.run_id,
          level: 'info',
          message: result.summary || 'Task completed',
          data: result,
        });
        await supabase.from('workers').update({
          last_heartbeat_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          status: 'idle',
        }).eq('worker_name', task.assigned_worker);
        categoryCounts[category] += result.deferred ? 0 : 1;
        dispatched.push({ task_id: task.task_id, worker: task.assigned_worker, result });
      } catch (workerError) {
        const failure = handleFailure(task);
        const scheduledAt = new Date(Date.now() + (failure.retry_delay_seconds || task.retry_delay_seconds || 300) * 1000).toISOString();
        await supabase.from('task_runs').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: String(workerError.message || workerError),
        }).eq('run_id', run.run_id);
        await supabase.from('tasks').update({
          status: failure.status,
          retry_count: failure.retry_count,
          scheduled_at: failure.status === 'retrying' ? scheduledAt : task.scheduled_at,
          error_message: String(workerError.message || workerError),
          last_log_message: String(workerError.message || workerError),
        }).eq('task_id', task.task_id);
        await supabase.from('task_logs').insert({
          task_id: task.task_id,
          run_id: run.run_id,
          level: 'error',
          message: 'Task execution failed',
          data: { error: String(workerError.message || workerError), failure },
        });
        await supabase.from('workers').update({
          last_heartbeat_at: new Date().toISOString(),
          last_failure_at: new Date().toISOString(),
        }).eq('worker_name', task.assigned_worker);
        if (failure.create_exception_diagnosis && task.task_type !== 'exception_diagnosis') {
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/task-ingress`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({
              task_type: 'exception_diagnosis',
              title: `Exception diagnosis for ${task.title}`,
              source: 'task-dispatcher',
              priority: 'P0',
              payload: {
                requires_reasoning: true,
                failed_task_id: task.task_id,
                failed_task_type: task.task_type,
                human_review_requested_ai_diagnosis: failure.status === 'needs_human',
              },
              related_entity_type: 'task',
              related_entity_id: task.task_id,
              dedupe_key: `exception:${task.task_id}`,
            }),
          });
        }
        if (failure.create_human_review) {
          await supabase.from('human_reviews').insert({
            task_id: task.task_id,
            reason: 'Task failed three times or duplicate money risk flagged',
            review_payload: { retry_count: failure.retry_count, error: String(workerError.message || workerError) },
          });
        }
      } finally {
        await supabase.from('worker_locks').delete().eq('lock_key', lockKey);
      }
    }
    return createJsonResponse({ ok: true, dispatched_count: dispatched.length, dispatched });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
