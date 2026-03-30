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
 * Scoring approach:
 *   1. Check operator_opportunities for pre-scored margin data
 *   2. Check vehicle_sales_truth for historical sell prices to estimate margin
 *   3. Feed anything with estimated margin > $1k OR discount > 3%
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
      .not("listing_url", "is", null)
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

    // Filter out already-queued listings (check both listing_id and uuid id)
    const newListings = listings.filter(
      (l: any) => !existingSet.has(l.listing_id) && !existingSet.has(l.id)
    );

    if (!newListings.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "All listings already in queue", fed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Check operator_opportunities for pre-scored margins (uses listing_id text)
    const textIds = newListings.map((l: any) => l.listing_id);
    const { data: opps } = await supabase
      .from("operator_opportunities")
      .select("listing_id, best_expected_margin, best_under_buy, tier, anchor_sale_sell_price, anchor_sale_buy_price")
      .in("listing_id", textIds.slice(0, 200));

    const oppMap = new Map(
      (opps || []).map((o: any) => [o.listing_id, o])
    );

    // 4. Get median sell prices from vehicle_sales_truth for make/model combos
    const makeModels = [
      ...new Set(
        newListings.map((l: any) => `${(l.make || "").toUpperCase()}|${(l.model || "").toUpperCase()}`)
      ),
    ].filter((mm) => mm !== "|");

    const truthMedians = new Map<string, { median_sell: number; median_buy: number }>();
    for (const mm of makeModels.slice(0, 30)) {
      const [make, model] = mm.split("|");
      const { data: truth } = await supabase
        .from("vehicle_sales_truth")
        .select("buy_price, sale_price")
        .ilike("make", make)
        .ilike("model", model)
        .not("sale_price", "is", null)
        .not("buy_price", "is", null)
        .order("sold_at", { ascending: false })
        .limit(30);

      if (truth?.length >= 2) {
        const sellPrices = truth.map((t: any) => t.sale_price).sort((a: number, b: number) => a - b);
        const buyPrices = truth.map((t: any) => t.buy_price).sort((a: number, b: number) => a - b);
        truthMedians.set(mm, {
          median_sell: sellPrices[Math.floor(sellPrices.length / 2)],
          median_buy: buyPrices[Math.floor(buyPrices.length / 2)],
        });
      }
    }

    // 5. Score and insert into cheap_car_queue
    const inserts: any[] = [];

    for (const l of newListings) {
      if (!l.make || !l.model || !l.asking_price) continue;

      const opp = oppMap.get(l.listing_id);
      const truthKey = `${l.make.toUpperCase()}|${l.model.toUpperCase()}`;
      const truth = truthMedians.get(truthKey);

      let marketPrice: number | null = null;
      let discountPct: number | null = null;
      let estimatedMargin: number | null = null;
      let dealScore: number | null = null;
      let dealTag: string | null = null;

      // Priority 1: Use opp data
      if (opp) {
        if (opp.anchor_sale_sell_price) {
          marketPrice = opp.anchor_sale_sell_price;
          estimatedMargin = opp.best_expected_margin || (marketPrice - l.asking_price);
          discountPct = ((l.asking_price - marketPrice) / marketPrice) * 100;
        }
      }

      // Priority 2: Use truth median
      if (!marketPrice && truth) {
        marketPrice = truth.median_sell;
        estimatedMargin = truth.median_sell - l.asking_price;
        discountPct = ((l.asking_price - truth.median_sell) / truth.median_sell) * 100;
      }

      // Qualification gate: need either margin > $1k or discount > 3% or opp tier
      const hasMargin = estimatedMargin !== null && estimatedMargin > 1000;
      const hasDiscount = discountPct !== null && discountPct < -3;
      const hasOppTier = opp && ["CODE_RED", "HIGH", "BUY", "RETAIL_BUY"].includes(opp.tier);

      if (!hasMargin && !hasDiscount && !hasOppTier) continue;

      // Compute deal score
      if (discountPct !== null) {
        let ps = 0;
        if (discountPct <= -20) ps = 10;
        else if (discountPct <= -16) ps = 8;
        else if (discountPct <= -12) ps = 6;
        else if (discountPct <= -8) ps = 4;
        else if (discountPct <= -5) ps = 2;
        else ps = 1;

        const sourceBonus = l.source === "autograb-retail" ? 2 : 1;
        dealScore = ps + sourceBonus + 3; // +3 for freshness
      }

      // Tag
      if (opp?.tier === "CODE_RED") {
        dealTag = "CODE RED";
        dealScore = Math.max(dealScore || 0, 10);
      } else if (opp?.tier === "HIGH") {
        dealTag = "High Priority";
        dealScore = Math.max(dealScore || 0, 8);
      } else if (discountPct !== null) {
        if (discountPct <= -15) dealTag = "Well Below Market";
        else if (discountPct <= -8) dealTag = "Below Market";
        else if (discountPct <= -3) dealTag = "Good Deal";
      } else if (hasMargin) {
        dealTag = `Est. Margin $${Math.round(estimatedMargin! / 1000)}k`;
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
    let fed = 0;
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

    const sourceCounts: Record<string, number> = {};
    for (const i of inserts) {
      sourceCounts[i.source] = (sourceCounts[i.source] || 0) + 1;
    }

    console.log(
      `[FEED-JOSH] Processed ${newListings.length} listings, fed ${fed} to Josh queue.`,
      sourceCounts
    );

    return new Response(
      JSON.stringify({
        ok: true,
        processed: newListings.length,
        fed,
        by_source: sourceCounts,
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
