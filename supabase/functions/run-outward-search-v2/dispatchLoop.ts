/**
 * Dispatch Loop — inserts page-level browse tasks into outward_browse_queue.
 *
 * The Lindy agent polls this queue, browses each URL, extracts listings,
 * signs the payload, and POSTs to the lindy-results-webhook.
 *
 * This module does NOT call the browser — it only enqueues work.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSearchUrls, type SearchTarget, type SourceKey } from "../_shared/search/buildSearchUrls.ts";
import { getExtractionPrompt } from "../_shared/search/extractionPrompts.ts";
import type { ParsedIntent } from "../_shared/outward-search/types.ts";

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DispatchResult {
  queued: number;
  errors: DispatchError[];
}

export interface DispatchError {
  source: string;
  page: number;
  url: string;
  reason: string;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runDispatchLoop(
  searchRunId: string,
  jobId: string,
  intent: ParsedIntent,
  options: {
    sources?: SourceKey[];
    maxPages?: number;
  } = {},
): Promise<DispatchResult> {
  const {
    sources = ["gumtree", "drive", "autotrader", "carsguide"],
    maxPages = 2,
  } = options;

  const sb = createClient(SUPABASE_URL(), SUPABASE_KEY());
  const targets = buildSearchUrls(intent, sources, maxPages);
  const errors: DispatchError[] = [];

  // Build all queue rows up-front — single bulk insert is faster
  // and gives us atomic visibility into what was queued.
  const rows = targets.map((t) => ({
    search_run_id: searchRunId,
    job_id: jobId,
    source: t.source,
    page: t.page,
    url: t.url,
    prompt: buildPrompt(t, intent),
    status: "pending",
  }));

  const { data, error } = await sb
    .from("outward_browse_queue")
    .insert(rows)
    .select("id, source, page, url");

  if (error) {
    // Bulk insert failed — record every target as an error
    for (const t of targets) {
      errors.push({
        source: t.source,
        page: t.page,
        url: t.url,
        reason: error.message,
      });
    }
    return { queued: 0, errors };
  }

  return { queued: data?.length ?? 0, errors };
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(target: SearchTarget, intent: ParsedIntent): string {
  const base = getExtractionPrompt(target);

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

  return `${base}\n\nSearch context (for reference — extract ALL visible listings):\n${ctx}`;
}
