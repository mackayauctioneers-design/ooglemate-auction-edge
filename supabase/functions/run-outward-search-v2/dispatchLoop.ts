/**
 * Dispatch Loop — browses each SearchTarget, extracts listings,
 * normalizes, signs, and POSTs to the lindy-results-webhook.
 *
 * lindyBrowse() is a shim — replace with actual Lindy browser tool call.
 */

import { buildSearchUrls, type SearchTarget } from "../_shared/search/buildSearchUrls.ts";
import { getExtractionPrompt } from "../_shared/search/extractionPrompts.ts";
import {
  normalizeExtractedListing,
  toBrowserRaw,
  type BrowserExtractedListing,
  type WebhookPayload,
} from "../_shared/search/extractionSchema.ts";
import type { ParsedIntent } from "../_shared/outward-search/types.ts";

// ─── Config ──────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = () => Deno.env.get("LINDY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL   = () => Deno.env.get("SUPABASE_URL")!;
const WEBHOOK_PATH   = "/functions/v1/lindy-results-webhook";

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runDispatchLoop(
  jobId: string,
  intent: ParsedIntent,
  options: {
    sources?: Array<"carsales" | "carsguide" | "gumtree">;
    maxPages?: number;
    delayMs?: number; // politeness delay between requests
  } = {},
): Promise<{ dispatched: number; errors: DispatchError[] }> {
  const {
    sources  = ["carsales", "carsguide", "gumtree"],
    maxPages = 2,
    delayMs  = 1500,
  } = options;

  const targets = buildSearchUrls(intent, sources, maxPages);
  const errors: DispatchError[] = [];
  let dispatched = 0;

  for (const target of targets) {
    try {
      await processTarget(jobId, target, intent);
      dispatched++;
    } catch (err) {
      errors.push({
        source: target.source,
        page:   target.page,
        url:    target.url,
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    // Politeness delay between pages — skip after last target
    if (target !== targets[targets.length - 1]) {
      await sleep(delayMs);
    }
  }

  return { dispatched, errors };
}

// ─── Per-target processing ────────────────────────────────────────────────────

async function processTarget(
  jobId: string,
  target: SearchTarget,
  intent: ParsedIntent,
): Promise<void> {
  // 1. Browse and extract raw listings via Lindy browser
  const rawItems = await browseAndExtract(target, intent);

  if (rawItems.length === 0) {
    // No listings found — not an error, just an empty page
    return;
  }

  // 2. Convert browser extractions → RawExtractedListing → NormalizedListing
  const listings = rawItems
    .map((item) => toBrowserRaw(item, target.source, intent.state ?? null))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(normalizeExtractedListing);

  if (listings.length === 0) return;

  // 3. Build and sign the payload
  const payload: WebhookPayload = {
    job_id:   jobId,
    source:   target.source,
    page:     target.page,
    listings,
  };

  const body = JSON.stringify(payload);
  const signature = await signPayload(body);

  // 4. POST to webhook
  const webhookUrl = `${SUPABASE_URL()}${WEBHOOK_PATH}`;
  const res = await fetch(webhookUrl, {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "X-Lindy-Signature": signature,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `Webhook rejected ${target.source} p${target.page}: ${res.status} — ${text}`,
    );
  }

  // Consume body to prevent resource leak
  await res.text().catch(() => {});
}

// ─── Browser extraction ───────────────────────────────────────────────────────

async function browseAndExtract(
  target: SearchTarget,
  intent: ParsedIntent,
): Promise<BrowserExtractedListing[]> {
  const prompt = buildExtractionPrompt(target, intent);

  const result = await lindyBrowse({
    url:    target.url,
    prompt,
    schema: RAW_LISTING_SCHEMA,
  });

  return result.listings ?? [];
}

function buildExtractionPrompt(
  target: SearchTarget,
  intent: ParsedIntent,
): string {
  const basePrompt = getExtractionPrompt(target);

  // Append intent context so the extractor can sanity-check relevance
  const context = [
    intent.make  && `Target make: ${intent.make}`,
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

  return `${basePrompt}\n\nSearch context (for reference only — extract ALL visible listings regardless):\n${context}`;
}

// ─── JSON schema for structured extraction ────────────────────────────────────

const RAW_LISTING_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          make:         { type: ["string", "null"] },
          model:        { type: ["string", "null"] },
          variant:      { type: ["string", "null"] },
          year:         { type: ["number", "null"] },
          odometer_km:  { type: ["number", "null"] },
          price_asking: { type: ["number", "null"] },
          listing_url:  { type: "string" },
          listing_id:   { type: ["string", "null"] },
          state:        { type: ["string", "null"] },
        },
        required: ["listing_url"],
      },
    },
  },
  required: ["listings"],
} as const;

// ─── HMAC signing ─────────────────────────────────────────────────────────────

async function signPayload(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Lindy browser shim ───────────────────────────────────────────────────────
// Replace with actual Lindy browser tool call in production.
// This shim makes the dispatch loop testable in isolation.
//
// Two likely integration shapes:
//
// Option A — HTTP tool:
//   const res = await fetch("https://browser.lindy.internal/extract", {
//     method: "POST",
//     headers: { Authorization: `Bearer ${Deno.env.get("LINDY_BROWSER_TOKEN")}` },
//     body: JSON.stringify({ url, prompt, schema }),
//   });
//   return res.json();
//
// Option B — Deno SDK:
//   import { browser } from "https://sdk.lindy.ai/browser.ts";
//   return browser.extract({ url, prompt, schema });

async function lindyBrowse(_params: {
  url: string;
  prompt: string;
  schema: unknown;
}): Promise<{ listings?: BrowserExtractedListing[] }> {
  // TODO: wire to actual Lindy browser tool
  throw new Error("lindyBrowse: not yet wired to browser tool");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DispatchError {
  source: string;
  page:   number;
  url:    string;
  reason: string;
}
