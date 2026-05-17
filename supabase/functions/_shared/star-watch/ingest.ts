/**
 * Shared ingest helper for star-watch results.
 * Mirrors the lindy-results-webhook write+score pattern so internal worker
 * and external webhook can share one downstream path.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  scoreListingsForDealer,
  type StagedListing,
} from "../fingerprint/matchListingToFingerprint.ts";

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
}

export interface IngestPayload {
  job_id: string;
  source_key: string;
  account_id?: string | null;
  job_status: "complete" | "failed" | "blocked" | "removed";
  listings: IngestListing[];
  error?: string | null;
}

export interface IngestResult {
  ok: boolean;
  inserted: number;
  scored: number;
  no_match: number;
  error?: string;
}

export async function ingestStarWatchResult(payload: IngestPayload): Promise<IngestResult> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const now = new Date().toISOString();

  // ── Mirror terminal status onto outward_jobs ─────────────────────────────
  await sb.from("outward_jobs").update({
    status: payload.job_status,
    completed_at: now,
    error: payload.error || null,
    result_count: payload.listings.length,
  }).eq("id", payload.job_id);

  if (payload.job_status !== "complete" || payload.listings.length === 0) {
    return { ok: true, inserted: 0, scored: 0, no_match: 0 };
  }

  // ── Insert results ───────────────────────────────────────────────────────
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
    condition_grade: l.condition_grade ?? null,
    condition_score: l.condition_score ?? null,
    major_defects: l.major_defects ?? null,
    status: "pending_score",
  }));

  const { error: insErr } = await sb.from("outward_search_results").insert(rows);
  if (insErr) {
    console.error("[star-watch ingest] insert failed:", insErr.message);
    await sb.from("outward_jobs").update({
      status: "failed",
      error: `Insert failed: ${insErr.message}`,
      completed_at: now,
    }).eq("id", payload.job_id);
    return { ok: false, inserted: 0, scored: 0, no_match: 0, error: insErr.message };
  }

  // ── Score against dealer fingerprints (skipped if no account_id) ─────────
  let scored = 0;
  let no_match = 0;
  if (payload.account_id) {
    try {
      const { data: profile } = await sb
        .from("dealer_profiles")
        .select("id")
        .eq("account_id", payload.account_id)
        .limit(1)
        .maybeSingle();

      if (profile?.id) {
        const { data: staged } = await sb
          .from("outward_search_results")
          .select("id, make_norm, model_norm, variant_family, year, odometer_km, price_aud, listing_url")
          .eq("job_id", payload.job_id)
          .eq("status", "pending_score");

        if (staged?.length) {
          const list: StagedListing[] = staged.map((r) => ({
            id: r.id,
            make_norm: r.make_norm,
            model_norm: r.model_norm,
            variant_family: r.variant_family,
            year: r.year,
            odometer_km: r.odometer_km ? Number(r.odometer_km) : null,
            price_aud: r.price_aud ? Number(r.price_aud) : null,
            listing_url: r.listing_url,
          }));
          const res = await scoreListingsForDealer(sb, profile.id, list);
          scored = res.scored;
          no_match = res.no_match;
        }
      }
    } catch (err) {
      console.warn("[star-watch ingest] scoring failed (silent):", (err as Error).message);
    }
  }

  return { ok: true, inserted: rows.length, scored, no_match };
}
