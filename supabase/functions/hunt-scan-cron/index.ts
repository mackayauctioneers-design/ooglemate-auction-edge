import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Call run-hunt-scan with run_all_due flag
    const response = await fetch(`${supabaseUrl}/functions/v1/run-hunt-scan`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ run_all_due: true }),
    });

    const result = await response.json();

    // Log to cron_heartbeat
    await supabase
      .from('cron_heartbeat')
      .upsert({
        cron_name: 'hunt-scan-cron',
        last_seen_at: new Date().toISOString(),
        last_ok: response.ok,
        note: `Scanned ${result.hunts_scanned || 0} hunts`
      }, { onConflict: 'cron_name' });

    // Log to cron_audit_log
    await supabase
      .from('cron_audit_log')
      .insert({
        cron_name: 'hunt-scan-cron',
        run_date: new Date().toISOString().split('T')[0],
        success: response.ok,
        result,
        error: response.ok ? null : result.error
      });

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Hunt scan cron error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
