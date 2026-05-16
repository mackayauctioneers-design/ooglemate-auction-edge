// Shared helpers for Phase 2C browser workers.
// Deterministic-first; AI/OpenCore only on escalation.

export const BROWSER_WORKER_FUNCTION_MAP = {
  'worker-easycars-upload': 'worker-easycars-upload',
  'worker-invoice-upload': 'worker-invoice-upload',
  'worker-stock-entry-browser': 'worker-stock-entry-browser',
};

export const BROWSER_TASK_TYPE_TO_WORKER = {
  easycars_upload: { worker: 'worker-easycars-upload', category: 'browser' },
  easycars_stock_entry: { worker: 'worker-stock-entry-browser', category: 'browser' },
  easycars_invoice_upload: { worker: 'worker-invoice-upload', category: 'browser' },
  invoice_upload: { worker: 'worker-invoice-upload', category: 'browser' },
  stock_entry_browser: { worker: 'worker-stock-entry-browser', category: 'browser' },
};

// Required fields per browser flow
const REQUIRED_STOCK_FIELDS = ['rego', 'vin', 'supplier_name', 'acquisition_cost'];
const REQUIRED_INVOICE_FIELDS = ['invoice_number'];

export function validateStockPayload(payload = {}) {
  const missing = REQUIRED_STOCK_FIELDS.filter((k) => {
    const v = payload[k];
    return v === undefined || v === null || v === '';
  });
  return { ok: missing.length === 0, missing };
}

export function validateInvoicePayload(payload = {}) {
  const missing = REQUIRED_INVOICE_FIELDS.filter((k) => {
    const v = payload[k];
    return v === undefined || v === null || v === '';
  });
  return { ok: missing.length === 0, missing };
}

export function isDuplicateRisk(payload = {}) {
  return Boolean(payload?.duplicate_check?.duplicate_risk || payload?.duplicate_money_risk);
}

// Structured browser step log
export async function logBrowserStep(supabase, {
  task_id,
  run_id,
  level = 'info',
  step,
  url = null,
  selector = null,
  screenshot_ref = null,
  result = null,
  message,
  extra = {},
}) {
  try {
    await supabase.from('task_logs').insert({
      task_id,
      run_id,
      level,
      message: message || `${step}: ${result || level}`,
      data: { step, url, selector, screenshot_ref, result, ...extra },
    });
  } catch {
    // best-effort
  }
}

// Browser session env discovery - returns null if no live session
export function detectBrowserSession() {
  const sessionUrl = Deno.env.get('EASYCARS_BROWSER_SESSION_URL');
  const sessionToken = Deno.env.get('EASYCARS_BROWSER_SESSION_TOKEN');
  if (!sessionUrl) return { ok: false, reason: 'no_easycars_browser_session_configured' };
  return { ok: true, sessionUrl, sessionToken: sessionToken || null };
}
