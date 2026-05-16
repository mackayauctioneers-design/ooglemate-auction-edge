// Shared helpers for Phase 2B data workers.

export const DATA_WORKER_FUNCTION_MAP = {
  'worker-invoice-parser': 'worker-invoice-parser',
  'worker-rego2stock-prepare': 'worker-rego2stock-prepare',
  'worker-duplicate-detection': 'worker-duplicate-detection',
};

export const DATA_TASK_TYPE_TO_WORKER = {
  invoice_parse: { worker: 'worker-invoice-parser', category: 'data' },
  rego2stock_prepare: { worker: 'worker-rego2stock-prepare', category: 'data' },
  duplicate_detection: { worker: 'worker-duplicate-detection', category: 'data' },
  autograb_health_alert: { worker: 'worker-duplicate-detection', category: 'data' },
  carbitrage_ingestion_alert: { worker: 'worker-duplicate-detection', category: 'data' },
};

// --- Invoice field extraction ---------------------------------------------

const FIELD_PATTERNS = {
  supplier: /^\s*Supplier\s*[:\-]\s*(.+)$/im,
  abn: /\bABN\s*[:\-]?\s*([\d\s]{11,16})/i,
  invoice_number: /(?:Invoice\s*(?:Number|No\.?|#)\s*[:\-]?\s*|\bINV[-#]\s*)([A-Z0-9][A-Z0-9\-\/]*)/i,
  invoice_date: /\b(?:Invoice\s*Date|Date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  rego: /\bRego(?:istration)?\s*[:\-]?\s*([A-Z0-9]{3,8})/i,
  vin: /\b(?:VIN|Chassis)\s*[:\-]?\s*([A-HJ-NPR-Z0-9]{11,17})/i,
  stock_number: /\bStock\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
  amount: /\b(?:Total|Amount(?:\s*Due)?|Grand\s*Total)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  gst: /\bGST\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
};

function num(str) {
  if (!str) return null;
  const n = Number(String(str).replace(/[,\s$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function extractInvoiceFields(text) {
  const out = {};
  if (!text || typeof text !== 'string') {
    return { fields: out, confidence: 0 };
  }
  for (const [key, re] of Object.entries(FIELD_PATTERNS)) {
    const m = text.match(re);
    if (m) out[key] = (m[1] || '').trim();
  }
  if (out.abn) out.abn = out.abn.replace(/\s+/g, '');
  if (out.amount) out.amount = num(out.amount);
  if (out.gst) out.gst = num(out.gst);
  if (out.rego) out.rego = out.rego.toUpperCase();
  if (out.vin) out.vin = out.vin.toUpperCase();
  if (out.stock_number) out.stock_number = out.stock_number.toUpperCase();

  // confidence = weighted hit rate over priority fields
  const weights = { supplier: 1, invoice_number: 2, amount: 2, rego: 2, vin: 2, invoice_date: 1, abn: 1, gst: 0.5, stock_number: 0.5 };
  let got = 0, total = 0;
  for (const [k, w] of Object.entries(weights)) {
    total += w;
    if (out[k] !== undefined && out[k] !== null && out[k] !== '') got += w;
  }
  const confidence = total ? Math.min(1, got / total) : 0;
  return { fields: out, confidence };
}

// --- Normalization --------------------------------------------------------

export function normalizeStockPayload(input = {}) {
  const rego = input.rego ? String(input.rego).toUpperCase().replace(/\s+/g, '') : null;
  const vin = (input.vin || input.chassis) ? String(input.vin || input.chassis).toUpperCase().replace(/\s+/g, '') : null;
  const stock_number = input.stock_number ? String(input.stock_number).toUpperCase().trim() : null;
  return {
    rego,
    vin,
    chassis: vin,
    stock_number,
    invoice_number: input.invoice_number ? String(input.invoice_number).trim() : null,
    supplier: input.supplier ? String(input.supplier).trim() : null,
    abn: input.abn ? String(input.abn).replace(/\s+/g, '') : null,
    amount: input.amount != null ? Number(input.amount) : null,
    gst: input.gst != null ? Number(input.gst) : null,
    invoice_date: input.invoice_date || null,
    source_task_id: input.source_task_id || null,
  };
}

// --- Duplicate-key lookup against active tasks ----------------------------

const ACTIVE_STATUSES = ['pending', 'assigned', 'running', 'waiting', 'retrying'];

export async function findActiveDuplicates(supabase, { invoice_number, rego, vin, stock_number, exclude_task_id }) {
  const keys = [];
  if (invoice_number && rego) keys.push(`invoice_rego:${invoice_number}:${String(rego).toUpperCase()}`);
  if (vin) keys.push(`vin:${String(vin).toUpperCase()}`);
  if (stock_number) keys.push(`stock:${stock_number}`);
  if (!keys.length) return { keys_checked: [], matches: [] };

  let query = supabase
    .from('tasks')
    .select('task_id,task_type,status,dedupe_key,created_at')
    .in('dedupe_key', keys)
    .in('status', ACTIVE_STATUSES);
  if (exclude_task_id) query = query.neq('task_id', exclude_task_id);
  const { data, error } = await query;
  if (error) return { keys_checked: keys, matches: [], error: error.message };
  return { keys_checked: keys, matches: data || [] };
}

// --- Logging --------------------------------------------------------------

export async function logDataWorker(supabase, { task_id, run_id, level = 'info', message, data }) {
  try {
    await supabase.from('task_logs').insert({
      task_id, run_id, level, message, data: data || {},
    });
  } catch {
    // best-effort
  }
}
