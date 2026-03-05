import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan-cron: Broad market sweep via Carsales.
 *
 * Runs on schedule. Builds wide search URLs (2016+, <200k km)
 * segmented by state to keep result counts manageable,
 * then calls carsales-scan to dispatch Apify runs.
 *
 * Schedule: every 2 hours during business hours
 */

const STATES = ["nsw", "vic", "qld", "wa", "sa"];
const YEAR_MIN = 2016;
const YEAR_MAX = 2026;
const KM_MAX = 200000;

function buildCarsalesUrl(state: string): string {
  // Carsales query syntax — broad sweep per state
  const stateMap: Record<string, string> = {
    nsw: "New South Wales",
    vic: "Victoria",
    qld: "Queensland",
    wa: "Western Australia",
    sa: "South Australia",
  };
  const stateName = stateMap[state] || state;
  return `https://www.carsales.com.au/cars/?q=(And.Service.carsales._.CarAll.year.range(${YEAR_MIN}..${YEAR_MAX})._.CarAll.odometer.range(..${KM_MAX})._.State.${encodeURIComponent(stateName)}.)&sort=~Price`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Build URLs for each state
    const startUrls = STATES.map((s) => ({ url: buildCarsalesUrl(s) }));

    console.log(`Carsales cron: dispatching ${startUrls.length} state sweeps`);

    // Call carsales-scan edge function internally
    const scanResponse = await fetch(
      `${supabaseUrl}/functions/v1/carsales-scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
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
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase
      .from("cron_heartbeat")
      .upsert({
        cron_name: "carsales-scan-cron",
        last_seen_at: new Date().toISOString(),
        last_ok: true,
        note: `Dispatched ${startUrls.length} state sweeps`,
      }, { onConflict: "cron_name" });

    console.log("Carsales cron complete:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Carsales cron error:", errorMsg);

    // Try to log failure heartbeat
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert({
          cron_name: "carsales-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: false,
          note: errorMsg.slice(0, 200),
        }, { onConflict: "cron_name" });
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
