import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-micro-cron v1.0 — Tier-based micro-batched Carsales scanning
 *
 * Dispatches state × make/model segments to carsales-scan.
 * Accepts { tier: "high" | "medium" | "low" } to determine which states to scan.
 *
 * HIGH: NSW, QLD, VIC — every 2h
 * MEDIUM: WA, SA — every 6h
 * LOW: TAS, ACT, NT — every 12h
 *
 * SAFETY:
 * - Honours CRAWL_MODE kill switch
 * - Serialised dispatch with inter-segment delays
 * - Backpressure: halts after 3 consecutive lock-skips
 * - No retries — logs and moves on
 */

const YEAR_MIN = 2020;
const KM_MAX = 120000;
const ITEMS_PER_SEGMENT = 80;
const INTER_SEGMENT_DELAY_MS = 10000; // 10s between segments

const TIER_STATES: Record<string, string[]> = {
  high: ["NSW", "QLD", "VIC"],
  medium: ["WA", "SA"],
  low: ["TAS", "ACT", "NT"],
};

const PRIORITY_MODELS = [
  { make: "Toyota", model: "Prado" },
  { make: "Toyota", model: "HiLux" },
  { make: "Toyota", model: "LandCruiser" },
  { make: "Toyota", model: "RAV4" },
  { make: "Ford", model: "Ranger" },
  { make: "Ford", model: "Everest" },
  { make: "Nissan", model: "Patrol" },
  { make: "Nissan", model: "Navara" },
  { make: "Isuzu", model: "MUX" },
  { make: "Isuzu", model: "DMax" },
  { make: "Mazda", model: "BT50" },
  { make: "Mazda", model: "CX5" },
  { make: "Mitsubishi", model: "Triton" },
  { make: "Hyundai", model: "Tucson" },
  { make: "Kia", model: "Sportage" },
  { make: "Volkswagen", model: "Amarok" },
];

function carsalesSlug(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join("");
}

function buildSegmentUrl(state: string, make: string, model: string): string {
  const q = `(And.Make.${carsalesSlug(make)}..Model.${carsalesSlug(model)}..Year.range(${YEAR_MIN}..)..Odometer.range(..${KM_MAX})..State.${state}.)`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~DateAdded`;
}

interface SegmentResult {
  state: string;
  make: string;
  model: string;
  status: string;
  run_id?: string;
  error?: string;
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
      console.log("[MICRO-CRON] Skipped: CRAWL_MODE=disabled");
      return respond(200, { ok: true, status: "skipped_disabled" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse tier from body
    const body = await req.json().catch(() => ({}));
    const tier = (body.tier || "high").toLowerCase();
    const states = TIER_STATES[tier];

    if (!states) {
      return respond(400, { ok: false, error: `Invalid tier: ${tier}. Use high, medium, or low.` });
    }

    // Build segments: state × make/model
    const segments: Array<{ state: string; make: string; model: string }> = [];
    for (const state of states) {
      for (const { make, model } of PRIORITY_MODELS) {
        segments.push({ state, make, model });
      }
    }

    console.log(`[MICRO-CRON] Tier=${tier} states=${states.join(",")} segments=${segments.length}`);

    const results: SegmentResult[] = [];
    let consecutiveLockSkips = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // Backpressure: halt after 3 consecutive lock-skips
      if (consecutiveLockSkips >= 3) {
        console.log(`[MICRO-CRON] Halting: ${consecutiveLockSkips} consecutive lock-skips`);
        for (let j = i; j < segments.length; j++) {
          results.push({ ...segments[j], status: "skipped_backpressure" });
        }
        break;
      }

      // Stagger between segments
      if (i > 0) {
        await new Promise((r) => setTimeout(r, INTER_SEGMENT_DELAY_MS));
      }

      const segUrl = buildSegmentUrl(seg.state, seg.make, seg.model);

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
              startUrls: [{ url: segUrl }],
              limit: ITEMS_PER_SEGMENT,
            }),
          }
        );

        const result = await scanResponse.json();

        if (result.status === "skipped_disabled") {
          console.log(`[MICRO-CRON] Halting: CRAWL_MODE disabled mid-run`);
          results.push({ ...seg, status: "skipped_disabled" });
          break;
        }

        if (result.status === "skipped_already_running") {
          console.log(`[MICRO-CRON] [${seg.state}/${seg.make}/${seg.model}] Lock active`);
          results.push({ ...seg, status: "skipped_already_running" });
          consecutiveLockSkips++;
          continue;
        }

        if (result.ok === false) {
          console.error(`[MICRO-CRON] [${seg.state}/${seg.make}/${seg.model}] Failed: ${result.error || result.status}`);
          results.push({ ...seg, status: "failed", error: result.error || result.status });
          consecutiveLockSkips = 0;
          continue;
        }

        console.log(`[MICRO-CRON] [${seg.state}/${seg.make}/${seg.model}] Launched: run=${result.apify_run_id}`);
        results.push({ ...seg, status: "launched", run_id: result.apify_run_id });
        consecutiveLockSkips = 0;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[MICRO-CRON] [${seg.state}/${seg.make}/${seg.model}] Error: ${msg}`);
        results.push({ ...seg, status: "error", error: msg });
        consecutiveLockSkips = 0;
      }
    }

    const launched = results.filter((r) => r.status === "launched").length;
    const skipped = results.filter((r) => r.status.startsWith("skipped")).length;
    const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: `carsales-micro-cron-${tier}`,
          last_seen_at: new Date().toISOString(),
          last_ok: failed === 0,
          note: `tier=${tier} launched=${launched} skipped=${skipped} failed=${failed} segments=${segments.length}`,
          states_failed: failed,
        },
        { onConflict: "cron_name" }
      );

    console.log(`[MICRO-CRON] Complete: tier=${tier} launched=${launched} skipped=${skipped} failed=${failed}`);

    return respond(200, { ok: true, tier, launched, skipped, failed, total_segments: segments.length, results });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[MICRO-CRON] Fatal error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "carsales-micro-cron",
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
