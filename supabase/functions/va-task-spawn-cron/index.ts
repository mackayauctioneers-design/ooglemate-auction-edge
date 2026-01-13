import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const today = new Date().toISOString().slice(0, 10);

  try {
    // Spawn tasks from BUY_WINDOW listings in the last 48 hours (dedup is enforced by DB constraint)
    const { data, error } = await supabase.rpc("spawn_va_tasks_for_buy_window", { p_hours: 48 });
    if (error) throw error;

    const createdCount =
      Array.isArray(data) && data.length > 0
        ? (data[0] as any).created_count ?? (data[0] as any).created ?? 0
        : 0;

    // Audit
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "va-task-spawn-cron",
        run_date: today,
        success: true,
        result: { created_count: createdCount, window_hours: 48 },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true, created_count: createdCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);

    await supabase.from("cron_audit_log").upsert(
      { cron_name: "va-task-spawn-cron", run_date: today, success: false, error: msg },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
