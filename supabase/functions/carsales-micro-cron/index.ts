import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-micro-cron v2.0 — Price-band × State micro-batched scheduler
 *
 * Replaces BOTH carsales-scan-cron AND carsales-deep-scan-cron.
 * 32 segments = 8 states × 4 price bands, dispatched in round-robin batches of 3.
 *
 * SCHEDULE (via pg_cron):
 *   HIGH  (NSW/QLD/VIC): every 2h
 *   MEDIUM (WA/SA): every 6h
 *   LOW   (TAS/ACT/NT): every 12h
 *
 * OFFSET TRACKING: Uses cron_heartbeat.rows_inserted (NOT cron_state — that table doesn't exist)
 * AUTH: Uses SUPABASE_SERVICE_ROLE_KEY to call carsales-scan (NOT anon key)
 */

const BATCH_SIZE = 3;

interface Segment {
  segment_id: string;
  state: string;
  price_band: string;
  priority: "high" | "medium" | "low";
  label: string;
  url: string;
  maxItems: number;
}

function buildUrl(state: string, priceMin: number, priceMax: number): string {
  const priceRange = priceMax >= 200000
    ? `Price.range(${priceMin}..)`
    : `Price.range(${priceMin}..${priceMax})`;
  return `https://www.carsales.com.au/cars/?q=(And.SellerType.Dealer..State.${state}..Year.range(2020..)..Odometer.range(..120000)..${priceRange}.)&sort=~DateAdded`;
}

const PRICE_BANDS = [
  { band: "budget",  min: 0,     max: 30000  },
  { band: "mid",     min: 30000, max: 50000  },
  { band: "upper",   min: 50000, max: 80000  },
  { band: "premium", min: 80000, max: 200000 },
] as const;

const STATE_TIERS: Record<string, "high" | "medium" | "low"> = {
  NSW: "high", QLD: "high", VIC: "high",
  WA: "medium", SA: "medium",
  TAS: "low", ACT: "low", NT: "low",
};

const MAX_ITEMS_BY_TIER: Record<string, number> = {
  high: 1000, medium: 800, low: 500,
};

// Build all 32 segments
const SEGMENTS: Segment[] = [];
let segIdx = 1;
for (const [state, tier] of Object.entries(STATE_TIERS)) {
  for (const pb of PRICE_BANDS) {
    SEGMENTS.push({
      segment_id: `SEG_${String(segIdx).padStart(3, "0")}`,
      state,
      price_band: pb.band,
      priority: tier,
      label: `${state}_${pb.band}`,
      url: buildUrl(state, pb.min, pb.max),
      maxItems: MAX_ITEMS_BY_TIER[tier],
    });
    segIdx++;
  }
}

async function getOffset(
  supabase: ReturnType<typeof createClient>,
  tier: string
): Promise<number> {
  const { data } = await supabase
    .from("cron_heartbeat")
    .select("rows_inserted")
    .eq("cron_name", `carsales_micro_cron_${tier}`)
    .single();
  return data?.rows_inserted ?? 0;
}

async function setOffset(
  supabase: ReturnType<typeof createClient>,
  tier: string,
  offset: number
): Promise<void> {
  await supabase.from("cron_heartbeat").upsert(
    {
      cron_name: `carsales_micro_cron_${tier}`,
      rows_inserted: offset,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "cron_name" }
  );
}

function jsonResp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const requestedTier: string = body.tier || "high";

    const tierSegments =
      requestedTier === "all"
        ? SEGMENTS
        : SEGMENTS.filter((s) => s.priority === requestedTier);

    if (tierSegments.length === 0) {
      return jsonResp(400, { error: `No segments for tier: ${requestedTier}` });
    }

    // Round-robin offset
    const offset = await getOffset(supabase, requestedTier);
    const batch: Segment[] = [];
    for (let i = 0; i < BATCH_SIZE && i < tierSegments.length; i++) {
      const idx = (offset + i) % tierSegments.length;
      batch.push(tierSegments[idx]);
    }

    const nextOffset = (offset + BATCH_SIZE) % tierSegments.length;
    await setOffset(supabase, requestedTier, nextOffset);

    console.log(
      `[micro-cron] tier=${requestedTier} | batch=${batch.map((s) => s.label).join(", ")} | offset=${offset}→${nextOffset}`
    );

    const results: Array<{ segment: string; status: string; detail: string }> = [];

    for (const seg of batch) {
      try {
        const scanResp = await fetch(
          `${supabaseUrl}/functions/v1/carsales-scan`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              url: seg.url,
              maxItems: seg.maxItems,
              segment_id: seg.segment_id,
              priority: seg.priority,
              label: seg.label,
            }),
          }
        );

        const scanData = await scanResp.json();

        if (scanResp.ok && scanData.ok) {
          results.push({
            segment: seg.label,
            status: "ok",
            detail: `run=${scanData.run_id}, max=${scanData.max_items}`,
          });
        } else if (scanResp.status === 429) {
          results.push({
            segment: seg.label,
            status: "skipped",
            detail: `Concurrency limit: ${scanData.active_runs}/${scanData.max}`,
          });
          console.log(`Concurrency limit hit at ${seg.label}, stopping batch`);
          break;
        } else {
          results.push({
            segment: seg.label,
            status: "error",
            detail: scanData.error || `HTTP ${scanResp.status}`,
          });
        }
      } catch (err) {
        results.push({
          segment: seg.label,
          status: "error",
          detail: String(err),
        });
      }

      // Small delay between launches
      await new Promise((r) => setTimeout(r, 2000));
    }

    const launched = results.filter((r) => r.status === "ok").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errored = results.filter((r) => r.status === "error").length;

    console.log(`[micro-cron] Done: ${launched} launched, ${skipped} skipped, ${errored} errors`);

    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "carsales-micro-cron",
        last_seen_at: new Date().toISOString(),
        last_ok: errored === 0,
        note: `tier=${requestedTier} | launched=${launched}, skipped=${skipped}, errors=${errored} | batch: ${batch.map((s) => s.label).join(", ")}`,
      },
      { onConflict: "cron_name" }
    );

    return jsonResp(200, {
      ok: true,
      tier: requestedTier,
      batch_size: batch.length,
      launched,
      skipped,
      errored,
      results,
      next_offset: nextOffset,
    });
  } catch (err) {
    console.error("[micro-cron] Fatal error:", err);
    return jsonResp(500, { ok: false, error: String(err) });
  }
});
