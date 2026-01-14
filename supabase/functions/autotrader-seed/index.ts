import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Time budget to stay under 30s platform timeout
const TIME_BUDGET_MS = 28000;
const LOCK_DURATION_MS = 120000; // 2 minute lock

// Seed configuration - targeting ~5k listings initially
const MAKES_TO_SEED = ["Toyota", "Mazda", "Honda", "Hyundai", "Kia", "Mitsubishi", "Nissan", "Subaru", "Ford", "Holden"];
const STATES_TO_SEED = ["nsw", "vic", "qld", "sa", "wa"];

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
    
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const actorId = Deno.env.get("APIFY_ACTOR_ID_AUTOTRADER_AU") || "fayoussef/autotrader-au-scraper";
    
    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    const now = new Date();

    // Fetch current cursor
    const { data: cursorRow, error: cursorError } = await supabase
      .from("retail_seed_cursor_autotrader")
      .select("*")
      .single();

    if (cursorError || !cursorRow) {
      throw new Error(`Failed to fetch autotrader cursor: ${cursorError?.message}`);
    }

    const cursor = cursorRow;

    // Check if already done
    if (cursor.status === "done") {
      const lastDoneLog = cursor.last_done_log_at ? new Date(cursor.last_done_log_at) : null;
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      if (!lastDoneLog || lastDoneLog < oneDayAgo) {
        await supabase
          .from("retail_seed_cursor_autotrader")
          .update({ last_done_log_at: now.toISOString() })
          .eq("id", cursor.id);

        await supabase.from("cron_audit_log").insert({
          cron_name: "autotrader-seed",
          success: true,
          result: { status: "done", message: "Seeding complete, daily ping" },
          run_date: now.toISOString().split("T")[0],
        });
      }

      return new Response(JSON.stringify({ status: "done", message: "Seeding already complete" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check lock
    if (cursor.locked_until && new Date(cursor.locked_until) > now) {
      console.log(`Skipping: locked until ${cursor.locked_until}`);
      return new Response(JSON.stringify({ 
        status: "locked", 
        locked_until: cursor.locked_until 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Acquire lock atomically
    const lockToken = crypto.randomUUID();
    const lockUntil = new Date(now.getTime() + LOCK_DURATION_MS).toISOString();
    
    await supabase
      .from("retail_seed_cursor_autotrader")
      .update({ 
        locked_until: lockUntil, 
        lock_token: lockToken,
        status: cursor.status === "pending" ? "running" : cursor.status,
        started_at: cursor.started_at || now.toISOString(),
        updated_at: now.toISOString()
      })
      .eq("id", cursor.id)
      .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`);

    // Verify we got the lock
    const { data: lockCheck, error: lockCheckError } = await supabase
      .from("retail_seed_cursor_autotrader")
      .select("lock_token")
      .eq("id", cursor.id)
      .single();

    if (lockCheckError || lockCheck?.lock_token !== lockToken) {
      console.log(`Lock acquisition failed: another process got the lock`);
      return new Response(JSON.stringify({ 
        status: "lock_race", 
        message: "Lost lock race to another invocation"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Lock acquired: ${lockToken}`);

    const cursorBefore = {
      make_idx: cursor.make_idx,
      state_idx: cursor.state_idx,
      batch_idx: cursor.batch_idx,
    };

    // Process batches until time budget exhausted
    let batchesRun = 0;
    let runTotalNew = 0;
    let runTotalUpdated = 0;
    let runTotalEvals = 0;
    let runTotalErrors = 0;
    let make_idx = cursor.make_idx;
    let state_idx = cursor.state_idx;
    let batch_idx = cursor.batch_idx;
    let isDone = false;

    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Check if we've completed all combinations
      if (make_idx >= MAKES_TO_SEED.length) {
        isDone = true;
        break;
      }

      const make = MAKES_TO_SEED[make_idx];
      const state = STATES_TO_SEED[state_idx];

      console.log(`Batch ${batchesRun + 1}: ${make} / ${state}`);

      try {
        // Call autotrader-ingest with this make/state
        const ingestUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autotrader-ingest`;
        const ingestResponse = await fetch(ingestUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            search: make,
            state: state,
            year_min: 2016,
            limit: 100,
            run_mode: "seed",
          }),
        });

        const result = await ingestResponse.json();

        if (result.error) {
          console.error(`Ingest error for ${make}/${state}:`, result.error);
          runTotalErrors++;
        } else {
          runTotalNew += result.new_listings || 0;
          runTotalUpdated += result.updated_listings || 0;
          runTotalEvals += result.evaluations_triggered || 0;
          runTotalErrors += result.errors || 0;
          console.log(`${make}/${state}: ${result.new_listings} new, ${result.updated_listings} updated`);
        }

        batchesRun++;
        batch_idx++;

      } catch (err) {
        console.error(`Error processing ${make}/${state}:`, err);
        runTotalErrors++;
      }

      // Advance cursor
      state_idx++;
      if (state_idx >= STATES_TO_SEED.length) {
        state_idx = 0;
        make_idx++;
      }

      // Small delay between Apify calls to avoid rate limits
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Update cursor with final state (update totals only once at end)
    const newStatus = isDone ? "done" : "running";
    await supabase
      .from("retail_seed_cursor_autotrader")
      .update({
        make_idx,
        state_idx,
        batch_idx,
        batches_completed: (cursor.batches_completed || 0) + batchesRun,
        status: newStatus,
        completed_at: isDone ? now.toISOString() : null,
        locked_until: null,
        lock_token: null,
        updated_at: now.toISOString(),
        last_error: runTotalErrors > 0 ? `${runTotalErrors} errors this run` : null,
        total_new: (cursor.total_new || 0) + runTotalNew,
        total_updated: (cursor.total_updated || 0) + runTotalUpdated,
        total_evaluations: (cursor.total_evaluations || 0) + runTotalEvals,
        total_errors: (cursor.total_errors || 0) + runTotalErrors,
      })
      .eq("id", cursor.id);

    const results = {
      status: newStatus,
      batches_run: batchesRun,
      new_listings: runTotalNew,
      updated_listings: runTotalUpdated,
      evaluations: runTotalEvals,
      errors: runTotalErrors,
      cursor_before: cursorBefore,
      cursor_after: { make_idx, state_idx, batch_idx },
      elapsed_ms: Date.now() - startTime,
    };

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-seed",
      success: true,
      result: results,
      run_date: now.toISOString().split("T")[0],
    });

    console.log("Autotrader seed run complete:", results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Autotrader seed error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Release lock on error
    await supabase
      .from("retail_seed_cursor_autotrader")
      .update({ 
        locked_until: null, 
        lock_token: null,
        last_error: errorMsg,
        updated_at: new Date().toISOString()
      })
      .eq("id", "00000000-0000-0000-0000-000000000002");

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-seed",
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
