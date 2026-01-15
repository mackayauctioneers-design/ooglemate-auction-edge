import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Internal secret for cron→ingest calls - MUST be set in env
const INTERNAL_SECRET = Deno.env.get("AUTOTRADER_INTERNAL_SECRET");
if (!INTERNAL_SECRET) {
  throw new Error("AUTOTRADER_INTERNAL_SECRET not set - cannot run cron");
}

// Thin scheduler: 1 batch, 3 pages, run every 5 minutes
const BATCHES_PER_RUN = 1;
const PAGES_PER_BATCH = 3;
const TIME_BUDGET_MS = 20000; // 20s safety margin

serve(async (req) => {
  console.log("CRON TICK autotrader-api-cron", new Date().toISOString());
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

    // Create source_run for this cron tick (lifecycle tracking)
    const { data: runData, error: runError } = await supabase
      .from("source_runs")
      .insert({ source: "autotrader", meta: { trigger: "cron" } })
      .select("run_id")
      .single();

    const runId = runData?.run_id ?? null;
    if (runError) {
      console.error("Failed to create source_run:", runError.message);
    } else {
      console.log(`Created source_run: ${runId}`);
    }

    const results = {
      run_id: runId,
      batches_claimed: 0,
      batches_completed: 0,
      total_new: 0,
      total_updated: 0,
      total_relisted: 0,
      total_raw_stored: 0,
      errors: [] as string[],
      batches: [] as { 
        cursor_id: string;
        make: string; 
        state: string; 
        page: number;
        new: number; 
        updated: number;
        relisted: number;
        has_more: boolean;
      }[],
      elapsed_ms: 0,
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
      // Update source_run as finished with 0 records
      if (runId) {
        await supabase.from("source_runs").update({ 
          finished_at: new Date().toISOString(),
          listings_processed: 0,
        }).eq("run_id", runId);
      }
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No batches to process",
        ...results 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    results.batches_claimed = claimedBatches.length;
    console.log(`Claimed ${claimedBatches.length} batches`);

    // Process each claimed batch (should be just 1)
    for (const batch of claimedBatches) {
      // Time budget check
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log("Time budget exhausted, stopping");
        break;
      }

      try {
        console.log(`Processing: ${batch.make} in ${batch.state}, page ${batch.next_page}`);

        // Call ingest function with internal secret + run_id for lifecycle tracking
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
            run_id: runId, // Lifecycle tracking
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const errMsg = `${batch.make}/${batch.state}: ${response.status}`;
          results.errors.push(errMsg);
          console.error(errMsg, errorText.slice(0, 100));

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
        results.total_relisted += data.relisted_listings || 0;
        results.total_raw_stored += data.raw_payloads_stored || 0;

        results.batches.push({
          cursor_id: batch.cursor_id,
          make: batch.make,
          state: batch.state,
          page: batch.next_page,
          new: data.new_listings || 0,
          updated: data.updated_listings || 0,
          relisted: data.relisted_listings || 0,
          has_more: data.has_more || false,
        });

        console.log(`${batch.make}/${batch.state} p${batch.next_page}: ${data.new_listings} new, ${data.relisted_listings || 0} relisted, has_more: ${data.has_more}`);

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${batch.make}/${batch.state}: ${errMsg}`);
        console.error(`Error:`, errMsg);
      }
    }

    results.elapsed_ms = Date.now() - startTime;

    // Finalize source_run with counts
    if (runId) {
      await supabase.from("source_runs").update({
        finished_at: new Date().toISOString(),
        listings_processed: results.total_raw_stored,
        listings_new: results.total_new,
        listings_updated: results.total_updated,
        meta: { 
          trigger: "cron", 
          relisted: results.total_relisted,
          batches: results.batches_completed,
          elapsed_ms: results.elapsed_ms,
        },
      }).eq("run_id", runId);
    }

    // Build audit row with summary (avoid huge payloads)
    const auditRow = {
      cron_name: "autotrader-api-cron",
      success: results.errors.length === 0,
      result: {
        run_id: runId,
        total_new: results.total_new,
        total_updated: results.total_updated,
        total_relisted: results.total_relisted,
        batches_completed: results.batches_completed,
        elapsed_ms: results.elapsed_ms,
        errors: results.errors.slice(0, 5),
      },
      run_date: new Date().toISOString().split("T")[0],
    };

    // Log to audit
    const { error: auditError } = await supabase.from("cron_audit_log").insert(auditRow);
    if (auditError) {
      console.error("AUDIT INSERT FAILED", auditError);
      console.error("AUDIT ROW", JSON.stringify(auditRow).slice(0, 2000));
    } else {
      console.log("AUDIT INSERT OK");
    }

    // Heartbeat - guaranteed signal
    await supabase.from("cron_heartbeat").upsert({
      cron_name: "autotrader-api-cron",
      last_seen_at: new Date().toISOString(),
      last_ok: results.errors.length === 0,
      note: `new=${results.total_new} relisted=${results.total_relisted} ms=${results.elapsed_ms}`,
    });

    console.log(`Cron complete: ${results.total_new} new, ${results.total_relisted} relisted, ${results.elapsed_ms}ms`);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Cron error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const errorAuditRow = {
      cron_name: "autotrader-api-cron",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    };
    const { error: auditError } = await supabase.from("cron_audit_log").insert(errorAuditRow);
    if (auditError) {
      console.error("AUDIT INSERT FAILED (catch)", auditError);
      console.error("AUDIT ROW", JSON.stringify(errorAuditRow));
    }

    // Heartbeat even on error
    await supabase.from("cron_heartbeat").upsert({
      cron_name: "autotrader-api-cron",
      last_seen_at: new Date().toISOString(),
      last_ok: false,
      note: `error: ${errorMsg.slice(0, 100)}`,
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
