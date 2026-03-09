/**
 * run-outward-search-v2
 *
 * Two-tier Ooglebot architecture:
 *   LAYER 1: Internal "Sales Truth" Match (always, free, no quota cost)
 *            - Auctions, dealer sites, VA uploads, prior scraped listings
 *            - If matches ≥3 → return results, STOP
 *   LAYER 2: Outward Market Recon (only when internal < 3)
 *            - CaroogleAI discovery
 *            - Priority: Auctions → Dealer websites → FB Marketplace → Gumtree → Carsales
 *
 * With: quota enforcement, cache (tier-aware), telemetry, global system cap.
 * Score filter: Only return results with score ≥70
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParsedIntent, AdapterResult } from "../_shared/outward-search/types.ts";
import { MAX_RESULTS } from "../_shared/outward-search/types.ts";
import { emptyIntent, parseIntentLLM, parseIntentRegex } from "../_shared/outward-search/intent-parser.ts";
import { checkQuota, incrementUsage, checkGlobalCap, incrementGlobalCap } from "../_shared/outward-search/quota.ts";
import { InternalDbAdapter } from "../_shared/outward-search/adapters/internal-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Minimum internal matches before triggering outward search */
const INTERNAL_MATCH_THRESHOLD = 3;

/** Minimum score to include in results */
const MIN_SCORE_THRESHOLD = 70;

/** Cache key includes tier to prevent cross-tier pollution */
function buildCacheKey(intent: ParsedIntent, tier: string, sourceKeys: string[]): string {
  return [
    intent.make?.toUpperCase() ?? "",
    intent.model?.toUpperCase() ?? "",
    intent.badge?.toUpperCase() ?? "",
    intent.year_min ?? "",
    intent.year_max ?? "",
    intent.max_km ?? "",
    intent.price_max ?? "",
    tier,
    sourceKeys.sort().join("+"),
  ].join("|");
}

/** Filter results by minimum score threshold */
function filterByScore(results: AdapterResult[], minScore: number): AdapterResult[] {
  return results.filter(r => (r.score ?? 0) >= minScore);
}

/** Sort results by score desc, then price asc */
function sortResults(results: AdapterResult[]): AdapterResult[] {
  return [...results].sort((a, b) => {
    // Score descending
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    // Price ascending (cheapest first for same score)
    return (a.effective_cost ?? a.price ?? Infinity) - (b.effective_cost ?? b.price ?? Infinity);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "error", error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startMs = Date.now();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

  let body: {
    instruction?: string;
    account_id?: string;
    initiated_by?: string;
    internal_count?: number;
    urgency?: string;
    full_market_scan?: boolean;
    filters?: Partial<ParsedIntent> | null;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ status: "error", error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const instruction = (body.instruction || "").trim();
  if (!instruction) {
    return new Response(JSON.stringify({ status: "error", error: "instruction is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const accountId = body.account_id || null;
  const initiatedBy = body.initiated_by || "user";

  // ── Backend plan-tier verification ──
  // Do NOT trust frontend full_market_scan alone — verify entitlement
  let isPrivileged = initiatedBy === "operator"; // operators always privileged
  if (!isPrivileged && body.full_market_scan === true && accountId) {
    const { data: ent } = await sb
      .from("dealer_entitlements")
      .select("plan_tier")
      .eq("account_id", accountId)
      .maybeSingle();
    isPrivileged = ent?.plan_tier === "enterprise" || ent?.plan_tier === "premium";
  }

  // ── Parse intent (NLP extraction → structured parameters) ──
  let intent: ParsedIntent = emptyIntent();
  const provided = body.filters;
  if (provided?.make) {
    // Structured filters override NLP
    intent = {
      make: String(provided.make).toUpperCase(),
      model: provided.model ? String(provided.model).toUpperCase() : null,
      badge: provided.badge ? String(provided.badge).toUpperCase() : null,
      year_min: typeof provided.year_min === "number" ? provided.year_min : null,
      year_max: typeof provided.year_max === "number" ? provided.year_max : null,
      max_km: typeof provided.max_km === "number" ? provided.max_km : null,
      price_max: typeof provided.price_max === "number" ? provided.price_max : null,
      state: typeof provided.state === "string" ? provided.state.toUpperCase() : null,
    };
  } else {
    // NLP extraction fallback
    intent = await parseIntentLLM(instruction, apiKey);
    if (!intent.make) {
      intent = parseIntentRegex(instruction);
    }
  }

  if (!intent.make) {
    return new Response(JSON.stringify({ status: "error", error: "Could not determine make/model from instruction" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ══════════════════════════════════════════════════════════
  // LAYER 1: Internal "Sales Truth" Match
  // Sources: auctions, dealer sites, VA uploads, prior scraped listings
  // If matches ≥3 → return results, STOP
  // ══════════════════════════════════════════════════════════
  const internalAdapter = new InternalDbAdapter();
  let internalResults: AdapterResult[] = [];

  try {
    internalResults = await internalAdapter.search(intent, {});
  } catch (err) {
    console.error("Layer 1 internal search error:", err);
  }

  // Apply score filter and sort
  const scoredInternal = filterByScore(internalResults, MIN_SCORE_THRESHOLD);
  const sortedInternal = sortResults(scoredInternal);

  console.log(`[Layer 1] Internal: ${internalResults.length} raw → ${scoredInternal.length} scored ≥${MIN_SCORE_THRESHOLD}`);

  // ── Demand gating: if ≥3 internal matches, return and STOP ──
  // Enterprise/operator can bypass this gate with full_market_scan
  if (!isPrivileged && scoredInternal.length >= INTERNAL_MATCH_THRESHOLD) {
    const durationMs = Date.now() - startMs;
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId, initiated_by: initiatedBy, instruction,
        parsed_intent: intent,
        sources_queried: ["internal_db"],
        total_results: sortedInternal.length,
        results_by_source: { internal_db: sortedInternal.length },
        gated: true,
        gate_reason: `${scoredInternal.length} internal matches (≥${INTERNAL_MATCH_THRESHOLD}) — outward skipped`,
        status: "gated", duration_ms: durationMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: `${scoredInternal.length} internal matches found — outward search skipped`,
      phase: "internal_only",
      intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
      results: sortedInternal.slice(0, MAX_RESULTS),
      internal_count: sortedInternal.length,
      score_threshold: MIN_SCORE_THRESHOLD,
      duration_ms: durationMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ══════════════════════════════════════════════════════════
  // LAYER 2: Outward Market Recon (internal < 3)
  // Trigger CaroogleAI discovery + external sources
  // Priority: Auctions → Dealer websites → FB Marketplace → Gumtree → Carsales
  // ══════════════════════════════════════════════════════════

  console.log(`[Layer 2] Internal matches (${scoredInternal.length}) < ${INTERNAL_MATCH_THRESHOLD}, triggering outward recon`);

  // Quota check
  const quota = await checkQuota(accountId, initiatedBy);
  if (!quota.allowed) {
    // Return internal results even when quota blocks outward
    const durationMs = Date.now() - startMs;
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId, initiated_by: initiatedBy, instruction,
        parsed_intent: intent, sources_queried: ["internal_db"],
        total_results: sortedInternal.length,
        results_by_source: { internal_db: sortedInternal.length },
        gated: true, gate_reason: quota.reason,
        quota_snapshot: quota.entitlement ? { used: quota.entitlement.searches_used_today, max: quota.entitlement.max_searches_per_day, tier: quota.entitlement.plan_tier } : null,
        status: "gated", duration_ms: durationMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: quota.reason, phase: "internal_only",
      intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
      results: sortedInternal.slice(0, MAX_RESULTS),
      internal_count: sortedInternal.length,
      quota: quota.entitlement ? { used: quota.entitlement.searches_used_today, max: quota.entitlement.max_searches_per_day, tier: quota.entitlement.plan_tier } : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Global system cap
  const globalOk = await checkGlobalCap(sb);
  if (!globalOk) {
    const durationMs = Date.now() - startMs;
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId, initiated_by: initiatedBy, instruction,
        parsed_intent: intent, sources_queried: ["internal_db"],
        total_results: sortedInternal.length,
        results_by_source: { internal_db: sortedInternal.length },
        gated: true, gate_reason: "Global daily outward search limit reached",
        status: "gated", duration_ms: durationMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: "Global daily outward search limit reached", phase: "internal_only",
      results: sortedInternal.slice(0, MAX_RESULTS),
      internal_count: sortedInternal.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── CaroogleAI Discovery (Layer 2 external recon) ──
  const sbUrl = Deno.env.get("SUPABASE_URL")!;
  const sbServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let caroogleaiResults: AdapterResult[] = [];

  try {
    const resp = await fetch(`${sbUrl}/functions/v1/valo-perplexity-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sbServiceKey}`,
      },
      body: JSON.stringify({ intent }),
    });
    if (resp.ok) {
      const pData = await resp.json();
      caroogleaiResults = (pData.results ?? []) as AdapterResult[];
      console.log(`[Layer 2] CaroogleAI: ${caroogleaiResults.length} results`);
    } else {
      console.error("CaroogleAI scan HTTP error:", resp.status);
    }
  } catch (err) {
    console.error("CaroogleAI scan error:", err);
  }

  // Increment usage (outward search was triggered)
  if (accountId && initiatedBy === "user") {
    await incrementUsage(accountId);
  }
  await incrementGlobalCap(sb);

  // Merge internal + caroogleai, apply score filter, deduplicate, sort
  const allResults = deduplicateResults([...internalResults, ...caroogleaiResults]);
  const scoredResults = filterByScore(allResults, MIN_SCORE_THRESHOLD);
  const finalResults = sortResults(scoredResults);

  console.log(`[Layer 2] Merged: ${allResults.length} raw → ${scoredResults.length} scored ≥${MIN_SCORE_THRESHOLD}`);

  const durationMs = Date.now() - startMs;

  try {
    await sb.from("outward_search_runs").insert({
      account_id: accountId, initiated_by: initiatedBy, instruction,
      parsed_intent: intent, 
      sources_queried: ["internal_db", "caroogleai"],
      total_results: finalResults.length,
      results_by_source: { internal_db: scoredInternal.length, caroogleai: filterByScore(caroogleaiResults, MIN_SCORE_THRESHOLD).length },
      cache_hit: false, status: "completed", duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });
  } catch (_) { /* swallow */ }

  return new Response(JSON.stringify({
    status: "ok",
    phase: "internal+outward",
    intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
    results: finalResults.slice(0, MAX_RESULTS),
    internal_count: scoredInternal.length,
    outward_count: filterByScore(caroogleaiResults, MIN_SCORE_THRESHOLD).length,
    score_threshold: MIN_SCORE_THRESHOLD,
    duration_ms: durationMs,
    quota: quota.entitlement ? { used: (quota.entitlement.searches_used_today || 0) + 1, max: quota.entitlement.max_searches_per_day, tier: quota.entitlement.plan_tier } : null,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

/**
 * Deduplicate results across sources.
 * Uses a composite key of: year + title prefix + km-band + price-band + state
 * This catches the same vehicle listed on multiple platforms.
 */
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
    if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}
