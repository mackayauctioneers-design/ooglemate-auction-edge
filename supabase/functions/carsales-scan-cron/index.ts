import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan-cron: Broad market sweep across all states.
 *
 * Strategy: Ingest everything 2020+, <120k km, segmented by state.
 * Sorting/scoring happens downstream — cast the widest net possible.
 *
 * Schedule: every 30 minutes
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;

const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

function buildBroadSweepUrl(state: string): string {
  const q = `(And.Year.range(${YEAR_MIN}..)._.Odometer.range(..${KM_MAX})._.State.${state})`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~Price`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Dispatch ONE run per state to avoid Apify timeouts on massive sweeps
    const results = [];
    for (const state of STATES) {
      const stateUrl = buildBroadSweepUrl(state);
      
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
              limit: 500,
            }),
          }
        );

        const result = await scanResponse.json();
        if (!scanResponse.ok) {
          console.error(`[${state}] carsales-scan error: ${JSON.stringify(result)}`);
          results.push({ state, error: result.error });
        } else {
          console.log(`[${state}] queued: run ${result.apify_run_id}`);
          results.push({ state, run_id: result.apify_run_id, queued: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${state}] dispatch failed: ${msg}`);
        results.push({ state, error: msg });
      }
    }

    const queued = results.filter(r => r.queued).length;
    const failed = results.filter(r => r.error).length;

    // Log heartbeat
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `${queued}/${STATES.length} states queued, ${failed} failed`,
        },
        { onConflict: "cron_name" }
      );

    console.log(`Carsales cron complete: ${queued} queued, ${failed} failed`);

    return new Response(JSON.stringify({ success: true, queued, failed, results }), {
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
    } catch (_) {
      /* best effort */
    }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
