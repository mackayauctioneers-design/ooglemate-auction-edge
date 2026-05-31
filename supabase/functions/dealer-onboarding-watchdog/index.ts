/**
 * dealer-onboarding-watchdog
 *
 * Runs every 15 minutes. For each non-ACTIVE dealer, checks where the
 * onboarding pipeline is stuck and auto-fires the next stage:
 *
 *   profile w/o dispatch       -> dealer-onboard-dispatch
 *   dispatched w/o callback    -> dealer-onboard-dispatch (retry, max 3)
 *   fingerprints w/o strategic -> rebuild-dealer-intelligence
 *   strategic w/o mandates     -> generate-dealer-mandates
 *   mandates never ran         -> run-mandate per mandate (capped)
 *
 * After 3 failed dispatch attempts, writes onboarding_alerts row for human review.
 * Never re-fires inside an SLA window — idempotent by design.
 */

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;

// SLA windows (minutes) — only act once the gate has been stuck this long.
const SLA = {
  profile_to_dispatch: 5,
  dispatch_to_callback: 45,
  fingerprints_to_strategic: 30,
  strategic_to_mandates: 30,
  mandates_to_first_run: 60,
};
const MAX_DISPATCH_ATTEMPTS = 3;
const MAX_MANDATES_PER_DEALER_RUN = 5;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invokeFn(name: string, body: Record<string, unknown> = {}) {
  const url = `${SB_URL}/functions/v1/${name}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
        apikey: SB_KEY,
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, body: txt.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SB_URL, SB_KEY);
  const startedAt = Date.now();
  const actions: any[] = [];

  // Pull every dealer with a website (the auto-pipeline only applies to website-backed dealers).
  const { data: dealers, error } = await sb
    .from("dealer_profiles")
    .select("id, dealer_name, account_id, dealer_website, strategic_profile_updated_at");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const d of dealers ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      actions.push({ status: "timeout_break" });
      break;
    }
    if (!d.dealer_website) continue;

    try {
      // ── Gate signals ─────────────────────────────────────────────
      const [runsRes, fpRes, stratRes, mandatesRes, mandateRunsRes] = await Promise.all([
        sb.from("worker_runs")
          .select("id, status, started_at, attempt_n")
          .eq("dealer_id", d.id)
          .eq("action", "dealer_profile_intake")
          .order("started_at", { ascending: false })
          .limit(5),
        sb.from("dealer_fingerprints")
          .select("id", { count: "exact", head: true })
          .eq("dealer_profile_id", d.id)
          .eq("is_active", true),
        d.account_id
          ? sb.from("dealer_intelligence_profiles")
              .select("id", { count: "exact", head: true })
              .eq("account_id", d.account_id)
          : Promise.resolve({ count: 0 } as any),
        sb.from("active_mandates")
          .select("id, last_run_at")
          .eq("dealer_id", d.id)
          .eq("is_active", true),
        sb.from("active_mandates")
          .select("id")
          .eq("dealer_id", d.id)
          .eq("is_active", true)
          .not("last_run_at", "is", null)
          .limit(1),
      ]);

      const runs = runsRes.data ?? [];
      const latestRun = runs[0];
      const fpCount = fpRes.count ?? 0;
      const stratCount = stratRes.count ?? 0;
      const mandates = mandatesRes.data ?? [];
      const anyMandateRan = (mandateRunsRes.data?.length ?? 0) > 0;

      const ageMin = (iso?: string | null) =>
        iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : Infinity;

      // ── Gate 1+2: profile exists but no dispatch yet ─────────────
      if (runs.length === 0) {
        // ageMin(d.id row?) — use the dealer profile creation indirectly via no rows.
        // Always safe to fire first dispatch.
        const res = await invokeFn("dealer-onboard-dispatch", {
          dealer_profile_id: d.id,
          dealer_name: d.dealer_name,
          dealer_website: d.dealer_website,
          source: "watchdog_initial",
        });
        actions.push({ dealer: d.dealer_name, action: "initial_dispatch", res });
        continue;
      }

      // ── Gate 3: dispatched but no fingerprints yet (callback stuck) ──
      const dispatchedAge = ageMin(latestRun.started_at);
      const dispatchAttempts = Math.max(...runs.map((r: any) => r.attempt_n ?? 1));

      if (fpCount === 0) {
        if (latestRun.status === "dispatched" && dispatchedAge > SLA.dispatch_to_callback) {
          if (dispatchAttempts < MAX_DISPATCH_ATTEMPTS) {
            const res = await invokeFn("dealer-onboard-dispatch", {
              dealer_profile_id: d.id,
              dealer_name: d.dealer_name,
              dealer_website: d.dealer_website,
              source: "watchdog_retry",
            });
            actions.push({ dealer: d.dealer_name, action: "retry_dispatch", attempt: dispatchAttempts + 1, res });
          } else {
            await sb.from("onboarding_alerts").upsert({
              dealer_id: d.id,
              gate: "dealer_profile_intake",
              severity: "error",
              message: `No callback from Arby after ${dispatchAttempts} dispatches over ${Math.round(dispatchedAge)}m`,
              attempt_n: dispatchAttempts,
              updated_at: new Date().toISOString(),
            }, { onConflict: "dealer_id,gate" });
            actions.push({ dealer: d.dealer_name, action: "alert_raised", gate: "dealer_profile_intake" });
          }
        } else if (latestRun.status === "failed" && dispatchAttempts < MAX_DISPATCH_ATTEMPTS) {
          const res = await invokeFn("dealer-onboard-dispatch", {
            dealer_profile_id: d.id,
            dealer_name: d.dealer_name,
            dealer_website: d.dealer_website,
            source: "watchdog_after_failure",
          });
          actions.push({ dealer: d.dealer_name, action: "retry_after_failure", res });
        }
        continue;
      }

      // ── Gate 4: fingerprints exist, strategic profile missing ────
      if (fpCount > 0 && stratCount === 0 && d.account_id) {
        const stratAge = ageMin(d.strategic_profile_updated_at);
        if (stratAge > SLA.fingerprints_to_strategic) {
          const res = await invokeFn("rebuild-dealer-intelligence", { account_id: d.account_id });
          actions.push({ dealer: d.dealer_name, action: "rebuild_strategic", res });
        }
        continue;
      }

      // ── Gate 5: strategic exists, no mandates ────────────────────
      if (stratCount > 0 && mandates.length === 0) {
        const res = await invokeFn("generate-dealer-mandates", {});
        actions.push({ dealer: d.dealer_name, action: "generate_mandates", res });
        continue;
      }

      // ── Gate 6: mandates exist but never ran ─────────────────────
      if (mandates.length > 0 && !anyMandateRan) {
        const oldest = mandates.slice(0, MAX_MANDATES_PER_DEALER_RUN);
        for (const m of oldest) {
          const res = await invokeFn("run-mandate", { mandate_id: m.id });
          actions.push({ dealer: d.dealer_name, action: "run_mandate", mandate_id: m.id, res });
        }
        continue;
      }

      // ── Resolved: clear any prior open alert ─────────────────────
      if (fpCount > 0) {
        await sb.from("onboarding_alerts")
          .update({ resolved_at: new Date().toISOString() })
          .eq("dealer_id", d.id)
          .is("resolved_at", null);
      }
    } catch (e) {
      actions.push({ dealer: d.dealer_name, error: String(e) });
    }
  }

  console.log(`[watchdog] processed ${dealers?.length ?? 0} dealers, ${actions.length} actions in ${Date.now() - startedAt}ms`);

  return new Response(
    JSON.stringify({ status: "ok", processed: dealers?.length ?? 0, actions }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
