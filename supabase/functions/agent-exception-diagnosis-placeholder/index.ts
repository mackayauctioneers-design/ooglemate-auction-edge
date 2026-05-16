import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id } = await req.json();
    const supabase = getSupabaseAdmin();
    const { data: task } = await supabase.from('tasks').select('*').eq('task_id', task_id).single();
    const failedTaskId = task?.payload?.failed_task_id;
    let relatedLogs = [];
    if (failedTaskId) {
      const { data } = await supabase.from('task_logs').select('ts,level,message,data').eq('task_id', failedTaskId).order('ts', { ascending: false }).limit(10);
      relatedLogs = data || [];
    }
    const summary = 'OpenCore placeholder invoked only for exception diagnosis. Review related logs and replace with live reasoning worker in Phase 2.';
    await supabase.from('task_logs').insert({
      task_id,
      run_id,
      level: 'info',
      message: 'Exception diagnosis placeholder executed',
      data: { opencore_allowed: true, failed_task_id: failedTaskId, related_logs: relatedLogs },
    });
    return createJsonResponse({ ok: true, summary, opencore_invoked: true, related_logs_count: relatedLogs.length });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
