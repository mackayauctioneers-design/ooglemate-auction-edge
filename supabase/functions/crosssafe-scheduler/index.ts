import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * CROSSSAFE SCHEDULER — Dumb cron that only ENQUEUES jobs
 * 
 * Does NOT crawl. Does NOT process. Just creates job rows.
 * Workers pick them up independently.
 * 
 * Schedule: 30 21 * * * (1:30am AEST nightly)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NIGHTLY_SOURCES = ["pickles", "grays"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const sources = body.sources || NIGHTLY_SOURCES;
    const includeLifecycle = body.include_lifecycle !== false;

    const jobs: any[] = [];

    // Enqueue source_refresh for each source
    for (const source of sources) {
      jobs.push({
        type: "source_refresh",
        source,
        payload: { scheduled: true, trigger: "nightly" },
        priority: 10,
      });
    }

    // Enqueue lifecycle sweep
    if (includeLifecycle) {
      jobs.push({
        type: "lifecycle_sweep",
        source: "system",
        payload: {},
        priority: 5,
      });
    }

    // Check for duplicates — don't enqueue if same source_refresh is already queued
    const dedupedJobs: any[] = [];
    for (const job of jobs) {
      const { count } = await sb
        .from("crosssafe_jobs")
        .select("id", { count: "exact", head: true })
        .eq("type", job.type)
        .eq("source", job.source)
        .eq("status", "queued");

      if ((count || 0) === 0) {
        dedupedJobs.push(job);
      } else {
        console.log(`[SCHEDULER] Skipping duplicate: ${job.type}/${job.source}`);
      }
    }

    if (dedupedJobs.length > 0) {
      const { error } = await sb.from("crosssafe_jobs").insert(dedupedJobs);
      if (error) throw error;
    }

    console.log(`[SCHEDULER] Enqueued ${dedupedJobs.length} jobs (${jobs.length - dedupedJobs.length} duplicates skipped)`);

    // Heartbeat
    await sb.from("cron_heartbeat").upsert({
      cron_name: "crosssafe-scheduler",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `enqueued=${dedupedJobs.length}`,
    }, { onConflict: "cron_name" });

    // Audit
    await sb.from("cron_audit_log").insert({
      cron_name: "crosssafe-scheduler",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: { enqueued: dedupedJobs.length, skipped_duplicates: jobs.length - dedupedJobs.length, sources },
    });

    return new Response(
      JSON.stringify({ success: true, enqueued: dedupedJobs.length, jobs: dedupedJobs.map(j => ({ type: j.type, source: j.source })) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[SCHEDULER] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
