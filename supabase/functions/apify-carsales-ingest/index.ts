// apify-carsales-ingest
// Pulls latest SUCCEEDED run from memo23/carsales-monitor, paginates the dataset,
// maps each item to the receive-deals payload, and POSTs them.
// Triggered every 30 min via pg_cron. Dedup is handled by receive-deals (24h window
// on listing_url), so re-posting items is safe & cheap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTOR_ID = "memo23~carsales-monitor";
const PAGE_SIZE = 500;
const TIME_BUDGET_MS = 110_000;

const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function mapItem(it: any): Record<string, unknown> | null {
  // memo23/carsales-monitor item shape (best-effort mapping)
  const listing_url =
    it.canonicalUrl || it.url || it.detailsUrl || it.link || null;
  const make = it.make || it.makeName || it.manufacturer || null;
  const model = it.model || it.modelName || null;
  const year = pickNumber(it.year ?? it.modelYear ?? it.yearOfManufacture);
  const price = pickNumber(it.price ?? it.priceValue ?? it.priceTotal);
  const mileage = pickNumber(it.odometer ?? it.kilometres ?? it.mileage);
  const location = it.location || it.suburb || it.state || null;
  // Preserve Carsales price badge / assessment ("Well Below Market", "Below Market", etc.)
  const price_badge =
    it.priceAssessment || it.priceBadge || it.price_badge || it.priceAssessmentText || null;
  const market_price = pickNumber(it.marketPrice ?? it.market_price ?? it.priceComparison);

  if (!listing_url || !make || !model || !year || !price) return null;

  return {
    make: String(make),
    model: String(model),
    year,
    price,
    mileage,
    location: location ? String(location) : null,
    listing_url: String(listing_url),
    source: "Apify_carsales-monitor",
    price_badge: price_badge ? String(price_badge) : null,
    market_price,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN");
  const SCANNER_API_KEY = Deno.env.get("SCANNER_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!APIFY_TOKEN) return json(500, { error: "APIFY_TOKEN missing" });
  if (!SCANNER_API_KEY) return json(500, { error: "SCANNER_API_KEY missing" });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const receiveUrl = `${SUPABASE_URL}/functions/v1/receive-deals`;

  // Optional override: { run_id, dataset_id }
  let override: any = {};
  if (req.method === "POST") {
    try { override = await req.json(); } catch { /* ignore */ }
  }

  try {
    let datasetId: string | null = override.dataset_id ?? null;
    let runId: string | null = override.run_id ?? null;

    // 1. If no override, get latest SUCCEEDED run
    if (!datasetId) {
      const runResp = await fetch(
        `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/last?status=SUCCEEDED&token=${APIFY_TOKEN}`,
      );
      if (!runResp.ok) {
        const t = await runResp.text();
        return json(502, { error: "Apify run lookup failed", status: runResp.status, detail: t });
      }
      const runData = await runResp.json();
      runId = runData?.data?.id ?? null;
      datasetId = runData?.data?.defaultDatasetId ?? null;
      if (!datasetId) return json(200, { ok: true, skipped: "no successful run yet" });
    }

    // 2. Skip if we've already processed this run
    const { data: lastSeen } = await supabase
      .from("cron_heartbeat")
      .select("note")
      .eq("cron_name", "apify-carsales-ingest")
      .maybeSingle();
    if (runId && lastSeen?.note?.includes(`run:${runId}`)) {
      return json(200, { ok: true, skipped: "run already processed", run_id: runId });
    }

    // 3. Paginate dataset & POST to receive-deals
    let offset = 0;
    let totalFetched = 0;
    let posted = 0;
    let duplicates = 0;
    let invalid = 0;
    let errors = 0;

    while (Date.now() - start < TIME_BUDGET_MS) {
      const dsResp = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${PAGE_SIZE}&offset=${offset}&format=json&clean=true`,
      );
      if (!dsResp.ok) {
        return json(502, { error: "Dataset fetch failed", status: dsResp.status });
      }
      const items: any[] = await dsResp.json();
      if (!Array.isArray(items) || items.length === 0) break;

      totalFetched += items.length;

      for (const raw of items) {
        if (Date.now() - start > TIME_BUDGET_MS) break;
        const payload = mapItem(raw);
        if (!payload) { invalid++; continue; }

        try {
          const r = await fetch(receiveUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": SCANNER_API_KEY,
            },
            body: JSON.stringify(payload),
          });
          const body = await r.json().catch(() => ({}));
          if (r.status === 201) posted++;
          else if (r.status === 200 && body.duplicate) duplicates++;
          else errors++;
        } catch {
          errors++;
        }
      }

      if (items.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // 4. Heartbeat + remember run
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "apify-carsales-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: errors === 0,
        note: `run:${runId} fetched=${totalFetched} posted=${posted} dupes=${duplicates} invalid=${invalid} errors=${errors}`,
      },
      { onConflict: "cron_name" },
    );

    return json(200, {
      ok: true,
      run_id: runId,
      dataset_id: datasetId,
      fetched: totalFetched,
      posted,
      duplicates,
      invalid,
      errors,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    return json(500, { error: String(err) });
  }
});
