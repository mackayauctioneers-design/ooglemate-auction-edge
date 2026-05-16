import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { spawnChildTask } from '../_shared/watchers.js';
import { normalizeStockPayload, logDataWorker } from '../_shared/data_workers.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};

    const stock_payload = normalizeStockPayload({ ...payload, source_task_id: task_id });

    const updatedPayload = {
      ...payload,
      stock_payload,
      stock_prepared_at: new Date().toISOString(),
    };
    await supabase.from('tasks').update({ payload: updatedPayload }).eq('task_id', task_id);

    const dedupeBits = stock_payload.invoice_number && stock_payload.rego
      ? `invoice_rego:${stock_payload.invoice_number}:${stock_payload.rego}`
      : stock_payload.vin ? `vin:${stock_payload.vin}`
      : stock_payload.stock_number ? `stock:${stock_payload.stock_number}`
      : `dup:${task_id}`;

    const child = await spawnChildTask(supabase, {
      task_type: 'duplicate_detection',
      title: `Duplicate check for ${stock_payload.rego || stock_payload.vin || stock_payload.stock_number || 'stock'}`,
      source: 'worker-rego2stock-prepare',
      priority: 'P1',
      dedupe_key: `dupchk:${dedupeBits}`,
      payload: {
        ...stock_payload,
        parent_task_id: task_id,
      },
      related_entity_type: 'stock',
      related_entity_id: stock_payload.stock_number || stock_payload.vin || stock_payload.rego || null,
    });

    const summary = `Stock payload prepared${child?.task_id ? `; spawned duplicate_detection ${child.task_id}` : ''}`;
    await logDataWorker(supabase, { task_id, run_id, level: 'info', message: summary, data: { stock_payload, child } });
    return createJsonResponse({ ok: true, summary, stock_payload, child });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
