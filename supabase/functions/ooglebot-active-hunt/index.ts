/**
 * ooglebot-active-hunt — On-Demand Market Hunt Orchestrator
 *
 * When OogleBot finds thin coverage, this function fans out to the
 * sources that can materially widen supply right now:
 *   - Carsales (queued Apify run)
 *   - AutoTrader API ingest (synchronous)
 *   - Pickles harvest (best-effort async)
 *   - Manheim crawl (synchronous)
 *   - Slattery crawl (synchronous)
 *   - CaroogleAI discovery (best-effort)
 *
 * Returns:
 *   - hunt_id
 *   - queued source ids the UI can poll
 *   - sync sources that require a final re-query even if queue rows stay at 0
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface HuntIntent {
  make: string;
  model: string;
  badge?: string | null;
  year_min?: number | null;
  year_max?: number | null;
  km_max?: number | null;
  price_max?: number | null;
  state?: string | null;
}

interface DispatchOutcome {
  source: string;
  ok: boolean;
  mode: "queued" | "sync" | "async";
  queue_id?: string;
  error?: string;
}

function carsalesSlug(str: string): string {
  return str.trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function buildCarsalesUrl(intent: HuntIntent): string {
  const parts: string[] = [];
  parts.push(`Make.${carsalesSlug(intent.make)}`);
  if (intent.model) parts.push(`Model.${carsalesSlug(intent.model)}`);
  if (intent.year_min && intent.year_max) {
    parts.push(`Year.range(${intent.year_min}..${intent.year_max})`);
  } else if (intent.year_min) {
    parts.push(`Year.range(${intent.year_min}..)`);
  }
  if (intent.km_max) parts.push(`Odometer.range(..${intent.km_max})`);
  if (intent.state) parts.push(`State.${intent.state.toUpperCase()}`);
  const q = `(And.${parts.join("._.")})`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~Price`;
}

function buildAutotraderSearch(intent: HuntIntent): string {
  return `${intent.make} ${intent.model}${intent.badge ? ` ${intent.badge}` : ""}`.trim();
}

async function readJsonSafe(resp: Response): Promise<Record<string, any> | null> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function dispatchCarsales(
  sbUrl: string,
  sbKey: string,
  intent: HuntIntent,
): Promise<DispatchOutcome> {
  try {
    const url = buildCarsalesUrl(intent);
    const resp = await fetch(`${sbUrl}/functions/v1/carsales-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({ startUrls: [{ url }], limit: 60 }),
    });
    const data = await readJsonSafe(resp);
    if (data?.ok && data?.status === "launched" && data?.queue_id) {
      return { source: "carsales", ok: true, mode: "queued", queue_id: data.queue_id };
    }
    return { source: "carsales", ok: false, mode: "queued", error: data?.detail || data?.status || data?.error || `HTTP ${resp.status}` };
  } catch (e) {
    return { source: "carsales", ok: false, mode: "queued", error: String(e) };
  }
}

async function dispatchAutotrader(
  sbUrl: string,
  intent: HuntIntent,
): Promise<DispatchOutcome> {
  try {
    const internalSecret = Deno.env.get("AUTOTRADER_INTERNAL_SECRET");
    if (!internalSecret) {
      return { source: "autotrader", ok: false, mode: "sync", error: "AUTOTRADER_INTERNAL_SECRET missing" };
    }

    const resp = await fetch(`${sbUrl}/functions/v1/autotrader-api-ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify({
        make: intent.make,
        model: buildAutotraderSearch(intent),
        state: intent.state || null,
        year_min: intent.year_min || 2016,
        year_max: intent.year_max || null,
        max_pages: 4,
      }),
    });

    const data = await readJsonSafe(resp);
    if (resp.ok && data?.success) {
      return { source: "autotrader", ok: true, mode: "sync" };
    }

    return {
      source: "autotrader",
      ok: false,
      mode: "sync",
      error: data?.error || `HTTP ${resp.status}`,
    };
  } catch (e) {
    return { source: "autotrader", ok: false, mode: "sync", error: String(e) };
  }
}

async function dispatchPickles(
  sbUrl: string,
  sbKey: string,
  intent: HuntIntent,
): Promise<DispatchOutcome> {
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/pickles-search-harvest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({
        make: intent.make,
        model: intent.model,
        year_min: intent.year_min || 2016,
        max_pages: 3,
      }),
    });
    const data = await readJsonSafe(resp);
    if (resp.ok && data?.success) {
      return { source: "pickles", ok: true, mode: "async" };
    }
    return {
      source: "pickles",
      ok: false,
      mode: "async",
      error: data?.error || `HTTP ${resp.status}`,
    };
  } catch (e) {
    return { source: "pickles", ok: false, mode: "async", error: String(e) };
  }
}

async function dispatchManheim(
  sbUrl: string,
  sbKey: string,
): Promise<DispatchOutcome> {
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/manheim-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({ mode: "discover" }),
    });
    const data = await readJsonSafe(resp);
    if (resp.ok && data?.success) {
      return { source: "manheim", ok: true, mode: "sync" };
    }
    return {
      source: "manheim",
      ok: false,
      mode: "sync",
      error: data?.error || `HTTP ${resp.status}`,
    };
  } catch (e) {
    return { source: "manheim", ok: false, mode: "sync", error: String(e) };
  }
}

async function dispatchSlattery(
  sbUrl: string,
  sbKey: string,
): Promise<DispatchOutcome> {
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/slattery-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({}),
    });
    const data = await readJsonSafe(resp);
    if (resp.ok && data?.success) {
      return { source: "slattery", ok: true, mode: "sync" };
    }
    return {
      source: "slattery",
      ok: false,
      mode: "sync",
      error: data?.error || `HTTP ${resp.status}`,
    };
  } catch (e) {
    return { source: "slattery", ok: false, mode: "sync", error: String(e) };
  }
}

async function dispatchCaroogleAI(
  sbUrl: string,
  sbKey: string,
  intent: HuntIntent,
): Promise<DispatchOutcome> {
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/valo-perplexity-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({
        intent: {
          make: intent.make.toUpperCase(),
          model: intent.model.toUpperCase(),
          badge: intent.badge?.toUpperCase() || null,
          year_min: intent.year_min,
          year_max: intent.year_max,
          max_km: intent.km_max,
          price_max: intent.price_max,
          state: intent.state || null,
        },
      }),
    });
    const data = await readJsonSafe(resp);
    if (resp.ok) {
      return { source: "caroogleai", ok: true, mode: "sync" };
    }
    return { source: "caroogleai", ok: false, mode: "sync", error: data?.error || `HTTP ${resp.status}` };
  } catch (e) {
    return { source: "caroogleai", ok: false, mode: "sync", error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return respond(405, { status: "error", error: "Method not allowed" });
  }

  const startMs = Date.now();
  const sbUrl = Deno.env.get("SUPABASE_URL")!;
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(sbUrl, sbKey);

  let body: {
    make?: string;
    model?: string;
    badge?: string | null;
    year_min?: number | null;
    year_max?: number | null;
    km_max?: number | null;
    price_max?: number | null;
    state?: string | null;
    account_id?: string | null;
    initiated_by?: string;
    internal_count?: number;
  };

  try {
    body = await req.json();
  } catch {
    return respond(400, { status: "error", error: "Invalid JSON" });
  }

  const make = (body.make || "").trim();
  const model = (body.model || "").trim();
  if (!make || !model) {
    return respond(400, { status: "error", error: "make and model required" });
  }

  const intent: HuntIntent = {
    make,
    model,
    badge: body.badge || null,
    year_min: body.year_min || null,
    year_max: body.year_max || null,
    km_max: body.km_max || null,
    price_max: body.price_max || null,
    state: body.state || null,
  };

  console.log(`[ACTIVE-HUNT] Launching hunt: ${make} ${model} ${intent.badge || ""}`);

  const { data: hunt, error: huntErr } = await sb
    .from("ooglebot_active_hunts")
    .insert({
      account_id: body.account_id || null,
      initiated_by: body.initiated_by || "user",
      make,
      model,
      badge: intent.badge,
      year_min: intent.year_min,
      year_max: intent.year_max,
      km_max: intent.km_max,
      price_max: intent.price_max,
      internal_count: body.internal_count || 0,
      status: "hunting",
      sources_triggered: [],
    })
    .select("id")
    .single();

  if (huntErr || !hunt) {
    console.error("[ACTIVE-HUNT] Failed to create hunt record:", huntErr);
    return respond(500, { status: "error", error: "Failed to create hunt" });
  }

  const huntId = hunt.id;

  const dispatches = await Promise.allSettled([
    dispatchCarsales(sbUrl, sbKey, intent),
    dispatchAutotrader(sbUrl, intent),
    dispatchPickles(sbUrl, sbKey, intent),
    dispatchManheim(sbUrl, sbKey),
    dispatchSlattery(sbUrl, sbKey),
    dispatchCaroogleAI(sbUrl, sbKey, intent),
  ]);

  const sources: string[] = [];
  const queueIds: string[] = [];
  const syncSources: string[] = [];
  const delayedSources: string[] = [];
  const results: DispatchOutcome[] = [];

  for (const dispatched of dispatches) {
    if (dispatched.status !== "fulfilled") continue;
    results.push(dispatched.value);

    if (!dispatched.value.ok) continue;
    sources.push(dispatched.value.source);
    if (dispatched.value.queue_id) queueIds.push(dispatched.value.queue_id);
    if (dispatched.value.mode === "sync") syncSources.push(dispatched.value.source);
    if (dispatched.value.mode === "async") delayedSources.push(dispatched.value.source);
  }

  console.log(`[ACTIVE-HUNT] Triggered: ${sources.join(", ") || "none"}`);
  console.log(`[ACTIVE-HUNT] Failures: ${results.filter((r) => !r.ok).map((r) => `${r.source}: ${r.error}`).join("; ") || "none"}`);

  await sb
    .from("ooglebot_active_hunts")
    .update({
      sources_triggered: sources,
      apify_queue_ids: queueIds,
    })
    .eq("id", huntId);

  const durationMs = Date.now() - startMs;

  return respond(200, {
    status: "ok",
    hunt_id: huntId,
    sources_triggered: sources,
    sync_sources_triggered: syncSources,
    delayed_sources_triggered: delayedSources,
    sources_failed: results.filter((r) => !r.ok).map((r) => ({ source: r.source, error: r.error })),
    apify_queue_ids: queueIds,
    duration_ms: durationMs,
  });
});