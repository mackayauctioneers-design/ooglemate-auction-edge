/**
 * dealer-arby-reprofile-cron — Weekly: re-dispatch Arby for every active dealer profile
 * with a website on file. Keeps dealer profiles continuously refreshed (inventory,
 * days-in-stock, business analysis) instead of one-shot at onboarding.
 *
 * Invokes the existing `dealer-onboard-dispatch` proxy per dealer (single source of truth
 * — no parallel Arby pipeline). Results post back to `arby-dealer-profile-intake`.
 */

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const startedAt = Date.now();
  const runDate = new Date().toISOString().split("T")[0];

  try {
    const { data: dealers, error } = await supabase
      .from("dealer_profiles")
      .select("id, dealer_name, dealer_website, dealer_email, account_id")
      .not("dealer_website", "is", null)
      .neq("dealer_website", "");

    if (error) throw error;

    const results: Array<{ dealer: string; status: string; error?: string }> = [];
    let dispatched = 0;
    let failed = 0;

    for (const d of dealers ?? []) {
      // Respect 110s edge function time budget
      if (Date.now() - startedAt > 110_000) {
        console.warn("[arby-reprofile-cron] time budget exceeded, stopping");
        break;
      }
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/dealer-onboard-dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            dealer_profile_id: d.id,
            dealer_name: d.dealer_name,
            dealer_website: d.dealer_website,
            dealer_email: d.dealer_email,
            scope: ["inventory", "days_in_stock", "business_analysis"],
          }),
        });
        if (res.ok) {
          dispatched++;
          results.push({ dealer: d.dealer_name, status: "dispatched" });
        } else {
          failed++;
          const t = await res.text();
          results.push({ dealer: d.dealer_name, status: "failed", error: `${res.status}: ${t.slice(0, 200)}` });
        }
      } catch (e) {
        failed++;
        results.push({ dealer: d.dealer_name, status: "error", error: String(e).slice(0, 200) });
      }
    }

    // Audit trail
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "dealer-arby-reprofile-cron",
        run_date: runDate,
        success: failed === 0,
        result: { dispatched, failed, total: dealers?.length ?? 0, results: results.slice(0, 50) },
        error: failed > 0 ? `${failed} dispatches failed` : null,
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(
      JSON.stringify({ ok: true, dispatched, failed, total: dealers?.length ?? 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[arby-reprofile-cron] fatal:", msg);
    await supabase.from("cron_audit_log").upsert(
      { cron_name: "dealer-arby-reprofile-cron", run_date: runDate, success: false, error: msg },
      { onConflict: "cron_name,run_date" }
    );
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
