import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * slattery-scan-cron: Scheduled trigger for Slattery Auctions scraper.
 *
 * Dispatches a stub-mode scan to discover new auction listings,
 * then calls slattery-scan to start the Apify actor.
 *
 * Schedule: every 2 hours
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    console.log("Slattery cron: dispatching stub scan");

    // Call slattery-scan edge function internally
    const scanResponse = await fetch(
      `${supabaseUrl}/functions/v1/slattery-scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          mode: "stub",
          maxPages: 10,
          batchSize: 50,
        }),
      }
    );

    const result = await scanResponse.json();

    if (!scanResponse.ok) {
      throw new Error(`slattery-scan returned ${scanResponse.status}: ${JSON.stringify(result)}`);
    }

    // Log heartbeat
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase
      .from("cron_heartbeat")
      .upsert({
        cron_name: "slattery-scan-cron",
        last_seen_at: new Date().toISOString(),
        last_ok: true,
        note: "Dispatched stub scan",
      }, { onConflict: "cron_name" });

    console.log("Slattery cron complete:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Slattery cron error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert({
          cron_name: "slattery-scan-cron",
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
