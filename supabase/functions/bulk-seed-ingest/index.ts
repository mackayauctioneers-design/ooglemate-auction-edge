import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOP_MAKES = [
  "Toyota", "Mazda", "Hyundai", "Kia", "Ford",
  "Mitsubishi", "Nissan", "Honda", "Subaru", "Volkswagen",
  "Mercedes-Benz", "BMW", "Audi", "Holden", "Suzuki"
];

const STATES = ["nsw", "vic", "qld", "wa", "sa"];
const PAGES = [1, 2, 3];
const LIMIT_PER_PAGE = 40;
const DELAY_MS = 2000; // 2 seconds between requests

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

    const body = await req.json().catch(() => ({}));
    const { 
      make_index = 0,  // Which make to start from (0-14)
      max_batches = 15 // Process max 15 batches per invocation (~45s with delays)
    } = body;

    const results = {
      make_index_started: make_index,
      batches_run: 0,
      total_new: 0,
      total_updated: 0,
      total_evaluations: 0,
      errors: 0,
      next_make_index: make_index,
    };

    let batchCount = 0;
    let currentMakeIndex = make_index;

    // Generate all batch combinations starting from make_index
    outer: for (let mi = make_index; mi < TOP_MAKES.length; mi++) {
      const make = TOP_MAKES[mi];
      for (const state of STATES) {
        for (const page of PAGES) {
          if (batchCount >= max_batches) {
            results.next_make_index = mi;
            break outer;
          }

          batchCount++;
          results.batches_run++;

          try {
            console.log(`Batch ${batchCount}/${max_batches}: ${make} / ${state} / page ${page}`);

            const response = await fetch(`${supabaseUrl}/functions/v1/gumtree-ingest`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                make,
                state,
                page,
                year_min: 2016,
                limit: LIMIT_PER_PAGE,
              }),
            });

            if (!response.ok) {
              console.error(`Batch failed: ${make}/${state}/${page}`);
              results.errors++;
              continue;
            }

            const data = await response.json();
            results.total_new += data.new_listings || 0;
            results.total_updated += data.updated_listings || 0;
            results.total_evaluations += data.evaluations_triggered || 0;

            // Rate limit delay
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
          } catch (err) {
            console.error(`Batch error: ${err}`);
            results.errors++;
          }
        }
      }
      currentMakeIndex = mi + 1;
    }

    results.next_make_index = currentMakeIndex;

    // Log this chunk to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: `bulk-seed-chunk-${make_index}`,
      success: true,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Bulk seed chunk complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Bulk seed error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
