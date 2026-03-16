/**
 * ooglebot-active-hunt — On-Demand Scraper Orchestrator
 *
 * When OogleBot finds < MIN_RESULTS in the internal database,
 * this function fires scrapers across multiple marketplaces:
 *   - Carsales (via carsales-scan)
 *   - Autotrader (via autotrader-ingest)
 *   - Pickles (via pickles-search-harvest)
 *   - Slattery (via slattery-scan)
 *   - Gumtree (via gumtree-scan)
 *   - CaroogleAI (via valo-perplexity-scan)
 *
 * Each scraper queues results into apify_runs_queue → autotrader-fetch
 * processes them → market_listings gets populated.
 *
 * Returns a hunt_id for the UI to poll progress.
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

// ─── URL Builders ────────────────────────────────────────────────────────────

function carsalesSlug(str: string): string {
  return str.trim().split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
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
  return `${intent.make} ${intent.model}${intent.badge ? " " + intent.badge : ""}`.trim();
}

// ─── Scraper Dispatchers ─────────────────────────────────────────────────────

async function dispatchCarsales(
  sbUrl: string, sbKey: string, intent: HuntIntent
): Promise<{ source: string; ok: boolean; queue_id?: string; error?: string }> {
  try {
    const url = buildCarsalesUrl(intent);
    const resp = await fetch(`${sbUrl}/functions/v1/carsales-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({ startUrls: [{ url }], limit: 60 }),
    });
    const data = await resp.json();
    if (data.ok && data.status === "launched") {
      return { source: "carsales", ok: true, queue_id: data.queue_id };
    }
    return { source: "carsales", ok: false, error: data.status || data.error };
  } catch (e) {
    return { source: "carsales", ok: false, error: String(e) };
  }
}

async function dispatchAutotrader(
  sbUrl: string, sbKey: string, intent: HuntIntent
): Promise<{ source: string; ok: boolean; queue_id?: string; error?: string }> {
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/autotrader-ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({
        search: buildAutotraderSearch(intent),
        year_min: intent.year_min || 2016,
        limit: 100,
      }),
    });
    const data = await resp.json();
    if (data.queue_id) {
      return { source: "autotrader", ok: true, queue_id: data.queue_id };
    }
    return { source: "autotrader", ok: false, error: data.error || "no queue_id" };
  } catch (e) {
    return { source: "autotrader", ok: false, error: String(e) };
  }
}

async function dispatchGumtree(
  sbUrl: string, sbKey: string, intent: HuntIntent
): Promise<{ source: string; ok: boolean; queue_id?: string; error?: string }> {
  try {
    const makeSlug = intent.make.toLowerCase().replace(/\s+/g, "-");
    const modelSlug = intent.model.toLowerCase().replace(/\s+/g, "-");
    const searchUrl = `https://www.gumtree.com.au/s-cars-vans-utes/australia/carmake-${makeSlug}/carmodel-${makeSlug}_${modelSlug}/c18320?pageSize=96${intent.year_min ? `&caryear=${intent.year_min}` : ""}`;

    const resp = await fetch(`${sbUrl}/functions/v1/gumtree-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({ startUrls: [{ url: searchUrl }], limit: 60 }),
    });
    const data = await resp.json();
    if (data.ok || data.queue_id) {
      return { source: "gumtree", ok: true, queue_id: data.queue_id };
    }
    return { source: "gumtree", ok: false, error: data.status || data.error };
  } catch (e) {
    return { source: "gumtree", ok: false, error: String(e) };
  }
}

async function dispatchSlattery(
  sbUrl: string, sbKey: string
): Promise<{ source: string; ok: boolean; queue_id?: string; error?: string }> {
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/slattery-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
      body: JSON.stringify({ mode: "stub", maxPages: 5 }),
    });
    const data = await resp.json();
    if (data.ok || data.queue_id) {
      return { source: "slattery", ok: true, queue_id: data.queue_id };
    }
    return { source: "slattery", ok: false, error: data.status || data.error };
  } catch (e) {
    return { source: "slattery", ok: false, error: String(e) };
  }
}

async function dispatchCaroogleAI(
  sbUrl: string, sbKey: string, intent: HuntIntent
): Promise<{ source: string; ok: boolean; error?: string }> {
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
    if (resp.ok) {
      return { source: "caroogleai", ok: true };
    }
    return { source: "caroogleai", ok: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { source: "caroogleai", ok: false, error: String(e) };
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

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

  // Create hunt record
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

  // ── Fire all scrapers in parallel ──
  const dispatches = await Promise.allSettled([
    dispatchCarsales(sbUrl, sbKey, intent),
    dispatchAutotrader(sbUrl, sbKey, intent),
    dispatchGumtree(sbUrl, sbKey, intent),
    dispatchSlattery(sbUrl, sbKey),
    dispatchCaroogleAI(sbUrl, sbKey, intent),
  ]);

  const sources: string[] = [];
  const queueIds: string[] = [];
  const results: Array<{ source: string; ok: boolean; queue_id?: string; error?: string }> = [];

  for (const d of dispatches) {
    if (d.status === "fulfilled") {
      results.push(d.value);
      if (d.value.ok) {
        sources.push(d.value.source);
        if (d.value.queue_id) queueIds.push(d.value.queue_id);
      }
    }
  }

  console.log(`[ACTIVE-HUNT] ${sources.length} sources triggered: ${sources.join(", ")}`);
  console.log(`[ACTIVE-HUNT] Failures: ${results.filter(r => !r.ok).map(r => `${r.source}: ${r.error}`).join("; ") || "none"}`);

  // Update hunt record with triggered sources
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
    sources_failed: results.filter(r => !r.ok).map(r => ({ source: r.source, error: r.error })),
    apify_queue_ids: queueIds,
    duration_ms: durationMs,
  });
});
