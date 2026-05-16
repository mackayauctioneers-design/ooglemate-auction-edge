// Shared helpers for Phase 2A watcher workers.

export const WORKER_FUNCTION_MAP = {
  'worker-heartbeat-check': 'worker-heartbeat-check',
  'worker-gmail-invoice-watcher': 'worker-gmail-invoice-watcher',
  'worker-autograb-health': 'worker-autograb-health',
  'worker-carbitrage-ingestion': 'worker-carbitrage-ingestion',
  'agent-exception-diagnosis-placeholder': 'agent-exception-diagnosis-placeholder',
};

export const TASK_TYPE_TO_WORKER = {
  gmail_invoice_detected: { worker: 'worker-gmail-invoice-watcher', category: 'watcher' },
  autograb_health_check: { worker: 'worker-autograb-health', category: 'watcher' },
  carbitrage_ingestion_check: { worker: 'worker-carbitrage-ingestion', category: 'watcher' },
  heartbeat_check: { worker: 'worker-heartbeat-check', category: 'watcher' },
};

export function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

export async function callExternalEndpoint({ url, auth, body, label }) {
  if (!url) {
    return { called: false, reason: `${label}_url_not_configured` };
  }
  try {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers['authorization'] = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { called: true, ok: resp.ok, status: resp.status, response: json };
  } catch (err) {
    return { called: true, ok: false, error: String(err?.message || err) };
  }
}

export async function spawnChildTask(supabase, body) {
  try {
    const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/task-ingress`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify(body),
    });
    return await resp.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export async function logTask(supabase, { task_id, run_id, level = 'info', message, data }) {
  try {
    await supabase.from('task_logs').insert({ task_id, run_id, level, message, data: data || {} });
  } catch {
    // best-effort
  }
}
