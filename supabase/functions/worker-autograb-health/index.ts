import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { callExternalEndpoint, logTask, minutesSince, spawnChildTask } from '../_shared/watchers.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};
    const window = payload.autograb_window || null;
    const lastSuccessAt = payload.last_success_at || null;
    const maxAgeMin = Number(payload.expected_max_age_minutes ?? 60);
    const age = minutesSince(lastSuccessAt);
    const stale = age == null ? true : age > maxAgeMin;

    const ext = await callExternalEndpoint({
      url: Deno.env.get('AUTOGRAB_HEALTHCHECK_URL'),
      auth: Deno.env.get('AUTOGRAB_HEALTHCHECK_AUTH'),
      body: { task_id, autograb_window: window, last_success_at: lastSuccessAt },
      label: 'autograb_healthcheck',
    });

    let child = null;
    if (stale) {
      child = await spawnChildTask(supabase, {
        task_type: 'autograb_health_alert',
        title: `AutoGrab freshness stale for ${window || 'unknown window'}`,
        source: 'worker-autograb-health',
        priority: 'P1',
        dedupe_key: `autograb_alert:${window || 'unknown'}`,
        payload: {
          autograb_window_ref: window,
          last_success_at: lastSuccessAt,
          age_minutes: age,
          max_age_minutes: maxAgeMin,
          parent_task_id: task_id,
        },
        related_entity_type: 'autograb_window',
        related_entity_id: window,
      });
    }

    const summary = `AutoGrab health: ${stale ? 'STALE' : 'fresh'} (age=${age == null ? 'unknown' : `${age.toFixed(1)}m`}, max=${maxAgeMin}m)${child?.task_id ? `; alert task ${child.task_id}` : ''}`;
    await logTask(supabase, { task_id, run_id, level: stale ? 'warn' : 'info', message: summary, data: { ext, child, stale, age, maxAgeMin } });
    return createJsonResponse({ ok: true, summary, stale, age_minutes: age, ext, child });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
