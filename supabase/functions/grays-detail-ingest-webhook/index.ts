import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * GRAYS DETAIL INGEST WEBHOOK
 * 
 * Receives scraped detail data from Apify Playwright actor.
 * For each item:
 * 1. Upsert vehicle_listings (listing_id = grays:{source_stock_id})
 * 2. Upsert dealer_spec_matches for matched specs
 * 3. Mark pickles_detail_queue row as done
 * 
 * NO direct fetching of Grays pages (Cloudflare blocks Edge functions).
 * Auth: Bearer token via GRAYS_INGEST_KEY secret
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DetailItem {
  source_stock_id: string;
  detail_url: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  variant_raw?: string | null;
  km?: number | null;
  asking_price?: number | null;
  guide_price?: number | null;
  reserve_price?: number | null;
  current_bid?: number | null;
  fuel?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  location?: string | null;
  auction_datetime?: string | null;
  reserve_status?: string | null;
  wovr_indicator?: boolean | null;
  damage_noted?: boolean | null;
  keys_present?: boolean | null;
  starts_drives?: boolean | null;
  raw_html?: string | null;
}

interface Metrics {
  items_received: number;
  vehicle_listings_upserted: number;
  dealer_spec_matches_created: number;
  queue_rows_marked_done: number;
  errors: { source_stock_id: string; error: string }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Auth check
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const expected = Deno.env.get("GRAYS_INGEST_KEY") || "";

    console.log(`[grays-detail-webhook] Auth check: token_len=${token.length}`);

    if (!expected || token !== expected) {
      console.error("[grays-detail-webhook] Unauthorized");
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const items: DetailItem[] = Array.isArray(body?.items) ? body.items : [];

    console.log(`[grays-detail-webhook] Received ${items.length} detail items`);

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, metrics: { items_received: 0 } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const metrics: Metrics = {
      items_received: items.length,
      vehicle_listings_upserted: 0,
      dealer_spec_matches_created: 0,
      queue_rows_marked_done: 0,
      errors: [],
    };

    // Process each item
    for (const item of items) {
      if (!item.source_stock_id) {
        metrics.errors.push({ source_stock_id: "unknown", error: "Missing source_stock_id" });
        continue;
      }

      const listingId = `grays:${item.source_stock_id}`;

      try {
        // 1. Upsert vehicle_listings
        const vehicleData = {
          listing_id: listingId,
          source: "grays",
          source_listing_id: item.source_stock_id,
          detail_url: item.detail_url,
          year: item.year,
          make: item.make,
          make_norm: item.make?.toLowerCase().trim() || null,
          model: item.model,
          model_norm: item.model?.toLowerCase().trim() || null,
          variant_raw: item.variant_raw,
          km: item.km,
          asking_price: item.asking_price || item.current_bid || item.guide_price,
          fuel: item.fuel,
          transmission: item.transmission,
          drivetrain: item.drivetrain,
          location: item.location,
          auction_datetime: item.auction_datetime,
          wovr_indicator: item.wovr_indicator,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: listingResult, error: listingError } = await supabase
          .from("vehicle_listings")
          .upsert(vehicleData, { onConflict: "listing_id" })
          .select("id")
          .single();

        if (listingError) {
          console.error(`[grays-detail-webhook] vehicle_listings upsert error for ${listingId}:`, listingError);
          metrics.errors.push({ source_stock_id: item.source_stock_id, error: `vehicle_listings: ${listingError.message}` });
          continue;
        }

        metrics.vehicle_listings_upserted++;
        const listingUuid = listingResult.id;

        // 2. Find matched dealer specs via stub_anchors
        const { data: stubData } = await supabase
          .from("stub_anchors")
          .select("matched_hunt_ids")
          .eq("source", "grays")
          .eq("source_stock_id", item.source_stock_id)
          .single();

        const matchedSpecIds: string[] = stubData?.matched_hunt_ids || [];

        if (matchedSpecIds.length > 0) {
          // Fetch spec details for match scoring
          const { data: specs } = await supabase
            .from("dealer_specs")
            .select("id, dealer_id, dealer_name, make, model, variant_family, year_min, year_max, km_max, region_scope")
            .in("id", matchedSpecIds);

          for (const spec of specs || []) {
            // Calculate match score
            let matchScore = 50;
            if (item.make?.toLowerCase() === spec.make?.toLowerCase()) matchScore += 15;
            if (item.model?.toLowerCase() === spec.model?.toLowerCase()) matchScore += 15;
            if (item.year && spec.year_min && spec.year_max) {
              if (item.year >= spec.year_min && item.year <= spec.year_max) matchScore += 10;
            }
            if (item.km && spec.km_max && item.km <= spec.km_max) matchScore += 10;

            const matchData = {
              dealer_spec_id: spec.id,
              listing_uuid: listingUuid,
              make: item.make,
              model: item.model,
              year: item.year,
              km: item.km,
              asking_price: item.asking_price || item.current_bid,
              listing_url: item.detail_url,
              variant_used: item.variant_raw,
              source_class: "auction",
              region_id: item.location?.match(/NSW|VIC|QLD|SA|WA|TAS|NT|ACT/i)?.[0]?.toUpperCase() || null,
              match_score: matchScore,
              deal_label: matchScore >= 80 ? "strong" : matchScore >= 60 ? "good" : "potential",
              matched_at: new Date().toISOString(),
            };

            const { error: matchError } = await supabase
              .from("dealer_spec_matches")
              .upsert(matchData, { onConflict: "dealer_spec_id,listing_uuid" });

            if (matchError) {
              console.error(`[grays-detail-webhook] dealer_spec_matches error for ${listingId}, spec ${spec.id}:`, matchError);
              metrics.errors.push({ 
                source_stock_id: item.source_stock_id, 
                error: `dealer_spec_matches: ${matchError.message}` 
              });
            } else {
              metrics.dealer_spec_matches_created++;
            }
          }
        }

        // 3. Mark queue row as done (or upsert if not exists)
        const { error: queueError } = await supabase
          .from("pickles_detail_queue")
          .upsert({
            source: "grays",
            source_listing_id: item.source_stock_id,
            detail_url: item.detail_url,
            crawl_status: "done",
            last_crawl_at: new Date().toISOString(),
            last_crawl_http_status: 200,
            extracted_year: item.year,
            extracted_make: item.make,
            extracted_model: item.model,
            extracted_variant: item.variant_raw,
            extracted_km: item.km,
            extracted_price: item.asking_price || item.current_bid,
            extracted_fuel: item.fuel,
            extracted_transmission: item.transmission,
            extracted_location: item.location,
          }, { onConflict: "source,source_listing_id" });

        if (queueError) {
          console.error(`[grays-detail-webhook] queue update error for ${item.source_stock_id}:`, queueError);
        } else {
          metrics.queue_rows_marked_done++;
        }

      } catch (itemError) {
        console.error(`[grays-detail-webhook] Error processing ${item.source_stock_id}:`, itemError);
        metrics.errors.push({ source_stock_id: item.source_stock_id, error: String(itemError) });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[grays-detail-webhook] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        metrics,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[grays-detail-webhook] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
