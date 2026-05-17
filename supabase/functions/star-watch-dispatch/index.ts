/**
 * star-watch-dispatch — Internal replacement for lindy-star-watch.
 * Invoked from useStarVehicle when a fresh star insert happens.
 *
 * Loads the listing, writes an outward_jobs audit row, and enqueues a
 * star_watch_jobs row for the cron-driven runner to pick up.
 *
 * POST { listing_id: string, account_id?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { listing_id, account_id } = await req.json();
    if (!listing_id) {
      return json({ error: "listing_id is required" }, 400);
    }

    // Try UUID lookup first, then source-specific id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listing_id);
    const { data: listing, error: listErr } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, listing_url, make, model, year, variant_used, km, source")
      .eq(isUuid ? "id" : "listing_id", listing_id)
      .maybeSingle();

    if (listErr || !listing) {
      return json({ error: "Listing not found", detail: listErr?.message }, 404);
    }
    if (!listing.listing_url) {
      return json({ error: "Listing has no URL" }, 400);
    }

    const jobId = crypto.randomUUID();
    const vehicle = [listing.year, listing.make, listing.model, listing.variant_used]
      .filter(Boolean).join(" ");

    // 1) audit row in outward_jobs (same shape as Lindy path)
    const { error: jobErr } = await sb.from("outward_jobs").insert({
      id: jobId,
      search_run_id: jobId,
      source_key: "star_watch",
      search_url: listing.listing_url,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
      account_id: account_id || null,
    });
    if (jobErr) {
      console.warn("[star-watch-dispatch] outward_jobs insert:", jobErr.message);
    }

    // 2) enqueue internal worker job
    const { error: qErr } = await sb.from("star_watch_jobs").insert({
      job_id: jobId,
      listing_id: String(listing.id),
      listing_url: listing.listing_url,
      source: listing.source || null,
      status: "queued",
    });
    if (qErr) {
      console.error("[star-watch-dispatch] enqueue failed:", qErr.message);
      return json({ error: "Failed to enqueue", detail: qErr.message }, 500);
    }

    return json({
      success: true,
      job_id: jobId,
      vehicle,
      url: listing.listing_url,
      message: `Watch queued for: ${vehicle}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[star-watch-dispatch] error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
