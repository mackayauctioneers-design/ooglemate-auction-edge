import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Run daily at 2am AEST to mark stale listings as delisted
// Uses the new lifecycle-aware mark_listings_delisted RPC
serve(async (req) => {
  console.log("STALE SWEEP autotrader", new Date().toISOString());
  
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

    // Use the new lifecycle-aware RPC that sets lifecycle_status = 'DELISTED'
    const { data, error: staleError } = await supabase.rpc("mark_listings_delisted", {
      p_source: "autotrader",
      p_stale_interval: "3 days",
    });

    if (staleError) {
      results.error = staleError.message;
      console.error("Stale sweep error:", staleError.message);
    } else {
      results.stale_marked = data || 0;
      console.log(`Marked ${results.stale_marked} stale listings as DELISTED`);
    }

    // Log to audit
    const { error: auditError } = await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-stale-sweep",
      success: !results.error,
      result: results,
      error: results.error,
      run_date: new Date().toISOString().split("T")[0],
    });

    if (auditError) {
      console.error("AUDIT INSERT FAILED", auditError);
    }

    // Heartbeat - guaranteed signal
    await supabase.from("cron_heartbeat").upsert({
      cron_name: "autotrader-stale-sweep",
      last_seen_at: new Date().toISOString(),
      last_ok: !results.error,
      note: `delisted=${results.stale_marked}`,
    });

    return new Response(JSON.stringify({ success: !results.error, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Stale sweep error:", errorMsg);

    // Try to log heartbeat even on error
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase.from("cron_heartbeat").upsert({
        cron_name: "autotrader-stale-sweep",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `error: ${errorMsg.slice(0, 100)}`,
      });
    } catch {
      // Ignore heartbeat errors
    }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});