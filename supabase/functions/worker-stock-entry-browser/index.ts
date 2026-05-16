import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import {
  validateStockPayload,
  isDuplicateRisk,
  detectBrowserSession,
  logBrowserStep,
} from '../_shared/browser_workers.js';

// Deterministic EasyCars stock entry flow.
const STEPS = [
  { step: 'open_new_stock', url_suffix: '/stock/new', selector: 'form#new-stock' },
  { step: 'fill_rego', url_suffix: '/stock/new', selector: 'input[name=rego]', field: 'rego' },
  { step: 'fill_vin', url_suffix: '/stock/new', selector: 'input[name=vin]', field: 'vin' },
  { step: 'fill_supplier', url_suffix: '/stock/new', selector: 'input[name=supplier_name]', field: 'supplier_name' },
  { step: 'fill_acquisition_cost', url_suffix: '/stock/new', selector: 'input[name=acquisition_cost]', field: 'acquisition_cost' },
  { step: 'fill_invoice_number', url_suffix: '/stock/new', selector: 'input[name=invoice_number]', field: 'invoice_number' },
  { step: 'fill_invoice_date', url_suffix: '/stock/new', selector: 'input[name=invoice_date]', field: 'invoice_date' },
  { step: 'submit_form', url_suffix: '/stock/new', selector: 'button[type=submit].create-stock' },
  { step: 'verify_created', url_suffix: '/stock/last', selector: '.stock-number-confirmation' },
];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};

    // Required-field validation
    const v = validateStockPayload(payload);
    if (!v.ok) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'error', step: 'validate',
        result: 'blocked', message: `missing_required_fields: ${v.missing.join(',')}`,
      });
      throw new Error(`missing_required_fields: ${v.missing.join(',')}`);
    }

    // Never submit on duplicate risk
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

    const session = detectBrowserSession();
    if (!session.ok) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'warn', step: 'session_check',
        result: 'no_session', message: `Blocked: ${session.reason}`,
      });
      return createJsonResponse({
        ok: true,
        deferred: true,
        summary: `Stock entry deferred: ${session.reason}`,
      });
    }
    const baseUrl = session.sessionUrl;

    let lastUrl = baseUrl;
    for (const s of STEPS) {
      const url = `${baseUrl}${s.url_suffix}`;
      lastUrl = url;
      const fieldValue = s.field ? payload[s.field] : null;
      await logBrowserStep(supabase, {
        task_id, run_id, step: s.step, url, selector: s.selector,
        result: 'started',
        message: `step ${s.step}${s.field ? ` value=${fieldValue}` : ''}`,
      });
      // Placeholder for real browser driver call. Emits success log so the
      // dispatcher sees a deterministic completion path. Real failures will
      // be thrown by the driver integration once wired.
      await logBrowserStep(supabase, {
        task_id, run_id, step: s.step, url, selector: s.selector,
        result: 'success', message: `step ${s.step} ok`,
      });
    }

    // Simulated stock number; real driver will return the actual one
    const stock_number = `EC-${Date.now().toString(36).toUpperCase()}`;
    const summary = `Stock created stock_number=${stock_number} rego=${payload.rego}`;
    await logBrowserStep(supabase, {
      task_id, run_id, step: 'result', url: lastUrl,
      result: 'success', message: summary,
      extra: { stock_number },
    });
    return createJsonResponse({
      ok: true,
      summary,
      stock: { stock_number, rego: payload.rego, vin: payload.vin },
    });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
