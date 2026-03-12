import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-deep-scan-cron v2.0 — Serialised daily market pricing
 *
 * SAFETY:
 * - Honours CRAWL_MODE kill switch
 * - Serialised: one bucket at a time, waits between launches
 * - Concurrency lock delegated to carsales-scan
 * - No retries on failure — logs and moves on
 * - All URLs are fully filtered and validated by carsales-scan
 *
 * Schedule: once daily
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;
const ITEMS_PER_BUCKET = 150;
const INTER_BUCKET_DELAY_MS = 12000; // 12s between buckets — wider gap for daily deep scan

const MARKET_BUCKETS = [
  { make: "Toyota", model: "HiLux" },
  { make: "Toyota", model: "LandCruiser" },
  { make: "Toyota", model: "Prado" },
  { make: "Toyota", model: "RAV4" },
  { make: "Toyota", model: "Corolla" },
  { make: "Toyota", model: "Camry" },
  { make: "Ford", model: "Ranger" },
  { make: "Ford", model: "Everest" },
  { make: "Mazda", model: "BT50" },
  { make: "Mazda", model: "CX5" },
  { make: "Mazda", model: "CX9" },
  { make: "Hyundai", model: "Tucson" },
  { make: "Hyundai", model: "iLoad" },
  { make: "Kia", model: "Sportage" },
  { make: "Kia", model: "Carnival" },
  { make: "Mitsubishi", model: "Triton" },
  { make: "Mitsubishi", model: "Outlander" },
  { make: "Nissan", model: "Navara" },
  { make: "Nissan", model: "Patrol" },
  { make: "Isuzu", model: "DMax" },
  { make: "Isuzu", model: "MUX" },
  { make: "Subaru", model: "Outback" },
  { make: "Volkswagen", model: "Amarok" },
  { make: "LDV", model: "T60" },
  { make: "GWM", model: "Ute" },
];

function carsalesSlug(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join("");
}

function buildBucketUrl(make: string, model: string): string {
  const q = `(And.Make.${carsalesSlug(make)}._.Model.${carsalesSlug(model)}._.Year.range(${YEAR_MIN}..)._.Odometer.range(..${KM_MAX}))`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~Price`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── CRAWL_MODE kill switch ──
    const crawlMode = Deno.env.get("CRAWL_MODE") || "normal";
    if (crawlMode === "disabled") {
      console.log("[CARSALES-DEEP] Carsales crawl skipped: CRAWL_MODE=disabled");
      return respond(200, { ok: true, status: "skipped_disabled" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[CARSALES-DEEP] Deep scan: ${MARKET_BUCKETS.length} buckets, ${ITEMS_PER_BUCKET} items each, SERIALISED`);

    const results: Array<{ make: string; model: string; status: string; run_id?: string; error?: string }> = [];
    let consecutiveSkipsForLock = 0;

    for (let i = 0; i < MARKET_BUCKETS.length; i++) {
      const bucket = MARKET_BUCKETS[i];
      const bucketUrl = buildBucketUrl(bucket.make, bucket.model);

      // Stagger between buckets
      if (i > 0) {
        await new Promise((r) => setTimeout(r, INTER_BUCKET_DELAY_MS));
      }

      // If 3 consecutive skips due to active lock, stop — system is backed up
      if (consecutiveSkipsForLock >= 3) {
        console.log(`[CARSALES-DEEP] Halting: ${consecutiveSkipsForLock} consecutive lock-skips — system backed up`);
        for (let j = i; j < MARKET_BUCKETS.length; j++) {
          results.push({ ...MARKET_BUCKETS[j], status: "skipped_backpressure" });
        }
        break;
      }

      try {
        const scanResponse = await fetch(
          `${supabaseUrl}/functions/v1/carsales-scan`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              startUrls: [{ url: bucketUrl }],
              limit: ITEMS_PER_BUCKET,
            }),
          }
        );

        const result = await scanResponse.json();

        if (result.status === "skipped_disabled") {
          console.log(`[CARSALES-DEEP] Halting: CRAWL_MODE disabled mid-run`);
          results.push({ ...bucket, status: "skipped_disabled" });
          break;
        }

        if (result.status === "skipped_already_running") {
          console.log(`[CARSALES-DEEP] [${bucket.make} ${bucket.model}] Skipped: lock active`);
          results.push({ ...bucket, status: "skipped_already_running" });
          consecutiveSkipsForLock++;
          continue;
        }

        if (result.ok === false) {
          console.error(`[CARSALES-DEEP] [${bucket.make} ${bucket.model}] Failed: ${result.error || result.status}`);
          results.push({ ...bucket, status: "failed", error: result.error || result.status });
          consecutiveSkipsForLock = 0;
          continue; // No retry
        }

        console.log(`[CARSALES-DEEP] [${bucket.make} ${bucket.model}] Launched: run=${result.apify_run_id}`);
        results.push({ ...bucket, status: "launched", run_id: result.apify_run_id });
        consecutiveSkipsForLock = 0;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CARSALES-DEEP] [${bucket.make} ${bucket.model}] Error: ${msg}`);
        results.push({ ...bucket, status: "error", error: msg });
        consecutiveSkipsForLock = 0;
      }
    }

    const launched = results.filter((r) => r.status === "launched").length;
    const skipped = results.filter((r) => r.status.startsWith("skipped")).length;
    const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-deep-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `v2 deep: launched=${launched} skipped=${skipped} failed=${failed}`,
          states_failed: failed,
        },
        { onConflict: "cron_name" }
      );

    console.log(`[CARSALES-DEEP] Complete: launched=${launched} skipped=${skipped} failed=${failed}`);

    return respond(200, { ok: true, launched, skipped, failed, buckets: MARKET_BUCKETS.length, results });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CARSALES-DEEP] Fatal error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "carsales-deep-scan-cron",
            last_seen_at: new Date().toISOString(),
            last_ok: false,
            note: errorMsg.slice(0, 200),
          },
          { onConflict: "cron_name" }
        );
    } catch (_) { /* best effort */ }

    return respond(500, { ok: false, status: "fatal_error", error: errorMsg });
  }
});
