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

    const reportJson = await reportResponse.json();
    const reportDate = new Date().toISOString().split("T")[0];

    // Upsert the report into feeding_mode_reports table
    const { data, error } = await supabase
      .from("feeding_mode_reports")
      .upsert(
        {
          report_date: reportDate,
          report_json: reportJson,
        },
        { onConflict: "report_date" }
      )
      .select()
      .single();

    if (error) throw error;

    console.log(`Feeding mode report stored for ${reportDate}`);

    return new Response(
      JSON.stringify({
        success: true,
        report_date: reportDate,
        stored_at: new Date().toISOString(),
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
