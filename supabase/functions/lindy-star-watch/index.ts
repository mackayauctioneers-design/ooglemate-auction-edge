/**
 * lindy-star-watch — When a user stars a vehicle, dispatch to Lindy to set up a watch alert.
 *
 * POST { listing_id: uuid }
 *
 * Flow:
 *   1. Look up vehicle details from vehicle_listings
 *   2. POST to Lindy HTTP Webhook with the listing URL + watch instructions
 *   3. Log the dispatch in url_watchlist for tracking
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

  const LINDY_URL = Deno.env.get("LINDY_HTTP_WEBHOOK_URL");
  if (!LINDY_URL) {
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

    // Build the Lindy watch task
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/lindy-results-webhook`;

    const vehicleDesc = [
      listing.year,
      listing.make,
      listing.model,
      listing.variant_used,
    ].filter(Boolean).join(" ");

    const prompt = `Set up a WATCH ALERT for this vehicle listing:
${listingUrl}

Vehicle: ${vehicleDesc}
${listing.km ? `Odometer: ${listing.km.toLocaleString()} km` : ""}
${listing.auction_house ? `Auction house: ${listing.auction_house}` : ""}
${listing.auction_datetime ? `Auction date: ${listing.auction_datetime}` : ""}

INSTRUCTIONS:
1. Browse this URL and note the current status (active, upcoming auction, sold, etc.)
2. Note the current asking price or guide price if shown
3. Set up monitoring — check this listing periodically (every 4 hours)
4. Alert me if:
   - The price changes (drops or increases)
   - The listing is marked as SOLD or removed
   - The auction date is approaching (within 24 hours)
   - Any new information appears (inspection reports, reserve price, etc.)

Return your findings as JSON:
{
  "listing_url": "${listingUrl}",
  "vehicle": "${vehicleDesc}",
  "current_status": "active|upcoming|sold|removed",
  "current_price": <number or null>,
  "auction_date": "<ISO date or null>",
  "notes": "<any relevant observations>",
  "watch_established": true
}`;

    const jobId = crypto.randomUUID();

    const lindyPayload = {
      job_id: jobId,
      task_type: "star_watch",
      listing_id: listing.id,
      source_listing_id: listing.listing_id,
      url: listingUrl,
      prompt,
      callback_url: CALLBACK_URL,
      callback_headers: {
        ...(Deno.env.get("LINDY_WEBHOOK_SECRET")
          ? { "x-lindy-signature": Deno.env.get("LINDY_WEBHOOK_SECRET")! }
          : {}),
        "Content-Type": "application/json",
      },
    };

    console.log(`[lindy-star-watch] Dispatching watch for ${vehicleDesc} → ${listingUrl}`);

    const resp = await fetch(LINDY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lindyPayload),
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
        message: `Lindy is now watching: ${vehicleDesc}`,
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
