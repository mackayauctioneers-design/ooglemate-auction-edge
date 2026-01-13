import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AuctionSource = {
  source_key: string;
  parser_profile: string;
  platform: "bidsonline" | "custom";
  enabled: boolean;
  preflight_status: "ok" | "fail" | "unknown";
  preflight_notes: string | null;
};

const TIMEOUT_MS = 3 * 60 * 1000; // 3 min per source
const MAX_CONCURRENCY = 2;       // keep it gentle

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1) Load enabled auction sources
    const { data: sources, error } = await supabase
      .from("auction_sources")
      .select("source_key, parser_profile, platform, enabled, preflight_status, preflight_notes")
      .eq("enabled", true);

    if (error) throw error;
    const enabled = (sources as AuctionSource[]) || [];

    // 2) Filter: only preflight OK (skip blocked sites)
    const runnable = enabled.filter(s => s.preflight_status === "ok");

    let success = 0;
    let failed = 0;

    // 3) Simple concurrency control
    for (let i = 0; i < runnable.length; i += MAX_CONCURRENCY) {
      const batch = runnable.slice(i, i + MAX_CONCURRENCY);

      await Promise.all(batch.map(async (src) => {
        const start = Date.now();
        try {
          const fn =
            src.platform === "bidsonline"
              ? "asp-auction-crawl"
              : "custom-auction-crawl";

          await withTimeout(
            supabase.functions.invoke(fn, {
              body: {
                source_key: src.source_key,
                parser_profile: src.parser_profile,
              },
            }),
            TIMEOUT_MS
          );

          success++;

          await supabase.from("cron_audit_log").upsert(
            {
              cron_name: `auction-wrapper-cron:${src.source_key}`,
              run_date: today,
              success: true,
              result: {
                source_key: src.source_key,
                ms: Date.now() - start,
              },
            },
            { onConflict: "cron_name,run_date" }
          );
        } catch (e: any) {
          failed++;
          await supabase.from("cron_audit_log").upsert(
            {
              cron_name: `auction-wrapper-cron:${src.source_key}`,
              run_date: today,
              success: false,
              error: e?.message || String(e),
            },
            { onConflict: "cron_name,run_date" }
          );
        }
      }));
    }

    // Overall summary log
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "auction-wrapper-cron",
        run_date: today,
        success: failed === 0,
        result: {
          sources_total: enabled.length,
          runnable: runnable.length,
          success_count: success,
          failed_count: failed,
        },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(
      JSON.stringify({
        success: true,
        sources_total: enabled.length,
        runnable: runnable.length,
        success_count: success,
        failed_count: failed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "auction-wrapper-cron",
        run_date: today,
        success: false,
        error: e?.message || String(e),
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(
      JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
