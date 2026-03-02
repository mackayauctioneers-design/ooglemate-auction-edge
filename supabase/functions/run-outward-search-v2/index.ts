/**
 * run-outward-search-v2
 *
 * Registry-driven orchestrator with:
 * - Quota enforcement per dealer account
 * - Source selection from source_registry
 * - Adapter dispatch (internal_db now, manus later)
 * - 3-hour cache
 * - Full telemetry logging to outward_search_runs
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParsedIntent, AdapterResult, SearchRunRecord } from "../_shared/outward-search/types.ts";
import { MAX_RESULTS } from "../_shared/outward-search/types.ts";
import { emptyIntent, parseIntentLLM, parseIntentRegex } from "../_shared/outward-search/intent-parser.ts";
import { checkQuota, incrementUsage } from "../_shared/outward-search/quota.ts";
import { InternalDbAdapter } from "../_shared/outward-search/adapters/internal-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildCacheKey(intent: ParsedIntent): string {
  return [
    intent.make?.toUpperCase() ?? "",
    intent.model?.toUpperCase() ?? "",
    intent.badge?.toUpperCase() ?? "",
    intent.year_min ?? "",
    intent.year_max ?? "",
    intent.max_km ?? "",
    intent.price_max ?? "",
  ].join("|");
}

// Adapter registry — add new adapters here
const ADAPTERS: Record<string, () => { search: (intent: ParsedIntent, config: Record<string, unknown>, signal?: AbortSignal) => Promise<AdapterResult[]> }> = {
  internal_db: () => new InternalDbAdapter(),
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

  // Parse body
  let body: {
    instruction?: string;
    account_id?: string;
    initiated_by?: string;
    internal_count?: number;
    urgency?: string;
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
  const internalCount = body.internal_count ?? 0;
  const urgency = body.urgency ?? "normal";

  // ── Demand gating ──
  if (internalCount >= 5 && urgency !== "high") {
    // Log gated run
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId,
        initiated_by: initiatedBy,
        instruction,
        parsed_intent: {},
        sources_queried: [],
        gated: true,
        gate_reason: `${internalCount} internal results — external search skipped`,
        status: "gated",
        duration_ms: Date.now() - startMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: `${internalCount} internal results found — external search skipped`,
      results: [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── Quota check ──
  const quota = await checkQuota(accountId, initiatedBy);
  if (!quota.allowed) {
    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId,
        initiated_by: initiatedBy,
        instruction,
        parsed_intent: {},
        sources_queried: [],
        gated: true,
        gate_reason: quota.reason,
        quota_snapshot: quota.entitlement ? {
          used: quota.entitlement.searches_used_today,
          max: quota.entitlement.max_searches_per_day,
          tier: quota.entitlement.plan_tier,
        } : null,
        status: "gated",
        duration_ms: Date.now() - startMs,
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: true,
      reason: quota.reason,
      results: [],
      quota: quota.entitlement ? {
        used: quota.entitlement.searches_used_today,
        max: quota.entitlement.max_searches_per_day,
        tier: quota.entitlement.plan_tier,
      } : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

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

  // ── Cache check ──
  const cacheKey = buildCacheKey(intent);
  const { data: cached } = await sb
    .from("search_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .eq("source", "outward")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (cached) {
    await sb.from("search_cache").update({ hits: (cached.hits || 0) + 1 }).eq("id", cached.id);

    try {
      await sb.from("outward_search_runs").insert({
        account_id: accountId,
        initiated_by: initiatedBy,
        instruction,
        parsed_intent: intent,
        sources_queried: [],
        total_results: (cached.results as any[])?.length ?? 0,
        cache_hit: true,
        status: "completed",
        duration_ms: Date.now() - startMs,
        completed_at: new Date().toISOString(),
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({
      status: "ok", gated: false, cached: true,
      intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
      results: cached.results,
      total_filtered: (cached.results as any[])?.length ?? 0,
      duration_ms: Date.now() - startMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── Dispatch to adapters ──
  const allResults: AdapterResult[] = [];
  const resultsBySource: Record<string, number> = {};
  const sourcesQueried: string[] = [];

  for (const source of quota.eligible_sources) {
    const adapterFactory = ADAPTERS[source.adapter_type];
    if (!adapterFactory) {
      console.warn(`No adapter for type: ${source.adapter_type} (source: ${source.source})`);
      continue;
    }

    try {
      const adapter = adapterFactory();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const results = await adapter.search(intent, source.config || {}, controller.signal);
      clearTimeout(timeout);

      allResults.push(...results);
      resultsBySource[source.source] = results.length;
      sourcesQueried.push(source.source);

      // Update source health
      await sb.from("source_registry").update({
        last_success_at: new Date().toISOString(),
        consecutive_failures: 0,
      }).eq("source", source.source);
    } catch (err) {
      console.error(`Adapter error for ${source.source}:`, err);
      resultsBySource[source.source] = 0;
      sourcesQueried.push(source.source);

      // Track failures
      await sb.from("source_registry").update({
        last_error_at: new Date().toISOString(),
        last_error: String(err),
        consecutive_failures: (source.consecutive_failures || 0) + 1,
      }).eq("source", source.source);
    }
  }

  // ── Sort and cap ──
  allResults.sort((a, b) => b.score - a.score || (a.effective_cost ?? Infinity) - (b.effective_cost ?? Infinity));
  const topResults = allResults.slice(0, MAX_RESULTS);
  const durationMs = Date.now() - startMs;

  // ── Increment usage ──
  if (accountId && initiatedBy === "user") {
    await incrementUsage(accountId);
  }

  // ── Write cache ──
  try {
    await sb.from("search_cache").upsert({
      cache_key: cacheKey,
      make: intent.make,
      model: intent.model,
      badge: intent.badge,
      year_min: intent.year_min,
      year_max: intent.year_max,
      max_km: intent.max_km,
      price_max: intent.price_max,
      results: topResults,
      source: "outward",
    }, { onConflict: "cache_key" });
  } catch (e) {
    console.warn("Cache write failed:", e);
  }

  // ── Log telemetry ──
  try {
    await sb.from("outward_search_runs").insert({
      account_id: accountId,
      initiated_by: initiatedBy,
      instruction,
      parsed_intent: intent,
      sources_queried: sourcesQueried,
      total_results: topResults.length,
      results_by_source: resultsBySource,
      cache_hit: false,
      status: "completed",
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      quota_snapshot: quota.entitlement ? {
        used: quota.entitlement.searches_used_today,
        max: quota.entitlement.max_searches_per_day,
        tier: quota.entitlement.plan_tier,
      } : null,
    });
  } catch (_) { /* swallow */ }

  return new Response(JSON.stringify({
    status: "ok",
    gated: false,
    cached: false,
    intent: { make: intent.make, model_keywords: intent.model ? [intent.model] : [], badge: intent.badge, year: intent.year_min, max_km: intent.max_km, price_max: intent.price_max },
    results: topResults,
    total_searched: allResults.length,
    total_filtered: topResults.length,
    sources_queried: sourcesQueried,
    results_by_source: resultsBySource,
    duration_ms: durationMs,
    quota: quota.entitlement ? {
      used: (quota.entitlement.searches_used_today || 0) + 1,
      max: quota.entitlement.max_searches_per_day,
      tier: quota.entitlement.plan_tier,
    } : null,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
