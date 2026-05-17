/**
 * Shared ingest helper for star-watch results.
 * Used by both worker-star-watch-browser (internal) and lindy-results-webhook
 * (external compatibility). Writes to outward_search_results, updates
 * outward_jobs, then runs scoreListingsForDealer().
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scoreListingsForDealer } from "../fingerprint/matchListingToFingerprint.ts";
import type { StagedListing } from "../fingerprint/matchListingToFingerprint.ts";

export interface IngestListing {
  listing_url: string;
  title: string | null;
  price_aud: number | null;
  odometer_km: number | null;
  year: number | null;
  state: string | null;
  source_id: string | null;
  seller_name?: string | null;
  condition_grade?: string | null;
  condition_score?: number | null;
  major_defects?: string | null;
  interior_notes?: string | null;
  exterior_notes?: string | null;
  mechanical_notes?: string | null;
}

export interface IngestPayload {
  job_id: string;
  source_key: string;            // e.g. "star_watch", "carsales"
  account_id?: string | null;
  job_status: "complete" | "failed" | "blocked" | "removed";
  listings: IngestListing[];
  error?: string | null;
}

export interface IngestResult {
  ok: boolean;
  inserted: number;
  scored: number;
  error?: string;
}

export async function ingestStarWatchResult(payload: IngestPayload): Promise<IngestResult> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();

  // ── 1) update outward_jobs (audit + status mirror) ───────────────────────
  await sb.from("outward_jobs").update({
    status: payload.job_status,
    completed_at: now,
    error_message: payload.error || null,
    result_count: payload.listings.length,
  }).eq("id", payload.job_id).then(({ error }) => {
    if (error) console.warn("[star-watch ingest] outward_jobs update:", error.message);
  });

  if (payload.job_status !== "complete" || payload.listings.length === 0) {
    return { ok: true, inserted: 0, scored: 0 };
  }

  // ── 2) insert into outward_search_results ────────────────────────────────
  const rows = payload.listings.map((l) => ({
    job_id: payload.job_id,
    search_run_id: payload.job_id,
    source_key: payload.source_key,
    listing_url: l.listing_url,
    title: l.title,
    price_aud: l.price_aud,
    odometer_km: l.odometer_km,
    year: l.year,
    state: l.state,
    source_id: l.source_id,
    seller_name: l.seller_name ?? null,
    condition_grade: l.condition_grade ?? null,
    condition_score: l.condition_score ?? null,
    major_defects: l.major_defects ?? null,
    interior_notes: l.interior_notes ?? null,
    exterior_notes: l.exterior_notes ?? null,
    mechanical_notes: l.mechanical_notes ?? null,
    created_at: now,
  }));

  const { error: insErr } = await sb.from("outward_search_results").insert(rows);
  if (insErr) {
    console.error("[star-watch ingest] outward_search_results insert failed:", insErr.message);
    return { ok: false, inserted: 0, scored: 0, error: insErr.message };
  }

  // ── 3) score against dealer fingerprints (silent on failure) ─────────────
  let scored = 0;
  try {
    const staged: StagedListing[] = rows.map((r) => ({
      listing_url: r.listing_url,
      title: r.title,
      price_aud: r.price_aud,
      odometer_km: r.odometer_km,
      year: r.year,
      state: r.state,
      source_id: r.source_id,
    })) as unknown as StagedListing[];

    const scoreOut = await scoreListingsForDealer(sb, {
      account_id: payload.account_id ?? null,
      listings: staged,
      source_key: payload.source_key,
      job_id: payload.job_id,
    } as any);
    scored = (scoreOut as any)?.matched ?? 0;
  } catch (err) {
    console.warn("[star-watch ingest] scoring failed (silent):", (err as Error).message);
  }

  return { ok: true, inserted: rows.length, scored };
}
