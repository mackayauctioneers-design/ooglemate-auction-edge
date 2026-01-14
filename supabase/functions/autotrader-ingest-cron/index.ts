import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Maintenance configuration - runs during AU business hours
const MAKES_TO_CRAWL = ["Toyota", "Mazda", "Honda", "Hyundai", "Kia", "Mitsubishi", "Nissan", "Subaru", "Ford", "Volkswagen"];
const STATES = ["nsw", "vic", "qld", "sa", "wa"];
const BATCHES_PER_RUN = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    // Check seed status - only run maintenance after seed is done
    const { data: seedCursor } = await supabase
      .from("retail_seed_cursor_autotrader")
      .select("status")
      .single();

    if (seedCursor?.status !== "done") {
      console.log("Skipping maintenance: seed still in progress");
      return new Response(JSON.stringify({ 
        status: "skipped", 
        reason: "seed in progress",
        seed_status: seedCursor?.status 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Randomly select make/state combinations
    const batches: Array<{ make: string; state: string }> = [];
    for (let i = 0; i < BATCHES_PER_RUN; i++) {
      const make = MAKES_TO_CRAWL[Math.floor(Math.random() * MAKES_TO_CRAWL.length)];
      const state = STATES[Math.floor(Math.random() * STATES.length)];
      batches.push({ make, state });
    }

    console.log(`Running ${batches.length} maintenance batches:`, batches);

    const results = {
      batches_run: 0,
      total_new: 0,
      total_updated: 0,
      total_evals: 0,
      total_errors: 0,
      batch_details: [] as Array<{ make: string; state: string; new: number; updated: number }>,
    };

    for (const batch of batches) {
      try {
        const ingestUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autotrader-ingest`;
        const response = await fetch(ingestUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            search: batch.make,
            state: batch.state,
            year_min: 2016,
            limit: 50,
            run_mode: "maintenance",
          }),
        });

        const result = await response.json();
        
        if (result.error) {
          console.error(`Error for ${batch.make}/${batch.state}:`, result.error);
          results.total_errors++;
        } else {
          results.total_new += result.new_listings || 0;
          results.total_updated += result.updated_listings || 0;
          results.total_evals += result.evaluations_triggered || 0;
          results.batch_details.push({
            make: batch.make,
            state: batch.state,
            new: result.new_listings || 0,
            updated: result.updated_listings || 0,
          });
        }
        
        results.batches_run++;

        // Rate limiting delay
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.error(`Batch error ${batch.make}/${batch.state}:`, err);
        results.total_errors++;
      }
    }

    // Mark stale Autotrader listings as delisted (not seen in 3 days)
    const { data: staleCount, error: staleError } = await supabase.rpc("mark_stale_listings_delisted", {
      p_stale_days: 3,
      p_source: "autotrader"
    });

    if (staleError) {
      console.warn("Delist sweep error:", staleError.message);
    } else {
      console.log(`Delisted ${staleCount || 0} stale Autotrader listings`);
    }

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-maintenance",
      success: true,
      result: { ...results, stale_delisted: staleCount || 0 },
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Autotrader maintenance complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Autotrader maintenance error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-maintenance",
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
