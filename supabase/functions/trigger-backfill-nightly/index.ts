import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const configVersion = "v0_provisional";
    const batchSize = 200;

    // Run the backfill RPC
    const { data, error } = await supabase.rpc("run_trigger_backfill", {
      p_config_version: configVersion,
      p_batch_size: batchSize,
    });

    if (error) throw error;

    // Log to cron_audit_log
    await supabase.from("cron_audit_log").insert({
      cron_name: "trigger-backfill-nightly",
      success: true,
      result: data,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Trigger backfill complete:", data);

    return new Response(JSON.stringify({ success: true, ...data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Trigger backfill error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "trigger-backfill-nightly",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
