import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * manus-webhook v2.0
 *
 * Receives Manus task completion callbacks.
 * Routes results to the correct destination:
 *   - hunt_id present → hunt_external_candidates (replaces outward-hunt/outward-scrape-worker)
 *   - no hunt_id → retail_listings (OogleBot flow)
 * Also updates manus_search_tasks with parsed results for frontend polling.
 */

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const payload = await req.json();
  console.log("[MANUS-WEBHOOK] Received:", JSON.stringify(payload).slice(0, 500));

  const taskId = payload?.task_id || payload?.id;
  const result = payload?.result || payload?.output;

  if (!taskId) {
    return new Response("Missing task_id", { status: 400 });
  }

  // Find the pending task record
  const { data: task } = await supabase
    .from("manus_search_tasks")
    .select("*")
    .eq("manus_task_id", taskId)
    .single();

  if (!task) {
    console.log(`[MANUS-WEBHOOK] Unknown task_id: ${taskId}`);
    return new Response("Unknown task", { status: 200 });
  }

  // Parse the result — Manus returns the agent's final message as a string
  let listings: any[] = [];
  try {
    const jsonMatch = String(result).match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      listings = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("[MANUS-WEBHOOK] Failed to parse listings JSON:", e);
  }

  console.log(`[MANUS-WEBHOOK] Task ${taskId}: parsed ${listings.length} listings`);

  // Determine make/model from hunt or stored filters
  let make = "";
  let model = "";
  if (task.hunt_id) {
    const { data: hunt } = await supabase
      .from("sale_hunts")
      .select("make, model")
      .eq("id", task.hunt_id)
      .single();
    make = hunt?.make || "";
    model = hunt?.model || "";
  } else if (task.search_filters) {
    const f = task.search_filters as Record<string, any>;
    make = f.make || "";
    model = f.model || "";
  }

  let hostname = "unknown";
  try {
    hostname = new URL(task.source_url).hostname.replace("www.", "");
  } catch {}

  let inserted = 0;

  // ── Route 1: Hunt flow → hunt_external_candidates ──
  if (task.hunt_id) {
    for (const listing of listings) {
      if (!listing.direct_url && !listing.price) continue;

      const dedupKey = `manus:${hostname}:${listing.stock_no || listing.direct_url?.replace(/[^a-zA-Z0-9]/g, "").slice(-40) || crypto.randomUUID()}`;
      const canonicalId = `manus-${hostname}-${listing.stock_no || crypto.randomUUID().slice(0, 8)}`;

      const { error } = await supabase.from("hunt_external_candidates").upsert(
        {
          hunt_id: task.hunt_id,
          source_name: hostname,
          source_url: listing.direct_url || task.source_url,
          dedup_key: dedupKey,
          canonical_id: canonicalId,
          title: `${listing.year || ""} ${make} ${model} ${listing.badge || ""}`.trim(),
          year: listing.year || null,
          make: make || listing.make || null,
          model: model || listing.model || null,
          variant_raw: listing.variant_raw || listing.badge || null,
          km: listing.km || null,
          asking_price: listing.price || null,
          extracted_price: listing.price || null,
          location: listing.location || null,
          badge: listing.badge || null,
          confidence: "high",
          is_listing: true,
          listing_kind: "dealer_stock",
          page_type: "listing",
          price_verified: !!listing.price,
          km_verified: !!listing.km,
          year_verified: !!listing.year,
          verified_at: new Date().toISOString(),
          verified_fields: {
            source: "manus",
            manus_task_id: taskId,
            dealer_name: listing.dealer_name,
            colour: listing.colour,
            price_type: listing.price_type,
            stock_no: listing.stock_no,
          },
          discovered_at: new Date().toISOString(),
          lifecycle_status: "active",
          source_tier: hostname.includes("carsales") || hostname.includes("autotrader") ? 2 : 3,
        },
        { onConflict: "hunt_id,dedup_key" },
      );

      if (!error) {
        inserted++;
      } else {
        console.error(`[MANUS-WEBHOOK] Hunt candidate insert error:`, error.message);
      }
    }

    // Trigger unified candidate rebuild for this hunt
    if (inserted > 0) {
      try {
        await supabase.rpc("rpc_build_unified_candidates", { p_hunt_id: task.hunt_id });
        console.log(`[MANUS-WEBHOOK] Triggered unified candidate rebuild for hunt ${task.hunt_id}`);
      } catch (e) {
        console.error(`[MANUS-WEBHOOK] Failed to rebuild candidates:`, e);
      }
    }
  }
  // ── Route 2: OogleBot flow → retail_listings ──
  else {
    for (const listing of listings) {
      if (!listing.direct_url || !listing.price) continue;

      const sourceListingId = `manus-${listing.stock_no || listing.direct_url.replace(/[^a-zA-Z0-9]/g, "").slice(-40)}`;

      const { error } = await supabase.from("retail_listings").upsert(
        {
          source_listing_id: sourceListingId,
          listing_url: listing.direct_url,
          make: make || listing.make,
          model: model || listing.model,
          year: listing.year,
          badge: listing.badge,
          asking_price: listing.price,
          price_type: listing.price_type || "unknown",
          km: listing.km,
          seller_name_raw: listing.dealer_name,
          region_raw: listing.location,
          source: hostname,
          source_type: "dealer_site",
          manus_task_id: taskId,
          search_source: "manus",
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "source,source_listing_id" },
      );

      if (!error) {
        inserted++;
      } else {
        console.error(`[MANUS-WEBHOOK] Retail insert error for ${listing.direct_url}:`, error.message);
      }
    }
  }

  // Store parsed results on the task for frontend polling
  await supabase
    .from("manus_search_tasks")
    .update({
      // "complete" even when zero results — empty is a valid completion, not a failure.
      // "failed" should only be used when the webhook payload itself is malformed.
      status: "complete",
      completed_at: new Date().toISOString(),
      results: listings.map((l: any) => ({
        title: `${l.year || ""} ${make} ${model} ${l.badge || ""}`.trim(),
        price: l.price,
        price_type: l.price_type || "unknown",
        km: l.km,
        year: l.year,
        location: l.location,
        dealer_name: l.dealer_name,
        url: l.direct_url,
        badge: l.badge,
        source: hostname,
        variant_raw: l.variant_raw,
        colour: l.colour,
        stock_no: l.stock_no,
      })),
    })
    .eq("manus_task_id", taskId);

  console.log(
    `[MANUS-WEBHOOK] Inserted ${inserted}/${listings.length} listings for ${task.hunt_id ? "hunt " + task.hunt_id : "session " + task.search_session_id}`,
  );

  return new Response(JSON.stringify({ ok: true, inserted, route: task.hunt_id ? "hunt" : "ooglebot" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
