import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id } = await req.json();
    const supabase = getSupabaseAdmin();
    const services = [
      { name: 'email_scan_state', path: '/data/.openclaw/workspace/data/email_scan_state.json' },
      { name: 'autograb_snapshot', path: '/data/.openclaw/workspace/out/autograb_savedsearch.json' },
      { name: 'carbitrage_monitor', path: '/data/.openclaw/workspace/out/carbitrage_ingestion_monitor_last.json' },
    ];
    const checks = [];
    for (const svc of services) {
      try {
        const stat = await Deno.stat(svc.path);
        checks.push({ name: svc.name, ok: true, mtime: stat.mtime?.toISOString() || null });
      } catch {
        checks.push({ name: svc.name, ok: false, error: 'missing' });
      }
    }
    const failed = checks.filter((c) => !c.ok);
    const summary = failed.length
      ? `Heartbeat check found ${failed.length} missing dependency files`
      : `Heartbeat check passed (${checks.length} dependencies seen)`;
    await supabase.from('task_logs').insert({
      task_id,
      run_id,
      level: failed.length ? 'warn' : 'info',
      message: summary,
      data: { checks },
    });
    if (failed.length) {
      return createJsonResponse({ ok: false, summary, checks }, 500);
    }
    return createJsonResponse({ ok: true, summary, checks });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
