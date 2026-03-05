import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * gumtree-scan-cron: Broad market sweep via Gumtree.
 *
 * Dispatches wide search URLs segmented by category (cars/vans/utes)
 * across major cities, then calls gumtree-scan.
 *
 * Schedule: every 2 hours
 */

const SEARCHES = [
  // Cars — major cities, 2016+, sorted by date
  { label: "Sydney", url: "https://www.gumtree.com.au/s-cars-vans-utes/sydney/c18320l3003435?sort=date&carmileageinkms_max=200000&caryear_min=2016" },
  { label: "Melbourne", url: "https://www.gumtree.com.au/s-cars-vans-utes/melbourne/c18320l3001317?sort=date&carmileageinkms_max=200000&caryear_min=2016" },
  { label: "Brisbane", url: "https://www.gumtree.com.au/s-cars-vans-utes/brisbane/c18320l3005721?sort=date&carmileageinkms_max=200000&caryear_min=2016" },
  { label: "Perth", url: "https://www.gumtree.com.au/s-cars-vans-utes/perth/c18320l3008463?sort=date&carmileageinkms_max=200000&caryear_min=2016" },
  { label: "Adelaide", url: "https://www.gumtree.com.au/s-cars-vans-utes/adelaide/c18320l3006753?sort=date&carmileageinkms_max=200000&caryear_min=2016" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const startUrls = SEARCHES.map((s) => ({ url: s.url }));

    console.log(`Gumtree cron: dispatching ${startUrls.length} city sweeps`);

    const scanResponse = await fetch(
      `${supabaseUrl}/functions/v1/gumtree-scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          startUrls,
          limit: 500,
        }),
      }
    );

    const result = await scanResponse.json();

    if (!scanResponse.ok) {
      throw new Error(`gumtree-scan returned ${scanResponse.status}: ${JSON.stringify(result)}`);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase
      .from("cron_heartbeat")
      .upsert({
        cron_name: "gumtree-scan-cron",
        last_seen_at: new Date().toISOString(),
        last_ok: true,
        note: `Dispatched ${startUrls.length} city sweeps`,
      }, { onConflict: "cron_name" });

    console.log("Gumtree cron complete:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Gumtree cron error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert({
          cron_name: "gumtree-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: false,
          note: errorMsg.slice(0, 200),
        }, { onConflict: "cron_name" });
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
