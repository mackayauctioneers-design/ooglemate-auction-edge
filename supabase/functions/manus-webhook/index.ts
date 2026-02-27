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

  // Find the pending task record (join hunt if available)
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
  let make = "", model = "";
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
  try { hostname = new URL(task.source_url).hostname; } catch {}

  let inserted = 0;
  for (const listing of listings) {
    if (!listing.direct_url || !listing.price) continue;

    const sourceListingId = `manus-${listing.stock_no || listing.direct_url.replace(/[^a-zA-Z0-9]/g, '').slice(-40)}`;

    const { error } = await supabase.from("retail_listings").upsert({
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
    }, { onConflict: "source,source_listing_id" });

    if (!error) {
      inserted++;
    } else {
      console.error(`[MANUS-WEBHOOK] Insert error for ${listing.direct_url}:`, error.message);
    }
  }

  // Store parsed results on the task itself for easy frontend polling
  await supabase
    .from("manus_search_tasks")
    .update({
      status: listings.length > 0 ? "complete" : "failed",
      completed_at: new Date().toISOString(),
      results: listings.map((l: any) => ({
        title: `${l.year || ""} ${make} ${model} ${l.badge || ""}`.trim(),
        price: l.price,
        km: l.km,
        year: l.year,
        location: l.location,
        dealer_name: l.dealer_name,
        url: l.direct_url,
        badge: l.badge,
        source: hostname,
      })),
    })
    .eq("manus_task_id", taskId);

  console.log(`[MANUS-WEBHOOK] Inserted ${inserted}/${listings.length} listings for session ${task.search_session_id || task.hunt_id}`);
  return new Response(JSON.stringify({ ok: true, inserted }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
