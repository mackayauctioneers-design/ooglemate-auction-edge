/**
 * lindy-results-webhook
 *
 * Receives structured listing results from Lindy Computer browser automation.
 * Validates HMAC signature, enforces schema, normalizes identity, writes to staging.
 *
 * Security: HMAC-SHA256 signature required via X-Lindy-Signature header.
 * Idempotent: re-posting for an already-completed job returns 200.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lindy-signature",
};

// ─── HMAC helpers ────────────────────────────────────────────────────────────

async function computeHmac(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Schema validation ──────────────────────────────────────────────────────

interface ValidatedListing {
  title: string | null;
  price_aud: number | null;
  odometer_km: number | null;
  year: number | null;
  state: string | null;
  listing_url: string;
  source_id: string | null;
}

const MAX_LISTINGS_PER_POST = 50;

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return isFinite(n) ? n : null;
  }
  return null;
}

function validateListings(raw: unknown[], sourceKey: string): ValidatedListing[] {
  if (!Array.isArray(raw)) return [];

  const valid: ValidatedListing[] = [];
  const capped = raw.slice(0, MAX_LISTINGS_PER_POST);

  for (const item of capped) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;

    // Hard reject: must have a valid listing_url
    if (typeof r.listing_url !== "string" || !r.listing_url.startsWith("http")) {
      continue;
    }

    // Reject unexpected top-level keys
    const allowedKeys = new Set(["title", "price_aud", "odometer_km", "year", "state", "listing_url", "source_id"]);
    const extraKeys = Object.keys(r).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      console.warn(`[lindy-webhook] Dropping listing with unexpected keys: ${extraKeys.join(", ")}`);
      continue;
    }

    const price = toNumberOrNull(r.price_aud);
    const km = toNumberOrNull(r.odometer_km);
    const year = toNumberOrNull(r.year);

    // Reject non-numeric price/km if they were provided
    if (r.price_aud !== undefined && r.price_aud !== null && price === null) continue;
    if (r.odometer_km !== undefined && r.odometer_km !== null && km === null) continue;

    valid.push({
      title: typeof r.title === "string" ? r.title : null,
      price_aud: price,
      odometer_km: km,
      year: year,
      state: typeof r.state === "string" ? r.state.toUpperCase().slice(0, 5) : null,
      listing_url: r.listing_url,
      source_id: typeof r.source_id === "string" ? r.source_id : sourceKey,
    });
  }

  return valid;
}

// ─── Lightweight identity normalization (no DB deps for webhook speed) ───────

function extractIdentityFromTitle(title: string | null): {
  make_norm: string | null;
  model_norm: string | null;
  fingerprint: string | null;
} {
  if (!title) return { make_norm: null, model_norm: null, fingerprint: null };

  // Extract year prefix if present
  const cleaned = title.replace(/^\d{4}\s+/, "").trim();
  const parts = cleaned.split(/\s+/);

  const make = parts[0]?.toUpperCase() || null;
  const model = parts[1]?.toUpperCase() || null;

  const fingerprint = make && model
    ? `${make}|${model}`.replace(/[^A-Z0-9|]/g, "")
    : null;

  return { make_norm: make, model_norm: model, fingerprint };
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("LINDY_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[lindy-webhook] LINDY_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 1. Read body and verify HMAC ────────────────────────────────────────
  const rawBody = await req.text();
  const signature = req.headers.get("x-lindy-signature") || "";
  const expectedSig = await computeHmac(secret, rawBody);

  if (signature !== expectedSig) {
    console.warn("[lindy-webhook] HMAC mismatch — rejecting");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────
  let body: { job_id?: string; source?: string; listings?: unknown[]; completed_at?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobId = body.job_id;
  if (!jobId || typeof jobId !== "string") {
    return new Response(JSON.stringify({ error: "Missing job_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 3. Fetch job record ────────────────────────────────────────────────
  const { data: job, error: jobErr } = await sb
    .from("outward_jobs")
    .select("id, search_run_id, source_key, status")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Idempotent — already processed
  if (job.status === "complete") {
    return new Response(JSON.stringify({ status: "already_processed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Reject if job wasn't dispatched
  if (job.status !== "dispatched") {
    return new Response(JSON.stringify({ error: `Job status is '${job.status}', expected 'dispatched'` }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 4. Schema enforcement ──────────────────────────────────────────────
  const validated = validateListings(body.listings ?? [], job.source_key);

  console.log(`[lindy-webhook] job=${jobId} source=${job.source_key}: ${validated.length}/${(body.listings ?? []).length} listings validated`);

  // ── 5. Identity normalization + insert into staging ────────────────────
  if (validated.length > 0) {
    const rows = validated.map((l) => {
      const identity = extractIdentityFromTitle(l.title);
      return {
        search_run_id: job.search_run_id,
        job_id: job.id,
        source_key: job.source_key,
        title: l.title,
        price_aud: l.price_aud,
        odometer_km: l.odometer_km,
        year: l.year,
        state: l.state,
        listing_url: l.listing_url,
        source_id: l.source_id,
        make_norm: identity.make_norm,
        model_norm: identity.model_norm,
        fingerprint: identity.fingerprint,
        ingested_at: new Date().toISOString(),
      };
    });

    const { error: insertErr } = await sb
      .from("outward_search_results")
      .upsert(rows, { onConflict: "listing_url" });

    if (insertErr) {
      console.error("[lindy-webhook] Insert error:", insertErr);
      await sb
        .from("outward_jobs")
        .update({
          status: "failed",
          error: `Insert failed: ${insertErr.message}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return new Response(JSON.stringify({ error: "Insert failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── 6. Mark job complete ───────────────────────────────────────────────
  await sb
    .from("outward_jobs")
    .update({
      status: "complete",
      result_count: validated.length,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return new Response(
    JSON.stringify({ status: "ok", received: validated.length }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
