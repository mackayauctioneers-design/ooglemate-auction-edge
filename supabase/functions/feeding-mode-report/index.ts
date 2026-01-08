import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    const startDateStr = startDate.toISOString().split("T")[0];

    // 1. Top 50 fingerprints with >=10 outcomes
    const { data: topFingerprints, error: fpError } = await supabase
      .from("fingerprint_outcomes")
      .select("*")
      .gte("listing_total", 10)
      .gte("asof_date", startDateStr)
      .order("listing_total", { ascending: false })
      .limit(50);

    if (fpError) throw fpError;

    const fingerprintReport = (topFingerprints || []).map((fp) => ({
      make: fp.make,
      model: fp.model,
      variant_family: fp.variant_family,
      year_range: `${fp.year_min}-${fp.year_max}`,
      region_id: fp.region_id,
      sample_size: fp.listing_total,
      cleared: fp.cleared_total,
      clearance_rate: fp.listing_total > 0 
        ? Math.round((fp.cleared_total / fp.listing_total) * 100) 
        : 0,
      avg_days_to_clear: fp.avg_days_to_clear ? Math.round(fp.avg_days_to_clear * 10) / 10 : null,
      relist_rate: fp.listing_total > 0 
        ? Math.round((fp.relisted_total / fp.listing_total) * 100) 
        : 0,
      passed_in_rate: fp.listing_total > 0 
        ? Math.round((fp.passed_in_total / fp.listing_total) * 100) 
        : 0,
    }));

    // 2. Agreement counters by source
    const { data: sourceStats, error: sourceError } = await supabase
      .from("vehicle_listings")
      .select("source")
      .gte("first_seen_at", startDateStr);

    if (sourceError) throw sourceError;

    const sourceCounts: Record<string, number> = {};
    (sourceStats || []).forEach((row) => {
      const src = row.source || "unknown";
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });

    const agreementCounters = {
      pickles: sourceCounts["pickles"] || 0,
      manheim: sourceCounts["manheim"] || 0,
      dealer_traps: Object.entries(sourceCounts)
        .filter(([k]) => !["pickles", "manheim", "unknown"].includes(k))
        .reduce((sum, [, v]) => sum + v, 0),
      total: (sourceStats || []).length,
    };

    // 3. Snapshots count (14 days)
    const { count: snapshotsCount, error: snapError } = await supabase
      .from("listing_snapshots")
      .select("*", { count: "exact", head: true })
      .gte("seen_at", startDateStr);

    if (snapError) throw snapError;

    // 4. Clearances count (14 days)
    const { count: clearancesCount, error: clearError } = await supabase
      .from("clearance_events")
      .select("*", { count: "exact", head: true })
      .gte("cleared_at", startDateStr);

    if (clearError) throw clearError;

    // 5. Top drop reasons from crawl runs
    const { data: crawlRuns, error: crawlError } = await supabase
      .from("trap_crawl_runs")
      .select("drop_reasons, vehicles_found, vehicles_ingested, vehicles_dropped")
      .gte("run_date", startDateStr);

    if (crawlError) throw crawlError;

    const dropReasonTotals: Record<string, number> = {};
    let totalFound = 0;
    let totalIngested = 0;
    let totalDropped = 0;

    (crawlRuns || []).forEach((run) => {
      totalFound += run.vehicles_found || 0;
      totalIngested += run.vehicles_ingested || 0;
      totalDropped += run.vehicles_dropped || 0;

      if (run.drop_reasons && typeof run.drop_reasons === "object") {
        const reasons = run.drop_reasons as Record<string, number>;
        Object.entries(reasons).forEach(([reason, count]) => {
          dropReasonTotals[reason] = (dropReasonTotals[reason] || 0) + count;
        });
      }
    });

    const topDropReasons = Object.entries(dropReasonTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count }));

    // 6. Ingestion runs summary
    const { data: ingestionRuns, error: ingestionError } = await supabase
      .from("ingestion_runs")
      .select("source, lots_found, lots_created, lots_updated, status")
      .gte("started_at", startDateStr);

    if (ingestionError) throw ingestionError;

    const ingestionBySource: Record<string, { found: number; created: number; updated: number; runs: number }> = {};
    (ingestionRuns || []).forEach((run) => {
      const src = run.source || "unknown";
      if (!ingestionBySource[src]) {
        ingestionBySource[src] = { found: 0, created: 0, updated: 0, runs: 0 };
      }
      ingestionBySource[src].found += run.lots_found || 0;
      ingestionBySource[src].created += run.lots_created || 0;
      ingestionBySource[src].updated += run.lots_updated || 0;
      ingestionBySource[src].runs += 1;
    });

    const report = {
      generated_at: new Date().toISOString(),
      period: {
        start: startDateStr,
        end: new Date().toISOString().split("T")[0],
        days: 14,
      },
      top_fingerprints: fingerprintReport,
      agreement_counters: agreementCounters,
      health_summary: {
        total_vehicles_found: totalFound,
        total_vehicles_ingested: totalIngested,
        total_vehicles_dropped: totalDropped,
        ingestion_rate: totalFound > 0 
          ? Math.round((totalIngested / totalFound) * 100) 
          : 0,
        snapshots_created: snapshotsCount || 0,
        clearances_recorded: clearancesCount || 0,
        crawl_runs: (crawlRuns || []).length,
      },
      ingestion_by_source: ingestionBySource,
      top_drop_reasons: topDropReasons,
    };

    return new Response(JSON.stringify(report, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Report generation error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
