// apify-carsales-ingest
// Pulls latest SUCCEEDED run from memo23/carsales-cheerio (re-published May 2026
// after memo23/carsales-monitor was deleted), paginates the dataset, maps each
// item to the receive-deals payload, and POSTs them. Also auto-triggers a new
// run if none are pending/running, biased toward WBM-rich queries (used, 2020+,
// nationwide, dealer + private).
//
// Triggered every 30 min via pg_cron. Dedup handled by receive-deals (24h window
// on listing_url), so re-posting items is safe & cheap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// memo23/carsales-cheerio — new (May 2026), $0.0009/result, auto-quarters
// large queries by price so >1k matches still complete fully.
const ACTOR_ID = "memo23~carsales-cheerio";
const PAGE_SIZE = 500;
const TIME_BUDGET_MS = 110_000;

// WBM-rich coverage. Memo23 cheerio actor auto-splits these by price band
// internally, so a single broad URL still returns the full national pool.
// We focus on used 2020+ where WBM badges concentrate.
const WBM_START_URLS = [
  // Used Toyota Hilux 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Toyota._.Model.HiLux.%29_.Year.range%282020..%29.%29",
  // Used Toyota RAV4 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Toyota._.Model.RAV4.%29_.Year.range%282020..%29.%29",
  // Used Toyota LandCruiser 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Toyota._.Model.LandCruiser.%29_.Year.range%282020..%29.%29",
  // Used Toyota Prado 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Toyota._.Model.Prado.%29_.Year.range%282020..%29.%29",
  // Used Ford Ranger 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Ford._.Model.Ranger.%29_.Year.range%282020..%29.%29",
  // Used Ford Everest 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Ford._.Model.Everest.%29_.Year.range%282020..%29.%29",
  // Used Isuzu D-MAX / MU-X 2020+
  "https://www.carsales.com.au/cars/?q=%28And.Service.Carsales._.Condition.Used._.%28C.Make.Isuzu%20Ute.%29_.Year.range%282020..%29.%29",
];

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
  // memo23/carsales-cheerio shape:
  //   link / canonicalUrl, make, model, year, price, specs.odometer,
  //   specs.colour, specs.fuelType, specs.transmission, marketIndicator
  // Legacy fallbacks kept for abotapi / memo23-monitor.
  const specs = (it.specs && typeof it.specs === "object") ? it.specs : {};

  const listing_url =
    it.link || it.canonicalUrl || it.url || it.detailsUrl || null;
  const make = it.make || it.makeName || it.manufacturer || null;
  const model = it.model || it.modelName || null;
  const year = pickNumber(it.year ?? it.modelYear ?? it.yearOfManufacture);
  const price = pickNumber(it.price ?? it.priceValue ?? it.priceTotal);
  const mileage = pickNumber(
    specs.odometer ?? it.odometer ?? it.kilometres ?? it.mileage,
  );
  const location =
    it.location || it.suburb || it.state || specs.location || null;

  // Carsales price badge / market assessment. memo23/cheerio surfaces it as
  // `marketIndicator` ("Well below market price", "Below market price",
  // "Around market price", "Above market price"). Legacy fallbacks retained.
  const badgesArr: string[] = Array.isArray(it.badges) ? it.badges.map(String) : [];
  const badgeFromArr =
    badgesArr.find((b) => /market price|special offer|great price/i.test(b)) || null;
  const price_badge =
    it.marketIndicator || it.priceAssessment || it.priceBadge ||
    it.price_badge || it.priceAssessmentText || badgeFromArr || null;

  const market_price = pickNumber(
    it.marketPrice ?? it.market_price ?? it.priceComparison,
  );

  if (!listing_url || !make || !model || !year || !price) return null;

  // Extra fields for retail_listings upsert
  const title = it.title || it.heading || it.name ||
    [year, make, model, it.badge || it.variant].filter(Boolean).join(" ") || null;
  const variant_raw = it.badge || it.variant || it.series || specs.badge || null;
  const colour = specs.colour || specs.color || it.colour || it.color || null;
  const fuel_type = specs.fuelType || specs.fuel || it.fuelType || null;
  const transmission = specs.transmission || it.transmission || null;
  const body_type = specs.bodyType || it.bodyType || null;
  const seller_name = it.dealerName || it.sellerName || it.seller || it.dealer || null;
  const seller_type = it.sellerType || it.seller_type || (seller_name ? "dealer" : null);
  const image_url = it.image || it.imageUrl || it.thumbnail || it.mainImage ||
    (Array.isArray(it.images) ? it.images[0] : null) || null;
  const images: string[] = Array.isArray(it.images)
    ? it.images.filter((x: any) => typeof x === "string")
    : image_url ? [String(image_url)] : [];

  return {
    make: String(make),
    model: String(model),
    year,
    price,
    mileage,
    location: location ? String(location) : null,
    listing_url: String(listing_url),
    source: "Apify_carsales-cheerio",
    price_badge: price_badge ? String(price_badge) : null,
    market_price,
    title: title ? String(title) : null,
    variant_raw: variant_raw ? String(variant_raw) : null,
    colour: colour ? String(colour) : null,
    fuel_type: fuel_type ? String(fuel_type) : null,
    transmission: transmission ? String(transmission) : null,
    body_type: body_type ? String(body_type) : null,
    seller_name: seller_name ? String(seller_name) : null,
    seller_type: seller_type ? String(seller_type) : null,
    image_url: image_url ? String(image_url) : null,
    images,
  };
}

// Stable source_listing_id from carsales URL (SSE-AD-<digits>) or URL itself.
function deriveSourceListingId(url: string): string {
  const m = url.match(/SSE-AD-(\d+)/i);
  if (m) return `SSE-AD-${m[1]}`;
  return url.split("?")[0].split("#")[0].replace(/\/+$/, "");
}

function parseState(loc: string | null): string | null {
  if (!loc) return null;
  const m = loc.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/i);
  return m ? m[1].toUpperCase() : null;
}

async function upsertRetailListing(
  supabase: ReturnType<typeof createClient>,
  payload: any,
): Promise<boolean> {
  const source_listing_id = deriveSourceListingId(String(payload.listing_url));
  const state = parseState(payload.location);
  const nowIso = new Date().toISOString();
  const row = {
    source: "Apify_carsales-cheerio",
    source_listing_id,
    listing_url: payload.listing_url,
    year: payload.year,
    make: String(payload.make).toUpperCase().trim(),
    model: String(payload.model).toUpperCase().trim(),
    variant_raw: payload.variant_raw ?? null,
    badge: payload.variant_raw ?? null,
    asking_price: Math.round(Number(payload.price)),
    km: payload.mileage ? Math.round(Number(payload.mileage)) : null,
    state,
    region_raw: payload.location ?? null,
    suburb: payload.location && state
      ? (payload.location as string).replace(new RegExp(`,?\\s*${state}.*$`, "i"), "").trim() || null
      : null,
    title: payload.title ?? null,
    colour: payload.colour ?? null,
    fuel_type: payload.fuel_type ?? null,
    transmission: payload.transmission ?? null,
    body_type: payload.body_type ?? null,
    seller_name_raw: payload.seller_name ?? null,
    seller_type: payload.seller_type ?? "unknown",
    image_urls: payload.images && payload.images.length ? payload.images : null,
    price_badge: payload.price_badge ?? null,
    market_price: payload.market_price ? Math.round(Number(payload.market_price)) : null,
    source_type: "RETAIL",
    lifecycle_status: "ACTIVE",
    last_seen_at: nowIso,
    updated_at: nowIso,
  };
  const { error } = await supabase
    .from("retail_listings")
    .upsert(row, { onConflict: "source,source_listing_id" });
  if (error) {
    console.error("[retail upsert]", source_listing_id, error.message);
    return false;
  }
  return true;
}

async function maybeStartRun(token: string): Promise<string | null> {
  // Don't pile up runs — check if anything is already in-flight.
  const listResp = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${token}&limit=5&desc=true`,
  );
  if (listResp.ok) {
    const data = await listResp.json();
    const items: any[] = data?.data?.items ?? [];
    const inflight = items.find((r) =>
      ["READY", "RUNNING"].includes(r.status)
    );
    if (inflight) return null;
  }

  // 90s default timeout is way too short for 7 broad national queries —
  // every run since May 11 TIMED-OUT, leaving us re-processing the stale
  // May 9 dataset. Bump to 10 min + 2GB memory so runs actually complete.
  const startResp = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${token}&timeout=600&memory=2048`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "url",
        startUrls: WBM_START_URLS.map((url) => ({ url })),
      }),
    },
  );
  if (!startResp.ok) return null;
  const startData = await startResp.json();
  return startData?.data?.id ?? null;
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

  // Optional override: { run_id, dataset_id, start?: true }
  let override: any = {};
  if (req.method === "POST") {
    try { override = await req.json(); } catch { /* ignore */ }
  }

  try {
    let datasetId: string | null = override.dataset_id ?? null;
    let runId: string | null = override.run_id ?? null;
    let triggeredRunId: string | null = null;

    // 1. If no override, fire a new run (if none in flight) to keep WBM fresh.
    if (!datasetId && !runId) {
      triggeredRunId = await maybeStartRun(APIFY_TOKEN);
    }

    // 2. Pull the latest SUCCEEDED run for processing
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
      const finishedAt = runData?.data?.finishedAt;
      // Freshness guard — refuse to re-process stale datasets (>6h old).
      // Otherwise we keep fanning out week-old "WBM" leads that may be sold.
      if (finishedAt) {
        const ageMs = Date.now() - new Date(finishedAt).getTime();
        if (ageMs > 6 * 60 * 60 * 1000) {
          return json(200, {
            ok: true,
            skipped: "latest SUCCEEDED run is stale",
            run_id: runId,
            finished_at: finishedAt,
            age_hours: +(ageMs / 3.6e6).toFixed(1),
            triggered_run_id: triggeredRunId,
            hint: "fresh run triggered — re-invoke in a few minutes",
          });
        }
      }
      if (!datasetId) {
        return json(200, {
          ok: true,
          skipped: "no successful run yet",
          triggered_run_id: triggeredRunId,
        });
      }
    }

    // 3. Skip if we've already processed this run
    const { data: lastSeen } = await supabase
      .from("cron_heartbeat")
      .select("note")
      .eq("cron_name", "apify-carsales-ingest")
      .maybeSingle();
    if (runId && lastSeen?.note?.includes(`run:${runId}`)) {
      return json(200, {
        ok: true,
        skipped: "run already processed",
        run_id: runId,
        triggered_run_id: triggeredRunId,
      });
    }

    // 4. Paginate dataset & POST to receive-deals
    let offset = 0;
    let totalFetched = 0;
    let posted = 0;
    let duplicates = 0;
    let invalid = 0;
    let errors = 0;
    let wbmCount = 0;
    let retailUpserts = 0;
    let retailErrors = 0;

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

        // ── WBM fan-out → well-below-market-alert → telegram-arby-leads ──
        // We bypass receive-deals (which drops price_badge) and push WBM hits
        // straight to the alert function so @arbycarleads gets fresh leads.
        const badge = payload.price_badge ? String(payload.price_badge) : "";
        const isWbm = /well\s+below\s+market/i.test(badge);
        const isBelow = /^below\s+market|^\s*below\s+market/i.test(badge);
        if (isWbm || isBelow) {
          wbmCount++;
          // Year guard mirrors well-below-market-alert (MIN_YEAR=2015)
          const yr = Number(payload.year);
          if (yr >= 2015) {
            // Stable synthetic listing_id from listing_url for dedupe
            const urlStr = String(payload.listing_url);
            const enc = new TextEncoder().encode(urlStr);
            const hashBuf = await crypto.subtle.digest("SHA-256", enc);
            const listing_id = "cs-" + Array.from(new Uint8Array(hashBuf))
              .slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
            try {
              await fetch(`${SUPABASE_URL}/functions/v1/well-below-market-alert`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${SERVICE_ROLE}`,
                },
                body: JSON.stringify({
                  listing_id,
                  make: payload.make,
                  model: payload.model,
                  variant: null,
                  year: yr,
                  price: payload.price,
                  km: payload.mileage,
                  listing_url: payload.listing_url,
                  state: payload.location,
                  price_badge: badge,
                  source_table: "apify_carsales_cheerio",
                }),
              });
            } catch (e) {
              console.error("WBM fan-out failed:", e);
            }
          }
        }

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

    // 5. Heartbeat + remember run
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "apify-carsales-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: errors === 0,
        note: `run:${runId} fetched=${totalFetched} posted=${posted} dupes=${duplicates} invalid=${invalid} errors=${errors} wbm=${wbmCount}`,
      },
      { onConflict: "cron_name" },
    );

    return json(200, {
      ok: true,
      run_id: runId,
      dataset_id: datasetId,
      triggered_run_id: triggeredRunId,
      fetched: totalFetched,
      posted,
      duplicates,
      invalid,
      errors,
      wbm_badges_seen: wbmCount,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    return json(500, { error: String(err) });
  }
});
