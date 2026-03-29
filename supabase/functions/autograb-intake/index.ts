import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth — accepts MANUS_WEBHOOK_SECRET or AUTOGRAB_INGEST_KEY
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const validTokens = [
      Deno.env.get("MANUS_WEBHOOK_SECRET"),
      Deno.env.get("AUTOGRAB_INGEST_KEY"),
    ].filter(Boolean);

    if (!validTokens.length || !validTokens.includes(token)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { source, search_name, search_id, listings } = body;

    if (!listings || !Array.isArray(listings) || listings.length === 0) {
      return new Response(
        JSON.stringify({ error: "listings array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date().toISOString();
    let upserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of listings) {
      try {
        // Build a stable listing_id from the autograb ID or generate one
        const listingId = item.id || `ag-${item.make}-${item.model}-${item.year}-${item.kms}-${item.price}`.toLowerCase().replace(/\s+/g, "-");

        const row: Record<string, unknown> = {
          listing_id: listingId,
          source: source || "autograb-retail",
          source_class: "retail",
          make: (item.make || "").toUpperCase(),
          model: (item.model || "").toUpperCase(),
          variant_raw: item.vehicle_title || null,
          year: item.year || 0,
          km: item.kms ?? item.km ?? null,
          asking_price: item.price ?? null,
          location: [item.suburb, item.state].filter(Boolean).join(", ") || null,
          suburb: item.suburb || null,
          // Map state abbreviation
          seller_type: item.seller_type || "dealer",
          dealer_name: item.dealership_name || null,
          image_url: item.cover_image_url || null,
          listing_url: item.listing_url || item.url || null,
          status: "active",
          lifecycle_state: "NEW",
          first_seen_at: now,
          last_seen_at: now,
          updated_at: now,
          // AutoGrab-specific enrichment
          guide_price: item.est_trade ? Math.round(item.est_trade) : null,
          platform_class: "autograb",
          visible_to_dealers: true,
          is_dealer_grade: item.seller_type === "dealer",
        };

        // Calculate expected margin if we have est_trade and price
        if (item.est_trade && item.price) {
          row.expected_gross_margin = Math.round(item.est_trade - item.price);
        }

        const { error } = await supabase
          .from("vehicle_listings")
          .upsert(row, {
            onConflict: "listing_id",
            ignoreDuplicates: false,
          });

        if (error) {
          errors.push(`${listingId}: ${error.message}`);
          skipped++;
        } else {
          upserted++;
        }
      } catch (e) {
        errors.push(`item error: ${e.message}`);
        skipped++;
      }
    }

    // Also log to market_listing_history for price tracking
    for (const item of listings) {
      try {
        const listingId = item.id || `ag-${item.make}-${item.model}-${item.year}-${item.kms}-${item.price}`.toLowerCase().replace(/\s+/g, "-");
        await supabase.from("market_listing_history").upsert(
          {
            listing_id: listingId,
            source_site: source || "autograb-retail",
            price_at_first_seen: item.price,
            first_seen_at: now,
            last_seen_at: now,
          },
          { onConflict: "listing_id,source_site", ignoreDuplicates: false }
        );
      } catch (_) {
        // non-critical
      }
    }

    console.log(`autograb-intake: ${upserted} upserted, ${skipped} skipped from search "${search_name || search_id}"`);

    return new Response(
      JSON.stringify({
        status: "ok",
        search_name: search_name || null,
        search_id: search_id || null,
        received: listings.length,
        upserted,
        skipped,
        errors: errors.length ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("autograb-intake error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
