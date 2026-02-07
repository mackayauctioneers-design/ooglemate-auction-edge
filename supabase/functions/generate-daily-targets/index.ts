import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// generate-daily-targets
// Selects 10–15 daily targets from sales_target_candidates for Josh.
// Avoids repeating the same target within the last 7 days where possible.
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { account_id, n = 15 } = await req.json();
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetCount = Math.min(Math.max(n, 5), 25); // clamp 5–25
    console.log(`[generate-daily-targets] Account ${account_id}, requesting ${targetCount} targets`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = new Date().toISOString().slice(0, 10);

    // 1. Check if targets already generated for today
    const { data: existingToday, error: existErr } = await supabase
      .from("josh_daily_targets")
      .select("id")
      .eq("account_id", account_id)
      .eq("target_date", today)
      .limit(1);

    if (existErr) throw existErr;

    if (existingToday && existingToday.length > 0) {
      // Already generated — return existing
      const { data: todayTargets, error: fetchErr } = await supabase
        .from("josh_daily_targets")
        .select("*, sales_target_candidates(*)")
        .eq("account_id", account_id)
        .eq("target_date", today)
        .order("created_at", { ascending: true });

      if (fetchErr) throw fetchErr;

      return new Response(JSON.stringify({
        created: 0,
        message: "Targets already generated for today",
        targets: todayTargets,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get all eligible candidates
    const { data: candidates, error: candErr } = await supabase
      .from("sales_target_candidates")
      .select("*")
      .eq("account_id", account_id)
      .in("status", ["candidate", "active"])
      .order("target_score", { ascending: false })
      .order("sales_count", { ascending: false });

    if (candErr) throw candErr;
    if (!candidates?.length) {
      return new Response(JSON.stringify({
        created: 0,
        message: "No eligible candidates found. Run build-sales-targets first.",
        targets: [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Get targets assigned in last 7 days to avoid repetition
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: recentTargets, error: recentErr } = await supabase
      .from("josh_daily_targets")
      .select("target_candidate_id")
      .eq("account_id", account_id)
      .gte("target_date", sevenDaysAgo.toISOString().slice(0, 10));

    if (recentErr) throw recentErr;

    const recentIds = new Set((recentTargets || []).map(t => t.target_candidate_id));

    // 4. Select targets: prefer non-recent, then fill with recent if needed
    const nonRecent = candidates.filter(c => !recentIds.has(c.id));
    const recent = candidates.filter(c => recentIds.has(c.id));

    const selected: any[] = [];
    // First add non-recent candidates
    for (const c of nonRecent) {
      if (selected.length >= targetCount) break;
      selected.push(c);
    }
    // Fill remaining from recent if needed
    for (const c of recent) {
      if (selected.length >= targetCount) break;
      selected.push(c);
    }

    if (!selected.length) {
      return new Response(JSON.stringify({
        created: 0,
        message: "No candidates to assign",
        targets: [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Insert daily targets
    const rows = selected.map(c => ({
      account_id,
      target_candidate_id: c.id,
      assigned_to: "josh",
      status: "open",
      target_date: today,
    }));

    const { error: insertErr } = await supabase
      .from("josh_daily_targets")
      .insert(rows);

    if (insertErr) {
      console.error("[generate-daily-targets] Insert error:", insertErr);
      throw insertErr;
    }

    // 6. Fetch inserted targets with candidate details
    const { data: createdTargets, error: fetchErr } = await supabase
      .from("josh_daily_targets")
      .select("*, sales_target_candidates(*)")
      .eq("account_id", account_id)
      .eq("target_date", today)
      .order("created_at", { ascending: true });

    if (fetchErr) throw fetchErr;

    console.log(`[generate-daily-targets] Created ${selected.length} daily targets for ${today}`);

    return new Response(JSON.stringify({
      created: selected.length,
      target_date: today,
      targets: createdTargets,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[generate-daily-targets] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
