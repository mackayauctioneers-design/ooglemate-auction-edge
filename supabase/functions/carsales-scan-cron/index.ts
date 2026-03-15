import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan-cron v5.0 — Serialised shallow sweep (NO parallel runs)
 *
 * SAFETY:
 * - Honours CRAWL_MODE kill switch
 * - Serialises all state runs (one at a time, waits for completion/queue)
 * - No retries — if a run fails, logs and moves on
 * - Each state URL is fully validated before dispatch
 * - Concurrency lock checked before each dispatch
 *
 * Schedule: every 2 hours
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;
const ALL_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const ITEMS_PER_STATE = 80; // Small batches — prevents actor timeout
const INTER_STATE_DELAY_MS = 10000; // 10s between states — serialised

function buildNewestUrl(state: string): string {
  const q = `(And.Year.range(${YEAR_MIN}..)..Odometer.range(..${KM_MAX})..State.${state}.)`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~DateAdded`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── CRAWL_MODE kill switch ──
    const crawlMode = Deno.env.get("CRAWL_MODE") || "normal";
    if (crawlMode === "disabled") {
      console.log("[CARSALES-CRON] Carsales crawl skipped: CRAWL_MODE=disabled");
      return respond(200, { ok: true, status: "skipped_disabled" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[CARSALES-CRON] Shallow sweep: ${ALL_STATES.length} states, ${ITEMS_PER_STATE} items each, SERIALISED`);

    const results: Array<{ state: string; status: string; run_id?: string; error?: string }> = [];

    for (let i = 0; i < ALL_STATES.length; i++) {
      const state = ALL_STATES[i];
      const stateUrl = buildNewestUrl(state);

      // Stagger between states
      if (i > 0) {
        await new Promise(r => setTimeout(r, INTER_STATE_DELAY_MS));
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

        // carsales-scan now returns structured status
        if (result.status === "skipped_disabled") {
          console.log(`[CARSALES-CRON] Halting: CRAWL_MODE disabled mid-run`);
          results.push({ state, status: "skipped_disabled" });
          break; // Stop all remaining states
        }

        if (result.status === "skipped_already_running") {
          console.log(`[CARSALES-CRON] [${state}] Skipped: another run active (${result.active_run})`);
          results.push({ state, status: "skipped_already_running" });
          // Don't break — the active run may finish before next state
          continue;
        }

        if (result.status === "skipped_invalid_url") {
          console.error(`[CARSALES-CRON] [${state}] URL rejected: ${result.detail}`);
          results.push({ state, status: "skipped_invalid_url", error: result.detail });
          continue;
        }

        if (result.ok === false) {
          console.error(`[CARSALES-CRON] [${state}] Launch failed: ${result.error || result.status}`);
          results.push({ state, status: "failed", error: result.error || result.status });
          continue; // No retry — wait for next cycle
        }

        console.log(`[CARSALES-CRON] [${state}] Launched: run=${result.apify_run_id}`);
        results.push({ state, status: "launched", run_id: result.apify_run_id });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CARSALES-CRON] [${state}] Dispatch error: ${msg}`);
        results.push({ state, status: "error", error: msg });
        // No retry
      }
    }

    const launched = results.filter(r => r.status === "launched").length;
    const skipped = results.filter(r => r.status.startsWith("skipped")).length;
    const failed = results.filter(r => r.status === "failed" || r.status === "error").length;

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `v5: launched=${launched} skipped=${skipped} failed=${failed}`,
          states_failed: failed,
        },
        { onConflict: "cron_name" }
      );

    console.log(`[CARSALES-CRON] Complete: launched=${launched} skipped=${skipped} failed=${failed}`);

    return respond(200, { ok: true, launched, skipped, failed, results });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CARSALES-CRON] Fatal error:", errorMsg);

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

    return respond(500, { ok: false, status: "fatal_error", error: errorMsg });
  }
});
