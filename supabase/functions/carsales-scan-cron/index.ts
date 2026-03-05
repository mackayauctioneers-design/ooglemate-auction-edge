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

    // Build one URL per state — broad sweep, no make/model filter
    const startUrls = STATES.map((state) => ({
      url: buildBroadSweepUrl(state),
    }));

    console.log(`Carsales cron: ${startUrls.length} state sweeps (${YEAR_MIN}+, <${KM_MAX}km)`);

    // Dispatch to carsales-scan
    const scanResponse = await fetch(
      `${supabaseUrl}/functions/v1/carsales-scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          startUrls,
          limit: 500,
        }),
      }
    );

    const result = await scanResponse.json();

    if (!scanResponse.ok) {
      throw new Error(`carsales-scan returned ${scanResponse.status}: ${JSON.stringify(result)}`);
    }

    // Log heartbeat
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: true,
          note: `Broad sweep: ${STATES.length} states, ${YEAR_MIN}+, <${KM_MAX}km`,
        },
        { onConflict: "cron_name" }
      );

    console.log("Carsales cron complete:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
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
