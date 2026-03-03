/**
 * Lindy Email Dispatch Module
 *
 * Dispatches browser automation jobs to Lindy via LindyMail email trigger.
 * The Lindy agent parses the JSON batch from the email body, browses each URL,
 * extracts listings, signs with HMAC, and POSTs to lindy-results-webhook.
 *
 * Trigger: carbitrage-dispatch-mackayauctioneers@lindymail.ai
 * Subject must contain: carbitrage-batch
 * Recommended batch size: 3–5 rows per email.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParsedIntent } from "./types.ts";

const MAX_CONCURRENT_SESSIONS = 3;
const BATCH_SIZE = 5;
const LINDY_TRIGGER_EMAIL = "carbitrage-dispatch-mackayauctioneers@lindymail.ai";
const LINDY_SUBJECT = "carbitrage-batch";

// ─── URL Builders (deterministic search URLs from intent) ────────────────────

const URL_BUILDERS: Record<string, (intent: ParsedIntent) => string | null> = {
  carsales: (intent) => {
    if (!intent.make) return null;
    const params = new URLSearchParams();
    params.set("q", `(And.Service.carsales._(C.Make.${intent.make}._.Model.${intent.model || ""}.))` );
    if (intent.year_min) params.set("yearFrom", String(intent.year_min));
    if (intent.year_max) params.set("yearTo", String(intent.year_max));
    if (intent.max_km) params.set("odometersMax", String(intent.max_km));
    if (intent.price_max) params.set("priceTo", String(intent.price_max));
    return `https://www.carsales.com.au/cars/?${params.toString()}`;
  },

  carsguide: (intent) => {
    if (!intent.make) return null;
    let url = `https://www.carsguide.com.au/buy-a-car/${intent.make.toLowerCase()}`;
    if (intent.model) url += `/${intent.model.toLowerCase()}`;
    const params = new URLSearchParams();
    if (intent.year_min) params.set("year_from", String(intent.year_min));
    if (intent.year_max) params.set("year_to", String(intent.year_max));
    if (intent.max_km) params.set("max_km", String(intent.max_km));
    if (intent.price_max) params.set("price_to", String(intent.price_max));
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  },

  gumtree: (intent) => {
    if (!intent.make) return null;
    const q = [intent.make, intent.model, intent.badge].filter(Boolean).join(" ");
    const params = new URLSearchParams({ search_query: q });
    if (intent.price_max) params.set("price_max", String(intent.price_max));
    return `https://www.gumtree.com.au/s-cars-vans-utes/c18320?${params.toString()}`;
  },

  // Aliases for actual source_registry keys
  gumtree_dealer: (intent) => {
    if (!intent.make) return null;
    const q = [intent.make, intent.model, intent.badge].filter(Boolean).join(" ");
    const params = new URLSearchParams({ search_query: q, seller_type: "dealer" });
    if (intent.price_max) params.set("price_max", String(intent.price_max));
    return `https://www.gumtree.com.au/s-cars-vans-utes/c18320?${params.toString()}`;
  },

  gumtree_private: (intent) => {
    if (!intent.make) return null;
    const q = [intent.make, intent.model, intent.badge].filter(Boolean).join(" ");
    const params = new URLSearchParams({ search_query: q, seller_type: "private" });
    if (intent.price_max) params.set("price_max", String(intent.price_max));
    return `https://www.gumtree.com.au/s-cars-vans-utes/c18320?${params.toString()}`;
  },

  drive: (intent) => {
    if (!intent.make) return null;
    const params = new URLSearchParams({ make: intent.make.toLowerCase(), sort: "price" });
    if (intent.model) params.set("model", intent.model.toLowerCase());
    if (intent.year_min) params.set("year_from", String(intent.year_min));
    if (intent.year_max) params.set("year_to", String(intent.year_max));
    if (intent.max_km) params.set("max_km", String(intent.max_km));
    if (intent.price_max) params.set("price_to", String(intent.price_max));
    return `https://www.drive.com.au/cars-for-sale/?${params.toString()}`;
  },

  autotrader: (intent) => {
    if (!intent.make) return null;
    const params = new URLSearchParams({
      make: intent.make.toLowerCase(),
      sourceCondition: "1:Used",
      sortBy: "price",
      orderBy: "asc",
    });
    if (intent.model) params.set("model", intent.model.toLowerCase());
    if (intent.year_min) params.set("yearFrom", String(intent.year_min));
    if (intent.year_max) params.set("yearTo", String(intent.year_max));
    if (intent.max_km) params.set("odometerMax", String(intent.max_km));
    if (intent.price_max) params.set("priceTo", String(intent.price_max));
    return `https://www.autotrader.com.au/cars-for-sale?${params.toString()}`;
  },
};

// ─── Extraction prompt per source ────────────────────────────────────────────

function buildExtractionPrompt(source: string, intent: ParsedIntent): string {
  const ctx = [
    intent.make && `Target make: ${intent.make}`,
    intent.model && `Target model: ${intent.model}`,
    intent.year_min && intent.year_max
      ? `Target year range: ${intent.year_min}–${intent.year_max}`
      : intent.year_min
        ? `Target year from: ${intent.year_min}`
        : null,
    intent.max_km && `Max odometer: ${intent.max_km.toLocaleString()} km`,
  ]
    .filter(Boolean)
    .join("\n");

  return `Extract all car listings from this ${source} page. For each listing return: make, model, variant, year, odometer (km), price (AUD), listing URL, listing ID, and state.\n\nSearch context:\n${ctx}`;
}

// ─── Concurrency check ──────────────────────────────────────────────────────

async function getActiveJobCount(sb: ReturnType<typeof createClient>): Promise<number> {
  // Only count jobs dispatched in the last 30 minutes to prevent stale jobs from permanently blocking
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count } = await sb
    .from("outward_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "dispatched")
    .gte("dispatched_at", cutoff);

  return count ?? 0;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DispatchResult {
  source: string;
  job_id: string | null;
  status: "dispatched" | "queued" | "skipped" | "error";
  reason?: string;
}

interface QueueRow {
  id: string;
  source: string;
  page: number;
  url: string;
  prompt: string;
  job_id: string;
  search_run_id: string;
}

// ─── Main dispatch function ─────────────────────────────────────────────────

/**
 * Dispatch Lindy Computer jobs for the given outward sources.
 * 1. Creates outward_jobs rows
 * 2. Inserts outward_browse_queue rows
 * 3. Sends batch email to LindyMail trigger via Resend
 *
 * @returns Array of dispatch results per source
 */
export async function dispatchLindyJobs(
  sb: ReturnType<typeof createClient>,
  searchRunId: string,
  intent: ParsedIntent,
  sourceKeys: string[],
): Promise<DispatchResult[]> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.warn("[lindy-dispatch] RESEND_API_KEY not configured — cannot send dispatch email");
    return sourceKeys.map((s) => ({ source: s, job_id: null, status: "skipped" as const, reason: "No RESEND_API_KEY" }));
  }

  const activeCount = await getActiveJobCount(sb);
  const results: DispatchResult[] = [];
  const queueRows: QueueRow[] = [];

  for (const sourceKey of sourceKeys) {
    // Build search URL
    const urlBuilder = URL_BUILDERS[sourceKey];
    if (!urlBuilder) {
      results.push({ source: sourceKey, job_id: null, status: "skipped", reason: `No URL builder for source: ${sourceKey}` });
      continue;
    }

    const searchUrl = urlBuilder(intent);
    if (!searchUrl) {
      results.push({ source: sourceKey, job_id: null, status: "skipped", reason: "Could not build search URL" });
      continue;
    }

    // Concurrency check
    const currentActive = activeCount + results.filter((r) => r.status === "dispatched").length;
    if (currentActive >= MAX_CONCURRENT_SESSIONS) {
      results.push({ source: sourceKey, job_id: null, status: "queued", reason: `Concurrency limit (${MAX_CONCURRENT_SESSIONS})` });
      continue;
    }

    // Create job record
    const { data: job, error: jobErr } = await sb
      .from("outward_jobs")
      .insert({
        search_run_id: searchRunId,
        source_key: sourceKey,
        search_url: searchUrl,
        status: "pending",
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      console.error(`[lindy-dispatch] Failed to create job for ${sourceKey}:`, jobErr);
      results.push({ source: sourceKey, job_id: null, status: "error", reason: "Job creation failed" });
      continue;
    }

    // Build queue row
    const prompt = buildExtractionPrompt(sourceKey, intent);
    queueRows.push({
      id: crypto.randomUUID(),
      source: sourceKey,
      page: 1,
      url: searchUrl,
      prompt,
      job_id: job.id,
      search_run_id: searchRunId,
    });

    results.push({ source: sourceKey, job_id: job.id, status: "dispatched" });
  }

  // Nothing to dispatch
  if (queueRows.length === 0) {
    return results;
  }

  // Insert queue rows
  const { error: queueErr } = await sb
    .from("outward_browse_queue")
    .insert(queueRows.map((r) => ({
      id: r.id,
      source: r.source,
      page: r.page,
      url: r.url,
      prompt: r.prompt,
      job_id: r.job_id,
      search_run_id: r.search_run_id,
      status: "pending",
    })));

  if (queueErr) {
    console.error("[lindy-dispatch] Failed to insert queue rows:", queueErr);
    // Mark all as error
    for (const r of queueRows) {
      await sb.from("outward_jobs").update({ status: "failed", error: "Queue insert failed" }).eq("id", r.job_id);
      const idx = results.findIndex((res) => res.job_id === r.job_id);
      if (idx >= 0) results[idx] = { ...results[idx], status: "error", reason: "Queue insert failed" };
    }
    return results;
  }

  // Send batched emails to LindyMail trigger
  const batches: QueueRow[][] = [];
  for (let i = 0; i < queueRows.length; i += BATCH_SIZE) {
    batches.push(queueRows.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const emailBody = JSON.stringify({
      rows: batch.map((r) => ({
        id: r.id,
        source: r.source,
        page: r.page,
        url: r.url,
        prompt: r.prompt,
        job_id: r.job_id,
        search_run_id: r.search_run_id,
      })),
    });

    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "onboarding@resend.dev",
          to: LINDY_TRIGGER_EMAIL,
          subject: LINDY_SUBJECT,
          text: emailBody,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "unknown");
        console.error(`[lindy-dispatch] Resend returned ${resp.status}: ${errText}`);
        // Mark batch jobs as error
        for (const r of batch) {
          await sb.from("outward_jobs").update({ status: "failed", error: `Resend HTTP ${resp.status}` }).eq("id", r.job_id);
          await sb.from("outward_browse_queue").update({ status: "failed", last_error: `Resend HTTP ${resp.status}` }).eq("id", r.id);
          const idx = results.findIndex((res) => res.job_id === r.job_id);
          if (idx >= 0) results[idx] = { ...results[idx], status: "error", reason: `Resend HTTP ${resp.status}` };
        }
        continue;
      }

      await resp.text(); // consume body

      // Mark queue rows as dispatched
      for (const r of batch) {
        await sb.from("outward_jobs").update({ status: "dispatched", dispatched_at: new Date().toISOString() }).eq("id", r.job_id);
        await sb.from("outward_browse_queue").update({ status: "dispatched", dispatched_at: new Date().toISOString() }).eq("id", r.id);
      }

      console.log(`[lindy-dispatch] Email dispatched with ${batch.length} rows to LindyMail`);
    } catch (err) {
      console.error(`[lindy-dispatch] Email send error:`, err);
      for (const r of batch) {
        await sb.from("outward_jobs").update({ status: "failed", error: String(err) }).eq("id", r.job_id);
        await sb.from("outward_browse_queue").update({ status: "failed", last_error: String(err) }).eq("id", r.id);
        const idx = results.findIndex((res) => res.job_id === r.job_id);
        if (idx >= 0) results[idx] = { ...results[idx], status: "error", reason: String(err) };
      }
    }
  }

  return results;
}
