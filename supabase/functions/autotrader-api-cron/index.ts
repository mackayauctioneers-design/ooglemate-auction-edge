import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Makes and states to crawl systematically
const MAKES_TO_CRAWL = [
  "Toyota", "Mazda", "Honda", "Hyundai", "Kia", 
  "Mitsubishi", "Nissan", "Subaru", "Ford", "Volkswagen",
  "BMW", "Mercedes-Benz", "Audi", "Lexus"
];

const STATES = ["NSW", "VIC", "QLD", "SA", "WA"];

const BATCHES_PER_RUN = 5; // Number of make/state combinations per cron run

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const results = {
      batches_run: 0,
      total_new: 0,
      total_updated: 0,
      total_raw_stored: 0,
      errors: [] as string[],
      batches: [] as { make: string; state: string; new: number; updated: number }[],
    };

    // Randomly select make/state combinations to spread coverage
    const shuffledMakes = [...MAKES_TO_CRAWL].sort(() => Math.random() - 0.5);
    const shuffledStates = [...STATES].sort(() => Math.random() - 0.5);

    const batches: { make: string; state: string }[] = [];
    for (let i = 0; i < BATCHES_PER_RUN; i++) {
      batches.push({
        make: shuffledMakes[i % shuffledMakes.length],
        state: shuffledStates[i % shuffledStates.length],
      });
    }

    for (const batch of batches) {
      try {
        console.log(`Processing: ${batch.make} in ${batch.state}`);

        const response = await fetch(`${supabaseUrl}/functions/v1/autotrader-api-ingest`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            make: batch.make,
            state: batch.state,
            year_min: 2016,
            max_pages: 5, // 5 pages × 48 = 240 listings per batch
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          results.errors.push(`${batch.make}/${batch.state}: ${response.status} - ${errorText.slice(0, 100)}`);
          continue;
        }

        const data = await response.json();
        results.batches_run++;
        results.total_new += data.new_listings || 0;
        results.total_updated += data.updated_listings || 0;
        results.total_raw_stored += data.raw_payloads_stored || 0;

        results.batches.push({
          make: batch.make,
          state: batch.state,
          new: data.new_listings || 0,
          updated: data.updated_listings || 0,
        });

        console.log(`${batch.make}/${batch.state}: ${data.new_listings} new, ${data.updated_listings} updated`);

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${batch.make}/${batch.state}: ${errMsg}`);
        console.error(`Error processing ${batch.make}/${batch.state}:`, errMsg);
      }
    }

    // Mark stale listings as delisted (not seen in 3 days)
    const { error: staleError } = await supabase.rpc("mark_stale_listings_delisted", {
      p_source: "autotrader",
      p_stale_days: 3,
    });

    if (staleError) {
      console.warn("Stale listings cleanup error:", staleError.message);
    }

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-api-cron",
      success: results.errors.length === 0,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("AutoTrader API cron complete:", JSON.stringify(results, null, 2));

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("AutoTrader API cron error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-api-cron",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
