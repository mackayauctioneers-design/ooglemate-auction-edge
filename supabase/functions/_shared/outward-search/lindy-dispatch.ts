/**
 * Lindy Computer Dispatch Module
 *
 * Dispatches browser automation jobs to Lindy Computer for JS-rendered
 * classified sites (Carsales, CarsGuide, Gumtree).
 *
 * Concurrency: max 3 concurrent sessions across all sources.
 * Each source has a deterministic URL builder.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParsedIntent } from "./types.ts";

const MAX_CONCURRENT_SESSIONS = 3;

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
};

// ─── Dispatch payload schema (what Lindy receives) ───────────────────────────

export interface LindyDispatchPayload {
  job_id: string;
  source: string;
  search_url: string;
  intent: ParsedIntent;
  schema: {
    fields: string[];
    rules: string[];
  };
  callback_url: string;
}

// ─── Concurrency check ──────────────────────────────────────────────────────

async function getActiveJobCount(sb: ReturnType<typeof createClient>): Promise<number> {
  const { count } = await sb
    .from("outward_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "dispatched");

  return count ?? 0;
}

async function getActiveJobCountForSource(
  sb: ReturnType<typeof createClient>,
  sourceKey: string,
): Promise<number> {
  const { count } = await sb
    .from("outward_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "dispatched")
    .eq("source_key", sourceKey);

  return count ?? 0;
}

// ─── Main dispatch function ─────────────────────────────────────────────────

export interface DispatchResult {
  source: string;
  job_id: string | null;
  status: "dispatched" | "queued" | "skipped" | "error";
  reason?: string;
}

/**
 * Dispatch Lindy Computer jobs for the given outward sources.
 * Creates outward_jobs rows and POSTs to the Lindy webhook.
 *
 * @returns Array of dispatch results per source
 */
export async function dispatchLindyJobs(
  sb: ReturnType<typeof createClient>,
  searchRunId: string,
  intent: ParsedIntent,
  sourceKeys: string[],
): Promise<DispatchResult[]> {
  const lindyWebhookUrl = Deno.env.get("LINDY_WEBHOOK_URL");
  const lindySecret = Deno.env.get("LINDY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  if (!lindyWebhookUrl) {
    console.warn("[lindy-dispatch] LINDY_WEBHOOK_URL not configured");
    return sourceKeys.map((s) => ({ source: s, job_id: null, status: "skipped" as const, reason: "No webhook URL" }));
  }

  const callbackUrl = `${supabaseUrl}/functions/v1/lindy-results-webhook`;

  const activeCount = await getActiveJobCount(sb);
  const results: DispatchResult[] = [];

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

    // Per-source concurrency (max 1 per source at a time)
    const sourceActive = await getActiveJobCountForSource(sb, sourceKey);
    if (sourceActive > 0) {
      results.push({ source: sourceKey, job_id: null, status: "queued", reason: "Source already has an active job" });
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

    // Build dispatch payload
    const payload: LindyDispatchPayload = {
      job_id: job.id,
      source: sourceKey,
      search_url: searchUrl,
      intent,
      schema: {
        fields: ["title", "price_aud", "odometer_km", "year", "state", "listing_url"],
        rules: [
          "return null if unconfirmed",
          "do not infer",
          "no summaries",
          "no scoring",
          "first page only — do not paginate",
          "do not follow listing detail links",
        ],
      },
      callback_url: callbackUrl,
    };

    // POST to Lindy webhook
    try {
      const resp = await fetch(lindyWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(lindySecret ? { "X-Dispatch-Signature": lindySecret } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "unknown");
        console.error(`[lindy-dispatch] Lindy returned ${resp.status} for ${sourceKey}: ${errText}`);
        await sb.from("outward_jobs").update({ status: "failed", error: `Dispatch HTTP ${resp.status}` }).eq("id", job.id);
        results.push({ source: sourceKey, job_id: job.id, status: "error", reason: `HTTP ${resp.status}` });
        continue;
      }

      // Mark as dispatched
      await sb.from("outward_jobs").update({ status: "dispatched", dispatched_at: new Date().toISOString() }).eq("id", job.id);
      results.push({ source: sourceKey, job_id: job.id, status: "dispatched" });

      console.log(`[lindy-dispatch] Dispatched job ${job.id} for ${sourceKey}`);
    } catch (err) {
      console.error(`[lindy-dispatch] Fetch error for ${sourceKey}:`, err);
      await sb.from("outward_jobs").update({ status: "failed", error: String(err) }).eq("id", job.id);
      results.push({ source: sourceKey, job_id: job.id, status: "error", reason: String(err) });
    }
  }

  return results;
}
