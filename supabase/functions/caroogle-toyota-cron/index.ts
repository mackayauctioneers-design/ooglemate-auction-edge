import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeVehicleIdentity } from "../_shared/taxonomy/normalizeVehicleIdentity.ts";
import { createTaxonomyDeps } from "../_shared/taxonomy/taxonomyRepo.ts";

/**
 * CAROOGLE → TOYOTA USED VEHICLES FEED
 * 
 * Fetches Toyota Used Vehicles inventory from Caroogle API
 * and upserts into vehicle_listings with source = "toyota".
 * 
 * Scheduled every 2 hours via config.toml.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CAROOGLE_API_BASE = "https://backend.caroogle.codesorbit.net/api/ads";
const PAGE_SIZE = 1000;
const CRON_NAME = "caroogle-toyota-ingest";
const SOURCE = "toyota";
const SOURCE_CLASS = "oem_used";
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

function parseYear(raw: unknown): number | null {
  if (raw == null) return null;
  const y = parseInt(String(raw));
  return y >= 1990 && y <= 2030 ? y : null;
}

// ─── BADGE EXTRACTION ────────────────────────────────────────────────────────

function extractBadge(text: string | null): string {
  if (!text) return "";
  const d = text.toUpperCase();
  const badges = [
    "EXCEED TOURER", "EXCEED", "X-TERRAIN", "XTERRAIN",
    "SR5", "ROGUE", "RUGGED X", "RUGGED-X", "RUGGED",
    "KAKADU", "SAHARA", "ASPIRE", "PLATINUM",
    "GXL", "VX", "GX", "XLS",
    "COMMUTER", "SLWB", "LWB",
    "WORKMATE", "ASCENT SPORT", "ASCENT", "MAXX SPORT", "MAXX",
    "AKARI", "GT-LINE", "TOURING",
    "EDGE", "ATMOS", "CRUSADE", "URBAN CRUISER",
  ];
  const shortBadges = ["SR", "XL", "LS", "ES", "SL", "ST", "SX", "XT", "RX", "ZR"];
  for (const b of badges) { if (d.includes(b)) return b; }
  for (const b of shortBadges) { if (new RegExp(`\\b${b}\\b`).test(d)) return b; }
  return "";
}

function extractVariantRaw(ad: Record<string, unknown>): string | null {
  // Toyota API provides explicit variant field
  if (ad.variant) {
    const badge = extractBadge(String(ad.variant));
    if (badge) return badge;
    return String(ad.variant).toUpperCase().trim();
  }
  // Fallback: try title
  const fromTitle = extractBadge(ad.title as string);
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
    const ads: Record<string, unknown>[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const pageUrl = `${CAROOGLE_API_BASE}?source=toyota&limit=${PAGE_SIZE}&page=${currentPage}`;
      console.log(`[${CRON_NAME}] Fetching page ${currentPage}/${totalPages}...`);
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(pageUrl, { signal: ac.signal });
      } catch (e) {
        clearTimeout(timeout);
        throw new Error(`Caroogle API fetch failed on page ${currentPage}: ${e instanceof Error ? e.message : String(e)}`);
      }
      clearTimeout(timeout);
      if (!resp.ok) {
        throw new Error(`Caroogle API returned ${resp.status} on page ${currentPage}: ${await resp.text()}`);
      }

      const payload = await resp.json();
      const pageAds: Record<string, unknown>[] = Array.isArray(payload)
        ? payload
        : (payload.data || payload.ads || payload.results || []);
      
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
      
      currentPage++;
    }

    console.log(`[${CRON_NAME}] Received ${ads.length} total Toyota records across ${currentPage} page(s)`);

    if (ads.length === 0) {
      throw new Error("Caroogle Toyota API returned 0 records — possible schema change or downtime");
    }

    // ── Build rows for vehicle_listings ──
    const taxonomyDeps = createTaxonomyDeps(sb);
    let withPriceCount = 0;
    let zeroPriceCount = 0;
    let skipped = 0;
    let normCount = 0;
    const rows: Record<string, unknown>[] = [];

    for (const ad of ads) {
      const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
      if (!lotId) { skipped++; continue; }

      const rawMake = ad.make ? String(ad.make).toUpperCase().trim() : null;
      if (!rawMake) { skipped++; continue; }

      // Toyota API uses vehicleModel
      let rawModel = (ad.vehicleModel || ad.vehicle_model || ad.model || "") as string;
      rawModel = rawModel ? rawModel.toUpperCase().trim() : "UNKNOWN";

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
          km: parseKm(ad.odometer || ad.km),
        });
        if (normResult.make) make = normResult.make.toUpperCase();
        if (normResult.model) model = normResult.model.toUpperCase();
        normCount++;
      } catch (_) { /* keep raw */ }

      const listingId = `toyota:${lotId}`;
      const price = parsePrice(ad.price);
      const km = parseKm(ad.odometer || ad.km);

      if (price && price > 0) withPriceCount++;
      else zeroPriceCount++;

      const variantRaw = extractVariantRaw(ad);
      const now = new Date().toISOString();

      rows.push({
        listing_id: listingId,
        lot_id: lotId,
        source: SOURCE,
        source_class: SOURCE_CLASS,
        make,
        model,
        year,
        km,
        asking_price: price,
        variant_raw: variantRaw,
        variant_family: variantRaw,
        drivetrain: normalizeDrivetrain(ad.driveType as string || ad.drivetrain as string),
        location: ad.location || ad.suburb || null,
        status: "listed",
        seller_type: "oem_dealer",
        listing_url: ad.listingUrl || ad.listing_url || ad.link || `https://www.toyota.com.au/used-vehicles`,
        first_seen_at: ad.scrapedAt || ad.scraped_at || now,
        last_seen_at: now,
        updated_at: now,
        last_ingested_at: now,
      });
    }

    console.log(`[${CRON_NAME}] Built ${rows.length} valid rows (skipped ${skipped}, normalized ${normCount})`);

    // ── Batch upsert into vehicle_listings ──
    let totalUpserted = 0;
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
        totalUpserted += data?.length || batch.length;
      }
    }

    // ── Stale sweep: mark Toyota listings NOT in this feed as sold ──
    const currentListingIds = rows.map(r => r.listing_id as string);
    let staleSweepCount = 0;

    if (currentListingIds.length > 100) {
      // Find toyota listings that are still "listed" but weren't in this feed
      const { data: staleListings, error: staleErr } = await sb
        .from("vehicle_listings")
        .select("id, listing_id")
        .eq("source", SOURCE)
        .eq("status", "listed")
        .not("listing_id", "in", `(${currentListingIds.join(",")})`)
        .limit(5000);

      if (staleErr) {
        console.error(`[${CRON_NAME}] Stale sweep query error: ${staleErr.message}`);
      } else if (staleListings && staleListings.length > 0) {
        const staleIds = staleListings.map(s => s.id);
        // Batch update in groups of 500
        for (let j = 0; j < staleIds.length; j += 500) {
          const batch = staleIds.slice(j, j + 500);
          const { error: updateErr } = await sb
            .from("vehicle_listings")
            .update({ status: "sold", updated_at: new Date().toISOString() })
            .in("id", batch);
          if (updateErr) {
            console.error(`[${CRON_NAME}] Stale sweep update error: ${updateErr.message}`);
          } else {
            staleSweepCount += batch.length;
          }
        }
        console.log(`[${CRON_NAME}] Stale sweep: marked ${staleSweepCount} Toyota listings as sold`);
      }
    }

    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_received: ads.length,
      valid_rows: rows.length,
      skipped,
      upserted: totalUpserted,
      total_new: totalUpserted,
      total_updated: 0,
      with_price: withPriceCount,
      zero_price: zeroPriceCount,
      stale_swept: staleSweepCount,
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
      note: `received=${ads.length} valid=${rows.length} upserted=${totalUpserted} price=${withPriceCount} noprice=${zeroPriceCount} errors=${errors}`,
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
