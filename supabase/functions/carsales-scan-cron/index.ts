import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan-cron v2.0 — Light monitoring mode
 *
 * Strategy shift: Carsales = reference pricing, not primary sourcing.
 * Sort by NEWEST → only grab fresh listings → dedup downstream.
 *
 * Changes from v1:
 *  - Sort by ~DateAdded (newest first) instead of ~Price
 *  - Limit 50 items per state (was 500) — catches new listings only
 *  - Only scan 4 high-volume states (NSW, VIC, QLD, WA) — covers ~85% of market
 *  - SA, TAS, ACT, NT run on alternate cycles (odd/even hour)
 *
 * Cost impact: ~200 items/run vs ~4000 = 95% reduction
 * Schedule: every 2 hours (unchanged)
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;

// Primary states — every run
const PRIMARY_STATES = ["NSW", "VIC", "QLD", "WA"];
// Secondary states — alternate runs only
const SECONDARY_STATES = ["SA", "TAS", "ACT", "NT"];

const ITEMS_PER_STATE = 50; // Only newest 50

function buildNewestUrl(state: string): string {
  const q = `(And.Year.range(${YEAR_MIN}..)._.Odometer.range(..${KM_MAX})._.State.${state})`;
  // Sort by ~DateAdded = newest first (was ~Price)
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~DateAdded`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Emergency kill switch ──
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

    // Determine if this is an odd or even hour cycle
    const currentHour = new Date().getUTCHours();
    const isEvenCycle = currentHour % 4 === 0; // every other 2h cycle

    // Primary states always run; secondary only on even cycles
    const statesToScan = isEvenCycle
      ? [...PRIMARY_STATES, ...SECONDARY_STATES]
      : PRIMARY_STATES;

    console.log(`Carsales light scan: ${statesToScan.length} states, ${ITEMS_PER_STATE} items each (${isEvenCycle ? "full" : "primary only"})`);

    const results = [];
    for (let i = 0; i < statesToScan.length; i++) {
      const state = statesToScan[i];
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
            // Update the result entry from error to success
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
          note: `v2 light: ${queued}/${statesToScan.length} states, ~${estItems} items (was ~4000)`,
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
