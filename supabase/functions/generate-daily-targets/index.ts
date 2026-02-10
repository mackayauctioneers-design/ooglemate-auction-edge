import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// generate-daily-targets v2
// Selects daily targets from BOTH core and outcome fingerprints.
// Core targets fill the majority; outcome targets get 2-3 slots for discovery.
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

    const targetCount = Math.min(Math.max(n, 5), 25);
    console.log(`[generate-daily-targets] v2 Account ${account_id}, requesting ${targetCount} targets`);

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

    // 2. Get all eligible candidates — BOTH types
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

    // 4. Split candidates by type
    const coreCandidates = candidates.filter((c: any) => c.fingerprint_type !== 'outcome');
    const outcomeCandidates = candidates.filter((c: any) => c.fingerprint_type === 'outcome');

    // Reserve 2-3 slots for outcome fingerprints (discovery)
    const outcomeSlots = Math.min(3, Math.max(1, Math.floor(targetCount * 0.2)));
    const coreSlots = targetCount - outcomeSlots;

    // Select core targets (prefer non-recent)
    const selectFromPool = (pool: any[], maxCount: number) => {
      const nonRecent = pool.filter(c => !recentIds.has(c.id));
      const recent = pool.filter(c => recentIds.has(c.id));
      const selected: any[] = [];
      for (const c of nonRecent) {
        if (selected.length >= maxCount) break;
        selected.push(c);
      }
      for (const c of recent) {
        if (selected.length >= maxCount) break;
        selected.push(c);
      }
      return selected;
    };

    const selectedCore = selectFromPool(coreCandidates, coreSlots);
    const selectedOutcome = selectFromPool(outcomeCandidates, outcomeSlots);

    // If we have unfilled core slots, fill with more outcomes (and vice versa)
    const selected = [...selectedCore, ...selectedOutcome];
    if (selected.length < targetCount) {
      const remaining = candidates.filter(c => !selected.some(s => s.id === c.id) && !recentIds.has(c.id));
      for (const c of remaining) {
        if (selected.length >= targetCount) break;
        selected.push(c);
      }
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

    // 6. Fetch inserted targets
    const { data: createdTargets, error: fetchErr } = await supabase
      .from("josh_daily_targets")
      .select("*, sales_target_candidates(*)")
      .eq("account_id", account_id)
      .eq("target_date", today)
      .order("created_at", { ascending: true });

    if (fetchErr) throw fetchErr;

    console.log(`[generate-daily-targets] Created ${selected.length} targets (${selectedCore.length} core, ${selectedOutcome.length} outcome) for ${today}`);

    return new Response(JSON.stringify({
      created: selected.length,
      core_count: selectedCore.length,
      outcome_count: selectedOutcome.length,
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
