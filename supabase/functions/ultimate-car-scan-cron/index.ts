import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * ultimate-car-scan-cron: Scheduled trigger for the ultimate-car-scan function.
 * Runs every 2 hours (offset :15) to sweep AU marketplace sources:
 *   CarsGuide, Drive, JustCars, OnlyCars
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Invoke ultimate-car-scan with default AU websites
    const res = await fetch(`${supabaseUrl}/functions/v1/ultimate-car-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        websites: ["autotraderau", "picklesau", "carsguideau", "driveau", "justcarsau", "onlycarsau"],
        pagesPerRun: 5,
        maxListings: 200,
      }),
    });

    const result = await res.json();
    console.log("Ultimate car scan cron result:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Ultimate car scan cron error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
