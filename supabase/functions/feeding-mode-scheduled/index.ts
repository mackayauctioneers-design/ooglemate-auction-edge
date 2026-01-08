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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const reportDate = new Date().toISOString().split("T")[0];
    let reportJson = null;
    let cronSuccess = true;
    let cronError = null;

    try {
      // Call the feeding-mode-report function to get the report JSON
      const reportResponse = await fetch(`${supabaseUrl}/functions/v1/feeding-mode-report`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!reportResponse.ok) {
        const errorText = await reportResponse.text();
        throw new Error(`Failed to fetch report: ${reportResponse.status} - ${errorText}`);
      }

      reportJson = await reportResponse.json();

      // Upsert the report into feeding_mode_reports table
      const { error } = await supabase
        .from("feeding_mode_reports")
        .upsert(
          {
            report_date: reportDate,
            report_json: reportJson,
          },
          { onConflict: "report_date" }
        );

      if (error) throw error;

      console.log(`Feeding mode report stored for ${reportDate}`);
    } catch (err) {
      cronSuccess = false;
      cronError = err instanceof Error ? err.message : String(err);
      console.error("Report generation failed:", cronError);
    }

    // Log to cron_audit_log
    await supabase
      .from("cron_audit_log")
      .upsert(
        {
          cron_name: "feeding-mode-scheduled",
          run_date: reportDate,
          success: cronSuccess,
          result: cronSuccess ? { fingerprints: reportJson?.top_fingerprints?.length || 0 } : null,
          error: cronError,
        },
        { onConflict: "cron_name,run_date" }
      );

    return new Response(
      JSON.stringify({
        success: cronSuccess,
        report_date: reportDate,
        stored_at: new Date().toISOString(),
        error: cronError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Scheduled report error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
