import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeVehicleIdentity } from "../_shared/taxonomy/normalizeVehicleIdentity.ts";
import { createTaxonomyDeps } from "../_shared/taxonomy/taxonomyRepo.ts";

/**
 * SLATTERY CRAWL v2 — Direct JSON API scraper for slatteryauctions.com.au
 *
 * Replaces the Firecrawl markdown → regex approach with direct HTTP calls
 * to Slattery's public JSON API. Zero browser rendering, zero proxies,
 * zero Firecrawl credits.
 *
 * API endpoints used (no auth required):
 *   GET /api/slattery/auctions                              → list all current auctions
 *   GET /api/slattery/assets?auctionId={id}&page=1&pageSize=100 → lots per auction
 *   GET /api/slattery/assets/{asset_id}                     → full detail per lot
 *
 * Flow:
 *   1. Fetch all current auctions
 *   2. For each motor-vehicle auction, fetch all lots via paginated list API
 *   3. For each lot, fetch detail API for VIN/colour/engine/year
 *   4. Normalize via taxonomy, upsert to vehicle_listings + stub_anchors
 *
 * Schedule: every 2 hours via slattery-scan-cron
 *
 * POST body (optional):
 *   { dry_run: boolean, debug: boolean, auction_ids: number[], fetch_details: boolean }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MIN_YEAR = 2016;
const BASE_URL = "https://slatteryauctions.com.au";
const API_BASE = `${BASE_URL}/api/slattery`;
const PAGE_SIZE = 100;
const CRON_NAME = "slattery-crawl";
const TIME_BUDGET_MS = 130_000; // 130s budget — leave 20s for DB writes + heartbeat (150s edge limit)

// Motor vehicle category keywords (auction names to include)
const MV_KEYWORDS = [
  "motor vehicle",
  "car ",
  "car&",
  "prestige",
  "toyota",
  "holden",
  "ford",
];
// Category names to exclude
const EXCLUDE_KEYWORDS = [
  "bicycle",
  "truck",
  "trailer",
  "machinery",
  "crane",
  "yacht",
  "equipment",
  "general goods",
  "hair removal",
  "number plate",
  "excavat",
  "engineering",
  "machining",
  "container",
  "generator",
  "cogeneration",
  "mine power",
  "bottling",
  "manufacturing",
  "groundskeeping",
  "agriculture",
  "shipping",
  "horse float",
  "flybridge",
  "cruiser auction",
  "motorcycle",
];

interface SlatteryAuction {
  id: number;
  name: string;
  closesAt: string;
  opensAt?: string;
  auctionNumber?: string;
  [key: string]: unknown;
}

interface SlatteryListItem {
  id: number;
  name: string;
  description?: string;
  consignmentNumber?: string;
  auctionId: number;
  auctionNumber?: string;
  lotNumber?: number;
  make?: string;
  model?: string;
  summaryAttributes?: {
    transmission?: string;
    fueltype?: string;
    drivetype?: string;
    odometer?: string;
  };
  categoryId?: number;
  pickupLocation?: string;
  opensAt?: string;
  closesAt?: string;
  currentBidAmount?: number;
  startingBidAmount?: number;
  odometer?: number;
  mediaUrls?: string[];
  [key: string]: unknown;
}

interface SlatteryDetail {
  id: number;
  name: string;
  description?: string;
  manufactureYear?: number;
  make?: string;
  model?: string;
  odometer?: number;
  currentBidAmount?: number;
  closesAt?: string;
  pickupLocation?: string;
  lotNumber?: number;
  consignmentNumber?: string;
  auctionNumber?: string;
  mediaUrls?: string[];
  detailAttributes?: {
    vin?: string;
    colour?: string;
    transmission?: string;
    fueltype?: string;
    drivetype?: string;
    capacity?: string;
    bodytype?: string;
    series?: string;
    [key: string]: string | undefined;
  };
  conditionAttributes?: {
    damage?: string;
    [key: string]: string | undefined;
  };
  [key: string]: unknown;
}

interface Metrics {
  auctions_found: number;
  mv_auctions: number;
  auction_names: string[];
  pages_fetched: number;
  raw_listings: number;
  details_fetched: number;
  details_failed: number;
  year_filtered: number;
  valid_listings: number;
  upserted: number;
  stubs_created: number;
  errors: string[];
  duration_ms: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.error(`[SLATTERY] API ${res.status} for ${url.substring(0, 100)}`);
      return null;
    }
    const json = await res.json();
    return json as T;
  } catch (e) {
    console.error(`[SLATTERY] Fetch error for ${url.substring(0, 100)}:`, e);
    return null;
  }
}

function isMvAuction(name: string): boolean {
  const lower = name.toLowerCase();
  // Exclude non-MV categories first
  if (EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  // Include if it matches MV keywords
  if (MV_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  // Include if auction name contains a specific vehicle reference
  // e.g. "2022 Ram 1500 TRX" or "Holden VU SS Ute"
  if (/\b(20\d{2})\b/.test(name) && /\b(ute|suv|sedan|wagon|hatch|cab|4x4|4wd|awd)\b/i.test(name)) return true;
  // Default: exclude unknown auctions to avoid unnecessary API calls
  // The major MV auctions always have "Motor Vehicle" or a car make in the name
  return false;
}

function extractState(location: string | null | undefined): string | null {
  if (!location) return null;
  const match = location.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/);
  return match ? match[1] : null;
}

function normalizeFuel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("hybrid") && lower.includes("petrol")) return "hybrid";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("diesel")) return "diesel";
  if (lower.includes("petrol")) return "petrol";
  if (lower.includes("electric")) return "electric";
  return raw.toLowerCase();
}

function normalizeTransmission(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("continuously variable") || lower === "cvt") return "CVT";
  if (lower.includes("automatic")) return "automatic";
  if (lower.includes("manual")) return "manual";
  return raw.toLowerCase();
}

function normalizeDrivetrain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("four wheel") || lower.includes("4wd") || lower.includes("4x4") || lower.includes("awd") || lower.includes("all wheel")) return "4WD";
  if (lower.includes("front wheel") || lower.includes("fwd")) return "FWD";
  if (lower.includes("rear wheel") || lower.includes("rwd")) return "RWD";
  return raw;
}

/** Small pause to be respectful to the API */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    /* empty */
  }

  const dryRun = body.dry_run === true;
  const debug = body.debug === true;
  const fetchDetails = body.fetch_details !== false; // default true
  const filterAuctionIds = Array.isArray(body.auction_ids)
    ? (body.auction_ids as number[])
    : null;

  const metrics: Metrics = {
    auctions_found: 0,
    mv_auctions: 0,
    auction_names: [],
    pages_fetched: 0,
    raw_listings: 0,
    details_fetched: 0,
    details_failed: 0,
    year_filtered: 0,
    valid_listings: 0,
    upserted: 0,
    stubs_created: 0,
    errors: [],
    duration_ms: 0,
  };

  try {
    // ── STEP 1: Fetch all current auctions (paginated) ──
    console.log("[SLATTERY] Fetching auctions list...");
    const allAuctions: SlatteryAuction[] = [];
    let auctionPage = 1;
    let hasMoreAuctions = true;

    while (hasMoreAuctions) {
      const auctionsResp = await fetchJson<{
        ok: boolean;
        data: SlatteryAuction[];
        metadata?: { hasNext: boolean; totalPages: number; totalCount: number };
      }>(`${API_BASE}/auctions?page=${auctionPage}`);

      if (!auctionsResp?.data) {
        if (auctionPage === 1) {
          throw new Error("Failed to fetch auctions list from Slattery API");
        }
        break;
      }

      allAuctions.push(...auctionsResp.data);
      hasMoreAuctions = auctionsResp.metadata?.hasNext ?? false;
      console.log(`[SLATTERY] Auctions page ${auctionPage}: ${auctionsResp.data.length} auctions (total: ${allAuctions.length}, hasNext: ${hasMoreAuctions})`);
      auctionPage++;

      if (hasMoreAuctions) await sleep(100);
    }

    metrics.auctions_found = allAuctions.length;
    console.log(`[SLATTERY] Found ${allAuctions.length} auctions across ${auctionPage - 1} page(s)`);

    // Filter to motor vehicle auctions
    let mvAuctions = allAuctions.filter((a) => isMvAuction(a.name));

    // If specific auction IDs provided, filter to those
    if (filterAuctionIds) {
      mvAuctions = mvAuctions.filter((a) => filterAuctionIds.includes(a.id));
    }

    metrics.mv_auctions = mvAuctions.length;
    metrics.auction_names = mvAuctions.map((a) => `${a.id}:${a.name}`);
    console.log(`[SLATTERY] ${mvAuctions.length} motor vehicle auctions to process`);

    // ── STEP 2: Fetch all lots for each auction ──
    const allLots: Array<{ item: SlatteryListItem; auctionName: string }> = [];

    for (const auction of mvAuctions) {
      let page = 1;
      let hasNext = true;

      while (hasNext) {
        const url = `${API_BASE}/assets?auctionId=${auction.id}&page=${page}&pageSize=${PAGE_SIZE}`;
        const lotsResp = await fetchJson<{
          ok: boolean;
          data: SlatteryListItem[];
          metadata: { hasNext: boolean; totalCount: number; totalPages: number };
        }>(url);

        metrics.pages_fetched++;

        if (!lotsResp?.data) {
          if (metrics.errors.length < 20)
            metrics.errors.push(`Failed to fetch lots for auction ${auction.id} page ${page}`);
          break;
        }

        // Only keep Motor Vehicles category (categoryId = 1) if mixed auction
        const mvLots = lotsResp.data.filter(
          (lot) => !lot.categoryId || lot.categoryId === 1 || lot.categoryId === 2
        );

        for (const item of mvLots) {
          allLots.push({ item, auctionName: auction.name });
        }

        hasNext = lotsResp.metadata?.hasNext ?? false;
        page++;

        // Be respectful
        if (hasNext) await sleep(100);
      }

      console.log(
        `[SLATTERY] Auction "${auction.name}" (${auction.id}): fetched lots`
      );
    }

    metrics.raw_listings = allLots.length;
    console.log(`[SLATTERY] Total raw lots: ${allLots.length}`);

    // ── STEP 3: Parse year from title for pre-filtering ──
    // The list API doesn't include manufactureYear, so parse from name
    // e.g. "2024 Toyota Camry SX Hybrid-Petrol" → 2024
    const yearFilteredLots = allLots.filter(({ item }) => {
      const yearMatch = item.name.match(/^(\d{4})\s/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      if (!year || year < MIN_YEAR) {
        metrics.year_filtered++;
        return false;
      }
      return true;
    });

    metrics.valid_listings = yearFilteredLots.length;
    console.log(
      `[SLATTERY] ${yearFilteredLots.length} valid (year >= ${MIN_YEAR}), filtered ${metrics.year_filtered}`
    );

    if (dryRun) {
      metrics.duration_ms = Date.now() - startTime;
      return respond(200, {
        success: true,
        dry_run: true,
        metrics,
        sample: yearFilteredLots.slice(0, 5).map((l) => ({
          id: l.item.id,
          name: l.item.name,
          make: l.item.make,
          model: l.item.model,
          km: l.item.odometer,
          bid: l.item.currentBidAmount,
          location: l.item.pickupLocation,
          auction: l.auctionName,
        })),
      });
    }

    // ── STEP 4: Fetch detail + normalize + upsert ──
    const taxonomyDeps = createTaxonomyDeps(supabase);

    for (const { item, auctionName } of yearFilteredLots) {
      // ── TIME BUDGET CHECK ──
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[SLATTERY] Time budget exhausted at ${Date.now() - startTime}ms — processed ${metrics.upserted} of ${yearFilteredLots.length} lots`);
        break;
      }
      try {
        // Parse basic year/make/model from list API
        let year: number | null = null;
        let make = item.make || null;
        let model = item.model || null;
        let variantRaw: string | null = null;
        let vin: string | null = null;
        let colour: string | null = null;
        let fuel = normalizeFuel(item.summaryAttributes?.fueltype);
        let transmission = normalizeTransmission(item.summaryAttributes?.transmission);
        let drivetrain = normalizeDrivetrain(item.summaryAttributes?.drivetype);
        let km = item.odometer ?? null;
        const currentBid = item.currentBidAmount ?? null;
        const location = item.pickupLocation || null;

        // Parse year from title
        const yearMatch = item.name.match(/^(\d{4})\s/);
        if (yearMatch) year = parseInt(yearMatch[1], 10);

        // Parse KM from summaryAttributes if not in top-level
        if (!km && item.summaryAttributes?.odometer) {
          km = parseInt(item.summaryAttributes.odometer.replace(/,/g, ""), 10) || null;
        }

        // ── Fetch detail API for full data (VIN, colour, year, engine) ──
        if (fetchDetails) {
          const detail = await fetchJson<{ ok: boolean; data: SlatteryDetail }>(
            `${API_BASE}/assets/${item.id}`
          );

          if (detail?.data) {
            metrics.details_fetched++;
            const d = detail.data;
            const da = d.detailAttributes || {};

            // Prefer detail data over list data
            if (d.manufactureYear) year = d.manufactureYear;
            if (d.make) make = d.make;
            if (d.model) model = d.model;
            if (d.odometer) km = d.odometer;
            if (da.vin) vin = da.vin;
            if (da.colour) colour = da.colour;
            if (da.series) variantRaw = da.series;
            if (da.fueltype) fuel = normalizeFuel(da.fueltype);
            if (da.transmission) transmission = normalizeTransmission(da.transmission);
            if (da.drivetype) drivetrain = normalizeDrivetrain(da.drivetype);
          } else {
            metrics.details_failed++;
          }

          // Polite delay between detail requests
          await sleep(100);
        }

        // Double-check year filter after detail enrichment
        if (!year || year < MIN_YEAR) {
          metrics.year_filtered++;
          continue;
        }

        // Build variant_raw from title if not from detail
        if (!variantRaw) {
          // Title format: "2024 Toyota Camry SX Hybrid-Petrol (Auto)"
          const titleParts = item.name
            .replace(/^\d{4}\s+/, "")          // remove year
            .replace(/\([^)]*\)\s*$/g, "")     // remove trailing (Auto) etc
            .replace(/\b(Petrol|Diesel|Hybrid-Petrol|Hybrid|Electric)\b/gi, "")
            .trim()
            .split(/\s+/);
          // First word = make, second = model, rest = variant
          if (titleParts.length > 2) {
            variantRaw = titleParts.slice(2).join(" ").trim() || null;
          }
        }

        // ── Normalize via taxonomy ──
        let makeNorm = make?.toUpperCase() || null;
        let modelNorm = model || null;
        let variantFamily: string | null = null;

        try {
          const normResult = await normalizeVehicleIdentity(taxonomyDeps, {
            makeRaw: make || "",
            modelRaw: model || "",
            variantRaw: variantRaw || undefined,
            year,
            km,
            title: item.name,
            source: "slattery",
          });
          if (normResult.make) makeNorm = normResult.make;
          if (normResult.model) modelNorm = normResult.model;
          if (normResult.familyKey) variantFamily = normResult.familyKey;
        } catch (normErr) {
          console.warn(
            `[SLATTERY] Normalization failed for ${item.name}:`,
            normErr
          );
        }

        const listingId = `slattery:${item.id}`;
        const detailUrl = `${BASE_URL}/assets/${item.id}?auctionId=${item.auctionId}`;
        const state = extractState(location);

        // ── Upsert to vehicle_listings ──
        const { error: upsertError } = await supabase
          .from("vehicle_listings")
          .upsert(
            {
              listing_id: listingId,
              source: "slattery",
              listing_url: detailUrl,
              make: makeNorm,
              model: modelNorm,
              year,
              variant_raw: variantRaw || item.name,
              variant_family: variantFamily,
              km,
              asking_price: currentBid,
              fuel,
              transmission,
              drivetrain,
              vin,
              location,
              state,
              auction_house: "slattery",
              source_class: "auction",
              status: "active",
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            },
            {
              onConflict: "listing_id,source",
              ignoreDuplicates: false,
            }
          );

        if (upsertError) {
          if (metrics.errors.length < 20)
            metrics.errors.push(
              `Upsert ${item.id}: ${upsertError.message}`
            );
          continue;
        }
        metrics.upserted++;

        // ── Create stub anchor for hunt matching ──
        const stubPayload = [
          {
            source_stock_id: String(item.id),
            detail_url: detailUrl,
            year,
            make_raw: makeNorm,
            model_raw: modelNorm,
            location,
            raw_text: item.name,
          },
        ];

        const { error: stubError } = await supabase.rpc(
          "upsert_stub_anchor_batch",
          {
            p_source: "slattery",
            p_stubs: stubPayload,
          }
        );

        if (stubError) {
          console.warn(
            `[SLATTERY] Stub error for ${item.id}:`,
            stubError.message
          );
        } else {
          metrics.stubs_created++;
        }
      } catch (itemErr) {
        if (metrics.errors.length < 20)
          metrics.errors.push(
            `Item ${item.id}: ${itemErr instanceof Error ? itemErr.message : String(itemErr)}`
          );
      }
    }

    metrics.duration_ms = Date.now() - startTime;

    const noteStr = `auctions=${metrics.mv_auctions} found=${metrics.raw_listings} valid=${metrics.valid_listings} detail=${metrics.details_fetched}/${metrics.details_failed} upserted=${metrics.upserted} stubs=${metrics.stubs_created} ms=${metrics.duration_ms}`;
    console.log(`[SLATTERY] Done: ${noteStr}`);

    // ── Log heartbeat + audit ──
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: CRON_NAME,
          last_seen_at: new Date().toISOString(),
          last_ok: metrics.errors.length === 0,
          note: noteStr,
        },
        { onConflict: "cron_name" }
      );

    await supabase.from("cron_audit_log").insert({
      cron_name: CRON_NAME,
      run_date: new Date().toISOString().slice(0, 10),
      success: metrics.errors.length === 0,
      error:
        metrics.errors.length > 0
          ? metrics.errors.join("; ").slice(0, 500)
          : null,
      result: metrics,
    });

    return respond(200, { success: true, metrics });
  } catch (error) {
    metrics.duration_ms = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[SLATTERY] Fatal error:", errMsg);

    // Best-effort logging
    await supabase
      .from("cron_audit_log")
      .insert({
        cron_name: CRON_NAME,
        run_date: new Date().toISOString().slice(0, 10),
        success: false,
        error: errMsg.slice(0, 500),
        result: metrics,
      })
      .catch(() => {});

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: CRON_NAME,
          last_seen_at: new Date().toISOString(),
          last_ok: false,
          note: errMsg.slice(0, 200),
        },
        { onConflict: "cron_name" }
      )
      .catch(() => {});

    return respond(500, { success: false, error: errMsg, metrics });
  }
});
