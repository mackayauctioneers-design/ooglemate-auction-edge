/**
 * run-outward-search-v2
 *
 * Two-phase orchestrator:
 *   PHASE 1: Internal DB search (always, free, no quota cost)
 *   PHASE 2: Outward registry sources (gated by entitlement + quota)
 *
 * With: quota enforcement, cache (tier-aware), telemetry, global system cap.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParsedIntent, AdapterResult } from "../_shared/outward-search/types.ts";
import { MAX_RESULTS } from "../_shared/outward-search/types.ts";
import { emptyIntent, parseIntentLLM, parseIntentRegex } from "../_shared/outward-search/intent-parser.ts";
import { checkQuota, incrementUsage, checkGlobalCap, incrementGlobalCap } from "../_shared/outward-search/quota.ts";
import { InternalDbAdapter } from "../_shared/outward-search/adapters/internal-db.ts";
import { dispatchLindyJobs } from "../_shared/outward-search/lindy-dispatch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

// Outward adapter registry — internal_db is NOT here (it's Phase 1)
const ADAPTERS: Record<string, () => { search: (intent: ParsedIntent, config: Record<string, unknown>, signal?: AbortSignal) => Promise<AdapterResult[]> }> = {
  // manus: () => new ManusAdapter(),  — future
};

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
  const isPrivileged = body.full_market_scan === true || initiatedBy === "operator";
  const urgency = body.urgency ?? (isPrivileged ? "high" : "normal");

  // ── Parse intent ──
  let intent: ParsedIntent = emptyIntent();
  const provided = body.filters;
  if (provided?.make) {
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
  // PHASE 1: Internal DB search (always runs, no quota cost)
  // ══════════════════════════════════════════════════════════
  const internalAdapter = new InternalDbAdapter();
  let internalResults: AdapterResult[] = [];
  try {
    internalResults = await internalAdapter.search(intent, {});
  } catch (err) {
    console.error("Phase 1 internal search error:", err);
  }

  const internalCount = body.internal_count ?? internalResults.length;

  // ── Demand gating: skip outward if plenty of internal results ──
  // Enterprise + operator always bypass this gate (isPrivileged = true)
  if (!isPrivileged && internalCount >= 5) {
    const durationMs = Date.now() - startMs;
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId, initiated_by: initiatedBy, instruction,
        parsed_intent: intent,
        sources_queried: ["internal_db"],
        total_results: internalResults.length,
        results_by_source: { internal_db: internalResults.length },
        gated: true,
        gate_reason: `${internalCount} internal results — outward search skipped`,
        status: "gated", duration_ms: durationMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: `${internalCount} internal results found — outward search skipped`,
      phase: "internal_only",
      intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
      results: internalResults.slice(0, MAX_RESULTS),
      internal_count: internalResults.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ══════════════════════════════════════════════════════════
  // PHASE 2: Outward registry sources (quota-gated)
  // ══════════════════════════════════════════════════════════

  // Quota check
  const quota = await checkQuota(accountId, initiatedBy);
  if (!quota.allowed) {
    // Return internal results even when quota blocks outward
    const durationMs = Date.now() - startMs;
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId, initiated_by: initiatedBy, instruction,
        parsed_intent: intent, sources_queried: ["internal_db"],
        total_results: internalResults.length,
        results_by_source: { internal_db: internalResults.length },
        gated: true, gate_reason: quota.reason,
        quota_snapshot: quota.entitlement ? { used: quota.entitlement.searches_used_today, max: quota.entitlement.max_searches_per_day, tier: quota.entitlement.plan_tier } : null,
        status: "gated", duration_ms: durationMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: quota.reason, phase: "internal_only",
      intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
      results: internalResults.slice(0, MAX_RESULTS),
      internal_count: internalResults.length,
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
        total_results: internalResults.length,
        results_by_source: { internal_db: internalResults.length },
        gated: true, gate_reason: "Global daily outward search limit reached",
        status: "gated", duration_ms: durationMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: "Global daily outward search limit reached", phase: "internal_only",
      results: internalResults.slice(0, MAX_RESULTS),
      internal_count: internalResults.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Filter eligible outward sources (exclude internal_db — it's Phase 1)
  const outwardSources = quota.eligible_sources.filter(s => s.adapter_type !== "internal_db");

  // Cache check (tier-aware key)
  const tier = quota.entitlement?.plan_tier ?? "free";
  const outwardSourceKeys = outwardSources.map(s => s.source);
  const cacheKey = buildCacheKey(intent, tier, outwardSourceKeys);

  const { data: cached } = await sb
    .from("search_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .eq("source", "outward_v2")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (cached) {
    await sb.from("search_cache").update({ hits: (cached.hits || 0) + 1 }).eq("id", cached.id);
    const cachedOutward = (cached.results as AdapterResult[]) || [];
    // Merge internal + cached outward, dedup, sort
    const merged = deduplicateResults([...internalResults, ...cachedOutward]);
    merged.sort((a, b) => b.score - a.score || (a.effective_cost ?? Infinity) - (b.effective_cost ?? Infinity));
    const topResults = merged.slice(0, MAX_RESULTS);

    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId, initiated_by: initiatedBy, instruction,
        parsed_intent: intent, sources_queried: ["internal_db"],
        total_results: topResults.length, cache_hit: true,
        status: "completed", duration_ms: Date.now() - startMs,
        completed_at: new Date().toISOString(),
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: false, cached: true, phase: "internal+outward_cached",
      intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
      results: topResults,
      internal_count: internalResults.length,
      total_filtered: topResults.length,
      duration_ms: Date.now() - startMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── Create search run record first (needed for job FK) ──
  let searchRunId: string | null = null;
  try {
    const { data: runRow } = await sb.from("outward_search_runs").insert({
      account_id: accountId, initiated_by: initiatedBy, instruction,
      parsed_intent: intent, sources_queried: ["internal_db", ...outwardSources.map(s => s.source)],
      total_results: internalResults.length,
      results_by_source: { internal_db: internalResults.length },
      cache_hit: false, status: "processing", duration_ms: 0,
      quota_snapshot: quota.entitlement ? { used: quota.entitlement.searches_used_today, max: quota.entitlement.max_searches_per_day, tier: quota.entitlement.plan_tier } : null,
    }).select("id").single();
    searchRunId = runRow?.id ?? null;
  } catch (err) {
    console.error("Failed to create search run:", err);
  }

  if (!searchRunId) {
    return new Response(JSON.stringify({
      status: "error", error: "Failed to create search run record",
      results: internalResults.slice(0, MAX_RESULTS),
      internal_count: internalResults.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── Dispatch Lindy Computer jobs (async — returns immediately) ──
  const lindySourceKeys = outwardSources
    .filter(s => ["carsales", "carsguide", "gumtree"].includes(s.source))
    .map(s => s.source);

  let dispatchResults: Awaited<ReturnType<typeof dispatchLindyJobs>> = [];
  if (lindySourceKeys.length > 0) {
    dispatchResults = await dispatchLindyJobs(sb, searchRunId, intent, lindySourceKeys);
  }

  // Increment usage (outward was dispatched)
  if (accountId && initiatedBy === "user" && lindySourceKeys.length > 0) {
    await incrementUsage(accountId);
  }
  if (lindySourceKeys.length > 0) {
    await incrementGlobalCap(sb);
  }

  const durationMs = Date.now() - startMs;

  // Update search run with dispatch info
  try {
    await sb.from("outward_search_runs").update({
      duration_ms: durationMs,
      results_by_source: {
        internal_db: internalResults.length,
        ...Object.fromEntries(dispatchResults.map(d => [d.source, d.status === "dispatched" ? -1 : 0])),
      },
    }).eq("id", searchRunId);
  } catch (_) { /* swallow */ }

  // Return immediately with internal results + job references for polling
  return new Response(JSON.stringify({
    status: "ok",
    phase: lindySourceKeys.length > 0 ? "internal+outward_dispatched" : "internal_only",
    search_run_id: searchRunId,
    intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
    results: internalResults.slice(0, MAX_RESULTS),
    internal_count: internalResults.length,
    outward_jobs: dispatchResults.map(d => ({
      source: d.source,
      job_id: d.job_id,
      status: d.status,
      reason: d.reason,
    })),
    duration_ms: durationMs,
    quota: quota.entitlement ? { used: (quota.entitlement.searches_used_today || 0) + 1, max: quota.entitlement.max_searches_per_day, tier: quota.entitlement.plan_tier } : null,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

/**
 * Deduplicate results across sources.
 * Uses a composite key of: year + make + model + km-band + price-band + state
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
    if (!existing || r.score > existing.score) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}
