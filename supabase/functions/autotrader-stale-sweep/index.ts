import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Run daily at 2am AEST to mark stale listings as delisted
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const results = {
      stale_marked: 0,
      error: null as string | null,
    };

    // Mark stale listings as delisted (not seen in 3 days)
    const { data, error: staleError } = await supabase.rpc("mark_stale_listings_delisted", {
      p_source: "autotrader",
      p_stale_days: 3,
    });

    if (staleError) {
      results.error = staleError.message;
      console.error("Stale sweep error:", staleError.message);
    } else {
      results.stale_marked = data || 0;
      console.log(`Marked ${results.stale_marked} stale listings as delisted`);
    }

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-stale-sweep",
      success: !results.error,
      result: results,
      error: results.error,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ success: !results.error, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Stale sweep error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
