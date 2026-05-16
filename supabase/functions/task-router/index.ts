import { getSupabaseAdmin } from '../_shared/supabase.js';
import { assignPriority, classifyTask, createJsonResponse, shouldAllowOpenCore } from '../_shared/task_os.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id } = await req.json();
    const supabase = getSupabaseAdmin();
    const { data: task, error } = await supabase.from('tasks').select('*').eq('task_id', task_id).single();
    if (error) throw error;
    const route = classifyTask(task);
    const priority = assignPriority(task);
    const allowOpenCore = shouldAllowOpenCore(task) && ['reasoning', 'exception'].includes(route.worker_category);
    const nextStatus = route.worker_category === 'human' ? 'needs_human' : 'pending';
    const { error: updateError } = await supabase.from('tasks').update({
      priority,
      assigned_worker: route.assigned_worker,
      status: nextStatus,
      payload: {
        ...(task.payload || {}),
        router: {
          ...(task.payload?.router || {}),
          worker_category: route.worker_category,
          route_reason: route.route_reason,
          allow_opencore: allowOpenCore,
        },
      },
    }).eq('task_id', task_id);
    if (updateError) throw updateError;
    await supabase.from('task_logs').insert({
      task_id,
      level: 'info',
      message: 'Task routed',
      data: { worker: route.assigned_worker, worker_category: route.worker_category, allow_opencore: allowOpenCore },
    });
    if (nextStatus === 'needs_human') {
      await supabase.from('human_reviews').insert({
        task_id,
        reason: 'Router escalated task directly to human review',
        review_payload: { route_reason: route.route_reason },
      });
    }
    return createJsonResponse({ ok: true, task_id, priority, ...route, allow_opencore: allowOpenCore, status: nextStatus });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
