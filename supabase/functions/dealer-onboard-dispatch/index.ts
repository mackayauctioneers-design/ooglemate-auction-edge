/**
 * dealer-onboard-dispatch — Dispatches a new dealer to Arby (OpenClaw) for auto-profiling.
 *
 * POSTs directly to the Arby dispatch HTTP endpoint. Arby performs inventory + days-in-stock
 * + business analysis and posts results back to `arby-dealer-profile-intake`.
 */

// @ts-nocheck

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!ARBY_DISPATCH_URL || !ARBY_DISPATCH_KEY) {
    return new Response(
      JSON.stringify({ error: "ARBY_DISPATCH_URL / ARBY_DISPATCH_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const payload = {
    dealer_profile_id: body.dealer_profile_id,
    dealer_name: body.dealer_name,
    website_url: body.dealer_website,
    dealer_email: body.dealer_email || null,
    scope: body.scope || ["inventory", "days_in_stock", "business_analysis"],
    callback_url: CALLBACK_URL,
  };

  console.log(`[dealer-onboard-dispatch] → Arby: ${body.dealer_name} (${body.dealer_website})`);

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
      return new Response(
        JSON.stringify({ error: "Arby dispatch failed", status: res.status, detail: parsed }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[dealer-onboard-dispatch] Arby accepted profile job for ${body.dealer_profile_id}`);

    return new Response(
      JSON.stringify({
        status: "dispatched",
        method: "arby_http",
        dealer_profile_id: body.dealer_profile_id,
        arby_response: parsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[dealer-onboard-dispatch] HTTP dispatch error:", err);
    return new Response(
      JSON.stringify({ error: "Arby HTTP dispatch failed", detail: String(err) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
