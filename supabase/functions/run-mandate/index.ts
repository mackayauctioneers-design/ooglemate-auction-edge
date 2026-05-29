/**
 * run-mandate
 *
 * Single-mandate dispatcher. Called by the UI (operator "Run Now") or by
 * a cron to push one mandate execution job to Arby.
 *
 * Writes a canonical (outward_search_runs, outward_jobs) pair using the
 * v2 schema, then POSTs to Arby with { job_id, mandate_id, callback_url,
 * callback_auth, intent }. Arby calls back into worker-results-webhook,
 * which writes outward_search_results and promotes mandate_feed_items.
 *
 * Auth: relies on verify_jwt = false; expects { mandate_id } in body.
 *       For unauthenticated callers, dealer_id/account_id are derived
 *       from the mandate row, not the caller.
 *
 * Secrets:
 *   ARBY_RUN_MANDATE_URL  — Arby HTTP endpoint (e.g. http://host:port/run-mandate)
 *   ARBY_DISPATCH_KEY     — Bearer token Arby validates inbound
 *   WORKER_RESULTS_WEBHOOK_SECRET — Bearer Arby uses on callback
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Config
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ARBY_URL =
    Deno.env.get("ARBY_RUN_MANDATE_URL") || Deno.env.get("ARBY_DISPATCH_URL");
  const ARBY_KEY = Deno.env.get("ARBY_DISPATCH_KEY");
  const CALLBACK_SECRET = Deno.env.get("WORKER_RESULTS_WEBHOOK_SECRET");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Supabase env missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!ARBY_URL || !ARBY_KEY) {
    return new Response(
      JSON.stringify({ error: "ARBY_RUN_MANDATE_URL or ARBY_DISPATCH_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!CALLBACK_SECRET) {
    return new Response(
      JSON.stringify({ error: "WORKER_RESULTS_WEBHOOK_SECRET not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse body
  let body: { mandate_id?: string; source?: string; initiated_by?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mandateId = body.mandate_id;
  const sourceKey = body.source || "arby";
  const initiatedBy = body.initiated_by || "operator";
  if (!mandateId || typeof mandateId !== "string") {
    return new Response(JSON.stringify({ error: "Missing mandate_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Load mandate from canonical active_mandates
  const { data: mandate, error: mErr } = await sb
    .from("active_mandates")
    .select("*")
    .eq("id", mandateId)
    .maybeSingle();

  if (mErr || !mandate) {
    return new Response(JSON.stringify({ error: "Mandate not found", id: mandateId }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!mandate.is_active) {
    return new Response(JSON.stringify({ error: "Mandate inactive", id: mandateId }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Build canonical intent payload
  const intent = {
    make: mandate.make,
    model: mandate.model,
    variant_family: mandate.variant_family,
    target_variants: mandate.target_variants,
    year_min: mandate.year_min,
    year_max: mandate.year_max,
    km_min: mandate.km_min,
    km_max: mandate.km_max,
    price_max: mandate.price_max,
    buy_price_min: mandate.buy_price_min,
    preferred_body_types: mandate.preferred_body_types,
    preferred_fuel: mandate.preferred_fuel,
    preferred_transmission: mandate.preferred_transmission,
    excluded_makes: mandate.excluded_makes,
    excluded_models: mandate.excluded_models,
    excluded_conditions: mandate.excluded_conditions,
    lane: mandate.lane,
    source_mask: mandate.source_mask,
  };

  // ── 1. Insert outward_search_runs (canonical run header)
  const { data: runRow, error: runErr } = await sb
    .from("outward_search_runs")
    .insert({
      account_id: mandate.account_id,
      initiated_by: initiatedBy,
      instruction: `run-mandate:${mandate.name}`,
      parsed_intent: intent,
      sources_queried: [sourceKey],
      status: "running",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    console.error("[run-mandate] outward_search_runs insert failed:", runErr);
    return new Response(
      JSON.stringify({ error: "Failed to create search run", detail: runErr?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Insert outward_jobs (canonical schema only)
  const callbackUrl = `${SUPABASE_URL}/functions/v1/worker-results-webhook`;
  const today = new Date().toISOString().slice(0, 10);
  const { data: jobRow, error: jobErr } = await sb
    .from("outward_jobs")
    .insert({
      search_run_id: runRow.id,
      account_id: mandate.account_id,
      mandate_id: mandate.id,
      source_key: sourceKey,
      search_url: ARBY_URL,
      intent,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
      dispatch_date: today,
    })
    .select("id")
    .single();

  if (jobErr || !jobRow) {
    console.error("[run-mandate] outward_jobs insert failed:", jobErr);
    await sb
      .from("outward_search_runs")
      .update({
        status: "failed",
        error: `outward_jobs insert: ${jobErr?.message ?? "unknown"}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runRow.id);
    return new Response(
      JSON.stringify({ error: "Failed to create outward job", detail: jobErr?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 3. Dispatch to Arby
  const dispatchPayload = {
    job_id: jobRow.id,
    run_id: runRow.id,
    mandate_id: mandate.id,
    dealer_id: mandate.dealer_id,
    account_id: mandate.account_id,
    source: sourceKey,
    intent,
    callback_url: callbackUrl,
    callback_auth: `Bearer ${CALLBACK_SECRET}`,
  };

  let dispatchOk = false;
  let dispatchStatus = 0;
  let dispatchError: string | null = null;
  try {
    const resp = await fetch(ARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ARBY_KEY}`,
      },
      body: JSON.stringify(dispatchPayload),
    });
    dispatchStatus = resp.status;
    dispatchOk = resp.ok;
    if (!resp.ok) {
      dispatchError = (await resp.text()).slice(0, 500);
    }
  } catch (e) {
    dispatchError = e instanceof Error ? e.message : String(e);
  }

  if (!dispatchOk) {
    console.error(
      `[run-mandate] Arby dispatch failed status=${dispatchStatus} err=${dispatchError}`,
    );
    await sb
      .from("outward_jobs")
      .update({
        status: "failed",
        error: `Arby dispatch failed: status=${dispatchStatus} ${dispatchError ?? ""}`.slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobRow.id);
    await sb
      .from("outward_search_runs")
      .update({
        status: "failed",
        error: `Arby dispatch failed status=${dispatchStatus}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runRow.id);
    return new Response(
      JSON.stringify({
        error: "Arby dispatch failed",
        status: dispatchStatus,
        detail: dispatchError,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 4. Update mandate run-tracking fields
  await sb
    .from("active_mandates")
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: new Date(
        Date.now() + (mandate.run_frequency_minutes || 240) * 60_000,
      ).toISOString(),
    })
    .eq("id", mandate.id);

  console.log(
    `[run-mandate] dispatched job=${jobRow.id} mandate=${mandate.id} source=${sourceKey}`,
  );

  return new Response(
    JSON.stringify({
      status: "dispatched",
      job_id: jobRow.id,
      search_run_id: runRow.id,
      mandate_id: mandate.id,
      callback_url: callbackUrl,
    }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
