import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { callExternalEndpoint, logTask, minutesSince, spawnChildTask } from '../_shared/watchers.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};
    const batchId = payload.batch_id || null;
    const source = payload.carbitrage_source || null;
    const lastIngestionAt = payload.last_ingestion_at || null;
    const maxAgeMin = Number(payload.expected_max_age_minutes ?? 120);
    const age = minutesSince(lastIngestionAt);
    const stale = age == null ? true : age > maxAgeMin;

    const ext = await callExternalEndpoint({
      url: Deno.env.get('CARBITRAGE_INGESTION_STATUS_URL'),
      auth: Deno.env.get('CARBITRAGE_INGESTION_STATUS_AUTH'),
      body: { task_id, batch_id: batchId, source, last_ingestion_at: lastIngestionAt },
      label: 'carbitrage_ingestion_status',
    });

    let child = null;
    if (stale) {
      child = await spawnChildTask(supabase, {
        task_type: 'carbitrage_ingestion_alert',
        title: `Carbitrage ingestion stale (batch ${batchId || 'unknown'})`,
        source: 'worker-carbitrage-ingestion',
        priority: 'P1',
        dedupe_key: `carbitrage_alert:${source || 'unknown'}:${batchId || 'unknown'}`,
        payload: {
          batch_id_ref: batchId,
          carbitrage_source_ref: source,
          last_ingestion_at: lastIngestionAt,
          age_minutes: age,
          max_age_minutes: maxAgeMin,
          parent_task_id: task_id,
        },
        related_entity_type: 'carbitrage_batch',
        related_entity_id: batchId,
      });
    }

    const summary = `Carbitrage ingestion: ${stale ? 'STALE' : 'fresh'} (age=${age == null ? 'unknown' : `${age.toFixed(1)}m`}, max=${maxAgeMin}m)${child?.task_id ? `; alert task ${child.task_id}` : ''}`;
    await logTask(supabase, { task_id, run_id, level: stale ? 'warn' : 'info', message: summary, data: { ext, child, stale, age, maxAgeMin } });
    return createJsonResponse({ ok: true, summary, stale, age_minutes: age, ext, child });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
