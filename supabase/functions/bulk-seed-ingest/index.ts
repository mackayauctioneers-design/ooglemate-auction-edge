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
const DELAY_MS = 2000;
const TIME_BUDGET_MS = 45000; // 45 seconds

serve(async (req) => {
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Read cursor
    const { data: cursor, error: cursorError } = await supabase
      .from("retail_seed_cursor")
      .select("*")
      .limit(1)
      .single();

    if (cursorError) {
      throw new Error(`Failed to read cursor: ${cursorError.message}`);
    }

    // If already done, skip
    if (cursor.status === "done") {
      return new Response(JSON.stringify({ 
        status: "done", 
        message: "Bulk seed already completed",
        completed_at: cursor.completed_at
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cursorBefore = {
      make_idx: cursor.make_idx,
      state_idx: cursor.state_idx,
      page: cursor.page,
      status: cursor.status,
    };

    // Mark as running
    if (cursor.status === "pending") {
      await supabase
        .from("retail_seed_cursor")
        .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", cursor.id);
    }

    const results = {
      batches_run: 0,
      new_listings: 0,
      updated_listings: 0,
      evaluations: 0,
      errors: 0,
      error_samples: [] as string[],
    };

    let makeIdx = cursor.make_idx;
    let stateIdx = cursor.state_idx;
    let page = cursor.page;
    let completed = false;

    // Loop through combinations with time budget
    outer: while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Check if we've completed all combinations
      if (makeIdx >= TOP_MAKES.length) {
        completed = true;
        break;
      }

      const make = TOP_MAKES[makeIdx];
      const state = STATES[stateIdx];

      try {
        console.log(`Batch: ${make} / ${state} / page ${page} (make ${makeIdx + 1}/${TOP_MAKES.length})`);

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
          const errText = await response.text().catch(() => "Unknown error");
          console.error(`Batch failed: ${make}/${state}/${page}: ${errText}`);
          results.errors++;
          if (results.error_samples.length < 5) {
            results.error_samples.push(`${make}/${state}/${page}: ${errText.slice(0, 100)}`);
          }
        } else {
          const data = await response.json();
          results.new_listings += data.new_listings || 0;
          results.updated_listings += data.updated_listings || 0;
          results.evaluations += data.evaluations_triggered || 0;
        }

        results.batches_run++;

        // Advance cursor
        page++;
        if (page > PAGES.length) {
          page = 1;
          stateIdx++;
          if (stateIdx >= STATES.length) {
            stateIdx = 0;
            makeIdx++;
          }
        }

        // Persist cursor after every batch
        await supabase
          .from("retail_seed_cursor")
          .update({
            make_idx: makeIdx,
            state_idx: stateIdx,
            page: page,
            batches_completed: cursor.batches_completed + results.batches_run,
            total_new: cursor.total_new + results.new_listings,
            total_updated: cursor.total_updated + results.updated_listings,
            total_evaluations: cursor.total_evaluations + results.evaluations,
            total_errors: cursor.total_errors + results.errors,
            last_error: results.error_samples.length > 0 ? results.error_samples[0] : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cursor.id);

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Batch error: ${errMsg}`);
        results.errors++;
        if (results.error_samples.length < 5) {
          results.error_samples.push(`${make}/${state}/${page}: ${errMsg.slice(0, 100)}`);
        }

        // Still advance to avoid getting stuck
        page++;
        if (page > PAGES.length) {
          page = 1;
          stateIdx++;
          if (stateIdx >= STATES.length) {
            stateIdx = 0;
            makeIdx++;
          }
        }
      }
    }

    // Final cursor state
    const cursorAfter = {
      make_idx: makeIdx,
      state_idx: stateIdx,
      page: page,
      status: completed ? "done" : "running",
    };

    // Update cursor with final state
    await supabase
      .from("retail_seed_cursor")
      .update({
        make_idx: makeIdx,
        state_idx: stateIdx,
        page: page,
        status: completed ? "done" : "running",
        completed_at: completed ? new Date().toISOString() : null,
        batches_completed: cursor.batches_completed + results.batches_run,
        total_new: cursor.total_new + results.new_listings,
        total_updated: cursor.total_updated + results.updated_listings,
        total_evaluations: cursor.total_evaluations + results.evaluations,
        total_errors: cursor.total_errors + results.errors,
        last_error: results.error_samples.length > 0 ? results.error_samples[0] : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cursor.id);

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "bulk-seed-ingest",
      success: results.errors === 0 || results.batches_run > 0,
      result: {
        cursor_before: cursorBefore,
        cursor_after: cursorAfter,
        batches_run: results.batches_run,
        new_listings: results.new_listings,
        updated_listings: results.updated_listings,
        evaluations: results.evaluations,
        errors: results.errors,
        error_samples: results.error_samples,
        elapsed_ms: Date.now() - startTime,
        completed: completed,
      },
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Bulk seed chunk complete:", cursorAfter, results);

    return new Response(JSON.stringify({ 
      success: true, 
      status: completed ? "done" : "running",
      cursor_before: cursorBefore,
      cursor_after: cursorAfter,
      ...results,
      elapsed_ms: Date.now() - startTime,
    }), {
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
