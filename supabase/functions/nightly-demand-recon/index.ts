import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * nightly-demand-recon v1.0
 *
 * Runs nightly for all open dealer_demands.
 * Re-triggers check-internal-demand for each, updating opportunities.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startTime = Date.now();
  const sbUrl = Deno.env.get("SUPABASE_URL")!;
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // Load all open demands
    const { data: demands, error: demErr } = await sb
      .from("dealer_demands")
      .select("id, dealer_name, make, model, urgency, search_interval_minutes, last_searched_at")
      .eq("status", "open");

    if (demErr) throw new Error(demErr.message);

    // Filter demands that are due for search based on their interval
    const now = Date.now();
    const dueDemands = (demands || []).filter((d: any) => {
      if (!d.last_searched_at) return true;
      const interval = d.search_interval_minutes || 1440;
      const lastSearch = new Date(d.last_searched_at).getTime();
      return (now - lastSearch) >= interval * 60 * 1000;
    });

    if (dueDemands.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No demands due for search" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[nightly-demand-recon] ${dueDemands.length} of ${demands?.length} demands due for search`);

    if (demErr) throw new Error(demErr.message);
    // (filtered above)

    let processed = 0;
    let totalMatches = 0;

    // Process sequentially to avoid overloading
    for (const demand of demands) {
      try {
        const resp = await fetch(`${sbUrl}/functions/v1/check-internal-demand`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${sbKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ demand_id: demand.id }),
        });

        if (resp.ok) {
          const result = await resp.json();
          totalMatches += result.total || 0;
          processed++;
          console.log(`[nightly-demand-recon] ${demand.make} ${demand.model} (${demand.dealer_name}): ${result.total} matches`);
        } else {
          const errText = await resp.text();
          console.warn(`[nightly-demand-recon] Failed for ${demand.id}: ${errText}`);
        }
      } catch (e) {
        console.warn(`[nightly-demand-recon] Error processing ${demand.id}:`, e);
      }

      // Small delay between demands
      await new Promise(r => setTimeout(r, 500));
    }

    const durationMs = Date.now() - startTime;

    // Audit
    await sb.from("cron_heartbeat").upsert({
      cron_name: "nightly-demand-recon",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: JSON.stringify({ processed, totalMatches, durationMs }),
    }, { onConflict: "cron_name" });

    console.log(`[nightly-demand-recon] Done: ${processed}/${demands.length} demands, ${totalMatches} total matches, ${durationMs}ms`);

    return new Response(JSON.stringify({
      success: true,
      demands_total: demands.length,
      processed,
      total_matches: totalMatches,
      duration_ms: durationMs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[nightly-demand-recon] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
