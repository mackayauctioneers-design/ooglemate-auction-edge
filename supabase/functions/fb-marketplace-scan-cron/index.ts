import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * fb-marketplace-scan-cron v1.0 — OOM-safe city sweeps
 *
 * Scans major AU cities on Facebook Marketplace for vehicles.
 * 150 items per city, staggered launches.
 * Schedule: every 3 hours.
 *
 * FB Marketplace URLs use location IDs for AU cities.
 * Category: vehicles (category_id for vehicles)
 */

const ITEMS_PER_CITY = 150;

// Major AU cities with FB Marketplace location slugs
const AU_CITIES = [
  { name: "Sydney", slug: "sydney-new-south-wales" },
  { name: "Melbourne", slug: "melbourne-victoria" },
  { name: "Brisbane", slug: "brisbane-queensland" },
  { name: "Perth", slug: "perth-western-australia" },
  { name: "Adelaide", slug: "adelaide-south-australia" },
  { name: "Gold Coast", slug: "gold-coast-queensland" },
  { name: "Newcastle", slug: "newcastle-new-south-wales" },
  { name: "Canberra", slug: "canberra-australian-capital-territory" },
];

function buildFbMarketplaceUrl(citySlug: string): string {
  // FB Marketplace vehicles search — sorted newest, AU radius, price filter for real cars
  return `https://www.facebook.com/marketplace/${citySlug}/vehicles/?sortBy=creation_time_descend&minPrice=5000&maxPrice=150000&exact=false`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const crawlMode = Deno.env.get("CRAWL_MODE") || "normal";
    if (crawlMode === "disabled") {
      console.log("FB Marketplace cron: CRAWL_MODE=disabled, skipping");
      return new Response(JSON.stringify({ success: true, message: "crawl disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`FB Marketplace scan: ${AU_CITIES.length} cities, ${ITEMS_PER_CITY} items each`);

    const results = [];
    for (let i = 0; i < AU_CITIES.length; i++) {
      const city = AU_CITIES[i];
      const cityUrl = buildFbMarketplaceUrl(city.slug);

      // 8s stagger between cities
      if (i > 0) {
        await new Promise(r => setTimeout(r, 8000));
      }

      try {
        const scanResponse = await fetch(
          `${supabaseUrl}/functions/v1/fb-marketplace-scan`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              startUrls: [{ url: cityUrl }],
              limit: ITEMS_PER_CITY,
            }),
          }
        );

        const result = await scanResponse.json();
        if (!scanResponse.ok) {
          console.error(`[${city.name}] fb-marketplace-scan error: ${JSON.stringify(result)}`);
          results.push({ city: city.name, error: result.error });
        } else {
          console.log(`[${city.name}] queued: run ${result.apify_run_id} (limit ${ITEMS_PER_CITY})`);
          results.push({ city: city.name, run_id: result.apify_run_id, queued: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${city.name}] dispatch failed: ${msg}`);
        results.push({ city: city.name, error: msg });
      }
    }

    // Auto-retry failed cities once
    const failedCities = results.filter(r => r.error);
    if (failedCities.length > 0 && failedCities.length <= 4) {
      console.log(`Retrying ${failedCities.length} failed cities`);
      await new Promise(r => setTimeout(r, 10000));

      for (const failed of failedCities) {
        const city = AU_CITIES.find(c => c.name === failed.city);
        if (!city) continue;

        try {
          const retryResp = await fetch(
            `${supabaseUrl}/functions/v1/fb-marketplace-scan`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                startUrls: [{ url: buildFbMarketplaceUrl(city.slug) }],
                limit: ITEMS_PER_CITY,
              }),
            }
          );
          const retryResult = await retryResp.json();
          if (retryResp.ok) {
            const idx = results.findIndex(r => r.city === city.name && r.error);
            if (idx >= 0) {
              results[idx] = { city: city.name, run_id: retryResult.apify_run_id, queued: true, retried: true };
            }
            console.log(`[${city.name}] RETRY OK: run ${retryResult.apify_run_id}`);
          }
        } catch (_) { /* best effort */ }

        await new Promise(r => setTimeout(r, 5000));
      }
    }

    const queued = results.filter(r => r.queued).length;
    const failed = results.filter(r => r.error).length;
    const estItems = queued * ITEMS_PER_CITY;

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "fb-marketplace-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `v1: ${queued}/${AU_CITIES.length} cities, ~${estItems} items`,
          states_failed: failed,
        },
        { onConflict: "cron_name" }
      );

    console.log(`FB Marketplace cron complete: ${queued} queued (~${estItems} items), ${failed} failed`);

    return new Response(JSON.stringify({ success: true, queued, failed, estimated_items: estItems, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("FB Marketplace cron error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "fb-marketplace-scan-cron",
            last_seen_at: new Date().toISOString(),
            last_ok: false,
            note: errorMsg.slice(0, 200),
          },
          { onConflict: "cron_name" }
        );
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
