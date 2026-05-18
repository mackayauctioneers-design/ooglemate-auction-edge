/**
 * arby-dealer-profile-intake — Receives OpenClaw/Arby's dealer profiling results
 * and upserts dealer fingerprints. Replaces the Lindy SMTP path.
 *
 * Auth: Authorization: Bearer <ARBY_INGEST_KEY>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const expected = Deno.env.get("ARBY_INGEST_KEY");
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const {
    dealer_profile_id,
    dealer_name,
    primary_makes = [],
    top_models = [],
    price_band,
    km_band,
    year_band,
    vehicle_segments = [],
    dealer_type,
    inventory_sample_size,
    confidence,
    location,
    status: agentStatus,
    error_message,
  } = payload;

  if (agentStatus === "failed") {
    console.error(`[arby-intake] Agent failed for ${dealer_name}: ${error_message}`);
    return new Response(
      JSON.stringify({ status: "acknowledged", agent_status: "failed", error_message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!dealer_profile_id || !dealer_name) {
    return new Response(
      JSON.stringify({ error: "dealer_profile_id and dealer_name are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  console.log(`[arby-intake] ${dealer_name} (${dealer_profile_id}) — makes: ${primary_makes.join(",")} | models: ${top_models.join(",")} | conf: ${confidence}`);

  // dealer_profile_id may arrive as a UUID or as a slug (e.g. "patrick_auto_group").
  // The DB column is uuid, so resolve slug -> UUID via dealer_name lookup; null if not found.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const slug = String(dealer_profile_id);
  let resolvedProfileUuid: string | null = UUID_RE.test(slug) ? slug : null;

  if (!resolvedProfileUuid) {
    const { data: prof } = await sb
      .from("dealer_profiles")
      .select("id")
      .ilike("dealer_name", dealer_name)
      .maybeSingle();
    if (prof?.id) {
      resolvedProfileUuid = prof.id;
      console.log(`[arby-intake] Resolved slug "${slug}" -> uuid ${resolvedProfileUuid} via dealer_name`);
    } else {
      console.warn(`[arby-intake] Could not resolve slug "${slug}" to a dealer_profiles.id — storing fingerprints with dealer_profile_id=null`);
    }
  }

  const fingerprints: any[] = [];
  for (const make of primary_makes) {
    const modelsForMake = top_models.length > 0 ? top_models : ["ALL"];
    for (const model of modelsForMake) {
      fingerprints.push({
        fingerprint_id: `auto-${slug}-${make}-${model}`.toLowerCase().replace(/\s+/g, "-"),
        dealer_name,
        dealer_profile_id: resolvedProfileUuid,
        make: String(make).toUpperCase(),
        model: String(model).toUpperCase(),
        year_min: year_band?.min || 2018,
        year_max: year_band?.max || new Date().getFullYear(),
        min_km: km_band?.min || null,
        max_km: km_band?.max || null,
        is_active: true,
        is_spec_only: true,
      });
    }
  }

  if (fingerprints.length === 0) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "No primary_makes in payload" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data, error } = await sb
    .from("dealer_fingerprints")
    .upsert(fingerprints, { onConflict: "fingerprint_id" })
    .select("id, fingerprint_id");

  if (error) {
    console.error("[arby-intake] Upsert error:", error);
    return new Response(
      JSON.stringify({ error: "Fingerprint upsert failed", detail: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[arby-intake] Created ${data?.length || 0} fingerprints for ${dealer_name}`);

  return new Response(
    JSON.stringify({
      status: "ok",
      fingerprints_created: data?.length || 0,
      dealer_profile_id,
      dealer_name,
      confidence,
      dealer_type,
      vehicle_segments,
      location: location || null,
      inventory_sample_size: inventory_sample_size || null,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
