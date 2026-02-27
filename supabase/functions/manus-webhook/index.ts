import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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
    .select("*, sale_hunts(*)")
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

  // Insert listings into retail_listings
  const hunt = task.sale_hunts;
  let inserted = 0;
  let hostname = "unknown";
  try { hostname = new URL(task.source_url).hostname; } catch {}

  for (const listing of listings) {
    if (!listing.direct_url || !listing.price) continue;

    // Generate a source_listing_id from the URL
    const sourceListingId = `manus-${listing.stock_no || listing.direct_url.replace(/[^a-zA-Z0-9]/g, '').slice(-40)}`;

    const { error } = await supabase.from("retail_listings").upsert({
      source_listing_id: sourceListingId,
      listing_url: listing.direct_url,
      make: hunt?.make,
      model: hunt?.model,
      year: listing.year || hunt?.year,
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
    }, { onConflict: "source,source_listing_id" });

    if (!error) {
      inserted++;
    } else {
      console.error(`[MANUS-WEBHOOK] Insert error for ${listing.direct_url}:`, error.message);
    }
  }

  // Mark task as complete
  await supabase
    .from("manus_search_tasks")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("manus_task_id", taskId);

  console.log(`[MANUS-WEBHOOK] Inserted ${inserted}/${listings.length} listings for hunt ${task.hunt_id}`);
  return new Response(JSON.stringify({ ok: true, inserted }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
