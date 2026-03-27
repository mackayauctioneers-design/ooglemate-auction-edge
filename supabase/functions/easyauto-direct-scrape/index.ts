import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBadge } from "../_shared/taxonomy/extractBadge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * easyauto-direct-scrape — Direct RSC-based scraper for EasyAuto123
 *
 * Bypasses the broken Apify actor by fetching EasyAuto123 pages directly
 * using their Next.js RSC (React Server Components) endpoint.
 * Extracts ALL vehicle fields including odometer/KM.
 *
 * Schedule: every 3 hours (replaces easyauto-scrape → Apify pipeline)
 *
 * POST body (optional):
 *   { maxPages: number, startPage: number }
 */

const BASE_URL = "https://www.easyauto123.com.au/buy/used-cars";
const PER_PAGE = 20;
const DEFAULT_MAX_PAGES = 100; // ~2000 vehicles max
const FETCH_HEADERS = {
  RSC: "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/x-component",
};

// ── RSC regex patterns (validated against live data 2026-03-27) ──

const VEHICLE_SPEC_RE =
  /\{"vehicleSpecifications":"[^"]*","odometer":"(\d+)","driveType":"([^"]*)","engineCapacityCCM":"([^"]*)","colour":"([^"]*)","fuelType":"([^"]*)","variant":"([^"]*)","vin":"([A-Z0-9]+)","model":"([^"]*)","transmissionType":"([^"]*)","make":"([^"]*)","releaseYear":"(\d+)"/g;

// Broader price regex — some vehicles omit contractPrice
const PRICE_RE = /"displayPrice":(\d+)/g;

const LOCATION_RE =
  /\{"siteCode":"([^"]+)","localityName":"([^"]+)","regionName":"([^"]+)","stateShortName":"([^"]+)"\}/g;

const DISPLAY_TEXT_RE = /"displayVehicleText":"([^"]+)"/g;

const VEHICLE_ID_RE = /"vehicleId":"([0-9a-f-]{36})"/g;

interface PositionMatch<T> {
  pos: number;
  data: T;
}

interface ParsedVehicle {
  vehicleId: string;
  displayText: string;
  odometer: number;
  driveType: string;
  engineCapacity: string;
  colour: string;
  fuelType: string;
  variant: string;
  vin: string;
  model: string;
  transmissionType: string;
  make: string;
  releaseYear: number;
  displayPrice: number;
  localityName: string;
  regionName: string;
  stateShortName: string;
  siteCode: string;
}

/**
 * Find the nearest match from `candidates` whose position is > `afterPos`.
 * Returns the data of the first match, or undefined.
 */
function findNextAfter<T>(
  candidates: PositionMatch<T>[],
  afterPos: number
): T | undefined {
  for (const c of candidates) {
    if (c.pos > afterPos) return c.data;
  }
  return undefined;
}

/**
 * Find the nearest match from `candidates` whose position is < `beforePos`.
 * Returns the last match before that position, or undefined.
 */
function findLastBefore<T>(
  candidates: PositionMatch<T>[],
  beforePos: number
): T | undefined {
  let last: T | undefined;
  for (const c of candidates) {
    if (c.pos < beforePos) last = c.data;
    else break;
  }
  return last;
}

function parseRscPage(rscText: string): ParsedVehicle[] {
  // Reset all regex lastIndex
  VEHICLE_SPEC_RE.lastIndex = 0;
  PRICE_RE.lastIndex = 0;
  LOCATION_RE.lastIndex = 0;
  DISPLAY_TEXT_RE.lastIndex = 0;
  VEHICLE_ID_RE.lastIndex = 0;

  // Collect all matches WITH their text positions
  const specs: PositionMatch<{
    odometer: number;
    driveType: string;
    engineCapacity: string;
    colour: string;
    fuelType: string;
    variant: string;
    vin: string;
    model: string;
    transmissionType: string;
    make: string;
    releaseYear: number;
  }>[] = [];

  const prices: PositionMatch<number>[] = [];
  const locations: PositionMatch<{
    siteCode: string;
    localityName: string;
    regionName: string;
    stateShortName: string;
  }>[] = [];
  const displayTexts: PositionMatch<string>[] = [];
  const vehicleIds: PositionMatch<string>[] = [];

  let m: RegExpExecArray | null;

  while ((m = VEHICLE_SPEC_RE.exec(rscText)) !== null) {
    specs.push({
      pos: m.index,
      data: {
        odometer: parseInt(m[1], 10),
        driveType: m[2],
        engineCapacity: m[3],
        colour: m[4],
        fuelType: m[5],
        variant: m[6],
        vin: m[7],
        model: m[8],
        transmissionType: m[9],
        make: m[10],
        releaseYear: parseInt(m[11], 10),
      },
    });
  }

  while ((m = PRICE_RE.exec(rscText)) !== null) {
    prices.push({ pos: m.index, data: parseInt(m[1], 10) });
  }

  while ((m = LOCATION_RE.exec(rscText)) !== null) {
    locations.push({
      pos: m.index,
      data: {
        siteCode: m[1],
        localityName: m[2],
        regionName: m[3],
        stateShortName: m[4],
      },
    });
  }

  while ((m = DISPLAY_TEXT_RE.exec(rscText)) !== null) {
    displayTexts.push({ pos: m.index, data: m[1] });
  }

  while ((m = VEHICLE_ID_RE.exec(rscText)) !== null) {
    vehicleIds.push({ pos: m.index, data: m[1] });
  }

  // ── Position-based assembly ──
  // Each vehicle's data in the RSC stream follows this order:
  //   displayVehicleText → vehicleId → vehicleSpecifications → displayPrice → location
  // The spec block is the anchor (appears exactly once per vehicle in the main section).
  // We find the nearest price/location AFTER each spec, and nearest text/id BEFORE.

  const vehicles: ParsedVehicle[] = [];

  for (const spec of specs) {
    const price = findNextAfter(prices, spec.pos);
    const location = findNextAfter(locations, spec.pos);
    const displayText = findLastBefore(displayTexts, spec.pos);
    const vehicleId = findLastBefore(vehicleIds, spec.pos);

    if (price === undefined || !vehicleId) continue;

    vehicles.push({
      vehicleId,
      displayText: displayText || "",
      ...spec.data,
      displayPrice: price,
      localityName: location?.localityName || "",
      regionName: location?.regionName || "",
      stateShortName: location?.stateShortName || "",
      siteCode: location?.siteCode || "",
    });
  }

  return vehicles;
}

async function fetchRscPage(
  page: number
): Promise<{ vehicles: ParsedVehicle[]; ok: boolean }> {
  const url = `${BASE_URL}?page=${page}&limit=${PER_PAGE}`;
  try {
    const resp = await fetch(url, { headers: FETCH_HEADERS });
    if (!resp.ok) {
      console.warn(`[EA-DIRECT] Page ${page} HTTP ${resp.status}`);
      return { vehicles: [], ok: false };
    }
    const text = await resp.text();
    const vehicles = parseRscPage(text);
    return { vehicles, ok: true };
  } catch (err) {
    console.error(
      `[EA-DIRECT] Page ${page} fetch error:`,
      err instanceof Error ? err.message : String(err)
    );
    return { vehicles: [], ok: false };
  }
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

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  const metrics = {
    pages_fetched: 0,
    total_parsed: 0,
    new: 0,
    updated: 0,
    price_changed: 0,
    skipped: 0,
    with_km: 0,
    errors: [] as string[],
  };

  try {
    // Parse optional overrides
    const body = await req.json().catch(() => ({}));
    const maxPages = Math.min(body.maxPages || DEFAULT_MAX_PAGES, 150);
    const startPage = body.startPage || 1;

    console.log(
      `[EA-DIRECT] Starting: pages ${startPage}–${startPage + maxPages - 1}`
    );

    // ── Fetch all pages ──
    const allVehicles: ParsedVehicle[] = [];
    let consecutiveEmpty = 0;

    for (let page = startPage; page < startPage + maxPages; page++) {
      const { vehicles, ok } = await fetchRscPage(page);
      metrics.pages_fetched++;

      if (!ok || vehicles.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) {
          console.log(
            `[EA-DIRECT] 3 consecutive empty pages at ${page}, stopping`
          );
          break;
        }
        continue;
      }

      consecutiveEmpty = 0;
      allVehicles.push(...vehicles);

      // Small delay every 5 pages to be respectful
      if (page % 5 === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    metrics.total_parsed = allVehicles.length;
    console.log(
      `[EA-DIRECT] Parsed ${allVehicles.length} vehicles from ${metrics.pages_fetched} pages`
    );

    // ── Upsert vehicles ──
    for (const v of allVehicles) {
      try {
        // Validate required fields
        if (!v.make || !v.model || !v.releaseYear || v.releaseYear < 2000) {
          metrics.skipped++;
          continue;
        }
        if (
          !v.displayPrice ||
          v.displayPrice < 1000 ||
          v.displayPrice > 500000
        ) {
          metrics.skipped++;
          continue;
        }

        const make = v.make.toUpperCase().trim();
        const model = v.model.toUpperCase().trim();
        const variantRaw = v.variant
          ? v.variant.toUpperCase().trim()
          : null;
        const km = v.odometer > 0 ? v.odometer : null;
        if (km) metrics.with_km++;

        // Build listing URL
        const listingUrl = `https://www.easyauto123.com.au/buy/vehicle/${v.vehicleId}`;

        // Badge extraction
        const extracted = extractBadge(make, model, variantRaw || "");

        const sourceListingId = `ea-${v.vehicleId}`;

        const { data, error } = await supabase.rpc("upsert_retail_listing", {
          p_source: "easyauto123",
          p_source_listing_id: sourceListingId,
          p_listing_url: listingUrl,
          p_year: v.releaseYear,
          p_make: make,
          p_model: model,
          p_variant_raw: variantRaw,
          p_variant_family: extracted.badge || null,
          p_km: km,
          p_asking_price: v.displayPrice,
          p_state: v.stateShortName || null,
          p_suburb: v.localityName || null,
          p_run_id: null,
          p_price_type: "dap",
        });

        if (error) {
          if (metrics.errors.length < 10) {
            metrics.errors.push(
              `RPC ${sourceListingId}: ${error.message}`
            );
          }
          continue;
        }

        const result = data?.[0] || data;
        if (result?.is_new) metrics.new++;
        else metrics.updated++;
        if (result?.price_changed) metrics.price_changed++;

        // ── Update structured fields (KM, transmission, colour, etc.) ──
        if (result?.id) {
          const updateFields: Record<string, unknown> = {};

          // ALWAYS set KM — this is the whole point of this function
          if (km) updateFields.km = km;

          if (extracted.badge) updateFields.badge = extracted.badge;
          if (v.fuelType)
            updateFields.fuel_type = v.fuelType.toUpperCase();
          if (v.driveType)
            updateFields.drivetrain = v.driveType.toUpperCase();
          if (v.transmissionType)
            updateFields.transmission =
              v.transmissionType.toUpperCase();
          if (v.colour) updateFields.colour = v.colour;
          // Note: vin is not a column on retail_listings (stored elsewhere)
          // Note: engine_capacity is not a column on retail_listings
          // It's stored via the RPC/ingest function if needed
          updateFields.classified_at = new Date().toISOString();
          updateFields.variant_source = "easyauto_direct_v1";

          if (Object.keys(updateFields).length > 1) {
            await supabase
              .from("retail_listings")
              .update(updateFields)
              .eq("id", result.id);
          }
        }
      } catch (itemErr) {
        if (metrics.errors.length < 10) {
          metrics.errors.push(
            `Item: ${
              itemErr instanceof Error
                ? itemErr.message
                : String(itemErr)
            }`
          );
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // Heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "easyauto-direct-scrape",
        last_seen_at: new Date().toISOString(),
        last_ok: metrics.errors.length === 0,
        note: `pages=${metrics.pages_fetched} parsed=${metrics.total_parsed} new=${metrics.new} upd=${metrics.updated} km=${metrics.with_km} skip=${metrics.skipped} ms=${elapsed}`,
      },
      { onConflict: "cron_name" }
    );

    // Audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "easyauto-direct-scrape",
      success: metrics.errors.length === 0,
      result: { ...metrics, elapsed_ms: elapsed },
      error:
        metrics.errors.length > 0
          ? metrics.errors.join("; ")
          : null,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log(`[EA-DIRECT] Done in ${elapsed}ms:`, metrics);
    return respond(200, { ok: true, ...metrics, elapsed_ms: elapsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EA-DIRECT] Fatal error:", msg);

    try {
      await supabase.from("cron_heartbeat").upsert(
        {
          cron_name: "easyauto-direct-scrape",
          last_seen_at: new Date().toISOString(),
          last_ok: false,
          note: msg.substring(0, 200),
        },
        { onConflict: "cron_name" }
      );
    } catch (_) {
      /* best effort */
    }

    return respond(500, { ok: false, status: "error", error: msg });
  }
});
