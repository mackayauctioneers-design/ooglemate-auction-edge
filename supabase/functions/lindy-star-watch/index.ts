/**
 * lindy-star-watch — When a user stars a vehicle, dispatch to Lindy via HTTP webhook.
 *
 * POST { listing_id: uuid }
 *
 * Flow:
 *   1. Look up vehicle details from vehicle_listings
 *   2. POST payload to Lindy HTTP webhook with browse queue row format
 *   3. Log the dispatch in outward_jobs for tracking
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const lindyWebhookUrl = Deno.env.get("LINDY_HTTP_WEBHOOK_URL");
  if (!lindyWebhookUrl) {
    return new Response(
      JSON.stringify({ error: "LINDY_HTTP_WEBHOOK_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { listing_id } = await req.json();
    if (!listing_id) {
      return new Response(
        JSON.stringify({ error: "listing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Look up the vehicle listing
    const { data: listing, error: listErr } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, listing_url, make, model, year, variant_used, km, source, auction_house, auction_datetime")
      .eq("id", listing_id)
      .single();

    if (listErr || !listing) {
      return new Response(
        JSON.stringify({ error: "Listing not found", detail: listErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const listingUrl = listing.listing_url;
    if (!listingUrl) {
      return new Response(
        JSON.stringify({ error: "Listing has no URL to watch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vehicleDesc = [
      listing.year,
      listing.make,
      listing.model,
      listing.variant_used,
    ].filter(Boolean).join(" ");

    const jobId = crypto.randomUUID();
    const queueId = crypto.randomUUID();

    const prompt = `WATCH ALERT — Browse this listing and extract current status:
${listingUrl}

Vehicle: ${vehicleDesc}
${listing.km ? `Odometer: ${listing.km.toLocaleString()} km` : ""}
${listing.auction_house ? `Auction house: ${listing.auction_house}` : ""}
${listing.auction_datetime ? `Auction date: ${listing.auction_datetime}` : ""}

Extract: current status (active/upcoming/sold/removed), current price, auction date, and any notes.
Return as JSON with fields: listing_url, vehicle, current_status, current_price, auction_date, notes, watch_established.`;

    const payload = {
      rows: [{
        id: queueId,
        source: "star_watch",
        page: 1,
        url: listingUrl,
        prompt,
        job_id: jobId,
        search_run_id: jobId,
      }],
    };

    console.log(`[lindy-star-watch] Dispatching watch via HTTP for ${vehicleDesc} → ${listingUrl}`);

    const resp = await fetch(lindyWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const respText = await resp.text();
    console.log(`[lindy-star-watch] Lindy response: ${resp.status} — ${respText.slice(0, 300)}`);

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "Lindy dispatch failed", status: resp.status, detail: respText.slice(0, 300) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log dispatch in outward_jobs for audit trail
    await sb.from("outward_jobs").insert({
      id: jobId,
      search_run_id: jobId,
      source_key: "star_watch",
      search_url: listingUrl,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
    }).then(({ error: insErr }) => {
      if (insErr) console.warn("[lindy-star-watch] Audit log insert failed:", insErr.message);
    });

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        vehicle: vehicleDesc,
        url: listingUrl,
        message: `Watch dispatched via HTTP for: ${vehicleDesc}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[lindy-star-watch] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
