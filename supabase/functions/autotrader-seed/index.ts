import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Time budget - enqueuing is fast, so we can do more
const TIME_BUDGET_MS = 25000;
const LOCK_DURATION_MS = 120000; // 2 minute lock

// Seed configuration - targeting ~5k listings initially
const MAKES_TO_SEED = ["Toyota", "Mazda", "Honda", "Hyundai", "Kia", "Mitsubishi", "Nissan", "Subaru", "Ford", "Holden"];
const STATES_TO_SEED = ["nsw", "vic", "qld", "sa", "wa"];

/**
 * autotrader-seed: ENQUEUE ONLY
 * 
 * This function enqueues Apify runs for make/state combinations.
 * It does NOT wait for results - just kicks off runs and tracks cursor.
 * 
 * Flow:
 * 1. Read cursor position (make_idx, state_idx)
 * 2. Enqueue Apify runs for remaining combos
 * 3. Update cursor
 * 4. Return immediately
 * 
 * autotrader-fetch handles the actual data fetching and upserting.
 */

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

    // Enqueue runs until time budget exhausted or done
    let runsEnqueued = 0;
    let make_idx = cursor.make_idx;
    let state_idx = cursor.state_idx;
    let batch_idx = cursor.batch_idx;
    let isDone = false;
    const enqueuedRuns: Array<{ make: string; state: string; run_id?: string }> = [];

    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Check if we've completed all combinations
      if (make_idx >= MAKES_TO_SEED.length) {
        isDone = true;
        break;
      }

      const make = MAKES_TO_SEED[make_idx];
      const state = STATES_TO_SEED[state_idx];

      console.log(`Enqueuing: ${make} / ${state}`);

      try {
        // Build Autotrader search URL for this make/state
        const searchUrl = `https://www.autotrader.com.au/cars/${make.toLowerCase()}?state=${state.toLowerCase()}&yearfrom=2016`;
        
        // Build Apify actor input with start_urls
        const actorInput = {
          start_urls: [{ url: searchUrl }],
          maxItems: 100,
        };

        // Start Apify run with waitForFinish=0 (returns immediately)
        // For private actors owned by your account, just use the actor ID directly
        console.log(`Calling Apify actor ID: ${actorId}`);
        const runResponse = await fetch(
          `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}&waitForFinish=0`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(actorInput),
          }
        );

        if (!runResponse.ok) {
          const err = await runResponse.text();
          console.error(`Apify run start failed for ${make}/${state}: ${err}`);
          enqueuedRuns.push({ make, state, run_id: undefined });
        } else {
          const runData = await runResponse.json();
          const runId = runData.data?.id;
          const datasetId = runData.data?.defaultDatasetId;

          if (runId) {
            // Queue for processing
            await supabase
              .from("apify_runs_queue")
              .insert({
                source: "autotrader",
                run_id: runId,
                dataset_id: datasetId,
                input: { search: make, state, year_min: 2016, limit: 100 },
                status: "queued",
              });

            enqueuedRuns.push({ make, state, run_id: runId });
            console.log(`Enqueued ${make}/${state}: run_id=${runId}`);
          } else {
            enqueuedRuns.push({ make, state, run_id: undefined });
          }
        }

        runsEnqueued++;
        batch_idx++;

      } catch (err) {
        console.error(`Error enqueuing ${make}/${state}:`, err);
        enqueuedRuns.push({ make, state, run_id: undefined });
      }

      // Advance cursor
      state_idx++;
      if (state_idx >= STATES_TO_SEED.length) {
        state_idx = 0;
        make_idx++;
      }

      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    }

    // Update cursor with final state
    const newStatus = isDone ? "done" : "running";
    await supabase
      .from("retail_seed_cursor_autotrader")
      .update({
        make_idx,
        state_idx,
        batch_idx,
        batches_completed: (cursor.batches_completed || 0) + runsEnqueued,
        status: newStatus,
        completed_at: isDone ? now.toISOString() : null,
        locked_until: null,
        lock_token: null,
        updated_at: now.toISOString(),
      })
      .eq("id", cursor.id);

    const results = {
      status: newStatus,
      runs_enqueued: runsEnqueued,
      cursor_before: cursorBefore,
      cursor_after: { make_idx, state_idx, batch_idx },
      enqueued_runs: enqueuedRuns,
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
