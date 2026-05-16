import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import {
  validateStockPayload,
  isDuplicateRisk,
  logBrowserStep,
} from '../_shared/browser_workers.js';
import {
  isLiveMode,
  ensureLoggedIn,
  openEasyCars,
  createStockEntry,
  captureScreenshot,
  currentUrl,
  runSteps,
} from '../_shared/easycars_browser_driver.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};

    const v = validateStockPayload(payload);
    if (!v.ok) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'error', step: 'validate',
        result: 'blocked', message: `missing_required_fields: ${v.missing.join(',')}`,
      });
      throw new Error(`missing_required_fields: ${v.missing.join(',')}`);
    }

    if (isDuplicateRisk(payload)) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'warn', step: 'duplicate_guard',
        result: 'blocked', message: 'duplicate_money_risk: stock entry refused',
      });
      await supabase.from('tasks').update({
        payload: { ...payload, duplicate_money_risk: true, blocked_reason: 'duplicate_money_risk' },
      }).eq('task_id', task_id);
      throw new Error('duplicate_money_risk: stock entry refused');
    }

    if (!isLiveMode()) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'warn', step: 'session_check',
        result: 'no_session', message: 'Blocked: no_easycars_browser_session_configured',
      });
      return createJsonResponse({
        ok: true,
        deferred: true,
        mode: 'deferred',
        summary: 'Stock entry deferred: no_easycars_browser_session_configured',
      });
    }

    const fields = {
      rego: payload.rego,
      vin: payload.vin,
      supplier_name: payload.supplier_name,
      acquisition_cost: payload.acquisition_cost,
      invoice_number: payload.invoice_number,
      invoice_date: payload.invoice_date || null,
    };
    const log = (entry) => logBrowserStep(supabase, { task_id, run_id, ...entry });

    const seq = await runSteps([
      { name: 'ensureLoggedIn', fn: () => ensureLoggedIn() },
      { name: 'openEasyCars', fn: () => openEasyCars('/stock/new') },
      { name: 'createStockEntry', fn: () => createStockEntry(fields) },
    ], log);

    if (!seq.ok) {
      const shot = await captureScreenshot(`stock_entry_fail_${seq.lastStep}`);
      const url = (await currentUrl())?.url || seq.failure?.url || null;
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'error', step: 'failure_capture',
        url, selector: seq.failure?.selector || null,
        screenshot_ref: shot?.screenshot_ref || seq.failure?.screenshot_ref || null,
        result: 'failed',
        message: `Stock entry failed at ${seq.lastStep}: ${seq.failure?.error}`,
        extra: { last_step: seq.lastStep },
      });
      throw new Error(`stock_entry_failed_at_${seq.lastStep}: ${seq.failure?.error}`);
    }

    const created = seq.results.find((r: any) => r.step === 'createStockEntry') || {};
    const stock_number = created.stock_number || created.id || null;
    const summary = `Stock created mode=live stock_number=${stock_number || 'unknown'} rego=${payload.rego}`;

    await logBrowserStep(supabase, {
      task_id, run_id, step: 'result', url: created.url || null,
      result: 'success', message: summary, extra: { stock_number },
    });

    // Persist stock_number on task payload for UI visibility
    await supabase.from('tasks').update({
      payload: { ...payload, easycars_stock_number: stock_number, easycars_stock_url: created.url || null },
    }).eq('task_id', task_id);

    return createJsonResponse({
      ok: true,
      mode: 'live',
      summary,
      stock: { stock_number, rego: payload.rego, vin: payload.vin, url: created.url || null },
    });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
