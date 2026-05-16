import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { spawnChildTask } from '../_shared/watchers.js';
import {
  validateStockPayload,
  validateInvoicePayload,
  isDuplicateRisk,
  logBrowserStep,
} from '../_shared/browser_workers.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};

    await logBrowserStep(supabase, {
      task_id, run_id, step: 'orchestration_start',
      message: 'easycars_upload orchestration started',
      extra: { has_invoice: Boolean(payload.invoice_number || payload.attachment_name) },
    });

    // 1. Validate required fields
    const stockValidation = validateStockPayload(payload);
    if (!stockValidation.ok) {
      const reason = `missing_required_fields: ${stockValidation.missing.join(',')}`;
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'error', step: 'validate',
        result: 'blocked', message: `Blocked: ${reason}`,
        extra: { missing: stockValidation.missing },
      });
      throw new Error(reason);
    }

    // 2. Refuse to submit if duplicate risk flagged
    if (isDuplicateRisk(payload)) {
      const reason = 'duplicate_money_risk: not submitting to EasyCars';
      await logBrowserStep(supabase, {
        task_id, run_id, level: 'warn', step: 'duplicate_guard',
        result: 'blocked', message: reason,
      });
      // Mark task payload so dispatcher escalates appropriately
      await supabase.from('tasks').update({
        payload: { ...payload, duplicate_money_risk: true, blocked_reason: reason },
      }).eq('task_id', task_id);
      throw new Error(reason);
    }

    // 3. Spawn child browser tasks
    const children: Record<string, any> = {};
    const hasInvoiceArtifact = Boolean(payload.attachment_name || payload.invoice_pdf_url || payload.invoice_attachment_id);

    if (hasInvoiceArtifact) {
      children.invoice_upload = await spawnChildTask(supabase, {
        task_type: 'invoice_upload',
        title: `Invoice upload for ${payload.invoice_number || payload.rego}`,
        source: 'worker-easycars-upload',
        priority: 'P1',
        dedupe_key: `inv_upload:${payload.invoice_number || task_id}`,
        payload: {
          invoice_number: payload.invoice_number,
          attachment_name: payload.attachment_name,
          invoice_pdf_url: payload.invoice_pdf_url,
          invoice_attachment_id: payload.invoice_attachment_id,
          easycars_target: payload.easycars_target || null,
          parent_task_id: task_id,
        },
        related_entity_type: 'invoice',
        related_entity_id: payload.invoice_number || null,
      });
    }

    children.stock_entry = await spawnChildTask(supabase, {
      task_type: 'stock_entry_browser',
      title: `Stock entry for ${payload.rego || payload.vin}`,
      source: 'worker-easycars-upload',
      priority: 'P1',
      dedupe_key: `stock_entry:${payload.invoice_number || ''}:${payload.rego || payload.vin}`,
      payload: {
        rego: payload.rego,
        vin: payload.vin,
        supplier_name: payload.supplier_name,
        acquisition_cost: payload.acquisition_cost,
        invoice_number: payload.invoice_number,
        invoice_date: payload.invoice_date || null,
        duplicate_check: payload.duplicate_check || { duplicate_risk: false },
        parent_task_id: task_id,
      },
      related_entity_type: 'vehicle',
      related_entity_id: payload.rego || payload.vin || null,
    });

    const summary = `EasyCars orchestration ok; children: ${Object.keys(children).join(', ')}`;
    await logBrowserStep(supabase, {
      task_id, run_id, step: 'orchestration_complete',
      result: 'success', message: summary, extra: { children },
    });

    return createJsonResponse({ ok: true, summary, children });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String((error as any)?.message || error) }, 500);
  }
});
