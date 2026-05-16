import { getSupabaseAdmin } from '../_shared/supabase.js';
import { assignPriority, buildDedupeKey, createJsonResponse } from '../_shared/task_os.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const dedupeKey = buildDedupeKey(body);
    if (dedupeKey) {
      const { data: existing } = await supabase
        .from('tasks')
        .select('task_id,status,assigned_worker,retry_count')
        .eq('dedupe_key', dedupeKey)
        .in('status', ['pending', 'assigned', 'running', 'waiting', 'retrying'])
        .limit(1)
        .maybeSingle();
      if (existing) {
        await supabase.from('task_logs').insert({
          task_id: existing.task_id,
          level: 'info',
          message: 'Duplicate task merged at ingress',
          data: { dedupe_key: dedupeKey, source: body.source || 'unknown' },
        });
        return createJsonResponse({ ok: true, deduped: true, task_id: existing.task_id, status: existing.status });
      }
    }
    const taskRow = {
      task_type: body.task_type,
      title: body.title,
      source: body.source,
      priority: assignPriority(body),
      assigned_worker: null,
      payload: body.payload || {},
      status: 'pending',
      dedupe_key: dedupeKey,
      merge_key: body.merge_key || null,
      scheduled_at: body.scheduled_at || new Date().toISOString(),
      max_retries: body.max_retries ?? 3,
      retry_delay_seconds: body.retry_delay_seconds ?? 300,
      escalation_rule: body.escalation_rule || 'after_2_to_exception_after_3_to_human',
      human_review_condition: body.human_review_condition || null,
      related_entity_type: body.related_entity_type || null,
      related_entity_id: body.related_entity_id || null,
    };
    const { data: inserted, error } = await supabase.from('tasks').insert(taskRow).select('*').single();
    if (error) throw error;
    await supabase.from('task_logs').insert({
      task_id: inserted.task_id,
      level: 'info',
      message: 'Task created by ingress',
      data: { source: inserted.source, dedupe_key: inserted.dedupe_key },
    });
    const routerUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/task-router`;
    const routerResp = await fetch(routerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ task_id: inserted.task_id }),
    });
    const routed = await routerResp.json().catch(() => ({}));
    return createJsonResponse({ ok: true, task_id: inserted.task_id, routed });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
