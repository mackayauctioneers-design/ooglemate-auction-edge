/**
 * dealer-fingerprint-webhook — Receives CaroogleAI's auto-profiling results
 * and upserts dealer fingerprints into the database.
 *
 * Auth: HMAC-SHA256 signature via x-lindy-signature header
 * Secret: LINDY_WEBHOOK_SECRET
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lindy-signature",
};

async function verifyHmac(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const secret = Deno.env.get("LINDY_WEBHOOK_SECRET");
  const rawBody = await req.text();

  // Verify HMAC-SHA256 signature
  if (secret) {
    const sig = req.headers.get("x-lindy-signature") || "";
    const valid = await verifyHmac(rawBody, sig, secret);
    if (!valid) {
      console.warn("[dealer-fingerprint-webhook] Invalid HMAC signature");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
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

  // Handle agent failure reports
  if (agentStatus === "failed") {
    console.error(`[dealer-fingerprint-webhook] Agent reported failure for ${dealer_name}: ${error_message}`);
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

  console.log(`[dealer-fingerprint-webhook] Processing fingerprint for: ${dealer_name} (${dealer_profile_id})`);
  console.log(`[dealer-fingerprint-webhook] Makes: ${primary_makes.join(", ")} | Models: ${top_models.join(", ")} | Confidence: ${confidence}`);

  // Create a fingerprint for each primary make + top model combination
  const fingerprints: any[] = [];

  for (const make of primary_makes) {
    const modelsForMake = top_models.length > 0 ? top_models : ["ALL"];

    for (const model of modelsForMake) {
      fingerprints.push({
        fingerprint_id: `auto-${dealer_profile_id}-${make}-${model}`.toLowerCase().replace(/\s+/g, "-"),
        dealer_name,
        dealer_profile_id,
        make: make.toUpperCase(),
        model: model.toUpperCase(),
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

  if (location) {
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
