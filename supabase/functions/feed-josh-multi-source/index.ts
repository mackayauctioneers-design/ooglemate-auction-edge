import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * FEED-JOSH-MULTI-SOURCE
 *
 * Pulls recent retail listings from non-Carsales sources in vehicle_listings
 * and feeds qualified ones into cheap_car_queue for Josh verification.
 *
 * Sources: autotrader, gumtree, autograb-retail, easyauto, toyota, f3
 * Filters: year >= 2020, km <= 120k, has asking_price
 *
 * Scoring: Uses operator_opportunities margin data when available,
 * otherwise estimates from vehicle_sales_truth median sell prices.
 *
 * Runs on cron every 30 minutes.
 */

const RETAIL_SOURCES = [
  "autotrader",
  "gumtree",
  "autograb-retail",
  "easyauto",
  "toyota",
  "f3",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 1. Get listing_ids already in cheap_car_queue to avoid re-processing
    const { data: existingIds } = await supabase
      .from("cheap_car_queue")
      .select("listing_id")
      .order("detected_at", { ascending: false })
      .limit(5000);

    const existingSet = new Set(
      (existingIds || []).map((r: any) => r.listing_id)
    );

    // 2. Pull recent retail listings from non-Carsales sources
    const { data: listings, error: listErr } = await supabase
      .from("vehicle_listings")
      .select(
        "id, listing_id, source, make, model, variant_raw, year, km, asking_price, listing_url, image_url, location, seller_type, first_seen_at, transmission, fuel, drivetrain"
      )
      .in("source", RETAIL_SOURCES)
      .gte("year", 2020)
      .lte("km", 120000)
      .not("asking_price", "is", null)
      .gte("first_seen_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("first_seen_at", { ascending: false })
      .limit(500);

    if (listErr) throw listErr;
    if (!listings?.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "No new listings to process", fed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter out already-queued listings
    const newListings = listings.filter(
      (l: any) => !existingSet.has(l.listing_id) && !existingSet.has(l.id)
    );

    if (!newListings.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "All listings already in queue", fed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Check operator_opportunities for pre-scored margins
    const listingIds = newListings.map((l: any) => l.id);
    const { data: opps } = await supabase
      .from("operator_opportunities")
      .select("listing_id, best_expected_margin, best_under_buy, tier, anchor_sale_sell_price")
      .in("listing_id", listingIds);

    const oppMap = new Map(
      (opps || []).map((o: any) => [o.listing_id, o])
    );

    // 4. For listings without opp scores, try to get median sell from vehicle_sales_truth
    const makeModels = [
      ...new Set(
        newListings
          .filter((l: any) => !oppMap.has(l.id))
          .map((l: any) => `${l.make}|${l.model}`)
      ),
    ];

    const truthMedians = new Map<string, number>();
    for (const mm of makeModels.slice(0, 20)) {
      const [make, model] = mm.split("|");
      const { data: truth } = await supabase
        .from("vehicle_sales_truth")
        .select("sell_price")
        .ilike("make", make)
        .ilike("model", model)
        .not("sell_price", "is", null)
        .order("sold_at", { ascending: false })
        .limit(20);

      if (truth?.length >= 3) {
        const prices = truth.map((t: any) => t.sell_price).sort((a: number, b: number) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        truthMedians.set(mm, median);
      }
    }

    // 5. Score and insert into cheap_car_queue
    let fed = 0;
    const inserts: any[] = [];

    for (const l of newListings) {
      const opp = oppMap.get(l.id);
      let marketPrice: number | null = null;
      let discountPct: number | null = null;
      let dealScore: number | null = null;
      let dealTag: string | null = null;

      if (opp?.anchor_sale_sell_price && l.asking_price) {
        // Use operator opp data
        marketPrice = opp.anchor_sale_sell_price;
        discountPct = ((l.asking_price - marketPrice) / marketPrice) * 100;
      } else {
        // Use truth median
        const key = `${l.make}|${l.model}`;
        const median = truthMedians.get(key);
        if (median && l.asking_price) {
          marketPrice = median;
          discountPct = ((l.asking_price - median) / median) * 100;
        }
      }

      // Only queue if there's a meaningful discount or opp score
      if (discountPct !== null && discountPct > -3) continue; // Not cheap enough
      if (discountPct === null && !opp) continue; // No data to score

      // Compute deal score (same logic as carsales pipeline)
      if (discountPct !== null) {
        let ps = 0;
        if (discountPct <= -20) ps = 10;
        else if (discountPct <= -16) ps = 8;
        else if (discountPct <= -12) ps = 6;
        else if (discountPct <= -8) ps = 4;
        else if (discountPct <= -5) ps = 2;
        else if (discountPct <= -3) ps = 1;

        // Source bonus
        const sourceBonus = l.source === "autograb-retail" ? 2 : 1;
        dealScore = ps + sourceBonus + 3; // +3 for freshness (< 7 days)
      }

      // Tag
      if (discountPct !== null) {
        if (discountPct <= -15) dealTag = "Well Below Market";
        else if (discountPct <= -8) dealTag = "Below Market";
        else if (discountPct <= -3) dealTag = "Good Deal";
      }

      // Tier from opp if available
      if (opp?.tier === "CODE_RED" || opp?.tier === "HIGH") {
        dealTag = dealTag || opp.tier;
        dealScore = Math.max(dealScore || 0, 8);
      }

      inserts.push({
        listing_id: l.listing_id || l.id,
        source: l.source,
        source_type: "system",
        make: l.make,
        model: l.model,
        variant: l.variant_raw || null,
        year: l.year,
        km: l.km || null,
        price: l.asking_price,
        market_price: marketPrice,
        discount_pct: discountPct ? Math.round(discountPct * 100) / 100 : null,
        deal_tag: dealTag,
        deal_score: dealScore,
        location: l.location || null,
        listing_url: l.listing_url,
        image_url: l.image_url || null,
        fuel_type: l.fuel || null,
        transmission: l.transmission || null,
        price_badge: dealTag,
        seller_type: l.seller_type || "dealer",
        status: "NEW",
        josh_verified: false,
      });
    }

    // Batch upsert
    if (inserts.length > 0) {
      const { error: upsertErr } = await supabase
        .from("cheap_car_queue")
        .upsert(inserts, { onConflict: "listing_id" });

      if (upsertErr) {
        console.error("[FEED-JOSH] Upsert error:", upsertErr);
        throw upsertErr;
      }
      fed = inserts.length;
    }

    console.log(
      `[FEED-JOSH] Processed ${newListings.length} listings, fed ${fed} to Josh queue. Sources: ${[...new Set(inserts.map((i) => i.source))].join(", ")}`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        processed: newListings.length,
        fed,
        sources: [...new Set(inserts.map((i) => i.source))],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[FEED-JOSH] Fatal error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
