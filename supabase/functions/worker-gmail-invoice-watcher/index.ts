import { getSupabaseAdmin } from '../_shared/supabase.js';
import { createJsonResponse } from '../_shared/task_os.js';
import { callExternalEndpoint, logTask, spawnChildTask } from '../_shared/watchers.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return createJsonResponse({ error: 'POST required' }, 405);
  try {
    const { task_id, run_id, task } = await req.json();
    const supabase = getSupabaseAdmin();
    const payload = task?.payload || {};
    const gmailId = payload.gmail_message_id || null;
    const subject = payload.subject || null;

    const ext = await callExternalEndpoint({
      url: Deno.env.get('GMAIL_WATCHER_WEBHOOK_URL'),
      auth: Deno.env.get('GMAIL_WATCHER_AUTH'),
      body: { task_id, gmail_message_id: gmailId, subject, payload },
      label: 'gmail_watcher',
    });

    let child = null;
    if (gmailId) {
      child = await spawnChildTask(supabase, {
        task_type: 'invoice_parse',
        title: `Parse invoice from gmail ${gmailId}`,
        source: 'worker-gmail-invoice-watcher',
        priority: 'P1',
        dedupe_key: `invoice_parse:${gmailId}`,
        payload: {
          gmail_message_id_ref: gmailId,
          subject,
          parent_task_id: task_id,
          ...(payload.attachments ? { attachments: payload.attachments } : {}),
        },
        related_entity_type: 'gmail_message',
        related_entity_id: gmailId,
      });
    }

    const summary = `Gmail watcher processed message ${gmailId || '(no id)'}${child?.task_id ? `; spawned invoice_parse ${child.task_id}` : ''}`;
    await logTask(supabase, { task_id, run_id, level: 'info', message: summary, data: { ext, child } });
    return createJsonResponse({ ok: true, summary, ext, child });
  } catch (error) {
    return createJsonResponse({ ok: false, error: String(error?.message || error) }, 500);
  }
});
