// gmail-backfill-easycars
// Pulls historical EasyCars invoice emails from a connected Gmail inbox
// (mackayauctioneers@gmail.com) and feeds each PDF attachment into the
// existing easycars-invoice-ingest function — no duplicate parsing logic.
//
// Architecture:
//   - Gmail access via the Lovable connector gateway (google_mail).
//     Auth headers: Authorization: Bearer LOVABLE_API_KEY
//                   X-Connection-Api-Key: GOOGLE_MAIL_API_KEY
//   - Search query: from:mailer@easycars.com.au has:attachment (no date floor).
//   - Idempotency: skip messages whose gmail_message_id is already in
//     invoice_emails.
//   - Resumable: pageToken cursor + counters persisted to gmail_backfill_state
//     (single row keyed by source='easycars').
//   - 110s TIME_BUDGET_MS per invocation, batches of 50, 1s delay between
//     batches. Re-invoke with no body to continue.
//
// Endpoints:
//   POST /                  → start or resume backfill
//                             body: { reset?: boolean, query?: string,
//                                     batch_size?: number }
//   GET  /?status=1         → current state
//
// Auth: Bearer LINDY_WEBHOOK_SECRET (operator-only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE_KEY = "easycars";
const DEFAULT_QUERY = "from:mailer@easycars.com.au has:attachment";
const TIME_BUDGET_MS = 110_000;
const DEFAULT_BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1_000;

const GMAIL_GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token !== Deno.env.get("LINDY_WEBHOOK_SECRET")) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GOOGLE_MAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LINDY_SECRET = Deno.env.get("LINDY_WEBHOOK_SECRET")!;

  if (!LOVABLE_API_KEY) return jsonResp({ error: "LOVABLE_API_KEY not configured" }, 500);
  if (!GOOGLE_MAIL_API_KEY) {
    return jsonResp({ error: "GOOGLE_MAIL_API_KEY not configured — Gmail connector not linked" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Status endpoint
  const url = new URL(req.url);
  if (req.method === "GET" || url.searchParams.get("status")) {
    const { data: state } = await supabase
      .from("gmail_backfill_state")
      .select("*")
      .eq("source", SOURCE_KEY)
      .maybeSingle();
    return jsonResp({ state });
  }

  const body = await safeJson(req);
  const reset = body?.reset === true;
  const query: string = body?.query || DEFAULT_QUERY;
  const batchSize = clampInt(body?.batch_size, DEFAULT_BATCH_SIZE, 1, 100);

  // Load or initialise state
  let state = await loadState(supabase);
  if (reset || !state) {
    state = {
      source: SOURCE_KEY,
      run_id: crypto.randomUUID(),
      page_token: null,
      query,
      total_estimate: null,
      messages_seen: 0,
      messages_ingested: 0,
      messages_skipped: 0,
      errors: 0,
      finished_at: null,
    };
    await saveState(supabase, state);
  }

  const startedAt = Date.now();
  let batchNumber = 0;

  while (true) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.log(`[gmail-backfill] time budget hit at ${state.messages_seen} seen`);
      break;
    }

    // List page of messages
    const listUrl = new URL(`${GMAIL_GATEWAY}/users/me/messages`);
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", String(batchSize));
    if (state.page_token) listUrl.searchParams.set("pageToken", state.page_token);

    const listResp = await fetch(listUrl.toString(), {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
      },
    });
    if (!listResp.ok) {
      const text = await listResp.text();
      console.error(`[gmail-backfill] list failed [${listResp.status}]: ${text.slice(0, 500)}`);
      state.errors++;
      await saveState(supabase, state);
      return jsonResp({ error: "Gmail list failed", status: listResp.status, body: text.slice(0, 500), state }, 502);
    }
    const listJson = await listResp.json();
    const messages: Array<{ id: string }> = listJson.messages || [];

    // Capture upfront universe estimate on the very first page of a fresh run
    if (state.total_estimate == null && typeof listJson.resultSizeEstimate === "number") {
      state.total_estimate = listJson.resultSizeEstimate;
    }

    if (messages.length === 0) {
      state.finished_at = new Date().toISOString();
      state.page_token = null;
      await saveState(supabase, state);
      console.log(`[gmail-backfill] complete: ${state.messages_seen} seen, ${state.messages_ingested} ingested`);
      break;
    }

    let bIngested = 0;
    let bSkipped = 0;
    let bErr = 0;

    for (const m of messages) {
      state.messages_seen++;

      // Idempotency: already in invoice_emails?
      const { data: existing } = await supabase
        .from("invoice_emails")
        .select("id")
        .eq("gmail_message_id", m.id)
        .maybeSingle();
      if (existing) {
        bSkipped++;
        state.messages_skipped++;
        continue;
      }

      try {
        // Fetch full message
        const msgResp = await fetch(
          `${GMAIL_GATEWAY}/users/me/messages/${m.id}?format=full`,
          {
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
            },
          },
        );
        if (!msgResp.ok) throw new Error(`get message ${m.id} failed [${msgResp.status}]`);
        const msg = await msgResp.json();

        // Find PDF attachment(s)
        const pdfParts = collectPdfParts(msg.payload);
        if (pdfParts.length === 0) {
          bSkipped++;
          state.messages_skipped++;
          continue;
        }

        for (const part of pdfParts) {
          let pdfBase64: string | null = null;
          if (part.body?.data) {
            pdfBase64 = b64UrlToB64(part.body.data);
          } else if (part.body?.attachmentId) {
            const attResp = await fetch(
              `${GMAIL_GATEWAY}/users/me/messages/${m.id}/attachments/${part.body.attachmentId}`,
              {
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
                },
              },
            );
            if (!attResp.ok) throw new Error(`get attachment failed [${attResp.status}]`);
            const att = await attResp.json();
            pdfBase64 = b64UrlToB64(att.data);
          }
          if (!pdfBase64) continue;

          // Hand off to easycars-invoice-ingest (PDF extraction + sales-truth +
          // buyer fingerprints + match trigger already implemented there).
          const ingestResp = await fetch(`${SUPABASE_URL}/functions/v1/easycars-invoice-ingest`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LINDY_SECRET}`,
            },
            body: JSON.stringify({
              account_id: "easycars-default",
              pdf_base64: pdfBase64,
              gmail_message_id: m.id,
            }),
          });
          if (!ingestResp.ok) {
            const t = await ingestResp.text();
            throw new Error(`ingest failed [${ingestResp.status}]: ${t.slice(0, 300)}`);
          }
        }

        bIngested++;
        state.messages_ingested++;
      } catch (err: any) {
        console.error(`[gmail-backfill] message ${m.id} error:`, err.message);
        bErr++;
        state.errors++;
      }
    }

    batchNumber++;
    state.page_token = listJson.nextPageToken || null;
    await saveState(supabase, state);
    await supabase.from("backfill_log").insert({
      run_id: state.run_id,
      batch_number: batchNumber,
      emails_processed: messages.length,
      sold_vehicles_written: bIngested,
      cross_references_matched: 0,
      errors: bErr,
    });

    if (!state.page_token) {
      state.finished_at = new Date().toISOString();
      await saveState(supabase, state);
      break;
    }

    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  return jsonResp({
    success: true,
    batches_this_run: batchNumber,
    state,
    note: state.finished_at
      ? "Backfill complete."
      : "Time budget reached — re-invoke (no body) to resume from saved cursor.",
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadState(supabase: any) {
  const { data } = await supabase
    .from("gmail_backfill_state")
    .select("*")
    .eq("source", SOURCE_KEY)
    .maybeSingle();
  return data;
}

async function saveState(supabase: any, state: any) {
  state.updated_at = new Date().toISOString();
  await supabase.from("gmail_backfill_state").upsert(state, { onConflict: "source" });
}

function collectPdfParts(payload: any, out: any[] = []): any[] {
  if (!payload) return out;
  const isPdf =
    payload.mimeType === "application/pdf" ||
    (payload.filename || "").toLowerCase().endsWith(".pdf");
  if (isPdf && payload.body) out.push(payload);
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) collectPdfParts(p, out);
  }
  return out;
}

function b64UrlToB64(data: string): string {
  return data.replace(/-/g, "+").replace(/_/g, "/");
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function safeJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

function clampInt(v: any, dflt: number, min: number, max: number): number {
  const n = parseInt(String(v ?? dflt));
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
