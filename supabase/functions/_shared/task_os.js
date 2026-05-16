const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const CONCURRENCY_LIMITS = {
  reasoning: 1,
  browser: 2,
  watcher: 10,
  data: 5,
  exception: 1,
};

export const ACTIVE_STATUSES = ['pending', 'assigned', 'running', 'waiting', 'retrying'];

export function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function classifyTask(input) {
  const text = [input.task_type, input.title, JSON.stringify(input.payload || {})]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const retryCount = Number(input.retry_count || 0);
  const duplicateMoneyRisk = Boolean(input.payload?.duplicate_money_risk);
  const stalled = Boolean(input.payload?.stalled);

  if (retryCount >= 3 || duplicateMoneyRisk) {
    return { worker_category: 'human', assigned_worker: 'human-review-gate', route_reason: 'human_review' };
  }
  if (retryCount >= 2 || stalled || text.includes('exception_diagnosis')) {
    return { worker_category: 'exception', assigned_worker: 'agent-exception-diagnosis-placeholder', route_reason: 'exception_diagnosis' };
  }
  const directMap = {
    gmail_invoice_detected: { worker_category: 'watcher', assigned_worker: 'worker-gmail-invoice-watcher', route_reason: 'gmail_watcher' },
    autograb_health_check: { worker_category: 'watcher', assigned_worker: 'worker-autograb-health', route_reason: 'autograb_watcher' },
    carbitrage_ingestion_check: { worker_category: 'watcher', assigned_worker: 'worker-carbitrage-ingestion', route_reason: 'carbitrage_watcher' },
    heartbeat_check: { worker_category: 'watcher', assigned_worker: 'worker-heartbeat-check', route_reason: 'watcher' },
    invoice_parse: { worker_category: 'data', assigned_worker: 'worker-invoice-parser', route_reason: 'invoice_parser' },
    rego2stock_prepare: { worker_category: 'data', assigned_worker: 'worker-rego2stock-prepare', route_reason: 'rego2stock' },
    duplicate_detection: { worker_category: 'data', assigned_worker: 'worker-duplicate-detection', route_reason: 'duplicate_detection' },
    autograb_health_alert: { worker_category: 'data', assigned_worker: 'worker-duplicate-detection', route_reason: 'duplicate_detection_alert' },
    carbitrage_ingestion_alert: { worker_category: 'data', assigned_worker: 'worker-duplicate-detection', route_reason: 'duplicate_detection_alert' },
    easycars_upload: { worker_category: 'browser', assigned_worker: 'worker-easycars-upload', route_reason: 'easycars_upload' },
    easycars_stock_entry: { worker_category: 'browser', assigned_worker: 'worker-stock-entry-browser', route_reason: 'easycars_stock_entry' },
    easycars_invoice_upload: { worker_category: 'browser', assigned_worker: 'worker-invoice-upload', route_reason: 'easycars_invoice_upload' },
    invoice_upload: { worker_category: 'browser', assigned_worker: 'worker-invoice-upload', route_reason: 'invoice_upload' },
    stock_entry_browser: { worker_category: 'browser', assigned_worker: 'worker-stock-entry-browser', route_reason: 'stock_entry_browser' },
  };
  if (directMap[input.task_type]) return directMap[input.task_type];
  if (/(heartbeat|cron|freshness|polling|health check|health_check)/.test(text)) {
    return { worker_category: 'watcher', assigned_worker: 'worker-heartbeat-check', route_reason: 'watcher' };
  }
  if (/(upload|login|portal|browser|easycars_upload|invoice upload|stock entry)/.test(text)) {
    return { worker_category: 'browser', assigned_worker: 'worker-browser-generic', route_reason: 'browser' };
  }
  if (/(parse|merge|dedupe|vin|rego|database update|database_update|stock record|invoice_parse)/.test(text)) {
    return { worker_category: 'data', assigned_worker: 'worker-data-generic', route_reason: 'data' };
  }
  if (/(ambiguity|diagnosis|analysis|decision|report|reasoning)/.test(text)) {
    return { worker_category: 'reasoning', assigned_worker: 'agent-reasoning-generic', route_reason: 'reasoning' };
  }
  return { worker_category: 'watcher', assigned_worker: 'worker-heartbeat-check', route_reason: 'default_watcher' };
}

export function assignPriority(input) {
  if (input.priority && PRIORITY_ORDER[input.priority] !== undefined) return input.priority;
  const text = [input.task_type, input.title, JSON.stringify(input.payload || {})].filter(Boolean).join(' ').toLowerCase();
  if (/(money|login failure|account failure|blocked|duplicate stock|ingestion completely down|duplicate_money_risk)/.test(text)) return 'P0';
  if (/(new invoice|stock entry|required|high-value|high value|stale|gmail_invoice_detected|carbitrage opportunity)/.test(text)) return 'P1';
  if (/(report|summary|cleanup|handover|analysis)/.test(text)) return 'P3';
  return 'P2';
}

export function buildDedupeKey(input) {
  if (input.dedupe_key) return input.dedupe_key;
  const payload = input.payload || {};
  if (payload.gmail_message_id) return `gmail:${payload.gmail_message_id}`;
  if (payload.invoice_number && payload.rego) return `invoice_rego:${payload.invoice_number}:${String(payload.rego).toUpperCase()}`;
  if (payload.vin || payload.chassis) return `vin:${String(payload.vin || payload.chassis).toUpperCase()}`;
  if (payload.stock_number) return `stock:${payload.stock_number}`;
  if (payload.autograb_window) return `autograb:${payload.autograb_window}`;
  if (payload.carbitrage_source && payload.batch_id) return `carbitrage:${payload.carbitrage_source}:${payload.batch_id}`;
  return input.dedupe_key || null;
}

export function shouldAllowOpenCore(task) {
  const requiresReasoning = Boolean(task.payload?.requires_reasoning);
  const humanRequestedDiagnosis = Boolean(task.payload?.human_review_requested_ai_diagnosis);
  return Boolean(
    requiresReasoning ||
    task.task_type === 'exception_diagnosis' ||
    task.status === 'needs_reasoning' ||
    Number(task.retry_count || 0) >= 2 ||
    humanRequestedDiagnosis
  );
}

export function nextRetryDelaySeconds(task) {
  const base = Number(task.retry_delay_seconds || 300);
  const retryCount = Number(task.retry_count || 0);
  return Math.min(base * Math.max(1, retryCount), 3600);
}

export function handleFailure(task) {
  const retryCount = Number(task.retry_count || 0) + 1;
  if (retryCount >= 3 || task.payload?.duplicate_money_risk) {
    return {
      status: 'needs_human',
      retry_count: retryCount,
      create_human_review: true,
      create_exception_diagnosis: retryCount >= 2,
    };
  }
  return {
    status: 'retrying',
    retry_count: retryCount,
    create_exception_diagnosis: retryCount >= 2,
    retry_delay_seconds: nextRetryDelaySeconds({ ...task, retry_count: retryCount }),
  };
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });
}

export function createJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
