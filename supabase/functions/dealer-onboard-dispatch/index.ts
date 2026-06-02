/**
 * dealer-onboard-dispatch — Dispatches a new dealer to Arby (OpenClaw) for auto-profiling.
 *
 * Now:
 *  - Normalizes whatever URL was stored (strips search/listing paths -> bare origin)
 *  - Persists a worker_runs row (action='dealer_profile_intake') for the watchdog
 *  - Increments attempt_n on retries
 *  - POSTs to Arby and marks the worker_runs row as dispatched / failed
 *
 * Arby's registry then picks the correct sitemap. The callback handler
 * (arby-dealer-profile-intake) flips the same worker_runs row to completed.
 */

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SEARCH_PATH_RE = /\/(search|inventory|stock|listings?|used-cars?|pre-?owned|vehicles?)\b/i;

/**
 * Normalize a dealer URL down to the bare origin so Arby's registry-based
 * sitemap lookup wins over auto_detect. Examples:
 *   https://www.illawarratoyota.com.au/search/pre-owned?query=Wollongong
 *     -> https://www.illawarratoyota.com.au
 *   https://patrickauto.com.au/used-cars
 *     -> https://patrickauto.com.au
 */
function normalizeDealerUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    // Drop query, hash, and search-ish paths entirely.
    if (u.search || u.hash || SEARCH_PATH_RE.test(u.pathname)) {
      return `${u.protocol}//${u.host}`;
    }
    // Strip trailing slash for consistency.
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ARBY_DISPATCH_URL = Deno.env.get("ARBY_DISPATCH_URL");
  const ARBY_DISPATCH_KEY = Deno.env.get("ARBY_DISPATCH_KEY");
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/arby-dealer-profile-intake`;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.dealer_profile_id || !body.dealer_name || !body.dealer_website) {
    return new Response(
      JSON.stringify({ error: "dealer_profile_id, dealer_name, and dealer_website are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!ARBY_DISPATCH_URL || !ARBY_DISPATCH_KEY) {
    return new Response(
      JSON.stringify({ error: "ARBY_DISPATCH_URL / ARBY_DISPATCH_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const originalUrl = body.dealer_website as string;
  const normalizedUrl = normalizeDealerUrl(originalUrl);

  // Compute attempt number from prior dispatched/failed rows in last 24h.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: priorAttempts } = await sb
    .from("worker_runs")
    .select("id", { count: "exact", head: true })
    .eq("dealer_id", body.dealer_profile_id)
    .eq("action", "dealer_profile_intake")
    .gte("started_at", since);
  const attempt_n = (priorAttempts ?? 0) + 1;

  const payload = {
    dealer_profile_id: body.dealer_profile_id,
    dealer_name: body.dealer_name,
    website_url: normalizedUrl,
    dealer_email: body.dealer_email || null,
    scope: body.scope || ["inventory", "days_in_stock", "business_analysis"],
    callback_url: CALLBACK_URL,
  };

  // Insert a dispatched run row up-front so the watchdog can see in-flight jobs.
  const { data: runRow } = await sb
    .from("worker_runs")
    .insert({
      dealer_id: body.dealer_profile_id,
      action: "dealer_profile_intake",
      status: "dispatched",
      started_at: new Date().toISOString(),
      attempt_n,
      request_payload: { ...payload, original_url: originalUrl, source: body.source ?? "manual" },
    })
    .select("id")
    .single();

  const runId = runRow?.id ?? null;
  console.log(`[dealer-onboard-dispatch] → Arby: ${body.dealer_name} | ${originalUrl} -> ${normalizedUrl} | attempt ${attempt_n} | run=${runId}`);

  try {
    const res = await fetch(ARBY_DISPATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ARBY_DISPATCH_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(responseText); } catch { parsed = { raw: responseText }; }

    if (!res.ok) {
      console.error(`[dealer-onboard-dispatch] Arby returned ${res.status}:`, responseText);
      if (runId) {
        await sb.from("worker_runs").update({
          status: "failed",
          finished_at: new Date().toISOString(),
          http_status: res.status,
          error: `Arby dispatch failed (${res.status})`,
          response_payload: parsed,
        }).eq("id", runId);
      }
      return new Response(
        JSON.stringify({ error: "Arby dispatch failed", status: res.status, detail: parsed }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (runId) {
      await sb.from("worker_runs").update({
        http_status: res.status,
        response_payload: parsed,
      }).eq("id", runId);
    }

    console.log(`[dealer-onboard-dispatch] Arby accepted ${body.dealer_profile_id}`);

    return new Response(
      JSON.stringify({
        status: "dispatched",
        method: "arby_http",
        dealer_profile_id: body.dealer_profile_id,
        original_url: originalUrl,
        normalized_url: normalizedUrl,
        attempt_n,
        worker_run_id: runId,
        arby_response: parsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const errMsg = String(err);
    const isNetworkError = /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|Connect|timed out|tcp connect/i.test(errMsg);
    console.error("[dealer-onboard-dispatch] HTTP dispatch error:", err);

    if (runId) {
      await sb.from("worker_runs").update({
        status: isNetworkError ? "queued_retry" : "failed",
        finished_at: new Date().toISOString(),
        error: errMsg,
      }).eq("id", runId);
    }

    // Transient infra outage → queue + warn, don't fail the operator action.
    if (isNetworkError) {
      try {
        await sb.from("onboarding_alerts").insert({
          dealer_id: body.dealer_profile_id,
          severity: "warning",
          stage: "dispatch",
          message: `Arby worker unreachable (${errMsg.slice(0, 200)}). Dealer queued; watchdog will retry automatically.`,
        });
      } catch (_) { /* non-fatal */ }

      return new Response(
        JSON.stringify({
          status: "queued_retry",
          method: "arby_http",
          dealer_profile_id: body.dealer_profile_id,
          original_url: originalUrl,
          normalized_url: normalizedUrl,
          attempt_n,
          worker_run_id: runId,
          message: "Arby worker is currently unreachable. Dealer onboarding has been queued and will retry automatically.",
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Arby HTTP dispatch failed", detail: errMsg }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
