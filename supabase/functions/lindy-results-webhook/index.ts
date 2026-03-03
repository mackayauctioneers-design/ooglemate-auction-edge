/**
 * lindy-results-webhook
 *
 * Receives structured listing results from Lindy Computer browser automation.
 * Validates signature, enforces schema, normalizes identity, writes to staging,
 * then runs fingerprint scoring against the dealer's active fingerprints.
 *
 * Security: Constant-time string comparison via X-Lindy-Signature header.
 * Idempotent: re-posting for an already-completed job returns 200.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scoreListingsForDealer } from "../_shared/fingerprint/matchListingToFingerprint.ts";
import type { StagedListing } from "../_shared/fingerprint/matchListingToFingerprint.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lindy-signature",
};

// ─── Constant-time string comparison (no HMAC — Lindy sends static header) ──

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i++) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }
  return mismatch === 0;
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

    // ── Normalize Lindy extraction prompt fields → webhook schema ──
    // Lindy sends: make, model, year, variant, odometer_km, price_asking, listing_url, listing_id
    // Webhook expects: title, price_aud, odometer_km, year, state, listing_url, source_id

    // Build title from make+model+year+variant if title not provided
    if (!r.title && (r.make || r.model)) {
      const parts = [r.year, r.make, r.model, r.variant].filter(Boolean);
      r.title = parts.join(" ");
    }

    // Map price_asking → price_aud
    if (r.price_asking !== undefined && r.price_aud === undefined) {
      r.price_aud = r.price_asking;
    }

    // Map listing_id → source_id
    if (r.listing_id !== undefined && r.source_id === undefined) {
      r.source_id = r.listing_id;
    }

    // Remove Lindy-specific keys after normalization so they don't trip the guard
    delete r.make;
    delete r.model;
    delete r.variant;
    delete r.price_asking;
    delete r.listing_id;

    // Hard reject: must have a valid listing_url
    if (typeof r.listing_url !== "string" || !r.listing_url.startsWith("http")) {
      continue;
    }

    // Map seller_name through
    // (no normalization needed, just pass-through)

    // RELAXED VALIDATION: Log unexpected keys but DON'T reject during integration
    const allowedKeys = new Set(["title", "price_aud", "odometer_km", "year", "state", "listing_url", "source_id", "image_url", "seller_name"]);
    const extraKeys = Object.keys(r).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      console.warn(`[lindy-webhook] Listing has unexpected keys (KEPT): ${extraKeys.join(", ")}`, JSON.stringify(r));
      // Strip extra keys but keep the listing
      for (const k of extraKeys) delete r[k];
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

  // ── 1. Signature validation (constant-time string compare) ──────────────
  const signature = req.headers.get("x-lindy-signature") || "";
  if (!timingSafeEqual(signature, secret)) {
    console.warn("[lindy-webhook] Signature mismatch — rejecting. Received:", JSON.stringify(signature));
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────
  let rawText: string;
  let body: { job_id?: string; run_id?: string; queue_id?: string; source?: string; listings?: unknown[]; completed_at?: string };
  try {
    rawText = await req.text();
    console.log("[lindy-webhook] LINDY RAW PAYLOAD:", rawText.slice(0, 5000));
    console.log("[lindy-webhook] Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));
    body = JSON.parse(rawText);
  } catch (e) {
    console.error("[lindy-webhook] JSON parse failed:", e);
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

  // ── 3. Fetch or auto-create job record ─────────────────────────────────
  let { data: job, error: jobErr } = await sb
    .from("outward_jobs")
    .select("id, search_run_id, source_key, status, account_id")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    // Auto-create a stub job so Lindy results are never lost
    const sourceKey = body.source || "unknown";
    const searchRunId = body.run_id || jobId; // fallback to jobId if no run_id
    console.warn(`[lindy-webhook] Job ${jobId} not found — auto-creating stub (source=${sourceKey})`);

    const { data: created, error: createErr } = await sb
      .from("outward_jobs")
      .insert({
        id: jobId,
        source_key: sourceKey,
        search_run_id: searchRunId,
        status: "dispatched",
        search_url: "auto-created-by-webhook",
      })
      .select("id, search_run_id, source_key, status, account_id")
      .single();

    if (createErr || !created) {
      console.error("[lindy-webhook] Failed to auto-create job:", createErr);
      return new Response(JSON.stringify({ error: "Job not found and auto-create failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    job = created;
  }

  // Idempotent — already processed
  if (job.status === "complete") {
    return new Response(JSON.stringify({ status: "already_processed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Accept both 'dispatched' and 'pending' statuses (auto-created jobs start as 'dispatched')
  if (job.status !== "dispatched" && job.status !== "pending") {
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
        listing_id: l.source_id,
        source_id: l.source_id,
        make_norm: identity.make_norm,
        model_norm: identity.model_norm,
        fingerprint: identity.fingerprint,
        ingested_at: new Date().toISOString(),
      };
    });

    const { error: insertErr } = await sb
      .from("outward_search_results")
      .upsert(rows, { onConflict: "listing_url", ignoreDuplicates: true });

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

  // ── 6. Fingerprint scoring ──────────────────────────────────────────────
  let scoreResult = { scored: 0, no_match: 0 };

  if (validated.length > 0 && job.account_id) {
    // Resolve dealer_profile_id from account_id
    const { data: profile } = await sb
      .from("dealer_profiles")
      .select("id")
      .eq("account_id", job.account_id)
      .limit(1)
      .single();

    if (profile?.id) {
      // Fetch the just-inserted listings for scoring
      const { data: staged } = await sb
        .from("outward_search_results")
        .select("id, make_norm, model_norm, variant_family, year, odometer_km, price_aud, listing_url")
        .eq("job_id", job.id)
        .eq("status", "pending_score");

      if (staged?.length) {
        const listingsToScore: StagedListing[] = staged.map((r) => ({
          id: r.id,
          make_norm: r.make_norm,
          model_norm: r.model_norm,
          variant_family: r.variant_family,
          year: r.year,
          odometer_km: r.odometer_km ? Number(r.odometer_km) : null,
          price_aud: r.price_aud ? Number(r.price_aud) : null,
          listing_url: r.listing_url,
        }));
        scoreResult = await scoreListingsForDealer(sb, profile.id, listingsToScore);
        console.log(
          `[lindy-webhook] Scoring complete: ${scoreResult.scored} scored, ${scoreResult.no_match} no_match`,
        );
      }
    } else {
      console.warn(`[lindy-webhook] No dealer_profile found for account_id=${job.account_id}`);
    }
  }

  // ── 7. Mark browse queue row complete (if queue_id provided) ─────────
  if (body.queue_id && typeof body.queue_id === "string") {
    await sb
      .from("outward_browse_queue")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", body.queue_id)
      .eq("status", "dispatched"); // guard: only if still dispatched
  }

  // ── 8. Mark job complete ───────────────────────────────────────────────
  await sb
    .from("outward_jobs")
    .update({
      status: "complete",
      result_count: validated.length,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return new Response(
    JSON.stringify({
      status: "ok",
      received: validated.length,
      scored: scoreResult.scored,
      no_match: scoreResult.no_match,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
