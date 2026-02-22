import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const CAROOGLE_API = "https://backend.caroogle.codesorbit.net/api/ads?limit=5000";
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
  return !isNaN(val) && val > 0 ? val : null;
}

function parseYear(raw: any): number | null {
  if (raw == null) return null;
  const y = parseInt(String(raw));
  return y >= 1990 && y <= 2030 ? y : null;
}

function extractModel(ad: any): string {
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

    // ── Fetch from Caroogle API ──
    console.log(`[${CRON_NAME}] Fetching from Caroogle API...`);
    const resp = await fetch(CAROOGLE_API);
    if (!resp.ok) {
      throw new Error(`Caroogle API returned ${resp.status}: ${await resp.text()}`);
    }

    const payload = await resp.json();
    const ads: any[] = Array.isArray(payload) ? payload : (payload.data || payload.ads || payload.results || []);
    console.log(`[${CRON_NAME}] Received ${ads.length} records from API`);

    if (ads.length === 0) {
      throw new Error("Caroogle API returned 0 records — possible schema change or downtime");
    }

    // ── Build rows for vehicle_listings ──
    let withPriceCount = 0;
    let zeroPriceCount = 0;
    let skipped = 0;
    const rows: any[] = [];

    for (const ad of ads) {
      const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
      if (!lotId) { skipped++; continue; }

      const make = ad.make ? String(ad.make).toUpperCase().trim() : null;
      if (!make) { skipped++; continue; }

      const model = extractModel(ad);
      const year = parseYear(ad.year);
      if (!year) { skipped++; continue; }

      const listingId = `pickles:${lotId}`;
      const price = parsePrice(ad.price || ad.askingPrice || ad.asking_price);
      const km = parseKm(ad.odometer || ad.km || ad.kms || ad.mileage);

      if (price && price > 0) withPriceCount++;
      else zeroPriceCount++;

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
        drivetrain: normalizeDrivetrain(ad.driveType || ad.drivetrain || ad.drive_type),
        location: ad.location || ad.suburb || null,
        status: ad.status || "listed",
        seller_type: "auction",
        listing_url: `https://www.pickles.com.au/cars/item/-/details/${lotId}`,
        first_seen_at: ad.scrapedAt || ad.scraped_at || now,
        last_seen_at: now,
        updated_at: now,
        last_ingested_at: now,
      });
    }

    console.log(`[${CRON_NAME}] Built ${rows.length} valid rows (skipped ${skipped})`);

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
