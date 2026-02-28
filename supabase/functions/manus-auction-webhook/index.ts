import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MANUS AUCTION WEBHOOK - Phase 3: Receives detail extraction results from Manus
 * 
 * Replaces the processing logic from: grays-deep-fetch, manheim-deep-fetch, pickles-detail-crawler
 * 
 * Flow:
 * 1. Receive Manus task completion with extracted fields
 * 2. Look up the queue item via manus_search_tasks correlation
 * 3. Update pickles_detail_queue with enriched data
 * 4. For grays/manheim: update stub_anchors → create vehicle_listings → dealer_spec_matches
 * 5. For pickles: only update queue (no downstream match creation — matching existing behaviour)
 */

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const payload = await req.json();
  console.log("[AUCTION-WEBHOOK] Received:", JSON.stringify(payload).slice(0, 500));

  const taskId = payload?.task_id || payload?.id;
  const result = payload?.result || payload?.output;

  if (!taskId) {
    return new Response("Missing task_id", { status: 400 });
  }

  // Find the task record
  const { data: task } = await supabase
    .from("manus_search_tasks")
    .select("*")
    .eq("manus_task_id", taskId)
    .single();

  if (!task) {
    console.log(`[AUCTION-WEBHOOK] Unknown task_id: ${taskId}`);
    return new Response("Unknown task", { status: 200 });
  }

  const filters = (task.search_filters || {}) as Record<string, any>;

  // Only process auction detail enrichment tasks
  if (filters.flow !== "auction_detail_enrichment") {
    console.log(`[AUCTION-WEBHOOK] Not an auction enrichment task, ignoring: ${taskId}`);
    return new Response("Not auction enrichment", { status: 200 });
  }

  const queueItemId = filters.queue_item_id;
  const source = filters.source as string;
  const sourceListingId = filters.source_listing_id as string;
  const stubAnchorId = filters.stub_anchor_id as string | null;

  // Parse the structured JSON result from Manus
  let extracted: Record<string, any> = {};
  try {
    const resultStr = String(result);
    // Try to find a JSON object in the response
    const jsonMatch = resultStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      extracted = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error(`[AUCTION-WEBHOOK] Failed to parse result for ${taskId}:`, e);
  }

  const hasData = Object.keys(extracted).length > 0;
  console.log(`[AUCTION-WEBHOOK] Task ${taskId} (${source}:${sourceListingId}): parsed ${hasData ? "OK" : "EMPTY"}`);

  if (!hasData) {
    // Mark as error and release
    await supabase
      .from("pickles_detail_queue")
      .update({
        crawl_status: "error",
        last_crawl_error: "Manus returned no parseable data",
        last_crawl_at: new Date().toISOString(),
        retry_count: (await getRetryCount(supabase, queueItemId)) + 1,
        claimed_at: null,
        claimed_by: null,
      })
      .eq("id", queueItemId);

    await updateTaskStatus(supabase, taskId, "failed");
    return new Response(JSON.stringify({ ok: false, reason: "no_data" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Normalise extracted values
  const km = safeInt(extracted.km);
  const askingPrice = safeInt(extracted.asking_price);
  const guidePrice = safeInt(extracted.guide_price);
  const reservePrice = safeInt(extracted.reserve_price);
  const soldPrice = safeInt(extracted.sold_price);
  const variantRaw = extracted.variant_raw || null;
  const fuel = extracted.fuel || null;
  const transmission = extracted.transmission || null;
  const drivetrain = extracted.drivetrain || null;
  const location = extracted.location || null;
  const state = extracted.state || null;
  const priceType = extracted.price_type || null;
  const buyMethod = extracted.buy_method || null;
  const saleStatus = extracted.sale_status || null;
  const saleCloseAt = extracted.sale_close_at || null;
  const reserveStatus = extracted.reserve_status || null;
  const wovrIndicator = extracted.wovr_indicator === true;
  const damageNoted = extracted.damage_noted === true;
  const keysPresent = extracted.keys_present ?? null;
  const startsDrives = extracted.starts_drives ?? null;
  const conditionNotes = Array.isArray(extracted.condition_notes) ? extracted.condition_notes : [];

  // ── Step 1: Update pickles_detail_queue ──
  const queueUpdate: Record<string, any> = {
    crawl_status: "done",
    last_crawl_at: new Date().toISOString(),
    last_crawl_error: null,
    claimed_at: null,
    claimed_by: null,
    km: km,
    asking_price: askingPrice,
    variant_raw: variantRaw,
  };

  // Pickles-specific fields (if columns exist on queue table)
  if (source === "pickles") {
    if (guidePrice !== null) queueUpdate.guide_price = guidePrice;
    if (reservePrice !== null) queueUpdate.reserve_price = reservePrice;
    if (soldPrice !== null) queueUpdate.sold_price = soldPrice;
    if (buyMethod !== null) queueUpdate.buy_method = buyMethod;
    if (saleCloseAt !== null) queueUpdate.sale_close_at = saleCloseAt;
    if (saleStatus !== null) queueUpdate.sale_status = saleStatus;
    if (state !== null) queueUpdate.state = state;
    if (location !== null) queueUpdate.location = location;
  }

  await supabase
    .from("pickles_detail_queue")
    .update(queueUpdate)
    .eq("id", queueItemId);

  // ── Step 2: For grays/manheim — downstream pipeline ──
  let listingsCreated = 0;
  let matchesCreated = 0;

  if ((source === "grays" || source === "manheim") && stubAnchorId) {
    // Update stub_anchor
    await supabase.from("stub_anchors").update({
      status: "enriched",
      km: km,
      deep_fetch_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", stubAnchorId);

    // Get stub_anchor data for matched_hunt_ids
    const { data: stubData } = await supabase
      .from("stub_anchors")
      .select("matched_hunt_ids, year, make, model, km, location")
      .eq("id", stubAnchorId)
      .single();

    if (stubData?.matched_hunt_ids && stubData.matched_hunt_ids.length > 0) {
      const detailUrl = task.source_url;

      // STEP 2a: Upsert vehicle_listing FIRST (FK constraint)
      const listingId = `${source}:${sourceListingId}`;
      const { data: listingResult, error: listingError } = await supabase
        .from("vehicle_listings")
        .upsert({
          listing_id: listingId,
          source: source,
          make: extracted.make || stubData.make || "Unknown",
          model: extracted.model || stubData.model || "Unknown",
          year: safeInt(extracted.year) || stubData.year || 2020,
          km: km || stubData.km,
          variant_raw: variantRaw,
          asking_price: askingPrice,
          listing_url: detailUrl,
          location: location || stubData.location,
          status: saleStatus === "sold" ? "sold" : "catalogue",
          source_class: "auction",
          seller_type: "dealer",
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        }, {
          onConflict: "listing_id,source",
        })
        .select("id")
        .single();

      if (listingError) {
        console.error(`[AUCTION-WEBHOOK] vehicle_listings upsert failed for ${listingId}: ${listingError.message}`);
      } else if (listingResult?.id) {
        listingsCreated++;
        const listingUuid = listingResult.id;
        console.log(`[AUCTION-WEBHOOK] Upserted vehicle_listing: ${listingId} → ${listingUuid}`);

        // Batch-fetch dealer_specs
        const { data: specs } = await supabase
          .from("dealer_specs")
          .select("id, km_max")
          .in("id", stubData.matched_hunt_ids);

        // STEP 2b: Create dealer_spec_matches
        for (const spec of specs || []) {
          let score = 100;
          if (km && spec.km_max && km > spec.km_max) score -= 20;
          if (wovrIndicator) score -= 30;
          if (damageNoted) score -= 15;

          const { error: matchError } = await supabase
            .from("dealer_spec_matches")
            .upsert({
              dealer_spec_id: spec.id,
              listing_uuid: listingUuid,
              make: extracted.make || stubData.make,
              model: extracted.model || stubData.model,
              year: safeInt(extracted.year) || stubData.year,
              km: km || stubData.km,
              asking_price: askingPrice,
              listing_url: detailUrl,
              variant_used: variantRaw,
              source_class: "auction",
              region_id: location || stubData.location,
              match_score: score,
              deal_label: score >= 70 ? "BUY" : score >= 50 ? "WATCH" : "SKIP",
              matched_at: new Date().toISOString(),
            }, {
              onConflict: "dealer_spec_id,listing_uuid",
            });

          if (matchError) {
            console.error(`[AUCTION-WEBHOOK] dealer_spec_matches upsert failed: spec=${spec.id}, listing=${listingUuid}: ${matchError.message}`);
          } else {
            matchesCreated++;
          }
        }
      }
    }
  }

  // ── Step 3: Update task status ──
  await updateTaskStatus(supabase, taskId, "complete", extracted);

  console.log(`[AUCTION-WEBHOOK] Done: ${source}:${sourceListingId} — listings=${listingsCreated}, matches=${matchesCreated}`);

  return new Response(
    JSON.stringify({
      ok: true,
      source,
      source_listing_id: sourceListingId,
      listings_created: listingsCreated,
      matches_created: matchesCreated,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

// ── Helpers ──

function safeInt(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseInt(val.replace(/[^0-9]/g, ""), 10) : Number(val);
  return isNaN(n) ? null : n;
}

async function getRetryCount(supabase: any, queueItemId: string): Promise<number> {
  const { data } = await supabase
    .from("pickles_detail_queue")
    .select("retry_count")
    .eq("id", queueItemId)
    .single();
  return data?.retry_count || 0;
}

async function updateTaskStatus(supabase: any, taskId: string, status: string, results?: any) {
  const update: Record<string, any> = {
    status,
    completed_at: new Date().toISOString(),
  };
  if (results) {
    update.results = [results];
  }
  await supabase
    .from("manus_search_tasks")
    .update(update)
    .eq("manus_task_id", taskId);
}
