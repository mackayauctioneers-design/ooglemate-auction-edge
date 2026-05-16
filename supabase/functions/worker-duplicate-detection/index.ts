import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { findActiveDuplicates, logDataWorker } from '../_shared/data_workers.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};

    const lookup = await findActiveDuplicates(supabase, {
      invoice_number: payload.invoice_number,
      rego: payload.rego,
      vin: payload.vin || payload.chassis,
      stock_number: payload.stock_number,
      exclude_task_id: task_id,
    });

    const duplicate_count = lookup.matches?.length || 0;
    const duplicate_money_risk = duplicate_count > 0;
    const duplicate_check = {
      checked_at: new Date().toISOString(),
      keys_checked: lookup.keys_checked,
      matches: lookup.matches,
      duplicate_count,
    };

    const updatedPayload = {
      ...payload,
      duplicate_check,
      duplicate_money_risk,
    };
    await supabase.from('tasks').update({ payload: updatedPayload }).eq('task_id', task_id);

    const summary = duplicate_money_risk
      ? `Duplicate risk: ${duplicate_count} active match(es) across ${lookup.keys_checked.length} key(s)`
      : `No active duplicates across ${lookup.keys_checked.length} key(s)`;
    await logDataWorker(supabase, {
      task_id, run_id,
      level: duplicate_money_risk ? 'warn' : 'info',
      message: summary,
      data: duplicate_check,
    });
    return createJsonResponse({ ok: true, summary, duplicate_check, duplicate_money_risk });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
