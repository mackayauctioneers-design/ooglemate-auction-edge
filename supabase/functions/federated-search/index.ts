/**
 * federated-search
 *
 * Strict, dealer-safe federated outward search.
 *
 *   L1 internal index   → vehicle_listings (always)
 *   L2 operator shadow  → vehicle_listings WHERE source IN ('autograb', ...)
 *                          (provenance stripped for dealer UI)
 *   L3 outward live     → currently delegates to run-outward-search-v2 if
 *                          enabled in body.allow_outward. (kept narrow to
 *                          avoid duplicating browser worker infra.)
 *
 * Every candidate runs through normalize → gates → classify, and the full
 * decision trace is persisted to `outward_search_decisions` for operator
 * debug. Only `exact_match` (+ `near_match` if business rule allows) is
 * surfaced to dealer-facing callers.
 *
 * AI is constrained: intent parser may use Gemini as fallback (strict-intent),
 * field extraction may use Gemini when raw fields are missing
 * (gemini-extract). Neither is allowed to authorise an inclusion decision.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createTaxonomyDeps } from "../_shared/taxonomy/taxonomyRepo.ts";
import { parseStrictIntent, type StrictIntent } from "../_shared/outward-search/strict-intent.ts";
import { normalizeCandidate, type RawSourceRow } from "../_shared/outward-search/normalize-candidate.ts";
import { classify, type Bucket } from "../_shared/outward-search/classifier.ts";
import { EXCLUDED_LIFECYCLE } from "../_shared/outward-search/types.ts";

const SHADOW_SOURCES = ["autograb"];
const TIME_BUDGET_MS = 25_000;

interface FederatedRequest {
  query: string;
  account_id?: string | null;
  initiated_by?: string | null;
  allow_outward?: boolean;
  include_ambiguous?: boolean; // operator only
  near_match_min_confidence?: number; // default 75
}

interface DealerResult {
  source: string;
  layer: "internal" | "shadow" | "outward";
  bucket: Bucket;
  confidence: number;
  make: string | null;
  model: string | null;
  variant: string | null;
  series: string | null;
  body_type: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  url: string | null;
}

async function searchLayer(
  sb: ReturnType<typeof createClient>,
  intent: StrictIntent,
  layer: "internal" | "shadow",
): Promise<RawSourceRow[]> {
  if (!intent.make) return [];
  let q = sb
    .from("vehicle_listings")
    .select(`id, listing_id, source, source_class, make, model,
             variant_raw, variant_family, variant_used, year, km,
             asking_price, location, state, listing_url, lifecycle_state,
             auction_house, first_seen_at, is_dealer_grade,
             drivetrain, fuel, transmission`)
    .ilike("make", `%${intent.make}%`)
    .not("lifecycle_state", "in", `(${EXCLUDED_LIFECYCLE.map(s => `"${s}"`).join(",")})`)
    .order("asking_price", { ascending: true, nullsFirst: false })
    .limit(200);

  if (intent.model) q = q.ilike("model", `%${intent.model}%`);
  if (intent.year_min) q = q.gte("year", intent.year_min);
  if (intent.year_max) q = q.lte("year", intent.year_max);
  if (intent.max_km) q = q.lte("km", intent.max_km);
  if (intent.price_max) q = q.lte("asking_price", intent.price_max);
  if (intent.state) q = q.eq("state", intent.state);

  if (layer === "shadow") q = q.in("source", SHADOW_SOURCES);
  else q = q.not("source", "in", `(${SHADOW_SOURCES.map(s => `"${s}"`).join(",")})`);

  const { data, error } = await q;
  if (error) {
    console.error(`[federated-search] ${layer} query failed:`, error.message);
    return [];
  }

  return (data ?? []).map((r: any) => ({
    source: r.source,
    layer,
    make: r.make,
    model: r.model,
    variant: r.variant_used ?? r.variant_family ?? r.variant_raw,
    year: r.year,
    km: r.km,
    price: r.asking_price,
    url: r.listing_url,
    title: `${r.year ?? ""} ${r.make ?? ""} ${r.model ?? ""} ${r.variant_used ?? r.variant_family ?? r.variant_raw ?? ""}`.trim(),
    description: null,
    state: r.state,
    lifecycle_state: r.lifecycle_state,
    drivetrain: r.drivetrain,
    fuel: r.fuel,
    transmission: r.transmission,
  }));
}

function toDealerResult(
  candidate: Awaited<ReturnType<typeof normalizeCandidate>>,
  classification: ReturnType<typeof classify>,
): DealerResult {
  return {
    source: candidate.source,
    layer: candidate.layer,
    bucket: classification.bucket,
    confidence: classification.confidence_score,
    make: candidate.make,
    model: candidate.model,
    variant: candidate.variant,
    series: candidate.series,
    body_type: candidate.body_type,
    year: candidate.year,
    km: candidate.km,
    price: candidate.price,
    url: candidate.url,
  };
}

function stripShadowProvenance(r: DealerResult): DealerResult {
  if (r.layer !== "shadow") return r;
  return { ...r, source: "market_index" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const t0 = Date.now();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";

  let body: FederatedRequest;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const minNearConf = body.near_match_min_confidence ?? 75;

  // ─── 1. Parse intent ───────────────────────────────────────────────
  const intent = await parseStrictIntent(query, apiKey);

  // Hard-fail: no make detected → can't search safely
  if (!intent.make) {
    return new Response(JSON.stringify({
      status: "ambiguous_query",
      intent,
      results: [],
      reason: "could not identify make — please clarify",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Constrained mode if low confidence — skip outward layer
  const constrained = intent.overall_confidence < 0.6 || intent.ambiguous_tokens.length > 0;
  const allowOutward = !!body.allow_outward && !constrained;

  // ─── 2. Run layers ─────────────────────────────────────────────────
  const taxonomyDeps = createTaxonomyDeps(sb);
  const layersRaw: RawSourceRow[] = [];

  const [internal, shadow] = await Promise.all([
    searchLayer(sb, intent, "internal"),
    searchLayer(sb, intent, "shadow"),
  ]);
  layersRaw.push(...internal, ...shadow);

  // L3 outward — only invoked if explicitly allowed and we still have budget
  if (allowOutward && Date.now() - t0 < TIME_BUDGET_MS) {
    try {
      const r = await sb.functions.invoke("run-outward-search-v2", {
        body: {
          instruction: query,
          account_id: body.account_id,
          initiated_by: body.initiated_by ?? "federated-search",
        },
      });
      const items: any[] = r.data?.results ?? [];
      for (const x of items) {
        layersRaw.push({
          source: x.source ?? "outward",
          layer: "outward",
          make: x.make ?? intent.make,
          model: x.model ?? intent.model,
          variant: x.variant ?? null,
          year: x.year ?? null,
          km: x.km ?? null,
          price: x.price ?? null,
          url: x.url ?? null,
          title: x.title ?? null,
          description: x.description ?? null,
        });
      }
    } catch (e) {
      console.warn("[federated-search] outward invoke failed:", e);
    }
  }

  // ─── 3. Normalize + classify ───────────────────────────────────────
  const decisions: Array<{
    candidate: Awaited<ReturnType<typeof normalizeCandidate>>;
    classification: ReturnType<typeof classify>;
  }> = [];
  for (const raw of layersRaw) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    try {
      const c = await normalizeCandidate(raw, taxonomyDeps);
      const cls = classify(intent, c);
      decisions.push({ candidate: c, classification: cls });
    } catch (e) {
      console.warn("[federated-search] normalize failed:", e);
    }
  }

  // ─── 4. Persist decisions (best-effort) ────────────────────────────
  const runId = crypto.randomUUID();
  const rows = decisions.map(({ candidate, classification }) => ({
    search_run_id: runId,
    source: candidate.source,
    layer: candidate.layer,
    raw: candidate.raw as any,
    normalized: {
      make: candidate.make, model: candidate.model, variant: candidate.variant,
      series: candidate.series, body_type: candidate.body_type,
      year: candidate.year, km: candidate.km, price: candidate.price,
      identity_confidence: candidate.identity_confidence,
    },
    bucket: classification.bucket,
    confidence_score: classification.confidence_score,
    rules_fired: classification.rules_fired,
    rejection_reason: classification.rejection_reason,
    ai_assisted: intent.used_ai,
  }));
  if (rows.length) {
    sb.from("outward_search_decisions").insert(rows).then(({ error }) => {
      if (error) console.warn("[federated-search] decision insert failed:", error.message);
    });
  }

  // ─── 5. Bucket + return ────────────────────────────────────────────
  const buckets = { exact_match: [] as DealerResult[], near_match: [] as DealerResult[], ambiguous: [] as DealerResult[], rejected: [] as DealerResult[] };
  for (const { candidate, classification } of decisions) {
    const r = stripShadowProvenance(toDealerResult(candidate, classification));
    buckets[classification.bucket].push(r);
  }

  const dealerResults = [
    ...buckets.exact_match,
    ...buckets.near_match.filter(r => r.confidence >= minNearConf),
  ].sort((a, b) => b.confidence - a.confidence || (a.price ?? Infinity) - (b.price ?? Infinity));

  return new Response(JSON.stringify({
    status: "ok",
    run_id: runId,
    intent,
    constrained_mode: constrained,
    counts: {
      exact_match: buckets.exact_match.length,
      near_match: buckets.near_match.length,
      ambiguous: buckets.ambiguous.length,
      rejected: buckets.rejected.length,
    },
    results: dealerResults,
    // operator surfaces can opt-in to see everything
    operator: body.include_ambiguous ? buckets : undefined,
    duration_ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
