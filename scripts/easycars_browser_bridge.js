#!/usr/bin/env node
/* eslint-disable */
// EasyCars Browser Bridge — Phase 2D execution dependency.
//
// Exposes a minimal HTTP surface the Supabase browser workers call when
// EASYCARS_BROWSER_SESSION_URL is set. Deterministic only — no AI.
//
// Endpoints (all POST, JSON in/out):
//   /health
//   /ensureLoggedIn
//   /openEasyCars        { path }
//   /currentUrl
//   /captureScreenshot   { label }
//   /createStockEntry    { fields }
//   /uploadInvoice       { invoice_number, attachment_name, attachment_url, target }
//
// Response shape (subset, fields optional):
//   { ok, url, selector, screenshot_ref, stock_number, document_id, error }
//
// Run:
//   node scripts/easycars_browser_bridge.js
//
// Env:
//   PORT                 (default 3457)
//   EASYCARS_USERNAME
//   EASYCARS_PASSWORD
//   EASYCARS_CREDENTIALS_FILE  (default /data/.openclaw/workspace/data/easycars_credentials.env)
//   EASYCARS_SCRIPT_PATH       (default skills/easycars-playwright/scripts/easycars-final-v4.js)
//   EASYCARS_SCREENSHOT_DIR    (default /tmp/easycars-bridge)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3457);
const SCREENSHOT_DIR = process.env.EASYCARS_SCREENSHOT_DIR || '/tmp/easycars-bridge';
const CRED_FILE = process.env.EASYCARS_CREDENTIALS_FILE
  || '/data/.openclaw/workspace/data/easycars_credentials.env';
const SCRIPT_PATH = process.env.EASYCARS_SCRIPT_PATH
  || path.resolve(__dirname, '..', 'skills', 'easycars-playwright', 'scripts', 'easycars-final-v4.js');

try { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

// -------- credentials ------------------------------------------------------

function loadCredentials() {
  let username = process.env.EASYCARS_USERNAME || null;
  let password = process.env.EASYCARS_PASSWORD || null;
  if ((!username || !password) && fs.existsSync(CRED_FILE)) {
    try {
      const text = fs.readFileSync(CRED_FILE, 'utf8');
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key === 'EASYCARS_USERNAME' && !username) username = val;
        if (key === 'EASYCARS_PASSWORD' && !password) password = val;
      }
    } catch (err) {
      console.error('[bridge] failed to read credentials file:', err.message);
    }
  }
  return { username, password };
}

// -------- helpers ----------------------------------------------------------

let lastKnownUrl = null;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 4 * 1024 * 1024) reject(new Error('payload_too_large')); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function runScript(args, extraEnv = {}, opts = {}) {
  return new Promise((resolve) => {
    if (!fs.existsSync(SCRIPT_PATH)) {
      return resolve({ ok: false, error: `script_not_found:${SCRIPT_PATH}` });
    }
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = Number(opts.timeoutMs || 180000);
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(t);
      // Try to parse last JSON line from stdout.
      let parsed = null;
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startsWith('{') && line.endsWith('}')) {
          try { parsed = JSON.parse(line); break; } catch {}
        }
      }
      resolve({
        ok: code === 0,
        exit_code: code,
        parsed,
        stdout_tail: stdout.slice(-2000),
        stderr_tail: stderr.slice(-2000),
      });
    });
  });
}

function takeLocalScreenshot(label) {
  // Bridge-level placeholder marker (real screenshot is taken by the
  // underlying Playwright script). Used when no browser context is held.
  const ref = `${SCREENSHOT_DIR}/${nowStamp()}_${(label || 'capture').replace(/[^a-z0-9_-]/gi, '_')}.txt`;
  try { fs.writeFileSync(ref, `bridge-marker ${new Date().toISOString()} ${label || ''}\n`); } catch {}
  return ref;
}

// -------- handlers ---------------------------------------------------------

async function handleHealth() {
  const { username } = loadCredentials();
  return {
    ok: true,
    service: 'easycars-browser-bridge',
    port: PORT,
    script_path: SCRIPT_PATH,
    script_present: fs.existsSync(SCRIPT_PATH),
    credentials_present: Boolean(username),
    last_known_url: lastKnownUrl,
    time: new Date().toISOString(),
  };
}

async function handleEnsureLoggedIn() {
  const { username, password } = loadCredentials();
  if (!username || !password) {
    return { ok: false, error: 'missing_easycars_credentials' };
  }
  // The underlying script logs in on each invocation; we treat creds-present
  // as a successful precondition. Live login is exercised by createStockEntry.
  return { ok: true, logged_in: true };
}

async function handleOpenEasyCars(body) {
  const target = body && body.path ? String(body.path) : '/';
  lastKnownUrl = `https://app.easycars.com.au${target.startsWith('/') ? '' : '/'}${target}`;
  return { ok: true, url: lastKnownUrl };
}

async function handleCurrentUrl() {
  return { ok: true, url: lastKnownUrl };
}

async function handleCaptureScreenshot(body) {
  const ref = takeLocalScreenshot((body && body.label) || 'capture');
  return { ok: true, screenshot_ref: ref };
}

async function handleCreateStockEntry(body) {
  const fields = (body && body.fields) || {};
  const { username, password } = loadCredentials();
  if (!username || !password) return { ok: false, error: 'missing_easycars_credentials' };

  // Pass fields to the proven Playwright script via env + JSON payload arg.
  const payloadFile = path.join(SCREENSHOT_DIR, `stock_${nowStamp()}.json`);
  try { fs.writeFileSync(payloadFile, JSON.stringify(fields, null, 2)); } catch {}

  const result = await runScript(['--payload', payloadFile], {
    EASYCARS_USERNAME: username,
    EASYCARS_PASSWORD: password,
    EASYCARS_SCREENSHOT_DIR: SCREENSHOT_DIR,
  }, { timeoutMs: 240000 });

  const parsed = result.parsed || {};
  if (!result.ok && !parsed.ok) {
    return {
      ok: false,
      step: 'createStockEntry',
      error: parsed.error || `script_exit_${result.exit_code}`,
      url: parsed.url || null,
      selector: parsed.selector || null,
      screenshot_ref: parsed.screenshot_ref || takeLocalScreenshot('stock_entry_fail'),
      stderr_tail: result.stderr_tail,
    };
  }
  if (parsed.url) lastKnownUrl = parsed.url;
  return {
    ok: true,
    step: 'createStockEntry',
    url: parsed.url || lastKnownUrl,
    stock_number: parsed.stock_number || parsed.stockNumber || null,
    screenshot_ref: parsed.screenshot_ref || null,
  };
}

async function handleUploadInvoice(body) {
  // Scaffold only — the exact EasyCars document-upload flow is not wired yet.
  return {
    ok: false,
    step: 'uploadInvoice',
    error: 'invoice_upload_not_implemented_in_bridge_yet',
    received: {
      invoice_number: body?.invoice_number || null,
      attachment_name: body?.attachment_name || null,
      attachment_url: body?.attachment_url || null,
      target: body?.target || null,
    },
  };
}

// -------- routing ----------------------------------------------------------

const ROUTES = {
  '/health': handleHealth,
  '/ensureLoggedIn': handleEnsureLoggedIn,
  '/openEasyCars': handleOpenEasyCars,
  '/currentUrl': handleCurrentUrl,
  '/captureScreenshot': handleCaptureScreenshot,
  '/createStockEntry': handleCreateStockEntry,
  '/uploadInvoice': handleUploadInvoice,
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'POST_required' });
  }
  const route = ROUTES[req.url] || ROUTES[(req.url || '').split('?')[0]];
  if (!route) return send(res, 404, { ok: false, error: 'unknown_command', path: req.url });

  let body = {};
  try { body = await readBody(req); }
  catch (e) { return send(res, 400, { ok: false, error: String(e.message || e) }); }

  try {
    const out = await route(body);
    return send(res, out.ok ? 200 : 500, out);
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[easycars-bridge] listening on :${PORT}`);
  console.log(`[easycars-bridge] script: ${SCRIPT_PATH}`);
  console.log(`[easycars-bridge] screenshots: ${SCREENSHOT_DIR}`);
});
