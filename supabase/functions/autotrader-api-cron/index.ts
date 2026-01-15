import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Internal secret for cron→ingest calls (matches ingest function)
const INTERNAL_SECRET = Deno.env.get("AUTOTRADER_INTERNAL_SECRET") || "autotrader-internal-v1";
const BATCHES_PER_RUN = 5;
const PAGES_PER_BATCH = 5;

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

    const results = {
      batches_claimed: 0,
      batches_completed: 0,
      total_new: 0,
      total_updated: 0,
      total_raw_stored: 0,
      errors: [] as string[],
      batches: [] as { 
        cursor_id: string;
        make: string; 
        state: string; 
        page: number;
        new: number; 
        updated: number;
        has_more: boolean;
      }[],
    };

    // Claim batches atomically using cursor table
    const { data: claimedBatches, error: claimError } = await supabase.rpc("claim_autotrader_crawl_batch", {
      p_batch_size: BATCHES_PER_RUN,
    });

    if (claimError) {
      console.error("Failed to claim batches:", claimError.message);
      throw new Error(`Claim failed: ${claimError.message}`);
    }

    if (!claimedBatches || claimedBatches.length === 0) {
      console.log("No batches available to claim");
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No batches to process",
        ...results 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    results.batches_claimed = claimedBatches.length;
    console.log(`Claimed ${claimedBatches.length} batches:`, claimedBatches);

    // Process each claimed batch
    for (const batch of claimedBatches) {
      try {
        console.log(`Processing: ${batch.make} in ${batch.state}, page ${batch.next_page}`);

        // Call ingest function with internal secret (not anon key)
        const response = await fetch(`${supabaseUrl}/functions/v1/autotrader-api-ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_SECRET,
          },
          body: JSON.stringify({
            cursor_id: batch.cursor_id,
            make: batch.make,
            state: batch.state,
            year_min: 2016,
            page_start: batch.next_page,
            max_pages: PAGES_PER_BATCH,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const errMsg = `${batch.make}/${batch.state}: ${response.status} - ${errorText.slice(0, 100)}`;
          results.errors.push(errMsg);
          console.error(errMsg);

          // Update cursor with error
          await supabase.rpc("update_autotrader_crawl_cursor", {
            p_cursor_id: batch.cursor_id,
            p_page_crawled: batch.next_page - 1,
            p_listings_found: 0,
            p_has_more: true,
            p_error: errMsg,
          });
          continue;
        }

        const data = await response.json();
        results.batches_completed++;
        results.total_new += data.new_listings || 0;
        results.total_updated += data.updated_listings || 0;
        results.total_raw_stored += data.raw_payloads_stored || 0;

        results.batches.push({
          cursor_id: batch.cursor_id,
          make: batch.make,
          state: batch.state,
          page: batch.next_page,
          new: data.new_listings || 0,
          updated: data.updated_listings || 0,
          has_more: data.has_more || false,
        });

        console.log(`${batch.make}/${batch.state} p${batch.next_page}: ${data.new_listings} new, ${data.updated_listings} updated, has_more: ${data.has_more}`);

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

    console.log("AutoTrader API cron complete:", JSON.stringify(results));

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
