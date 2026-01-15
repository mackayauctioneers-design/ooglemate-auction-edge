import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Top makes to crawl systematically
const MAKES_TO_CRAWL = [
  "Toyota",
  "Mazda",
  "Hyundai",
  "Kia",
  "Ford",
  "Holden",
  "Mitsubishi",
  "Nissan",
  "Honda",
  "Subaru",
  "Volkswagen",
  "Mercedes-Benz",
  "BMW",
  "Audi",
];

const STATES = ["NSW", "VIC", "QLD", "SA", "WA"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const results = {
      batches_run: 0,
      total_new: 0,
      total_updated: 0,
      total_evaluations: 0,
      errors: [] as string[],
    };

    // Pick 5 random make/state/page combinations per run to maximize coverage
    const shuffledMakes = [...MAKES_TO_CRAWL].sort(() => Math.random() - 0.5);
    const shuffledStates = [...STATES].sort(() => Math.random() - 0.5);
    const pages = [1, 1, 1, 2, 2]; // Weight page 1 more heavily
    
    const batchesToRun = [
      { make: shuffledMakes[0], state: shuffledStates[0], page: pages[0] },
      { make: shuffledMakes[1], state: shuffledStates[1], page: pages[1] },
      { make: shuffledMakes[2], state: shuffledStates[2], page: pages[2] },
      { make: shuffledMakes[3], state: shuffledStates[3 % STATES.length], page: pages[3] },
      { make: shuffledMakes[4], state: shuffledStates[4 % STATES.length], page: pages[4] },
    ];

    for (const batch of batchesToRun) {
      try {
        console.log(`Running ingest for ${batch.make} in ${batch.state}`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/gumtree-ingest`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            make: batch.make,
            state: batch.state,
            page: batch.page || 1,
            year_min: 2016,
            limit: 40,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          results.errors.push(`${batch.make}/${batch.state}: ${errorText}`);
          continue;
        }

        const data = await response.json();
        results.batches_run++;
        results.total_new += data.new_listings || 0;
        results.total_updated += data.updated_listings || 0;
        results.total_evaluations += data.evaluations_triggered || 0;

        // Rate limit: wait 2 seconds between batches
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${batch.make}/${batch.state}: ${msg}`);
      }
    }

    // Mark stale listings as delisted
    const { data: delistedCount } = await supabase.rpc("mark_stale_listings_delisted", {
      p_stale_days: 3,
    });

    // Log results
    await supabase.from("cron_audit_log").insert({
      cron_name: "retail-ingest-cron",
      success: results.errors.length === 0,
      result: { ...results, delisted: delistedCount || 0 },
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Retail ingest cron complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Retail ingest cron error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
