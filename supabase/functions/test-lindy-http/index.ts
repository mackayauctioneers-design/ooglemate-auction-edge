/**
 * test-lindy-http — Proof-of-concept: Lindy via HTTP Webhook (no email)
 *
 * Flow:
 *   1. POST intent to this function
 *   2. This function creates an outward_job + queue row
 *   3. POSTs the browse task to Lindy's HTTP Webhook URL
 *   4. Lindy browses, extracts listings
 *   5. Lindy POSTs results back to lindy-results-webhook (existing)
 *
 * Required secrets:
 *   - LINDY_HTTP_WEBHOOK_URL — the HTTP trigger URL from your Lindy agent
 *   - LINDY_WEBHOOK_SECRET   — shared secret for callback signature (already exists)
 *
 * Test with:
 *   curl -X POST <SUPABASE_URL>/functions/v1/test-lindy-http \
 *     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"make":"Toyota","model":"HiLux","badge":"SR5","year_min":2019,"year_max":2023,"max_km":120000,"source":"carsales"}'
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Source URL builders (same logic as lindy-dispatch, but inline for PoC) ──

type SourceKey = "carsales" | "carsguide" | "gumtree" | "autotrader" | "drive";

interface Intent {
  make: string;
  model?: string;
  badge?: string;
  year_min?: number;
  year_max?: number;
  max_km?: number;
  price_max?: number;
}

const URL_BUILDERS: Record<SourceKey, (i: Intent) => string | null> = {
  carsales: (i) => {
    const params = new URLSearchParams();
    params.set("q", `(And.Service.carsales._(C.Make.${i.make}._.Model.${i.model || ""}.))` );
    if (i.year_min) params.set("yearFrom", String(i.year_min));
    if (i.year_max) params.set("yearTo", String(i.year_max));
    if (i.max_km) params.set("odometersMax", String(i.max_km));
    if (i.price_max) params.set("priceTo", String(i.price_max));
    return `https://www.carsales.com.au/cars/?${params}`;
  },
  carsguide: (i) => {
    let url = `https://www.carsguide.com.au/buy-a-car/${i.make.toLowerCase()}`;
    if (i.model) url += `/${i.model.toLowerCase()}`;
    const params = new URLSearchParams();
    if (i.year_min) params.set("year_from", String(i.year_min));
    if (i.year_max) params.set("year_to", String(i.year_max));
    if (i.max_km) params.set("max_km", String(i.max_km));
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  },
  gumtree: (i) => {
    const q = [i.make, i.model, i.badge].filter(Boolean).join(" ");
    const params = new URLSearchParams({ search_query: q });
    if (i.price_max) params.set("price_max", String(i.price_max));
    return `https://www.gumtree.com.au/s-cars-vans-utes/c18320?${params}`;
  },
  autotrader: (i) => {
    const params = new URLSearchParams({
      make: i.make.toLowerCase(),
      sourceCondition: "1:Used",
      sortBy: "price",
      orderBy: "asc",
    });
    if (i.model) params.set("model", i.model.toLowerCase());
    if (i.year_min) params.set("yearFrom", String(i.year_min));
    if (i.year_max) params.set("yearTo", String(i.year_max));
    if (i.max_km) params.set("odometerMax", String(i.max_km));
    return `https://www.autotrader.com.au/cars-for-sale?${params}`;
  },
  drive: (i) => {
    const params = new URLSearchParams({ make: i.make.toLowerCase(), sort: "price" });
    if (i.model) params.set("model", i.model.toLowerCase());
    if (i.year_min) params.set("year_from", String(i.year_min));
    if (i.year_max) params.set("year_to", String(i.year_max));
    if (i.max_km) params.set("max_km", String(i.max_km));
    return `https://www.drive.com.au/cars-for-sale/?${params}`;
  },
};

// ─── Extraction prompt ──────────────────────────────────────────────────────

function buildPrompt(source: string, url: string, intent: Intent): string {
  const ctx = [
    `Target make: ${intent.make}`,
    intent.model && `Target model: ${intent.model}`,
    intent.badge && `Target badge/variant: ${intent.badge}`,
    intent.year_min && intent.year_max
      ? `Target year range: ${intent.year_min}–${intent.year_max}`
      : intent.year_min ? `Target year from: ${intent.year_min}` : null,
    intent.max_km && `Max odometer: ${intent.max_km.toLocaleString()} km`,
  ].filter(Boolean).join("\n");

  return `Browse this URL and extract all used car listings:
${url}

Search context:
${ctx}

For each listing return a JSON object with: make, model, year, variant, odometer_km, price_asking, listing_url, listing_id, image_url, seller_name.
Return a JSON array of listings. If no listings found, return [].
Extract ONLY listings visible on this page. Do NOT follow pagination.
Strip "$", ",", "AUD" from prices — digits only. Same for odometer — digits only.
If price is "POA" or missing, use null. If odometer missing, use null.`;
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LINDY_URL = Deno.env.get("LINDY_HTTP_WEBHOOK_URL");
  if (!LINDY_URL) {
    return new Response(JSON.stringify({ error: "LINDY_HTTP_WEBHOOK_URL not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/lindy-results-webhook`;

  let body: Intent & { source?: SourceKey };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.make) {
    return new Response(JSON.stringify({ error: "make is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const source: SourceKey = body.source || "carsales";
  const urlBuilder = URL_BUILDERS[source];
  if (!urlBuilder) {
    return new Response(JSON.stringify({ error: `Unknown source: ${source}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const searchUrl = urlBuilder(body);
  if (!searchUrl) {
    return new Response(JSON.stringify({ error: "Could not build search URL" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create DB records
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jobId = crypto.randomUUID();
  const searchRunId = crypto.randomUUID();

  const { error: jobErr } = await sb.from("outward_jobs").insert({
    id: jobId,
    search_run_id: searchRunId,
    source_key: source,
    search_url: searchUrl,
    status: "dispatched",
    dispatched_at: new Date().toISOString(),
  });

  if (jobErr) {
    console.error("[test-lindy-http] Job insert failed:", jobErr);
    return new Response(JSON.stringify({ error: "Job creation failed", detail: jobErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── POST to Lindy HTTP Webhook ──
  // This is the key part: instead of emailing, we POST directly.
  // Lindy receives the task, browses the URL, extracts listings,
  // then POSTs results to our callback URL.
  const prompt = buildPrompt(source, searchUrl, body);
  const lindyPayload = {
    job_id: jobId,
    search_run_id: searchRunId,
    source: source,
    url: searchUrl,
    prompt: prompt,
    callback_url: CALLBACK_URL,
    callback_headers: {
      "x-lindy-signature": Deno.env.get("LINDY_WEBHOOK_SECRET") || "",
      "Content-Type": "application/json",
    },
  };

  console.log(`[test-lindy-http] Dispatching to Lindy: source=${source} url=${searchUrl}`);

  try {
    const resp = await fetch(LINDY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lindyPayload),
    });

    const respText = await resp.text();
    console.log(`[test-lindy-http] Lindy response: ${resp.status} — ${respText.slice(0, 500)}`);

    if (!resp.ok) {
      await sb.from("outward_jobs").update({
        status: "failed",
        error: `Lindy HTTP ${resp.status}: ${respText.slice(0, 200)}`,
      }).eq("id", jobId);

      return new Response(JSON.stringify({
        error: "Lindy dispatch failed",
        lindy_status: resp.status,
        lindy_response: respText.slice(0, 500),
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      status: "dispatched",
      job_id: jobId,
      search_run_id: searchRunId,
      source: source,
      search_url: searchUrl,
      lindy_response: respText.slice(0, 500),
      message: "Job sent to Lindy via HTTP. Results will arrive at lindy-results-webhook.",
      check_results: `Query outward_jobs WHERE id = '${jobId}' — status will change to 'complete' when Lindy responds.`,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[test-lindy-http] Lindy fetch error:", err);
    await sb.from("outward_jobs").update({
      status: "failed",
      error: String(err),
    }).eq("id", jobId);

    return new Response(JSON.stringify({ error: "Lindy unreachable", detail: String(err) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
