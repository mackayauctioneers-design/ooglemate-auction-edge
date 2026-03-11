import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan-cron v4.0 — OOM-safe shallow sweep
 *
 * Scans all 8 AU states with 200 items per state (down from 500).
 * Reduced depth prevents Apify actor OOM crashes.
 * Sort by ~DateAdded (newest first) to catch fresh inventory.
 * Target: ~1,200–1,600 listings per cycle.
 * Schedule: every 2 hours.
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;

const ALL_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

const ITEMS_PER_STATE = 500;

function buildNewestUrl(state: string): string {
  const q = `(And.Year.range(${YEAR_MIN}..)._.Odometer.range(..${KM_MAX})._.State.${state})`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~DateAdded`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const crawlMode = Deno.env.get("CRAWL_MODE") || "normal";
    if (crawlMode === "disabled") {
      console.log("Carsales cron: CRAWL_MODE=disabled, skipping");
      return new Response(JSON.stringify({ success: true, message: "crawl disabled via CRAWL_MODE" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Carsales full scan: ${ALL_STATES.length} states, ${ITEMS_PER_STATE} items each`);

    const results = [];
    for (let i = 0; i < ALL_STATES.length; i++) {
      const state = ALL_STATES[i];
      const stateUrl = buildNewestUrl(state);

      // Stagger launches: 5s delay between each state to reduce Apify contention
      if (i > 0) {
        await new Promise(r => setTimeout(r, 5000));
      }

      try {
        const scanResponse = await fetch(
          `${supabaseUrl}/functions/v1/carsales-scan`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              startUrls: [{ url: stateUrl }],
              limit: ITEMS_PER_STATE,
            }),
          }
        );

        const result = await scanResponse.json();
        if (!scanResponse.ok) {
          console.error(`[${state}] carsales-scan error: ${JSON.stringify(result)}`);
          results.push({ state, error: result.error });
        } else {
          console.log(`[${state}] queued: run ${result.apify_run_id} (limit ${ITEMS_PER_STATE})`);
          results.push({ state, run_id: result.apify_run_id, queued: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${state}] dispatch failed: ${msg}`);
        results.push({ state, error: msg });
      }
    }

    // Auto-retry failed states once with extra delay
    const failedStates = results.filter(r => r.error).map(r => r.state);
    if (failedStates.length > 0 && failedStates.length <= 4) {
      console.log(`Retrying ${failedStates.length} failed states: ${failedStates.join(", ")}`);
      await new Promise(r => setTimeout(r, 10000));

      for (const state of failedStates) {
        const stateUrl = buildNewestUrl(state);
        try {
          const retryResp = await fetch(
            `${supabaseUrl}/functions/v1/carsales-scan`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                startUrls: [{ url: stateUrl }],
                limit: ITEMS_PER_STATE,
              }),
            }
          );
          const retryResult = await retryResp.json();
          if (retryResp.ok) {
            const idx = results.findIndex(r => r.state === state && r.error);
            if (idx >= 0) {
              results[idx] = { state, run_id: retryResult.apify_run_id, queued: true, retried: true };
            }
            console.log(`[${state}] RETRY OK: run ${retryResult.apify_run_id}`);
          } else {
            console.error(`[${state}] RETRY failed: ${JSON.stringify(retryResult)}`);
          }
        } catch (_) { /* best effort retry */ }

        await new Promise(r => setTimeout(r, 5000));
      }
    }

    const queued = results.filter(r => r.queued).length;
    const failed = results.filter(r => r.error).length;
    const estItems = queued * ITEMS_PER_STATE;

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `v3 full: ${queued}/${ALL_STATES.length} states, ~${estItems} items`,
          states_failed: failed,
        },
        { onConflict: "cron_name" }
      );

    console.log(`Carsales cron complete: ${queued} queued (~${estItems} items), ${failed} failed`);

    return new Response(JSON.stringify({ success: true, queued, failed, estimated_items: estItems, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Carsales cron error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "carsales-scan-cron",
            last_seen_at: new Date().toISOString(),
            last_ok: false,
            note: errorMsg.slice(0, 200),
          },
          { onConflict: "cron_name" }
        );
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
