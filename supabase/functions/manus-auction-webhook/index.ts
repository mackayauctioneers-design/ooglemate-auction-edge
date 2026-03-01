import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MANUS AUCTION WEBHOOK - Phase 3: Receives detail extraction results from Manus
 *
 * Manus webhook event types:
 * - task_created: task started (ignore)
 * - task_progress: intermediate updates (ignore)
 * - task_stopped: task completed with result in task_detail.message
 *
 * Flow:
 * 1. Only process task_stopped events
 * 2. Look up queue item via manus_search_tasks correlation
 * 3. Parse JSON from task_detail.message
 * 4. Update pickles_detail_queue with ALL enriched fields (incl. fuel/transmission/wovr/condition)
 * 5. For ALL sources: write enriched data back to vehicle_listings
 * 6. For grays/manheim with stub_anchor: also update stub_anchors + dealer_spec_matches
 * 7. For pickles with stub_anchor: also create dealer_spec_matches (same as grays/manheim)
 */

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const payload = await req.json();
  const eventType = payload?.event_type;
  const taskDetail = payload?.task_detail || {};

  // Only process task_stopped events (task completed)
  if (eventType !== "task_stopped") {
    return new Response(JSON.stringify({ ok: true, skipped: eventType }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const taskId = taskDetail.task_id;
  const resultMessage = taskDetail.message || "";
  const stopReason = taskDetail.stop_reason || "unknown";

  console.log(`[AUCTION-WEBHOOK] task_stopped: ${taskId}, reason=${stopReason}, message=${resultMessage.slice(0, 200)}`);

  if (!taskId) {
    return new Response("Missing task_id in task_detail", { status: 400 });
  }

  // Find the task record
  const { data: task } = await supabase
    .from("manus_search_tasks")
    .select("*")
    .eq("manus_task_id", taskId)
    .single();

  if (!task) {
    console.log(`[AUCTION-WEBHOOK] Unknown task_id: ${taskId} (may be from a different flow)`);
    return new Response(JSON.stringify({ ok: true, skipped: "unknown_task" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const filters = (task.search_filters || {}) as Record<string, any>;

  // Only process auction detail enrichment tasks
  if (filters.flow !== "auction_detail_enrichment") {
    console.log(`[AUCTION-WEBHOOK] Not an auction enrichment task, ignoring: ${taskId}`);
    return new Response(JSON.stringify({ ok: true, skipped: "wrong_flow" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const queueItemId = filters.queue_item_id as string;
  const source = filters.source as string;
  const sourceListingId = filters.source_listing_id as string;
  const stubAnchorId = filters.stub_anchor_id as string | null;
  const detailUrl = task.source_url as string;

  // Parse the structured JSON result from Manus task_detail.message
  let extracted: Record<string, any> = {};
  try {
    const jsonMatch = resultMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      extracted = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error(`[AUCTION-WEBHOOK] Failed to parse result for ${taskId}:`, e);
  }

  // Handle expired/unavailable listings
  if (extracted.listing_expired === true || extracted.sale_status === "withdrawn") {
    console.log(`[AUCTION-WEBHOOK] Listing expired/withdrawn: ${source}:${sourceListingId}`);
    await supabase
      .from("pickles_detail_queue")
      .update({
        crawl_status: "listing_expired",
        last_crawl_at: new Date().toISOString(),
        last_crawl_error: null,
        claimed_at: null,
        claimed_by: null,
        sale_status: "withdrawn",
      })
      .eq("id", queueItemId);

    // Also mark the vehicle_listing as expired if it exists
    await supabase
      .from("vehicle_listings")
      .update({
        sale_status: "withdrawn",
        status: "delisted",
        delisted_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("listing_id", `${source}:${sourceListingId}`);

    await updateTaskStatus(supabase, taskId, "complete", extracted);
    return new Response(JSON.stringify({ ok: true, source, expired: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const hasData = Object.keys(extracted).length > 0;
  console.log(`[AUCTION-WEBHOOK] Task ${taskId} (${source}:${sourceListingId}): parsed ${hasData ? "OK" : "EMPTY"}`);

  if (!hasData) {
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

  // ── Normalise extracted values ──────────────────────────────────────────────
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
  const make = extracted.make || null;
  const model = extracted.model || null;
  const year = safeInt(extracted.year);

  // ── Step 1: Update pickles_detail_queue with ALL enriched fields ─────────────
  const queueUpdate: Record<string, any> = {
    crawl_status: "done",
    last_crawl_at: new Date().toISOString(),
    last_crawl_error: null,
    claimed_at: null,
    claimed_by: null,
    km,
    asking_price: askingPrice,
    variant_raw: variantRaw,
    fuel,
    transmission,
    wovr_indicator: wovrIndicator,
    damage_noted: damageNoted,
    keys_present: keysPresent,
    starts_drives: startsDrives,
    condition_notes: conditionNotes.length > 0 ? conditionNotes : null,
    reserve_status: reserveStatus,
    price_type: priceType,
  };

  if (make) queueUpdate.make = make;
  if (model) queueUpdate.model = model;
  if (year) queueUpdate.year = year;
  if (guidePrice !== null) queueUpdate.guide_price = guidePrice;
  if (reservePrice !== null) queueUpdate.reserve_price = reservePrice;
  if (soldPrice !== null) queueUpdate.sold_price = soldPrice;
  if (buyMethod !== null) queueUpdate.buy_method = buyMethod;
  if (saleCloseAt !== null) queueUpdate.sale_close_at = saleCloseAt;
  if (saleStatus !== null) queueUpdate.sale_status = saleStatus;
  if (state !== null) queueUpdate.state = state;
  if (location !== null) queueUpdate.location = location;

  await supabase
    .from("pickles_detail_queue")
    .update(queueUpdate)
    .eq("id", queueItemId);

  // ── Step 2: Write enriched data back to vehicle_listings (ALL sources) ───────
  // This is the key step that makes Manus enrichment useful downstream.
  // The Caroogle feed populates vehicle_listings with basic data; Manus adds
  // the detail-page fields (guide price, reserve, sale close, condition, etc.)
  let listingsCreated = 0;
  let matchesCreated = 0;

  const listingId = `${source}:${sourceListingId}`;

  const vehicleListingUpdate: Record<string, any> = {
    km,
    asking_price: askingPrice,
    variant_raw: variantRaw,
    fuel,
    transmission,
    drivetrain: drivetrain || undefined,
    location: location || undefined,
    state: state || undefined,
    price_type: priceType,
    wovr_indicator: wovrIndicator,
    damage_noted: damageNoted,
    keys_present: keysPresent,
    starts_drives: startsDrives,
    condition_notes: conditionNotes.length > 0 ? conditionNotes : null,
    reserve_status: reserveStatus,
    guide_price: guidePrice,
    reserve_price: reservePrice,
    sold_price: soldPrice,
    buy_method: buyMethod,
    sale_close_at: saleCloseAt,
    sale_status: saleStatus,
    last_seen_at: new Date().toISOString(),
    last_ingested_at: new Date().toISOString(),
  };

  // Remove undefined values to avoid overwriting with null
  Object.keys(vehicleListingUpdate).forEach((k) => {
    if (vehicleListingUpdate[k] === undefined) delete vehicleListingUpdate[k];
  });

  // Also update make/model/year if Manus extracted them (fills gaps from Caroogle)
  if (make) vehicleListingUpdate.make = make.toUpperCase();
  if (model) vehicleListingUpdate.model = model.toUpperCase();
  if (year) vehicleListingUpdate.year = year;

  // If the listing already exists (from Caroogle feed), update it
  // If it doesn't exist (Grays/Manheim items), we'll upsert below
  const { data: existingListing } = await supabase
    .from("vehicle_listings")
    .select("id, make, model, year, km, location")
    .eq("listing_id", listingId)
    .maybeSingle();

  if (existingListing) {
    // Update existing listing with enriched data
    const { error: updateErr } = await supabase
      .from("vehicle_listings")
      .update(vehicleListingUpdate)
      .eq("listing_id", listingId);

    if (updateErr) {
      console.error(`[AUCTION-WEBHOOK] vehicle_listings update failed for ${listingId}: ${updateErr.message}`);
    } else {
      listingsCreated++; // counts as "enriched"
      console.log(`[AUCTION-WEBHOOK] Enriched vehicle_listing: ${listingId}`);
    }
  } else if (source === "grays" || source === "manheim") {
    // For Grays/Manheim, the listing may not exist yet — upsert it
    // (Pickles listings are always pre-populated by Caroogle feed)
    const { data: upsertResult, error: upsertErr } = await supabase
      .from("vehicle_listings")
      .upsert({
        listing_id: listingId,
        source,
        make: (make || "Unknown").toUpperCase(),
        model: (model || "Unknown").toUpperCase(),
        year: year || 2020,
        km,
        variant_raw: variantRaw,
        asking_price: askingPrice,
        listing_url: detailUrl,
        location,
        status: saleStatus === "sold" ? "sold" : "catalogue",
        source_class: "auction",
        seller_type: "dealer",
        fuel,
        transmission,
        wovr_indicator: wovrIndicator,
        damage_noted: damageNoted,
        condition_notes: conditionNotes.length > 0 ? conditionNotes : null,
        guide_price: guidePrice,
        reserve_price: reservePrice,
        sold_price: soldPrice,
        buy_method: buyMethod,
        sale_close_at: saleCloseAt,
        sale_status: saleStatus,
        reserve_status: reserveStatus,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "listing_id,source" })
      .select("id")
      .single();

    if (upsertErr) {
      console.error(`[AUCTION-WEBHOOK] vehicle_listings upsert failed for ${listingId}: ${upsertErr.message}`);
    } else if (upsertResult?.id) {
      listingsCreated++;
    }
  }

  // ── Step 3: Stub anchor + dealer_spec_matches (Grays/Manheim AND Pickles) ───
  // Previously only Grays/Manheim got this treatment. Now Pickles with a
  // stub_anchor_id also gets dealer_spec_matches created.
  if (stubAnchorId) {
    // For Grays/Manheim: update stub_anchor status
    if (source === "grays" || source === "manheim") {
      await supabase.from("stub_anchors").update({
        status: "enriched",
        km,
        deep_fetch_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", stubAnchorId);
    }

    const { data: stubData } = await supabase
      .from("stub_anchors")
      .select("matched_hunt_ids, year, make, model, km, location")
      .eq("id", stubAnchorId)
      .single();

    if (stubData?.matched_hunt_ids && stubData.matched_hunt_ids.length > 0) {
      // Get the vehicle_listing UUID for the FK
      const { data: listingRow } = await supabase
        .from("vehicle_listings")
        .select("id")
        .eq("listing_id", listingId)
        .maybeSingle();

      const listingUuid = listingRow?.id;

      if (listingUuid) {
        const { data: specs } = await supabase
          .from("dealer_specs")
          .select("id, km_max")
          .in("id", stubData.matched_hunt_ids);

        for (const spec of specs || []) {
          let score = 100;
          if (km && spec.km_max && km > spec.km_max) score -= 20;
          if (wovrIndicator) score -= 30;
          if (damageNoted) score -= 15;
          if (!startsDrives && startsDrives !== null) score -= 25;

          const { error: matchError } = await supabase
            .from("dealer_spec_matches")
            .upsert({
              dealer_spec_id: spec.id,
              listing_uuid: listingUuid,
              make: (make || stubData.make || "Unknown").toUpperCase(),
              model: (model || stubData.model || "Unknown").toUpperCase(),
              year: year || stubData.year,
              km: km || stubData.km,
              asking_price: askingPrice,
              listing_url: detailUrl,
              variant_used: variantRaw,
              source_class: "auction",
              region_id: location || stubData.location,
              match_score: score,
              deal_label: score >= 70 ? "BUY" : score >= 50 ? "WATCH" : "SKIP",
              matched_at: new Date().toISOString(),
            }, { onConflict: "dealer_spec_id,listing_uuid" });

          if (matchError) {
            console.error(`[AUCTION-WEBHOOK] match upsert failed: spec=${spec.id}: ${matchError.message}`);
          } else {
            matchesCreated++;
          }
        }
      }
    }
  }

  // ── Step 4: Auction history — repeat listing detection ──────────────────────────
  // Compute a normalised fingerprint for cross-source vehicle matching
  const resolvedMake = (make || existingListing?.make || 'unknown').toLowerCase();
  const resolvedModel = (model || existingListing?.model || 'unknown').toLowerCase();
  const resolvedYear = year || existingListing?.year || 0;
  const resolvedKm = km || existingListing?.km || 0;
  const yearBandStart = Math.floor(resolvedYear / 2) * 2;
  const kmBandStart = Math.floor(resolvedKm / 20000) * 20000;
  const fingerprint = `${resolvedMake}|${resolvedModel}|${yearBandStart}-${yearBandStart + 1}|${kmBandStart}k-${kmBandStart + 20000}k`;

  // Upsert this appearance into vehicle_auction_history
  const { data: historyRecord } = await supabase
    .from('vehicle_auction_history')
    .upsert({
      fingerprint,
      listing_id: listingId,
      source,
      auction_house: source === 'pickles' ? 'Pickles' : source === 'grays' ? 'Grays Online' : source === 'manheim' ? 'Manheim' : source,
      listing_url: detailUrl,
      guide_price: guidePrice,
      reserve_status: reserveStatus,
      sale_close_at: saleCloseAt,
      sale_status: saleStatus,
      sold_price: soldPrice,
      buy_method: buyMethod,
      make: resolvedMake.toUpperCase(),
      model: resolvedModel.toUpperCase(),
      year: resolvedYear || null,
      odometer: resolvedKm || null,
      state: state || existingListing?.state || null,
      wovr_indicator: wovrIndicator,
      damage_noted: damageNoted,
      condition_notes: conditionNotes.length > 0 ? conditionNotes : null,
    }, { onConflict: 'listing_id,source' })
    .select('id')
    .maybeSingle();

  // Count prior appearances of this fingerprint (excluding current listing)
  const { count: priorCount } = await supabase
    .from('vehicle_auction_history')
    .select('id', { count: 'exact', head: true })
    .eq('fingerprint', fingerprint)
    .neq('listing_id', listingId);

  const passNumber = (priorCount || 0) + 1;

  // Get the earliest appearance date for this fingerprint
  const { data: firstSeenRow } = await supabase
    .from('vehicle_auction_history')
    .select('created_at')
    .eq('fingerprint', fingerprint)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const firstSeenAt = firstSeenRow?.created_at || new Date().toISOString();
  const daysCirculating = saleCloseAt
    ? Math.max(0, Math.floor((new Date(saleCloseAt).getTime() - new Date(firstSeenAt).getTime()) / 86400000))
    : 0;

  // Update pass_number and first_seen_at on the history record
  if (historyRecord?.id) {
    await supabase
      .from('vehicle_auction_history')
      .update({ pass_number: passNumber, first_seen_at: firstSeenAt })
      .eq('id', historyRecord.id);
  }

  // Denormalise pass data back to vehicle_listings for fast scoring (no join needed)
  await supabase
    .from('vehicle_listings')
    .update({
      auction_pass_number: passNumber,
      auction_first_seen_at: firstSeenAt,
      auction_days_circulating: daysCirculating,
      auction_history_count: priorCount || 0,
      vehicle_fingerprint: fingerprint,
    })
    .eq('listing_id', listingId);

  if (passNumber > 1) {
    console.log(`[AUCTION-WEBHOOK] REPEAT LISTING pass #${passNumber}: ${listingId} — ${daysCirculating} days circulating, fingerprint=${fingerprint}`);
  }

  // ── Step 5: Update task status ───────────────────────────────────────────────
  await updateTaskStatus(supabase, taskId, "complete", extracted);

  console.log(`[AUCTION-WEBHOOK] Done: ${source}:${sourceListingId} — listings_enriched=${listingsCreated}, matches=${matchesCreated}, wovr=${wovrIndicator}, damage=${damageNoted}`);

  return new Response(
    JSON.stringify({
      ok: true,
      source,
      source_listing_id: sourceListingId,
      listings_enriched: listingsCreated,
      matches_created: matchesCreated,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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
