// Phase 2D - EasyCars browser driver shim.
// Talks to an external browser session service (Playwright/Puppeteer worker,
// Browserless, etc.) over HTTP. No AI logic - deterministic command/response.
//
// Configure via env:
//   EASYCARS_BROWSER_SESSION_URL   (required to switch from deferred -> live)
//   EASYCARS_BROWSER_SESSION_AUTH  (optional bearer token)
//   EASYCARS_BROWSER_PROFILE       (optional profile/session id)
//   EASYCARS_BROWSER_TIMEOUT_MS    (optional, default 30000)

function env(name, fallback = null) {
  const v = Deno.env.get(name);
  return v === undefined || v === '' ? fallback : v;
}

export function isLiveMode() {
  return Boolean(env('EASYCARS_BROWSER_SESSION_URL'));
}

export function driverConfig() {
  return {
    sessionUrl: env('EASYCARS_BROWSER_SESSION_URL'),
    auth: env('EASYCARS_BROWSER_SESSION_AUTH'),
    profile: env('EASYCARS_BROWSER_PROFILE', 'default'),
    timeoutMs: Number(env('EASYCARS_BROWSER_TIMEOUT_MS', '30000')),
  };
}

async function call(command, params = {}) {
  const cfg = driverConfig();
  if (!cfg.sessionUrl) {
    return { ok: false, deferred: true, reason: 'no_easycars_browser_session_configured' };
  }
  const headers = { 'content-type': 'application/json' };
  if (cfg.auth) headers['authorization'] = cfg.auth.startsWith('Bearer ') ? cfg.auth : `Bearer ${cfg.auth}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const resp = await fetch(`${cfg.sessionUrl.replace(/\/+$/, '')}/${command}`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ profile: cfg.profile, ...params }),
    });
    const text = await resp.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: body.error || `driver ${command} returned ${resp.status}`,
        url: body.url || null,
        selector: body.selector || null,
        screenshot_ref: body.screenshot_ref || null,
        step: body.step || command,
        body,
      };
    }
    return { ok: true, ...body };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
      step: command,
      screenshot_ref: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- Deterministic helpers ------------------------------------------------

export async function ensureLoggedIn() {
  return call('ensureLoggedIn');
}

export async function openEasyCars(path = '/') {
  return call('openEasyCars', { path });
}

export async function currentUrl() {
  return call('currentUrl');
}

export async function captureScreenshot(label = 'capture') {
  return call('captureScreenshot', { label });
}

export async function uploadInvoice({ invoice_number, attachment_name, attachment_url, target }) {
  return call('uploadInvoice', { invoice_number, attachment_name, attachment_url, target });
}

export async function createStockEntry(fields) {
  return call('createStockEntry', { fields });
}

// Convenience: run a sequence of named steps, logging each via the provided logger.
// Stops on first failure and returns { ok, lastStep, results, failure }.
export async function runSteps(steps, log) {
  const results = [];
  for (const s of steps) {
    if (log) await log({ step: s.name, result: 'started', url: null, selector: null });
    const out = await s.fn();
    results.push({ step: s.name, ...out });
    if (log) {
      await log({
        step: s.name,
        result: out.ok ? 'success' : 'failed',
        url: out.url || null,
        selector: out.selector || null,
        screenshot_ref: out.screenshot_ref || null,
        message: out.ok ? `${s.name} ok` : `${s.name} failed: ${out.error}`,
        level: out.ok ? 'info' : 'error',
      });
    }
    if (!out.ok) {
      return { ok: false, lastStep: s.name, results, failure: out };
    }
  }
  return { ok: true, results };
}
