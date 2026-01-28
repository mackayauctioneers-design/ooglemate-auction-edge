import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * SLATTERY DETAIL INGEST WEBHOOK - Receives enriched vehicle data from Apify Playwright actor
 * 
 * Slattery is JavaScript-rendered (React/Next.js) and requires headless browser.
 * This webhook receives pre-extracted detail data from an external Apify actor.
 * 
 * Auth: VMA_INGEST_KEY as Bearer token (same as VMA/Pickles/Manheim/Grays)
 * 
 * Flow per item:
 * 1. Upsert vehicle_listings (listing_id = `slattery:${source_stock_id}`)
 * 2. Upsert dealer_spec_matches for each matched spec from stub_anchors.matched_hunt_ids
 * 3. Mark pickles_detail_queue row as done
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DetailItem {
  source_stock_id: string;
  detail_url: string;
  variant_raw?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  km?: number | null;
  asking_price?: number | null;
  guide_price?: number | null;
  current_bid?: number | null;
  fuel?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  location?: string | null;
  state?: string | null;
  auction_datetime?: string | null;
  reserve_status?: string | null;
  wovr_indicator?: boolean | null;
  damage_noted?: boolean | null;
  keys_present?: boolean | null;
  starts_drives?: boolean | null;
  sold?: boolean | null;
}

interface IngestMetrics {
  items_received: number;
  listings_created: number;
  matches_created: number;
  queue_items_done: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check - require VMA_INGEST_KEY
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = Deno.env.get("VMA_INGEST_KEY") || "";

  if (!token || token !== expected) {
    console.error("[SLATTERY-DETAIL-WEBHOOK] Unauthorized - invalid or missing token");
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const items: DetailItem[] = body.items || [];

    console.log(`[SLATTERY-DETAIL-WEBHOOK] Received ${items.length} items`);

    const metrics: IngestMetrics = {
      items_received: items.length,
      listings_created: 0,
      matches_created: 0,
      queue_items_done: 0,
      errors: [],
    };

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No items to process", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    for (const item of items) {
      try {
        if (!item.source_stock_id) {
          metrics.errors.push(`Missing source_stock_id`);
          continue;
        }

        const listingId = `slattery:${item.source_stock_id}`;

        // 1) Upsert vehicle_listings
        const { data: listing, error: listingError } = await supabase
          .from("vehicle_listings")
          .upsert({
            listing_id: listingId,
            source: "slattery",
            source_url: item.detail_url,
            make: item.make,
            model: item.model,
            year: item.year,
            variant_raw: item.variant_raw,
            km: item.km,
            asking_price: item.asking_price,
            guide_price: item.guide_price,
            fuel: item.fuel,
            transmission: item.transmission,
            drivetrain: item.drivetrain,
            location: item.location,
            state: item.state,
            auction_datetime: item.auction_datetime,
            auction_house: "slattery",
            status: item.sold ? "sold" : "active",
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }, {
            onConflict: "listing_id,source",
            ignoreDuplicates: false,
          })
          .select("id")
          .single();

        if (listingError) {
          console.error(`[SLATTERY-DETAIL-WEBHOOK] Listing error for ${item.source_stock_id}:`, listingError);
          metrics.errors.push(`Listing error: ${listingError.message}`);
          continue;
        }

        metrics.listings_created++;

        // 2) Look up stub_anchors for matched_hunt_ids
        const { data: stub } = await supabase
          .from("stub_anchors")
          .select("id, matched_hunt_ids")
          .eq("source", "slattery")
          .eq("source_stock_id", item.source_stock_id)
          .single();

        if (stub?.matched_hunt_ids && stub.matched_hunt_ids.length > 0 && listing?.id) {
          const matchInserts = stub.matched_hunt_ids.map((specId: string) => ({
            dealer_spec_id: specId,
            listing_uuid: listing.id,
            make: item.make,
            model: item.model,
            year: item.year,
            km: item.km,
            asking_price: item.asking_price,
            listing_url: item.detail_url,
            source_class: "auction",
            match_score: 100,
            matched_at: new Date().toISOString(),
          }));

          const { error: matchError } = await supabase
            .from("dealer_spec_matches")
            .upsert(matchInserts, {
              onConflict: "dealer_spec_id,listing_uuid",
              ignoreDuplicates: true,
            });

          if (matchError) {
            console.error(`[SLATTERY-DETAIL-WEBHOOK] Match error:`, matchError);
            metrics.errors.push(`Match error: ${matchError.message}`);
          } else {
            metrics.matches_created += matchInserts.length;
          }
        }

        // 3) Mark pickles_detail_queue row as done
        const { error: queueError } = await supabase
          .from("pickles_detail_queue")
          .update({
            crawl_status: "completed",
            last_crawl_http_status: 200,
            crawl_attempts: 1,
            km: item.km,
            asking_price: item.asking_price,
            variant_raw: item.variant_raw,
          })
          .eq("source", "slattery")
          .eq("source_listing_id", item.source_stock_id);

        if (!queueError) {
          metrics.queue_items_done++;
        }

        // 4) Update stub_anchors status
        if (stub?.id) {
          await supabase
            .from("stub_anchors")
            .update({
              status: "enriched",
              enriched_at: new Date().toISOString(),
            })
            .eq("id", stub.id);
        }

      } catch (itemError) {
        console.error(`[SLATTERY-DETAIL-WEBHOOK] Item error:`, itemError);
        metrics.errors.push(`Item error: ${itemError instanceof Error ? itemError.message : String(itemError)}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SLATTERY-DETAIL-WEBHOOK] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        metrics,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[SLATTERY-DETAIL-WEBHOOK] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
