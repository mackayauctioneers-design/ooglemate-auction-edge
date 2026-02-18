import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * CAROOGLE SHADOW CRON — Shadow-mode ingestion for Caroogle API validation
 * 
 * Writes ONLY to vehicle_listings_shadow.
 * Does NOT touch vehicle_listings, replication, opportunities, or Slack.
 * 
 * Purpose: 72-hour validation of Caroogle API as potential Firecrawl replacement.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CAROOGLE_API = "https://backend.caroogle.codesorbit.net/api/ads?limit=5000";

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
    console.log("[SHADOW] Fetching from Caroogle API...");
    const resp = await fetch(CAROOGLE_API);
    if (!resp.ok) {
      throw new Error(`Caroogle API returned ${resp.status}: ${await resp.text()}`);
    }

    const payload = await resp.json();
    const ads: any[] = Array.isArray(payload) ? payload : (payload.data || payload.ads || payload.results || []);
    console.log(`[SHADOW] Received ${ads.length} records from Caroogle`);

    if (ads.length === 0) {
      throw new Error("Caroogle API returned 0 records — possible schema change or downtime");
    }

    // ── Process and upsert ──
    let withPriceCount = 0;
    let zeroPriceCount = 0;
    let errors = 0;

    // ── Build all rows first ──
    const rows: any[] = [];
    for (const ad of ads) {
      const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
      if (!lotId) { errors++; continue; }

      const listingId = `caroogle:${lotId}`;
      const price = parsePrice(ad.price || ad.askingPrice || ad.asking_price);
      const km = parseKm(ad.odometer || ad.km || ad.kms || ad.mileage);

      if (price && price > 0) withPriceCount++;
      else zeroPriceCount++;

      rows.push({
        listing_id: listingId,
        lot_id: lotId,
        source: "auction",
        shadow_source: "caroogle",
        make: ad.make ? String(ad.make).toUpperCase() : null,
        model: ad.model ? String(ad.model).toUpperCase() : null,
        year: ad.year ? parseInt(String(ad.year)) : null,
        asking_price: price,
        km,
        location: ad.location || ad.suburb || null,
        state: ad.state || null,
        drivetrain: normalizeDrivetrain(ad.driveType || ad.drivetrain || ad.drive_type),
        auction_date: ad.auctionDate || ad.auction_date || null,
        status: ad.status || "listed",
        vin: ad.vin || null,
        first_seen_at: ad.scrapedAt || ad.scraped_at || new Date().toISOString(),
        last_seen_at: ad.updatedAt || ad.updated_at || ad.scrapedAt || ad.scraped_at || new Date().toISOString(),
        raw_payload: ad,
        updated_at: new Date().toISOString(),
      });
    }

    // ── Batch upsert in chunks of 200 ──
    const BATCH_SIZE = 200;
    let totalUpserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error, data } = await sb
        .from("vehicle_listings_shadow")
        .upsert(batch, { onConflict: "listing_id", ignoreDuplicates: false })
        .select("id");
      if (error) {
        errors += batch.length;
        console.error(`[SHADOW] Batch upsert error at offset ${i}: ${error.message}`);
      } else {
        totalUpserted += data?.length || batch.length;
      }
    }

    const newInserted = totalUpserted;
    const updated = 0; // upsert doesn't distinguish; total is what matters

    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_received: ads.length,
      new_inserted: newInserted,
      updated,
      with_price_count: withPriceCount,
      zero_price_count: zeroPriceCount,
      errors,
      runtime_ms: runtimeMs,
    };

    console.log("[SHADOW] Result:", JSON.stringify(result));

    // ── Audit log ──
    await sb.from("cron_audit_log").insert({
      cron_name: "caroogle-shadow-cron",
      run_date: new Date().toISOString().split("T")[0],
      success: errors < ads.length / 2,
      result,
    });

    await sb.from("cron_heartbeat").upsert({
      cron_name: "caroogle-shadow-cron",
      last_seen_at: new Date().toISOString(),
      last_ok: errors < ads.length / 2,
      note: `received=${ads.length} new=${newInserted} updated=${updated} price=${withPriceCount} noprice=${zeroPriceCount}`,
    }, { onConflict: "cron_name" });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[SHADOW] Fatal:", errorMsg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("cron_audit_log").insert({
        cron_name: "caroogle-shadow-cron",
        run_date: new Date().toISOString().split("T")[0],
        success: false,
        error: errorMsg,
        result: { runtime_ms: Date.now() - startTime },
      });
      await sb.from("cron_heartbeat").upsert({
        cron_name: "caroogle-shadow-cron",
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
