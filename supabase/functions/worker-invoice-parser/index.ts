import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { spawnChildTask } from '../_shared/watchers.js';
import { extractInvoiceFields, logDataWorker } from '../_shared/data_workers.js';

const CONFIDENCE_THRESHOLD = 0.5;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};
    const text = payload.invoice_text || payload.text || payload.raw_text || '';

    const { fields, confidence } = extractInvoiceFields(text);
    const merged = { ...payload, ...fields };
    const parsed_invoice = { ...fields, confidence };

    const updatedPayload = {
      ...payload,
      parsed_invoice,
      parsed_at: new Date().toISOString(),
    };

    let child = null;
    let flaggedReasoning = false;

    if (confidence >= CONFIDENCE_THRESHOLD && (fields.rego || fields.vin)) {
      const dedupeBase = fields.invoice_number && fields.rego
        ? `invoice_rego:${fields.invoice_number}:${fields.rego}`
        : `r2s:${task_id}`;
      child = await spawnChildTask(supabase, {
        task_type: 'rego2stock_prepare',
        title: `Rego2Stock prep for ${fields.rego || fields.vin}`,
        source: 'worker-invoice-parser',
        priority: 'P1',
        dedupe_key: `r2s:${dedupeBase}`,
        payload: {
          ...fields,
          source_task_id: task_id,
          parent_task_id: task_id,
        },
        related_entity_type: 'invoice',
        related_entity_id: fields.invoice_number || null,
      });
    } else {
      flaggedReasoning = true;
      updatedPayload.requires_reasoning = true;
      updatedPayload.low_confidence_reason = confidence < CONFIDENCE_THRESHOLD
        ? `confidence ${confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`
        : 'missing rego/vin';
    }

    await supabase.from('tasks').update({ payload: updatedPayload }).eq('task_id', task_id);

    const summary = `Invoice parsed (conf ${confidence.toFixed(2)})${child?.task_id ? `; spawned rego2stock ${child.task_id}` : flaggedReasoning ? '; flagged requires_reasoning' : ''}`;
    await logDataWorker(supabase, { task_id, run_id, level: 'info', message: summary, data: { parsed_invoice, child, flaggedReasoning } });
    return createJsonResponse({ ok: true, summary, parsed_invoice, child, flagged_reasoning: flaggedReasoning });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
