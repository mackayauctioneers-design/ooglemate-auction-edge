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
    // Auth check
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const secret = Deno.env.get("MANUS_WEBHOOK_SECRET") || Deno.env.get("LINDY_WEBHOOK_SECRET");
    if (!secret || token !== secret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      task_id,
      task_type,
      trade_batch_id,
      easycars_updates,
      xero_postings,
      logs,
      warnings,
      status,
    } = body;

    if (!task_id) {
      return new Response(JSON.stringify({ error: "task_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Upsert the task result
    const { data, error } = await supabase
      .from("manus_task_results")
      .upsert(
        {
          task_id,
          task_type: task_type || null,
          trade_batch_id: trade_batch_id || null,
          easycars_updates: easycars_updates || [],
          xero_postings: xero_postings || [],
          logs: logs || [],
          warnings: warnings || [],
          status: status || "completed",
          completed_at: new Date().toISOString(),
        },
        { onConflict: "task_id" }
      )
      .select()
      .single();

    if (error) throw error;

    // If there are trade reconciliation updates, mark trades as reconciled
    if (easycars_updates && Array.isArray(easycars_updates)) {
      for (const update of easycars_updates) {
        if (update.invoice_number) {
          await supabase
            .from("trades")
            .update({
              reconciled: true,
              reconciled_at: new Date().toISOString(),
              reconciled_by: `manus:${task_id}`,
            })
            .eq("invoice_number", update.invoice_number);
        }
      }
    }

    return new Response(
      JSON.stringify({ status: "ok", task_result_id: data.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("manus-results-intake error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
