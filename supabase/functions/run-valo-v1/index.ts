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
import { extractSeries } from "../_shared/taxonomy/derivePlatform.ts";
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

    // ── 2c. Derive platform series (LC300 vs LC70 etc) ──
    if (!intent.series && intent.make && intent.model) {
      intent.series = extractSeries(intent.make, intent.model);
      if (intent.series) {
        console.log(`VALO series derived: ${intent.series}`);
      }
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

    // ── 3b. Parallel AI discovery: Perplexity + Gemini (25s timeout each) ──
    const [perplexityResults, geminiResults] = await Promise.all([
      runDiscoveryScan(sbUrl, sbKey, intent, "valo-perplexity-scan", "Perplexity"),
      runDiscoveryScan(sbUrl, sbKey, intent, "valo-gemini-scan", "Gemini"),
    ]);

    if (perplexityResults.length > 0 || geminiResults.length > 0) {
      const merged = deduplicateResults([...allComps, ...perplexityResults, ...geminiResults]);
      console.log(`VALO parallel discovery: ${perplexityResults.length} Perplexity + ${geminiResults.length} Gemini → ${merged.length} after dedup`);
      allComps = merged;
    }

    // ── 3c. Persist discovered listings to market_listing_history ──
    try {
      await persistDiscoveredListings(sb, intent, [...perplexityResults, ...geminiResults]);
    } catch (err) {
      console.error("VALO market_listing_history persist error:", err);
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
          series: intent.series,
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

// ─── Deduplication (enhanced with listing_id) ───────────────────

function extractListingId(url: string): string | null {
  if (!url) return null;
  try {
    const carsales = url.match(/OAG-AD-\d+/i);
    if (carsales) return carsales[0];
    const drive = url.match(/drive\.com\.au\/.*\/car\/(\d+)/i);
    if (drive) return `drive-${drive[1]}`;
    const autotrader = url.match(/autotrader\.com\.au\/.*?(\d{6,})/i);
    if (autotrader) return `at-${autotrader[1]}`;
    const carsguide = url.match(/carsguide\.com\.au\/.*?(\d{6,})/i);
    if (carsguide) return `cg-${carsguide[1]}`;
  } catch { /* ignore */ }
  return null;
}

function deduplicateResults(results: AdapterResult[]): AdapterResult[] {
  const seen = new Map<string, AdapterResult>();
  for (const r of results) {
    // Primary dedup: listing_id from URL
    const listingId = extractListingId(r.url ?? "");
    if (listingId) {
      const existing = seen.get(`lid:${listingId}`);
      if (!existing || (r.price ?? Infinity) < (existing.price ?? Infinity)) {
        seen.set(`lid:${listingId}`, r);
      }
      continue;
    }

    // Secondary dedup: composite key
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
    if (!existing || (r.price ?? Infinity) < (existing.price ?? Infinity)) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

// ─── Parallel Discovery Scan Helper ─────────────────────────────

async function runDiscoveryScan(
  sbUrl: string,
  sbKey: string,
  intent: ParsedIntent,
  functionName: string,
  label: string,
): Promise<AdapterResult[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const resp = await fetch(`${sbUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sbKey}`,
      },
      body: JSON.stringify({ intent }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      const results: AdapterResult[] = data.results ?? [];
      console.log(`VALO ${label} scan: ${results.length} comps found`);
      return results;
    } else {
      const errText = await resp.text();
      console.error(`VALO ${label} scan failed:`, resp.status, errText);
      return [];
    }
  } catch (err) {
    console.error(`VALO ${label} scan error:`, err);
    return [];
  }
}

// ─── Persist Discovered Listings ────────────────────────────────

async function persistDiscoveredListings(
  sb: any,
  intent: ParsedIntent,
  results: AdapterResult[],
) {
  if (results.length === 0) return;

  const now = new Date().toISOString();
  const rows = results
    .filter(r => r.price && r.price > 0)
    .map(r => {
      const listingId = extractListingId(r.url ?? "") ?? (r as any)._listing_id ?? null;
      const sourceSite = (r as any)._source_site ?? r.source_class ?? r.source ?? "unknown";
      return {
        listing_id: listingId,
        url: r.url,
        source_site: sourceSite,
        make: intent.make ?? "unknown",
        model: intent.model ?? "unknown",
        variant: r.variant,
        year: r.year,
        price: r.price,
        km: r.km,
        dealer: r.seller_name,
        seller_type: (r as any)._seller_type ?? null,
        state: r.state,
        stock_number: (r as any)._stock_number ?? null,
        image_url: r.image_url,
        discovered_by: r.source === "gemini_discovery" ? "gemini" : "perplexity",
        first_seen_at: now,
        last_seen_at: now,
        price_at_first_seen: r.price,
        price_at_last_seen: r.price,
      };
    });

  if (rows.length === 0) return;

  // Upsert: update last_seen and price_at_last_seen for existing listings
  for (const row of rows) {
    if (row.listing_id) {
      const { error } = await sb.from("market_listing_history").upsert(row, {
        onConflict: "listing_id,source_site",
        ignoreDuplicates: false,
      });
      if (error) console.error("MLH upsert error:", error.message);
    } else {
      // No listing_id — just insert, skip if it fails on constraint
      const { error } = await sb.from("market_listing_history").insert(row);
      if (error && !error.message.includes("duplicate")) {
        console.error("MLH insert error:", error.message);
      }
    }
  }

  console.log(`VALO persisted ${rows.length} listings to market_listing_history`);
}
