import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISABLE_AFTER_FAILS = 3;
const TIMEOUT_MS = 3 * 60 * 1000; // 3 min per source

type AuctionSource = {
  source_key: string;
  display_name: string;
  enabled: boolean;
  platform: string;
  schedule_enabled: boolean;
  schedule_paused: boolean;
  schedule_days: string[] | null;
  schedule_time_local: string | null;
  schedule_min_interval_minutes: number | null;
  schedule_tz: string | null;
  preflight_status: string | null;
  consecutive_failures: number | null;
  last_scheduled_run_at: string | null;
  parser_profile: string | null;
};

function toDowMonSun(date: Date, tz: string): string {
  const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(date);
  return wd.toUpperCase().slice(0, 3);
}

function toHHMM(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function minutesSince(iso: string | null): number {
  if (!iso) return Infinity;
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return Infinity;
  return Math.floor((Date.now() - dt) / 60000);
}

function parseHHMM(s: string): number {
  const [h, m] = (s || "00:00").split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

type SkipReason =
  | "disabled"
  | "preflight_not_ok"
  | "schedule_disabled"
  | "paused"
  | "wrong_day"
  | "not_in_window"
  | "min_interval"
  | "too_many_failures";

function shouldRun(src: AuctionSource, now: Date): { ok: boolean; reason: SkipReason | "due" } {
  if (!src.enabled) return { ok: false, reason: "disabled" };
  if (src.preflight_status !== "ok") return { ok: false, reason: "preflight_not_ok" };
  if (!src.schedule_enabled) return { ok: false, reason: "schedule_disabled" };
  if (src.schedule_paused) return { ok: false, reason: "paused" };
  if ((src.consecutive_failures ?? 0) >= DISABLE_AFTER_FAILS) return { ok: false, reason: "too_many_failures" };

  const tz = src.schedule_tz || "Australia/Sydney";
  const todayDow = toDowMonSun(now, tz);
  if (!src.schedule_days?.includes(todayDow)) return { ok: false, reason: "wrong_day" };

  const nowHHMM = toHHMM(now, tz);
  const nowMins = parseHHMM(nowHHMM);
  const schedMins = parseHHMM(src.schedule_time_local || "07:05");

  // 5-minute window after schedule time
  if (nowMins < schedMins || nowMins >= schedMins + 5) return { ok: false, reason: "not_in_window" };

  const minsSinceLast = minutesSince(src.last_scheduled_run_at);
  if (minsSinceLast < (src.schedule_min_interval_minutes ?? 60)) return { ok: false, reason: "min_interval" };

  return { ok: true, reason: "due" };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

// deno-lint-ignore no-explicit-any
async function invokeCrawler(supabase: any, src: AuctionSource) {
  const profile = (src.parser_profile || "").toLowerCase();
  const platform = (src.platform || "").toLowerCase();

  // Choose crawler based on platform/profile
  let fn = "custom-auction-crawl";
  if (platform === "bidsonline") fn = "bidsonline-crawl";
  else if (platform === "asp" || profile.includes("asp")) fn = "asp-auction-crawl";

  const { data, error } = await supabase.functions.invoke(fn, {
    body: { source_key: src.source_key },
  });

  return { fn, data, error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  try {
    // Load all sources with scheduling enabled
    const { data: sources, error } = await supabase
      .from("auction_sources")
      .select(
        "source_key,display_name,enabled,platform,schedule_enabled,schedule_paused,schedule_days,schedule_time_local,schedule_min_interval_minutes,schedule_tz,preflight_status,consecutive_failures,last_scheduled_run_at,parser_profile"
      )
      .eq("schedule_enabled", true);

    if (error) throw error;

    const rows = (sources as AuctionSource[]) || [];
    const results: { source_key: string; status: string; reason?: string; error?: string; lots?: number }[] = [];

    let ran = 0;
    let skipped = 0;
    let failed = 0;

    for (const src of rows) {
      const check = shouldRun(src, now);

      if (!check.ok) {
        // Log skipped run
        await supabase.from("auction_schedule_runs").insert({
          source_key: src.source_key,
          run_date: today,
          status: "skipped",
          reason: check.reason,
        });
        results.push({ source_key: src.source_key, status: "skipped", reason: check.reason });
        skipped++;
        continue;
      }

      // Mark run started + update last_scheduled_run_at to prevent double-fire
      const runId = crypto.randomUUID();
      await supabase.from("auction_schedule_runs").insert({
        id: runId,
        source_key: src.source_key,
        run_date: today,
        status: "started",
      });

      await supabase
        .from("auction_sources")
        .update({ last_scheduled_run_at: now.toISOString() })
        .eq("source_key", src.source_key);

      try {
        const { fn, data, error: invErr } = await withTimeout(invokeCrawler(supabase, src), TIMEOUT_MS);

        if (invErr) throw new Error(invErr.message || "crawl invoke error");

        const lotsFound = data?.lots_found ?? data?.lotsFound ?? null;
        const created = data?.created ?? null;
        const updated = data?.updated ?? null;
        const dropped = data?.dropped ?? null;

        // Success: reset failures
        await supabase
          .from("auction_sources")
          .update({
            consecutive_failures: 0,
            last_success_at: now.toISOString(),
            last_error: null,
            last_lots_found: lotsFound,
          })
          .eq("source_key", src.source_key);

        // Update run log
        await supabase
          .from("auction_schedule_runs")
          .update({
            status: "success",
            lots_found: lotsFound,
            created,
            updated,
            dropped,
          })
          .eq("id", runId);

        // Log event
        await supabase.from("auction_source_events").insert({
          source_key: src.source_key,
          event_type: "scheduled_success",
          message: `Scheduled run via ${fn}`,
          meta: { lots_found: lotsFound, created, updated, dropped },
        });

        results.push({ source_key: src.source_key, status: "success", lots: lotsFound });
        ran++;
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);

        // Increment failures
        const newFailCount = ((src.consecutive_failures ?? 0) + 1);

        const patch: Record<string, unknown> = {
          consecutive_failures: newFailCount,
          last_crawl_fail_at: now.toISOString(),
          last_error: errMsg,
        };

        // Auto-disable if too many failures
        if (newFailCount >= DISABLE_AFTER_FAILS) {
          patch.enabled = false;
          patch.auto_disabled_at = now.toISOString();
          patch.auto_disabled_reason = `Auto-disabled after ${newFailCount} consecutive failures`;

          // Log event + Slack alert
          await supabase.from("auction_source_events").insert({
            source_key: src.source_key,
            event_type: "disabled",
            message: `Auto-disabled after ${newFailCount} consecutive failures`,
            meta: { last_error: errMsg },
          });

          if (SLACK_WEBHOOK_URL) {
            await fetch(SLACK_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                blocks: [
                  { type: "header", text: { type: "plain_text", text: "🧨 Auction Source Auto-Disabled", emoji: true } },
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text:
                        `*${src.display_name}* (\`${src.source_key}\`) was auto-disabled.\n` +
                        `• Fail streak: *${newFailCount}*\n` +
                        `• Error: \`${errMsg}\`\n` +
                        `Action: Re-enable in Operator → Auction Sources Health.`,
                    },
                  },
                ],
              }),
            });
          }
        }

        await supabase
          .from("auction_sources")
          .update(patch)
          .eq("source_key", src.source_key);

        // Update run log
        await supabase
          .from("auction_schedule_runs")
          .update({ status: "fail", error: errMsg })
          .eq("id", runId);

        // Log event
        await supabase.from("auction_source_events").insert({
          source_key: src.source_key,
          event_type: "scheduled_fail",
          message: `Scheduled run failed`,
          meta: { error: errMsg },
        });

        results.push({ source_key: src.source_key, status: "fail", error: errMsg });
        failed++;
      }
    }

    // Overall audit log
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "auction-schedule-dispatch",
        run_date: today,
        success: failed === 0,
        result: { total: rows.length, ran, skipped, failed, results: results.slice(0, 20) },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(
      JSON.stringify({ success: true, total: rows.length, ran, skipped, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    await supabase.from("cron_audit_log").upsert(
      { cron_name: "auction-schedule-dispatch", run_date: today, success: false, error: msg },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
