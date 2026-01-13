import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SourceRow = {
  source_key: string;
  enabled: boolean;
  preflight_status: string | null;
  schedule_enabled: boolean;
  schedule_paused: boolean;
  schedule_pause_reason: string | null;
  schedule_tz: string;
  schedule_days: string[];
  schedule_time_local: string;
  schedule_min_interval_minutes: number;
  last_scheduled_run_at: string | null;
  platform: string | null;
  parser_profile: string | null;
};

function nowUtcIso() {
  return new Date().toISOString();
}

function parseHHMM(hhmm: string) {
  const [h, m] = (hhmm || "00:00").split(":").map((x) => parseInt(x, 10));
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m };
}

function dayKeyForTZ(tz: string) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).formatToParts(d);
  const wk = parts.find((p) => p.type === "weekday")?.value || "Mon";
  return wk.toUpperCase().slice(0, 3);
}

function localHHMMForTZ(tz: string) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function minutesSince(aIso: string | null) {
  if (!aIso) return 999999;
  const dt = new Date(aIso).getTime();
  if (!Number.isFinite(dt)) return 999999;
  return Math.floor((Date.now() - dt) / 60000);
}

function shouldRunNow(src: SourceRow) {
  if (!src.enabled) return { ok: false, reason: "disabled" };
  if (src.preflight_status !== "ok") return { ok: false, reason: "preflight_not_ok" };
  if (!src.schedule_enabled) return { ok: false, reason: "schedule_disabled" };
  if (src.schedule_paused) return { ok: false, reason: "paused" };

  const tz = src.schedule_tz || "Australia/Sydney";
  const todayKey = dayKeyForTZ(tz);
  if (!src.schedule_days?.includes(todayKey)) return { ok: false, reason: "wrong_day" };

  const nowLocal = localHHMMForTZ(tz);
  const { h: nowH, m: nowM } = parseHHMM(nowLocal);
  const { h: schedH, m: schedM } = parseHHMM(src.schedule_time_local);

  const nowMin = nowH * 60 + nowM;
  const schedMin = schedH * 60 + schedM;
  const withinWindow = nowMin >= schedMin && nowMin < schedMin + 5;
  if (!withinWindow) return { ok: false, reason: "not_in_window" };

  const mins = minutesSince(src.last_scheduled_run_at);
  if (mins < (src.schedule_min_interval_minutes || 60)) return { ok: false, reason: "min_interval" };

  return { ok: true, reason: "due" };
}

// deno-lint-ignore no-explicit-any
async function invokeCrawler(supabase: any, src: SourceRow) {
  const profile = (src.parser_profile || "").toLowerCase();
  const platform = (src.platform || "").toLowerCase();

  const useAsp =
    profile.includes("asp") ||
    profile === "asp_search_results" ||
    platform === "asp" ||
    src.source_key.includes("auto_auctions");

  const fn = useAsp ? "asp-auction-crawl" : platform === "bidsonline" ? "bidsonline-crawl" : "custom-auction-crawl";

  const { data, error } = await supabase.functions.invoke(fn, {
    body: { source_key: src.source_key },
  });

  return { fn, data, error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const today = new Date().toISOString().slice(0, 10);

  try {
    const { data: sources, error } = await supabase
      .from("auction_sources")
      .select(
        "source_key,enabled,preflight_status,schedule_enabled,schedule_paused,schedule_pause_reason,schedule_tz,schedule_days,schedule_time_local,schedule_min_interval_minutes,last_scheduled_run_at,platform,parser_profile"
      )
      .eq("schedule_enabled", true);

    if (error) throw error;

    const rows = (sources as SourceRow[]) || [];
    const due = rows.filter((s) => shouldRunNow(s).ok);

    let ran = 0;
    const results: { source_key: string; fn: string; ok: boolean; error?: string; data?: unknown }[] = [];

    for (const src of due) {
      await supabase
        .from("auction_sources")
        .update({ last_scheduled_run_at: nowUtcIso() })
        .eq("source_key", src.source_key);

      const { fn, data, error: invErr } = await invokeCrawler(supabase, src);

      if (invErr) {
        results.push({ source_key: src.source_key, fn, ok: false, error: invErr.message });
      } else {
        results.push({ source_key: src.source_key, fn, ok: true, data });
        ran++;
      }
    }

    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "auction-schedule-dispatch",
        run_date: today,
        success: true,
        result: { total_sources: rows.length, due: due.length, ran, results: results.slice(0, 10) },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true, total: rows.length, due: due.length, ran, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
