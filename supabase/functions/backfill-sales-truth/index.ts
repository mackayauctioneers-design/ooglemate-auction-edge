// backfill-sales-truth
// One-shot job (operator-triggered) that walks existing invoice_emails rows,
// applies the Mackay quality filter, writes qualifying sales into
// sold_vehicles, attempts cross-reference for days_to_sell / margin_achieved,
// and logs progress per batch into backfill_log.
//
// Idempotency: writeSoldVehicle upserts on (dealer_id, vin) or
// (dealer_id, make, model, year, odometer, sale_date), so re-runs are safe.
//
// Trigger:  POST /functions/v1/backfill-sales-truth
//   body: { batch_size?: number, max_emails?: number, since?: ISODate }
// Status:   GET  /functions/v1/backfill-sales-truth?status=1
//
// Auth: Bearer LINDY_WEBHOOK_SECRET (operator-only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  writeSoldVehicle,
  MACKAY_SELLER_ABN,
  normaliseAbn,
} from "../_shared/sales-truth/writeSoldVehicle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000; // hard cap per invocation
const DEFAULT_BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth (operator-only)
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token !== Deno.env.get("LINDY_WEBHOOK_SECRET")) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Status endpoint: GET ?status=1 → latest run summary
  const url = new URL(req.url);
  if (req.method === "GET" || url.searchParams.get("status")) {
    const { data: latest } = await supabase
      .from("backfill_log")
      .select("run_id, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) return jsonResp({ runs: 0 });

    const { data: batches } = await supabase
      .from("backfill_log")
      .select("*")
      .eq("run_id", latest.run_id)
      .order("batch_number", { ascending: true });

    const totals = (batches ?? []).reduce(
      (acc, b: any) => ({
        emails_processed: acc.emails_processed + (b.emails_processed ?? 0),
        sold_vehicles_written: acc.sold_vehicles_written + (b.sold_vehicles_written ?? 0),
        cross_references_matched: acc.cross_references_matched + (b.cross_references_matched ?? 0),
        errors: acc.errors + (b.errors ?? 0),
      }),
      { emails_processed: 0, sold_vehicles_written: 0, cross_references_matched: 0, errors: 0 },
    );

    return jsonResp({
      latest_run_id: latest.run_id,
      started_at: batches?.[0]?.created_at,
      last_batch_at: batches?.[batches.length - 1]?.created_at,
      batches: batches?.length ?? 0,
      totals,
    });
  }

  // POST → start/continue a backfill run
  const body = await safeJson(req);
  const batchSize = clampInt(body?.batch_size, DEFAULT_BATCH_SIZE, 1, 200);
  const maxEmails = clampInt(body?.max_emails, 5_000, 1, 50_000);
  const since: string | null = body?.since ?? null;
  const runId = body?.run_id ?? crypto.randomUUID();

  const startedAt = Date.now();
  let processed = 0;
  let written = 0;
  let crossRefs = 0;
  let errors = 0;
  let batchNumber = 0;
  let cursor: string | null = null; // ISO timestamptz of created_at

  // Walk invoice_emails sequentially, oldest first, by created_at.
  // Restrict to Mackay-as-seller invoices to avoid scanning irrelevant rows.
  while (processed < maxEmails) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.log(`[backfill-sales-truth] time budget reached, stopping at ${processed}`);
      break;
    }

    let q = supabase
      .from("invoice_emails")
      .select("id, gmail_message_id, supplier_abn, make, model, variant, year, vin, odo_km, purchase_price_inc_gst, invoice_date, created_at")
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (cursor) q = q.gt("created_at", cursor);
    if (since) q = q.gte("invoice_date", since);

    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) {
      console.error("[backfill-sales-truth] fetch error:", fetchErr.message);
      errors++;
      break;
    }
    if (!rows || rows.length === 0) break;

    let bWritten = 0;
    let bCross = 0;
    let bErr = 0;

    for (const e of rows) {
      processed++;
      cursor = e.created_at as string;

      // Mackay must be the seller for this row to count
      if (normaliseAbn(e.supplier_abn) !== MACKAY_SELLER_ABN) continue;

      // Idempotency: skip if a sold_vehicle is already linked to this email
      const { data: existing } = await supabase
        .from("sold_vehicles")
        .select("id")
        .eq("invoice_email_id", e.id)
        .maybeSingle();
      if (existing) continue;

      try {
        const result = await writeSoldVehicle(supabase, {
          seller_abn: e.supplier_abn,
          make: e.make,
          model: e.model,
          variant: e.variant,
          year: e.year,
          odometer: e.odo_km,
          sale_price: e.purchase_price_inc_gst,
          sale_date: e.invoice_date as any,
          vin: e.vin,
          source: "easycars_backfill",
          invoice_email_id: e.id,
        });
        if (result.qualified && result.sold_vehicle_id) {
          bWritten++;
          if (result.cross_referenced) bCross++;
        }
      } catch (err: any) {
        console.error("[backfill-sales-truth] row error:", err.message);
        bErr++;
      }
    }

    batchNumber++;
    written += bWritten;
    crossRefs += bCross;
    errors += bErr;

    await supabase.from("backfill_log").insert({
      run_id: runId,
      batch_number: batchNumber,
      emails_processed: rows.length,
      sold_vehicles_written: bWritten,
      cross_references_matched: bCross,
      errors: bErr,
    });

    // Rate-limit between batches
    if (rows.length === batchSize) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    } else {
      break; // last batch
    }
  }

  return jsonResp({
    success: true,
    run_id: runId,
    batches: batchNumber,
    emails_processed: processed,
    sold_vehicles_written: written,
    cross_references_matched: crossRefs,
    errors,
    next_cursor: cursor,
    note: processed >= maxEmails
      ? "max_emails reached — re-invoke with the same run_id and a later `since` to continue"
      : undefined,
  });
});

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
