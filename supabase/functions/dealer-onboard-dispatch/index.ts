/**
 * dealer-onboard-dispatch — Dispatches a new dealer to Lindy for auto-profiling.
 *
 * Called from the DealerOnboarding UI after a dealer_profile is seeded.
 * POSTs to Lindy's HTTP Webhook with the dealer's website so Lindy can:
 *   1. Crawl the website
 *   2. Extract inventory patterns
 *   3. Build a dealer fingerprint
 *   4. POST results back to dealer-fingerprint-webhook
 *
 * Required secrets:
 *   - LINDY_HTTP_WEBHOOK_URL
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LINDY_URL = Deno.env.get("LINDY_HTTP_WEBHOOK_URL");
  if (!LINDY_URL) {
    return new Response(
      JSON.stringify({ error: "LINDY_HTTP_WEBHOOK_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/dealer-fingerprint-webhook`;

  let body: {
    dealer_profile_id: string;
    dealer_name: string;
    dealer_website: string;
    dealer_email?: string;
    dealer_phone?: string;
  };

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
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const prompt = `You are an automated dealer intelligence agent operating inside the Carbitrage platform.

Your task is to automatically generate a Dealer Fingerprint Profile for a new dealership.

Dealer Information:
- Name: ${body.dealer_name}
- Website: ${body.dealer_website}
${body.dealer_email ? `- Email: ${body.dealer_email}` : ''}
${body.dealer_phone ? `- Phone: ${body.dealer_phone}` : ''}

Step 1 — Visit the dealership website and extract: dealership name, business description, address, phone, suburb, state, postcode.

Step 2 — Scan the website inventory pages. Common paths: /used-cars, /stock, /inventory, /vehicles. Extract the first 20-50 listings.

Step 3 — From inventory analysis determine:
- Primary Makes (e.g. Toyota, Ford, Isuzu)
- Common Models (e.g. Hilux, Ranger, Prado)
- Price Range (e.g. $30,000 - $70,000)
- Typical KM Range (e.g. 40,000 - 120,000 km)
- Vehicle Segments (4x4, SUV, Commercial utes, Passenger, Luxury, Mixed)
- Dealer Type (Franchise, Independent, Wholesale, Mixed)

Step 4 — Return results as JSON to the callback URL. The JSON payload MUST be:
{
  "dealer_profile_id": "${body.dealer_profile_id}",
  "dealer_name": "${body.dealer_name}",
  "website": "${body.dealer_website}",
  "location": { "suburb": "...", "state": "...", "postcode": "...", "address": "..." },
  "primary_makes": ["Toyota", "Ford"],
  "top_models": ["Hilux", "Ranger"],
  "price_band": { "min": 30000, "max": 70000 },
  "km_band": { "min": 40000, "max": 120000 },
  "vehicle_segments": ["4x4", "SUV"],
  "dealer_type": "Independent",
  "inventory_sample_size": 25,
  "confidence": "HIGH",
  "year_band": { "min": 2018, "max": 2024 }
}

Important: Prioritise actual inventory listings over marketing descriptions. If inventory pages are unavailable, check sitemap or third-party stock feeds.`;

  const lindyPayload = {
    dealer_profile_id: body.dealer_profile_id,
    dealer_name: body.dealer_name,
    dealer_website: body.dealer_website,
    prompt,
    callback_url: CALLBACK_URL,
    callback_headers: {
      ...(Deno.env.get("LINDY_WEBHOOK_SECRET")
        ? { "x-lindy-signature": Deno.env.get("LINDY_WEBHOOK_SECRET")! }
        : {}),
      "Content-Type": "application/json",
    },
  };

  console.log(`[dealer-onboard-dispatch] Dispatching profiling for: ${body.dealer_name} → ${body.dealer_website}`);

  try {
    const resp = await fetch(LINDY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lindyPayload),
    });

    const respText = await resp.text();
    console.log(`[dealer-onboard-dispatch] Lindy response: ${resp.status} — ${respText.slice(0, 500)}`);

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "Lindy dispatch failed", status: resp.status, detail: respText.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "dispatched",
        dealer_profile_id: body.dealer_profile_id,
        message: "Lindy profiling dispatched. Fingerprint will arrive at dealer-fingerprint-webhook.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[dealer-onboard-dispatch] Lindy fetch error:", err);
    return new Response(
      JSON.stringify({ error: "Lindy unreachable", detail: String(err) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
