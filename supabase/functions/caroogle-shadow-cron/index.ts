import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeVehicleIdentity } from "../_shared/taxonomy/normalizeVehicleIdentity.ts";
import { createTaxonomyDeps } from "../_shared/taxonomy/taxonomyRepo.ts";
import { extractBadge } from "../_shared/taxonomy/derivePlatform.ts";

/**
 * CAROOGLE → PICKLES PRODUCTION FEED
 * 
 * Fetches auction inventory from Caroogle API (which aggregates Pickles listings)
 * and upserts directly into vehicle_listings with source = "pickles".
 * 
 * Replaces the broken Firecrawl-based pickles-ingest-cron.
 * Scheduled every 2 hours via config.toml.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CAROOGLE_API_BASE = "https://backend.caroogle.codesorbit.net/api/ads";
const PAGE_SIZE = 1000;
const CRON_NAME = "caroogle-pickles-ingest";
const SOURCE = "pickles";
const SOURCE_CLASS = "auction";
const AUCTION_HOUSE = "pickles";
const BATCH_SIZE = 200;

// ─── NORMALIZERS ─────────────────────────────────────────────────────────────

function normalizeDrivetrain(raw: string | null | undefined): string {
  if (!raw) return "UNKNOWN";
  const d = raw.toUpperCase().trim();
  if (/4WD|4X4/.test(d)) return "4WD";
  if (/AWD|ALL.?WHEEL/.test(d)) return "AWD";
  if (/FWD|FRONT.?WHEEL/.test(d)) return "FWD";
  if (/RWD|REAR.?WHEEL/.test(d)) return "RWD";
  return "UNKNOWN";
}

function parseKm(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, "");
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const val = parseInt(m[1]);
  return val > 0 && val < 999999 ? val : null;
}

function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const val = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[,$\s]/g, ""));
  return !isNaN(val) && val > 0 ? Math.round(val) : null;
}

function parseYear(raw: any): number | null {
  if (raw == null) return null;
  const y = parseInt(String(raw));
  return y >= 1990 && y <= 2030 ? y : null;
}

// Extract raw model text from Caroogle API response
// NOTE: This is NOT identity resolution — it's a simple field extractor for the API format.
// The actual canonical model is resolved downstream by normalizeVehicleIdentity().
function extractRawModelFromApi(ad: any): string {
  const rawMake = ad.make ? String(ad.make).toUpperCase().trim() : null;
  let rawModel: string | null = ad.model ? String(ad.model).toUpperCase().trim() : null;
  
  // Model is often NULL in API — parse from title by stripping make prefix
  if (!rawModel && ad.title && rawMake) {
    const titleUpper = String(ad.title).toUpperCase().trim();
    if (titleUpper.startsWith(rawMake)) {
      rawModel = titleUpper.slice(rawMake.length).trim() || null;
    }
  }
  
  return rawModel || "UNKNOWN";
}

// extractBadge imported from _shared/taxonomy/derivePlatform.ts
// No inline copies allowed. See memory/architecture/identity/governance-rule-v1

/**
 * Extract the model/variant portion from Pickles sellerNotes.
 * Format: "CP: date,Built: date,Make,Model,SeriesCode Badge,BodyType,..."
 * We want fields [3] and [4] which contain model code + badge.
 */
function extractBadgeFromSellerNotes(notes: string | null): string {
  if (!notes) return "";
  const parts = notes.split(",");
  // Fields 3-4 typically contain: "Ranger", "PX MkIII MY21.75 XL"
  // or "Hilux", "GUN126R SR5"
  const modelFields = parts.slice(3, 6).join(" ");
  return extractBadge(modelFields);
}

/**
 * Build a variant_raw string from all available badge sources in the Caroogle API record.
 * Priority: sellerNotes model fields (most accurate) > grade/variant > title
 */
function extractVariantRaw(ad: any): string | null {
  // 1. Try sellerNotes first — most reliable, extract only model/variant portion
  const fromNotes = extractBadgeFromSellerNotes(ad.sellerNotes || ad.seller_notes);
  if (fromNotes) return fromNotes;

  // 2. Try explicit badge/variant/grade fields
  const explicitSources = [
    ad.badgeDescription,
    ad.badge_description,
    ad.grade,
    ad.variant,
  ].filter(Boolean).join(" ");
  const fromExplicit = extractBadge(explicitSources);
  if (fromExplicit) return fromExplicit;

  // 3. Fallback: try title + vehicleModel
  const titleSources = [ad.title, ad.vehicleModel, ad.vehicle_model].filter(Boolean).join(" ");
  const fromTitle = extractBadge(titleSources);
  return fromTitle || null;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Fetch from Caroogle API (paginated) ──
    console.log(`[${CRON_NAME}] Fetching from Caroogle API (paginated, pageSize=${PAGE_SIZE})...`);
    const ads: any[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages && currentPage <= 10) {
      const pageUrl = `${CAROOGLE_API_BASE}?source=pickles&limit=${PAGE_SIZE}&page=${currentPage}`;
      console.log(`[${CRON_NAME}] Fetching page ${currentPage}/${totalPages}...`);
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(pageUrl, { signal: ac.signal });
      } catch (e) {
        clearTimeout(timeout);
        console.error(`[${CRON_NAME}] Fetch failed on page ${currentPage}: ${e instanceof Error ? e.message : String(e)}`);
        // Process whatever we've collected so far instead of crashing
        break;
      }
      clearTimeout(timeout);

      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        console.error(`[${CRON_NAME}] API returned ${resp.status} on page ${currentPage}: ${bodyText.slice(0, 200)}`);
        // 500 errors on later pages = stop paginating, process what we have
        if (resp.status >= 500) {
          console.log(`[${CRON_NAME}] Server error on page ${currentPage} — stopping pagination, processing ${ads.length} records collected so far`);
          break;
        }
        // 4xx = likely bad request, also stop
        break;
      }

      const payload = await resp.json();
      const pageAds: any[] = Array.isArray(payload) ? payload : (payload.data || payload.ads || payload.results || []);
      
      // Read total_pages from response if provided
      if (payload.total_pages && typeof payload.total_pages === "number") {
        totalPages = payload.total_pages;
      } else if (payload.totalPages && typeof payload.totalPages === "number") {
        totalPages = payload.totalPages;
      }

      ads.push(...pageAds);
      console.log(`[${CRON_NAME}] Page ${currentPage}: got ${pageAds.length} records (total so far: ${ads.length})`);

      // If API doesn't support pagination yet, we got everything in one shot
      if (pageAds.length < PAGE_SIZE && currentPage === 1 && totalPages === 1) break;
      
      // If page returned 0 results, we've exhausted the data
      if (pageAds.length === 0) {
        console.log(`[${CRON_NAME}] Empty page ${currentPage} — pagination complete`);
        break;
      }

      currentPage++;
    }

    console.log(`[${CRON_NAME}] Received ${ads.length} total records from API across ${currentPage} page(s)`);

    if (ads.length === 0) {
      throw new Error("Caroogle API returned 0 records across all pages — possible schema change or downtime");
    }

    // ── Build rows for vehicle_listings ──
    const taxonomyDeps = createTaxonomyDeps(sb);
    let withPriceCount = 0;
    let zeroPriceCount = 0;
    let skipped = 0;
    let normCount = 0;
    const rows: any[] = [];

    for (const ad of ads) {
      const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
      if (!lotId) { skipped++; continue; }

      const rawMake = ad.make ? String(ad.make).toUpperCase().trim() : null;
      if (!rawMake) { skipped++; continue; }

      const rawModel = extractRawModelFromApi(ad);
      const year = parseYear(ad.year);
      if (!year) { skipped++; continue; }

      // ── Canonical normalization ──
      const title = ad.title ? String(ad.title) : `${year} ${rawMake} ${rawModel}`;
      let make = rawMake;
      let model = rawModel;
      try {
        const normResult = await normalizeVehicleIdentity(taxonomyDeps, {
          source: SOURCE,
          title,
          makeRaw: rawMake,
          modelRaw: rawModel,
          year,
          km: parseKm(ad.odometer || ad.km || ad.kms || ad.mileage),
        });
        if (normResult.make) make = normResult.make.toUpperCase();
        if (normResult.model) model = normResult.model.toUpperCase();
        normCount++;
      } catch (_) { /* keep raw */ }

      const listingId = `pickles:${lotId}`;
      const price = parsePrice(ad.price || ad.askingPrice || ad.asking_price);
      const km = parseKm(ad.odometer || ad.km || ad.kms || ad.mileage);

      if (price && price > 0) withPriceCount++;
      else zeroPriceCount++;

      // ── Extract badge/variant from all available text fields ──
      const variantRaw = extractVariantRaw(ad);

      const now = new Date().toISOString();

      rows.push({
        listing_id: listingId,
        lot_id: lotId,
        source: SOURCE,
        source_class: SOURCE_CLASS,
        auction_house: AUCTION_HOUSE,
        make,
        model,
        year,
        km,
        asking_price: price,
        variant_raw: variantRaw,
        variant_family: variantRaw,  // badge IS the family for auction
        drivetrain: normalizeDrivetrain(ad.driveType || ad.drivetrain || ad.drive_type),
        location: ad.location || ad.suburb || null,
        status: ad.status || "listed",
        seller_type: "auction",
        listing_url: (() => { const rawUrl = ad.url || ad.listing_url || ad.link || null; if (rawUrl && !/\/used\/search\?/i.test(rawUrl)) return rawUrl; return lotId ? `https://www.pickles.com.au/used/details/cars/${lotId}` : "https://www.pickles.com.au/used"; })(),
        first_seen_at: ad.scrapedAt || ad.scraped_at || now,
        last_seen_at: now,
        updated_at: now,
        last_ingested_at: now,
      });
    }

    console.log(`[${CRON_NAME}] Built ${rows.length} valid rows (skipped ${skipped}, normalized ${normCount})`);

    // ── Batch upsert into vehicle_listings ──
    let totalNew = 0;
    let totalUpdated = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error, data } = await sb
        .from("vehicle_listings")
        .upsert(batch, { onConflict: "listing_id", ignoreDuplicates: false })
        .select("id");
      
      if (error) {
        errors += batch.length;
        console.error(`[${CRON_NAME}] Batch upsert error at offset ${i}: ${error.message}`);
      } else {
        const count = data?.length || batch.length;
        totalNew += count; // upsert doesn't distinguish new vs updated
      }
    }

    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_received: ads.length,
      valid_rows: rows.length,
      skipped,
      upserted: totalNew,
      with_price: withPriceCount,
      zero_price: zeroPriceCount,
      errors,
      runtime_ms: runtimeMs,
    };

    console.log(`[${CRON_NAME}] Result:`, JSON.stringify(result));

    // ── Health logging ──
    const isSuccess = errors < rows.length / 2 && rows.length > 0;

    await sb.from("cron_audit_log").insert({
      cron_name: CRON_NAME,
      run_date: new Date().toISOString().split("T")[0],
      success: isSuccess,
      result,
    });

    await sb.from("cron_heartbeat").upsert({
      cron_name: CRON_NAME,
      last_seen_at: new Date().toISOString(),
      last_ok: isSuccess,
      note: `received=${ads.length} valid=${rows.length} upserted=${totalNew} price=${withPriceCount} noprice=${zeroPriceCount} errors=${errors}`,
    }, { onConflict: "cron_name" });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${CRON_NAME}] Fatal:`, errorMsg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("cron_audit_log").insert({
        cron_name: CRON_NAME,
        run_date: new Date().toISOString().split("T")[0],
        success: false,
        error: errorMsg,
        result: { runtime_ms: Date.now() - startTime },
      });
      await sb.from("cron_heartbeat").upsert({
        cron_name: CRON_NAME,
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `FATAL: ${errorMsg.slice(0, 100)}`,
      }, { onConflict: "cron_name" });
    } catch (_) {}

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
