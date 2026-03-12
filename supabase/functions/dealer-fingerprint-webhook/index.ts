/**
 * dealer-fingerprint-webhook — Receives Lindy's auto-profiling results
 * and upserts dealer fingerprints into the database.
 *
 * Expected payload from Lindy:
 * {
 *   dealer_profile_id: string,
 *   dealer_name: string,
 *   website: string,
 *   location: { suburb, state, postcode, address },
 *   primary_makes: string[],
 *   top_models: string[],
 *   price_band: { min, max },
 *   km_band: { min, max },
 *   vehicle_segments: string[],
 *   dealer_type: string,
 *   inventory_sample_size: number,
 *   confidence: string,
 *   year_band: { min, max }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lindy-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify Lindy signature if configured
  const secret = Deno.env.get("LINDY_WEBHOOK_SECRET");
  if (secret) {
    const sig = req.headers.get("x-lindy-signature");
    if (sig !== secret) {
      console.warn("[dealer-fingerprint-webhook] Invalid signature");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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
  } = payload;

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

  console.log(`[dealer-fingerprint-webhook] Processing fingerprint for: ${dealer_name} (${dealer_profile_id})`);
  console.log(`[dealer-fingerprint-webhook] Makes: ${primary_makes.join(', ')} | Models: ${top_models.join(', ')}`);

  // Create a fingerprint for each primary make + top model combination
  const fingerprints: any[] = [];

  for (const make of primary_makes) {
    // Find models that match this make (best effort — use all if can't determine)
    const modelsForMake = top_models.length > 0 ? top_models : ['ALL'];

    for (const model of modelsForMake) {
      fingerprints.push({
        fingerprint_id: `auto-${dealer_profile_id}-${make}-${model}`.toLowerCase().replace(/\s+/g, '-'),
        dealer_name,
        dealer_profile_id,
        make: make.toUpperCase(),
        model: model.toUpperCase(),
        year_min: year_band?.min || 2018,
        year_max: year_band?.max || new Date().getFullYear(),
        min_km: km_band?.min || null,
        max_km: km_band?.max || null,
        is_active: true,
        is_spec_only: true, // Auto-generated, not from sales truth
      });
    }
  }

  if (fingerprints.length === 0) {
    console.warn("[dealer-fingerprint-webhook] No fingerprints to create — no primary_makes provided");
    return new Response(
      JSON.stringify({ status: "skipped", reason: "No primary_makes in payload" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Upsert fingerprints
  const { data, error } = await sb
    .from("dealer_fingerprints")
    .upsert(fingerprints, { onConflict: "fingerprint_id" })
    .select("id, fingerprint_id");

  if (error) {
    console.error("[dealer-fingerprint-webhook] Upsert error:", error);
    return new Response(
      JSON.stringify({ error: "Fingerprint upsert failed", detail: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[dealer-fingerprint-webhook] Created ${data?.length || 0} fingerprints for ${dealer_name}`);

  // Update dealer_profiles with location metadata if provided
  if (location) {
    // Store location info — we don't have dedicated columns yet but can log it
    console.log(`[dealer-fingerprint-webhook] Location: ${location.suburb}, ${location.state} ${location.postcode}`);
  }

  return new Response(
    JSON.stringify({
      status: "ok",
      fingerprints_created: data?.length || 0,
      dealer_profile_id,
      dealer_name,
      confidence,
      dealer_type,
      vehicle_segments,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
