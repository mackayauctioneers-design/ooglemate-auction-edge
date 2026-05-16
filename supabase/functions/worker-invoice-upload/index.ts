import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import {
  validateInvoicePayload,
  logBrowserStep,
} from '../_shared/browser_workers.js';
import {
  isLiveMode,
  ensureLoggedIn,
  openEasyCars,
  uploadInvoice,
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

    const v = validateInvoicePayload(payload);
    if (!v.ok) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'error', step: 'validate',
        result: 'blocked', message: `missing_required_fields: ${v.missing.join(',')}`,
      });
      throw new Error(`missing_required_fields: ${v.missing.join(',')}`);
    }

    // Deferred mode preserved when env not set
    if (!isLiveMode()) {
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'warn', step: 'session_check',
        result: 'no_session',
        message: 'Blocked: no_easycars_browser_session_configured',
      });
      return createJsonResponse({
        ok: true,
        deferred: true,
        mode: 'deferred',
        summary: 'Invoice upload deferred: no_easycars_browser_session_configured',
      });
    }

    const target = payload.easycars_target || payload.stock_draft_id || null;
    const log = (entry) => logBrowserStep(supabase, { task_id, run_id, ...entry });

    const seq = await runSteps([
      { name: 'ensureLoggedIn', fn: () => ensureLoggedIn() },
      { name: 'openEasyCars', fn: () => openEasyCars(target ? `/stock/${target}/documents` : '/stock') },
      { name: 'uploadInvoice', fn: () => uploadInvoice({
          invoice_number: payload.invoice_number,
          attachment_name: payload.attachment_name,
          attachment_url: payload.invoice_pdf_url || payload.attachment_url || null,
          target,
        }) },
    ], log);

    if (!seq.ok) {
      // capture screenshot on failure for diagnosis
      const shot = await captureScreenshot(`invoice_upload_fail_${seq.lastStep}`);
      const url = (await currentUrl())?.url || seq.failure?.url || null;
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'error', step: 'failure_capture',
        url, selector: seq.failure?.selector || null,
        screenshot_ref: shot?.screenshot_ref || seq.failure?.screenshot_ref || null,
        result: 'failed',
        message: `Invoice upload failed at ${seq.lastStep}: ${seq.failure?.error}`,
        extra: { last_step: seq.lastStep },
      });
      throw new Error(`invoice_upload_failed_at_${seq.lastStep}: ${seq.failure?.error}`);
    }

    const last = seq.results[seq.results.length - 1] || {};
    const summary = `Invoice uploaded mode=live invoice=${payload.invoice_number}${target ? ` target=${target}` : ''}`;
    return createJsonResponse({
      ok: true,
      mode: 'live',
      summary,
      uploaded: {
        invoice_number: payload.invoice_number,
        target,
        document_id: last.document_id || null,
        url: last.url || null,
      },
    });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
