/**
 * run-valo-v1 — VALO Trade-In Valuation Orchestrator (Phase 1: Market Comps)
 *
 * Linear, deterministic flow:
 *   1. Validate entitlement
 *   2. Parse VALO intent
 *   3. Fetch comps (internal first, outward if needed)
 *   4. Score comps → anchor + backups
 *   5. Market range (P25/P50/P75)
 *   6. Base trade-in offer
 *   7. Confidence (with guardrail downgrades)
 *   8. Persist valo_run
 *   9. Return result
 *
 * MODO is a separate call — it adjusts recon only.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParsedIntent, AdapterResult } from "../_shared/outward-search/types.ts";
import { parseIntentLLM, parseIntentRegex } from "../_shared/outward-search/intent-parser.ts";
import { InternalDbAdapter } from "../_shared/outward-search/adapters/internal-db.ts";
import {
  runValoScoring,
  computeConfidence,
  type Confidence,
} from "../_shared/valo/scoreValoComps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function errorResponse(message: string, status = 400) {
  return new Response(
    JSON.stringify({ status: "error", error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const startMs = Date.now();

  try {
    const body = await req.json();
    const accountId: string | null = body.account_id ?? null;
    const instruction: string = body.instruction ?? "";
    const fullMarketScan: boolean = body.full_market_scan === true;
    const initiatedBy: string = body.initiated_by ?? "dealer";
    const kmInput: number | null = body.km ?? null;
    const filters: Record<string, unknown> | null = body.filters ?? null;

    if (!instruction.trim()) {
      return errorResponse("Missing instruction");
    }

    // KM is required for VALO strict mode (check body.km or filters.max_km)
    const effectiveKm = kmInput ?? (filters?.max_km as number | null) ?? null;
    if (!effectiveKm || effectiveKm <= 0) {
      return new Response(
        JSON.stringify({
          status: "missing_required_fields",
          missing: ["km"],
          error: "Kilometres (km) is required for VALO valuation",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Supabase client ──
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(sbUrl, sbKey);

    // ── 1. Entitlement check (enterprise only) ──
    if (accountId) {
      const { data: ent } = await sb
        .from("dealer_entitlements")
        .select("is_active, plan_tier")
        .eq("account_id", accountId)
        .maybeSingle();

      if (ent && !ent.is_active) {
        return errorResponse("Account is not active");
      }
    }

    // ── 2. Parse intent ──
    const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    let intent: ParsedIntent = await parseIntentLLM(instruction, apiKey);
    if (!intent.make) {
      intent = parseIntentRegex(instruction);
    }

    if (!intent.make) {
      return errorResponse("Unable to determine vehicle make/model from description");
    }

    // ── 2b. Apply structured filters (override parsed intent) ──
    if (filters) {
      if (filters.year_min != null) intent.year_min = filters.year_min as number;
      if (filters.year_max != null) intent.year_max = filters.year_max as number;
      if (filters.max_km != null) intent.max_km = filters.max_km as number;
      if (filters.badge != null) intent.badge = filters.badge as string;
      if (filters.condition != null) intent.condition = filters.condition as string;
      if (filters.allowance_aud != null) intent.allowance_aud = filters.allowance_aud as number;
      if (Array.isArray(filters.accessory_terms) && filters.accessory_terms.length > 0) {
        intent.accessory_terms = filters.accessory_terms as string[];
      }
    }
    // Ensure KM is set on intent
    if (!intent.max_km && effectiveKm) {
      intent.max_km = effectiveKm;
    }

    // ── 3. Fetch comparables ──
    const internalAdapter = new InternalDbAdapter();
    let internalResults: AdapterResult[] = [];
    try {
      internalResults = await internalAdapter.search(intent, {});
    } catch (err) {
      console.error("VALO internal search error:", err);
    }

    let allComps = [...internalResults];

    // ── 3b. Perplexity market scan (supplementary comps) ──
    try {
      const perplexityResp = await fetch(`${sbUrl}/functions/v1/valo-perplexity-scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sbKey}`,
        },
        body: JSON.stringify({ intent }),
      });

      if (perplexityResp.ok) {
        const perplexityData = await perplexityResp.json();
        const perplexityResults: AdapterResult[] = perplexityData.results ?? [];
        if (perplexityResults.length > 0) {
          console.log(`VALO Perplexity scan: ${perplexityResults.length} comps found`);
          allComps = deduplicateResults([...allComps, ...perplexityResults]);
        }
      } else {
        const errText = await perplexityResp.text();
        console.error("VALO Perplexity scan failed:", perplexityResp.status, errText);
      }
    } catch (err) {
      console.error("VALO Perplexity scan error:", err);
    }

    // If still insufficient and full_market_scan requested, try outward search
    if (allComps.length < 8 && fullMarketScan) {
      try {
        const outwardResp = await fetch(`${sbUrl}/functions/v1/run-outward-search-v2`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sbKey}`,
          },
          body: JSON.stringify({
            account_id: accountId,
            initiated_by: "valo",
            instruction,
            urgency: "high",
          }),
        });

        if (outwardResp.ok) {
          const outwardData = await outwardResp.json();
          const outwardResults: AdapterResult[] = outwardData.results ?? [];
          allComps = deduplicateResults([...allComps, ...outwardResults]);
        } else {
          const errText = await outwardResp.text();
          console.error("VALO outward search failed:", outwardResp.status, errText);
        }
      } catch (err) {
        console.error("VALO outward search error:", err);
      }
    }

    if (allComps.length < 3) {
      return errorResponse(
        `Insufficient comparable vehicles found (${allComps.length}). Need at least 3.`,
      );
    }

    // ── 4–8. Score, range, offer, confidence ──
    const valo = runValoScoring(intent, allComps);
    if (!valo) {
      return errorResponse("Valuation could not be computed — scoring failed");
    }

    // ── Guardrail downgrades ──
    let confidence = valo.confidence;
    confidence = applyGuardrails(valo.all_scored, confidence);

    // ── 9. Persist run ──
    let valoRunId: string | null = null;
    try {
      const { data } = await sb
        .from("valo_runs")
        .insert({
          account_id: accountId,
          intent,
          anchor: valo.anchor,
          backups: valo.backups,
          market: valo.market,
          trade_in_offer: valo.trade_in_offer,
          confidence,
        })
        .select("id")
        .single();
      valoRunId = data?.id ?? null;
    } catch (err) {
      console.error("Failed to persist valo_run:", err);
    }

    // ── 10. Return ──
    const durationMs = Date.now() - startMs;

    return new Response(
      JSON.stringify({
        status: "complete",
        valo_run_id: valoRunId,
        parsed_intent: {
          make: intent.make,
          model: intent.model,
          badge: intent.badge,
          year_min: intent.year_min,
          year_max: intent.year_max,
          max_km: intent.max_km,
          condition: intent.condition,
          allowance_aud: intent.allowance_aud,
          accessory_terms: intent.accessory_terms,
          body_keywords: intent.body_keywords,
        },
        anchor: valo.anchor,
        backups: valo.backups,
        market: valo.market,
        trade_in_offer: valo.trade_in_offer,
        confidence,
        comp_count: valo.all_scored.length,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("run-valo-v1 error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Unknown error",
      500,
    );
  }
});

// ─── Guardrail Downgrades ───────────────────────────────────────

function applyGuardrails(
  scored: Array<{ valo_score: number; km?: number | null; price?: number | null; effective_cost?: number | null; url?: string | null }>,
  confidence: Confidence,
): Confidence {
  let c = confidence;

  // Rule 1: comp_count < 5 → downgrade
  if (scored.length < 5) {
    c = downgrade(c);
  }

  // Rule 2: all same seller (URL domain)
  const domains = new Set(
    scored
      .map((s) => {
        try {
          return s.url ? new URL(s.url).hostname : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
  if (domains.size === 1 && scored.length > 1) {
    c = downgrade(c);
  }

  // Rule 3: KM spread > 60k
  const kms = scored.map((s) => s.km).filter((k): k is number => k != null);
  if (kms.length >= 2) {
    const kmSpread = Math.max(...kms) - Math.min(...kms);
    if (kmSpread > 60000) {
      c = downgrade(c);
    }
  }

  // Rule 4: Price spread > 30%
  const prices = scored
    .map((s) => s.price ?? s.effective_cost)
    .filter((p): p is number => p != null && p > 0);
  if (prices.length >= 2) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min > 0 && (max - min) / min > 0.3) {
      c = downgrade(c);
    }
  }

  return c;
}

function downgrade(c: Confidence): Confidence {
  if (c === "HIGH") return "MED";
  if (c === "MED") return "LOW";
  return "LOW";
}

// ─── Deduplication (mirrored from outward-search-v2) ────────────

function deduplicateResults(results: AdapterResult[]): AdapterResult[] {
  const seen = new Map<string, AdapterResult>();
  for (const r of results) {
    const kmBand = r.km ? Math.round(r.km / 5000) * 5000 : 0;
    const priceBand = r.price ? Math.round(r.price / 500) * 500 : 0;
    const key = [
      r.year ?? "",
      (r.title || "").substring(0, 30).toUpperCase(),
      kmBand,
      priceBand,
      (r.state || "").toUpperCase(),
    ].join("|");

    const existing = seen.get(key);
    if (!existing || r.score > existing.score) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}
