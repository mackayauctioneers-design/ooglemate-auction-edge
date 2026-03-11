import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-deep-scan-cron v1.0 — Daily market pricing dataset
 *
 * Runs ONCE per day. Scrapes by specific make/model buckets
 * with small item limits (~150 per bucket) to prevent OOM.
 * Sorted by price (ascending) for market floor detection.
 *
 * This builds the true comparable dataset for delta calculations.
 * The shallow cron (carsales-scan-cron) catches new inventory every 2h.
 * This deep cron builds the pricing truth table once daily.
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;
const ITEMS_PER_BUCKET = 150;

// Top-volume make/model pairs for AU market pricing
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

/** Carsales PascalCase slug */
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

  try {
    const crawlMode = Deno.env.get("CRAWL_MODE") || "normal";
    if (crawlMode === "disabled") {
      console.log("Deep scan: CRAWL_MODE=disabled, skipping");
      return new Response(JSON.stringify({ success: true, message: "crawl disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Deep scan: ${MARKET_BUCKETS.length} make/model buckets, ${ITEMS_PER_BUCKET} items each`);

    const results = [];

    for (let i = 0; i < MARKET_BUCKETS.length; i++) {
      const bucket = MARKET_BUCKETS[i];
      const bucketUrl = buildBucketUrl(bucket.make, bucket.model);

      // 8s stagger between buckets to avoid Apify contention
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 8000));
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
        if (!scanResponse.ok) {
          console.error(`[${bucket.make} ${bucket.model}] error: ${JSON.stringify(result)}`);
          results.push({ ...bucket, error: result.error });
        } else {
          console.log(`[${bucket.make} ${bucket.model}] queued: run ${result.apify_run_id}`);
          results.push({ ...bucket, run_id: result.apify_run_id, queued: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${bucket.make} ${bucket.model}] dispatch failed: ${msg}`);
        results.push({ ...bucket, error: msg });
      }
    }

    const queued = results.filter((r) => r.queued).length;
    const failed = results.filter((r) => r.error).length;

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-deep-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `v1 deep: ${queued}/${MARKET_BUCKETS.length} buckets, ~${queued * ITEMS_PER_BUCKET} items`,
          states_failed: failed,
        },
        { onConflict: "cron_name" }
      );

    console.log(`Deep scan complete: ${queued} queued, ${failed} failed`);

    return new Response(
      JSON.stringify({ success: true, queued, failed, buckets: MARKET_BUCKETS.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Deep scan error:", errorMsg);

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

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
