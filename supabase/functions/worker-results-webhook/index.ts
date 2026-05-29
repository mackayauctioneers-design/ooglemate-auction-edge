/**
 * worker-results-webhook
 *
 * Generic worker results callback. Successor to lindy-results-webhook.
 * Accepts listing results from Arby / OpenClaw / any external worker,
 * writes them into the canonical outward_search_results staging table,
 * and promotes mandate-scoped results into mandate_feed_items so they
 * surface on Dealer Radar via the existing v2 promotion path.
 *
 * Auth: Authorization: Bearer <WORKER_RESULTS_WEBHOOK_SECRET>
 * Idempotent: re-posting for a completed job returns 200.
 *
 * Canonical contract — DO NOT diverge from outward_search_results /
 * mandate_feed_items column names. See platform-architecture-contract.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Constant-time string compare ────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aB = enc.encode(a);
  const bB = enc.encode(b);
  if (aB.length !== bB.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aB.length; i++) mismatch |= aB[i] ^ bB[i];
  return mismatch === 0;
}

// ─── Listing validation (canonical column names) ─────────────────────────────

interface ValidatedListing {
  title: string | null;
  price_aud: number | null;
  odometer_km: number | null;
  year: number | null;
  state: string | null;
  listing_url: string;
  source_id: string | null;
  // Optional condition-report fields
  condition_grade: string | null;
  condition_score: number | null;
  major_defects: string | null;
  interior_notes: string | null;
  exterior_notes: string | null;
  mechanical_notes: string | null;
}

const MAX_LISTINGS_PER_POST = 100;

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
  const out: ValidatedListing[] = [];
  for (const item of raw.slice(0, MAX_LISTINGS_PER_POST)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const rawData =
      typeof r.raw_listing_data === "object" && r.raw_listing_data !== null
        ? (r.raw_listing_data as Record<string, unknown>)
        : {};

    // Accept either canonical (title/price_aud) or generic (make/model/price) shapes
    if (!r.title && (r.make || r.model)) {
      const parts = [r.year, r.make, r.model, r.variant].filter(Boolean);
      r.title = parts.join(" ");
    }
    if (r.price_aud === undefined && r.price !== undefined) r.price_aud = r.price;
    if (r.price_aud === undefined && r.listed_price !== undefined) r.price_aud = r.listed_price;
    if (r.price_aud === undefined && rawData.listed_price !== undefined) r.price_aud = rawData.listed_price;
    if (r.price_aud === undefined && rawData.latest !== undefined) r.price_aud = rawData.latest;
    if (r.odometer_km === undefined && r.km !== undefined) r.odometer_km = r.km;
    if (r.odometer_km === undefined && rawData.odometer_km !== undefined) r.odometer_km = rawData.odometer_km;
    if (r.odometer_km === undefined && rawData.kms !== undefined) r.odometer_km = rawData.kms;
    if (r.listing_url === undefined && rawData.source_listing_url !== undefined) r.listing_url = rawData.source_listing_url;
    if (r.listing_url === undefined && rawData.url !== undefined) r.listing_url = rawData.url;
    if (r.state === undefined && r.location_state !== undefined) r.state = r.location_state;
    if (r.source_id === undefined && r.source_listing_id !== undefined) r.source_id = r.source_listing_id;

    const url = typeof r.listing_url === "string" ? r.listing_url : null;
    if (!url) continue;

    const price = toNumberOrNull(r.price_aud);
    const km = toNumberOrNull(r.odometer_km);
    const year = toNumberOrNull(r.year);

    if (r.price_aud != null && price === null) continue;
    if (r.odometer_km != null && km === null) continue;

    out.push({
      title: typeof r.title === "string" ? r.title : null,
      price_aud: price,
      odometer_km: km,
      year,
      state: typeof r.state === "string" ? r.state.toUpperCase().slice(0, 5) : null,
      listing_url: url,
      source_id:
        typeof r.source_id === "string"
          ? r.source_id
          : typeof r.listing_id === "string"
            ? r.listing_id
            : sourceKey,
      condition_grade: typeof r.condition_grade === "string" ? r.condition_grade : null,
      condition_score: toNumberOrNull(r.condition_score),
      major_defects: typeof r.major_defects === "string" ? r.major_defects : null,
      interior_notes: typeof r.interior_notes === "string" ? r.interior_notes : null,
      exterior_notes: typeof r.exterior_notes === "string" ? r.exterior_notes : null,
      mechanical_notes: typeof r.mechanical_notes === "string" ? r.mechanical_notes : null,
    });
  }
  return out;
}

// ─── Lightweight identity normalization (no DB deps) ────────────────────────

function extractIdentity(title: string | null): {
  make_norm: string | null;
  model_norm: string | null;
  fingerprint: string | null;
} {
  if (!title) return { make_norm: null, model_norm: null, fingerprint: null };
  const cleaned = title.replace(/^\d{4}\s+/, "").trim();
  const parts = cleaned.split(/\s+/);
  const make = parts[0]?.toUpperCase() || null;
  const model = parts[1]?.toUpperCase() || null;
  const fingerprint =
    make && model ? `${make}|${model}`.replace(/[^A-Z0-9|]/g, "") : null;
  return { make_norm: make, model_norm: model, fingerprint };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("WORKER_RESULTS_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[worker-results-webhook] WORKER_RESULTS_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth: Authorization: Bearer <secret>
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(token, secret)) {
    console.warn("[worker-results-webhook] Unauthorized — bearer mismatch");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Parse body
  let body: {
    job_id?: string;
    run_id?: string;
    source?: string;
    listings?: unknown[];
    completed_at?: string;
    error?: string;
  };
  let rawText = "";
  try {
    rawText = await req.text();
    console.log("[worker-results-webhook] RAW PAYLOAD:", rawText.slice(0, 3000));
    body = JSON.parse(rawText);
  } catch (e) {
    console.error("[worker-results-webhook] JSON parse failed:", e);
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

  // ── Fetch or auto-create job stub (mirrors lindy-results-webhook behavior)
  let { data: job, error: jobErr } = await sb
    .from("outward_jobs")
    .select("id, search_run_id, source_key, status, account_id, mandate_id")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    const sourceKey = body.source || "arby";
    const searchRunId = body.run_id || jobId;
    console.warn(`[worker-results-webhook] Job ${jobId} not found — auto-creating stub`);
    const { data: created, error: createErr } = await sb
      .from("outward_jobs")
      .insert({
        id: jobId,
        source_key: sourceKey,
        search_run_id: searchRunId,
        status: "dispatched",
        search_url: "auto-created-by-webhook",
      })
      .select("id, search_run_id, source_key, status, account_id, mandate_id")
      .single();
    if (createErr || !created) {
      console.error("[worker-results-webhook] Auto-create failed:", createErr);
      return new Response(JSON.stringify({ error: "Job not found and auto-create failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    job = created;
  }

  // Idempotent
  if (job.status === "complete") {
    return new Response(JSON.stringify({ status: "already_processed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (job.status !== "dispatched" && job.status !== "pending") {
    return new Response(
      JSON.stringify({ error: `Job status is '${job.status}', expected 'dispatched'` }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Worker reported an error
  if (body.error) {
    await sb
      .from("outward_jobs")
      .update({
        status: "failed",
        error: String(body.error).slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return new Response(JSON.stringify({ status: "failed", job_id: job.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Validate listings
  const validated = validateListings(body.listings ?? [], job.source_key);
  console.log(
    `[worker-results-webhook] job=${jobId} source=${job.source_key}: ${validated.length}/${(body.listings ?? []).length} listings validated`,
  );

  // ── Insert into canonical staging: outward_search_results
  if (validated.length > 0) {
    const rows = validated.map((l) => {
      const ident = extractIdentity(l.title);
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
        make_norm: ident.make_norm,
        model_norm: ident.model_norm,
        fingerprint: ident.fingerprint,
        ingested_at: new Date().toISOString(),
        condition_grade: l.condition_grade,
        condition_score: l.condition_score,
        major_defects: l.major_defects,
        interior_notes: l.interior_notes,
        exterior_notes: l.exterior_notes,
        mechanical_notes: l.mechanical_notes,
      };
    });

    const { error: insertErr } = await sb
      .from("outward_search_results")
      .upsert(rows, { onConflict: "listing_url,job_id", ignoreDuplicates: true });

    if (insertErr) {
      console.error("[worker-results-webhook] Insert error:", insertErr);
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

  // ── Promote mandate-scoped results into mandate_feed_items (Dealer Radar)
  let promoted = 0;
  let promotionRejected = 0;
  if (validated.length > 0 && job.mandate_id) {
    const { data: mandateRow } = await sb
      .from("active_mandates")
      .select("dealer_id, lane")
      .eq("id", job.mandate_id)
      .maybeSingle();

    const dealerId = mandateRow?.dealer_id ?? null;
    const lane = mandateRow?.lane ?? null;
    const now = new Date().toISOString();

    const feedRows = validated
      .map((l) => {
        const ident = extractIdentity(l.title);
        const listingId = l.source_id || l.listing_url;
        if (!listingId) {
          promotionRejected++;
          return null;
        }
        return {
          mandate_id: job.mandate_id,
          source: job.source_key,
          listing_id: String(listingId),
          source_url: l.listing_url,
          dealer_id: dealerId,
          lane,
          make: ident.make_norm,
          model: ident.model_norm,
          variant: null,
          year: l.year,
          km: l.odometer_km,
          asking_price: l.price_aud,
          location: l.state,
          last_seen_at: now,
          raw: {
            title: l.title,
            source_id: l.source_id,
            condition_grade: l.condition_grade,
            condition_score: l.condition_score,
            promoted_from: "worker-results-webhook",
            job_id: job.id,
          },
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (feedRows.length > 0) {
      const { data: promData, error: promErr } = await sb
        .from("mandate_feed_items")
        .upsert(feedRows, {
          onConflict: "mandate_id,source,listing_id",
          ignoreDuplicates: false,
        })
        .select("id");
      if (promErr) {
        console.error("[worker-results-webhook] PROMOTION FAILED:", promErr.message);
        promotionRejected += feedRows.length;
      } else {
        promoted = promData?.length ?? feedRows.length;
        try {
          await sb.rpc("mandate_feed_detect_price_changes", { p_mandate_id: job.mandate_id });
        } catch (e) {
          console.warn("[worker-results-webhook] price-change rpc failed:", e);
        }
      }
    }
  }

  // ── Mark job complete
  const { error: completeErr } = await sb
    .from("outward_jobs")
    .update({
      status: "complete",
      result_count: validated.length,
      completed_at: body.completed_at || new Date().toISOString(),
    })
    .eq("id", job.id);
  if (completeErr) console.error("[worker-results-webhook] Mark complete failed:", completeErr);

  console.log(
    `[worker-results-webhook] OBSERVABILITY job=${jobId} source=${job.source_key} mandate_id=${job.mandate_id || "none"} received=${(body.listings ?? []).length} validated=${validated.length} promoted=${promoted} rejected=${promotionRejected}`,
  );

  return new Response(
    JSON.stringify({
      status: "ok",
      job_id: job.id,
      validated: validated.length,
      promoted,
      promotion_rejected: promotionRejected,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
