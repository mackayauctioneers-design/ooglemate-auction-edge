import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBadge } from "../_shared/taxonomy/extractBadge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * easyauto-ingest — Push-based ingest endpoint for EasyAuto123 Apify actor
 *
 * Receives POST { items: [...] } from the easyauto-harvest actor.
 * Maps to retail_listings via upsert_retail_listing RPC.
 *
 * Auth: Bearer EASYAUTO_INGEST_KEY
 */

interface EasyAutoItem {
  vehicleId?: string;
  id?: string;
  stockNumber?: string;
  url?: string;
  link?: string;
  detailUrl?: string;
  title?: string;
  name?: string;
  year?: number | string;
  make?: string;
  brand?: string;
  model?: string;
  variant?: string;
  badge?: string;
  trim?: string;
  price?: number | string | Record<string, unknown>;
  askingPrice?: number | string;
  asking_price?: number | string;
  dap?: number | string;
  egc?: number | string;
  odometer?: number | string;
  km?: number | string;
  mileage?: number | string;
  kilometres?: number | string;
  location?: string;
  suburb?: string;
  dealership?: string;
  state?: string;
  transmission?: string;
  fuel?: string;
  fuelType?: string;
  fuel_type?: string;
  fuelConsumption?: string;
  fuel_consumption?: string;
  bodyType?: string;
  body_type?: string;
  colour?: string;
  color?: string;
  driveType?: string;
  drive_type?: string;
  engineCapacity?: string;
  engine_capacity?: string;
  vin?: string;
  image?: string;
  imageUrl?: string;
  image_url?: string;
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
    received: 0,
    mapped: 0,
    new: 0,
    updated: 0,
    price_changed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    // Auth check
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const expectedKey = Deno.env.get("EASYAUTO_INGEST_KEY");
    if (!expectedKey || token !== expectedKey) {
      return respond(401, { error: "Unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const items: EasyAutoItem[] = body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return respond(400, { error: "No items provided" });
    }

    metrics.received = items.length;
    console.log(`[EASYAUTO-INGEST] Received ${items.length} items`);

    for (const item of items) {
      try {
        // ── Extract listing ID ──
        const url = String(item.detail_url || item.url || item.link || item.detailUrl || "");
        const rawId = String(item.vehicle_id || item.vehicleId || item.id || item.stockNumber || "");
        const idMatch = url.match(/\/([a-zA-Z0-9-]{6,})\/?(\?|$)/);
        const listingId = rawId || idMatch?.[1] || "";
        if (!listingId) { metrics.skipped++; continue; }

        // ── Year ──
        let year = 0;
        if (typeof item.year === "number") year = item.year;
        else if (typeof item.year === "string") year = parseInt(item.year, 10) || 0;
        if (!year) {
          const title = String(item.title || item.name || "");
          const ym = title.match(/\b(20[0-2]\d)\b/);
          if (ym) year = parseInt(ym[1], 10);
        }
        if (!year || year < 2000) { metrics.skipped++; continue; }

        // ── Make / Model ──
        const make = String(item.make || item.brand || "").toUpperCase().trim();
        const model = String(item.model || "").toUpperCase().trim();
        if (!make || !model) { metrics.skipped++; continue; }

        // ── Variant ──
        const variantRaw = String(item.variant || item.badge || item.trim || "").toUpperCase().trim() || null;

        // ── Price — prefer DAP/EGC from the new actor ──
        let price = 0;
        const rawPrice = item.display_price || item.dap || item.egc || item.price || item.askingPrice || item.asking_price;
        if (typeof rawPrice === "number") price = rawPrice;
        else if (typeof rawPrice === "string") {
          const cleaned = rawPrice.replace(/[^0-9]/g, "");
          if (cleaned) price = parseInt(cleaned, 10);
        } else if (rawPrice && typeof rawPrice === "object") {
          const p = rawPrice as Record<string, unknown>;
          price = Number(p.value || p.amount || p.driveaway || 0);
        }
        if (!price || price < 1000 || price > 500000) { metrics.skipped++; continue; }

        // ── KM ──
        let km: number | null = null;
        const rawKm = item.odometer || item.km || item.mileage || item.kilometres;
        if (typeof rawKm === "number") km = rawKm;
        else if (typeof rawKm === "string") {
          const parsed = parseInt(String(rawKm).replace(/[^0-9]/g, ""), 10);
          if (parsed > 0) km = parsed;
        }

        // ── Location ──
        const location = String(item.location || item.suburb || item.dealership || "").trim();
        let state = String(item.state || "").toUpperCase().trim();
        if (!state) {
          const stateMatch = location.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/i);
          if (stateMatch) state = stateMatch[1].toUpperCase();
        }

        // ── URL ──
        const fullUrl = url.startsWith("http") ? url
          : url ? `https://www.easyauto123.com.au${url.startsWith("/") ? "" : "/"}${url}` : "";
        if (!fullUrl) { metrics.skipped++; continue; }

        // ── Badge extraction ──
        const extracted = extractBadge(make, model, variantRaw || "");

        // ── Upsert via RPC ──
        const sourceListingId = `ea-${listingId}`;
        const { data, error } = await supabase.rpc("upsert_retail_listing", {
          p_source: "easyauto123",
          p_source_listing_id: sourceListingId,
          p_listing_url: fullUrl,
          p_year: year,
          p_make: make,
          p_model: model,
          p_variant_raw: variantRaw,
          p_variant_family: extracted.badge || null,
          p_km: km,
          p_asking_price: price,
          p_state: state || null,
          p_suburb: location || null,
          p_run_id: null,
          p_price_type: "dap",
        });

        if (error) {
          if (metrics.errors.length < 5) metrics.errors.push(`RPC: ${error.message}`);
          continue;
        }

        metrics.mapped++;
        const result = data?.[0] || data;
        if (result?.is_new) metrics.new++;
        else metrics.updated++;
        if (result?.price_changed) metrics.price_changed++;

        // ── Update structured fields ──
        if (result?.id) {
          const updateFields: Record<string, unknown> = {};
          if (extracted.badge) updateFields.badge = extracted.badge;
          if (extracted.fuel_type || item.fuel || item.fuelType || item.fuel_type) {
            updateFields.fuel_type = extracted.fuel_type || String(item.fuel || item.fuelType || item.fuel_type || "").toUpperCase();
          }
          if (extracted.drivetrain || item.driveType || item.drive_type) {
            updateFields.drivetrain = extracted.drivetrain || String(item.driveType || item.drive_type || "").toUpperCase();
          }
          if (extracted.body_type || item.bodyType || item.body_type) {
            updateFields.body_type = extracted.body_type || String(item.bodyType || item.body_type || "").toUpperCase();
          }
          if (item.transmission) updateFields.transmission = String(item.transmission).toUpperCase();
          if (item.colour || item.color) updateFields.colour = String(item.colour || item.color || "");
          if (item.vin) updateFields.vin = String(item.vin);
          if (item.fuelConsumption || item.fuel_consumption) {
            updateFields.fuel_consumption = String(item.fuelConsumption || item.fuel_consumption);
          }
          if (item.engineCapacity || item.engine_capacity) {
            updateFields.engine_capacity = String(item.engineCapacity || item.engine_capacity);
          }
          if (item.image || item.imageUrl || item.image_url) {
            updateFields.image_url = String(item.image || item.imageUrl || item.image_url);
          }
          updateFields.classified_at = new Date().toISOString();
          updateFields.variant_source = "easyauto_ingest_v1";

          if (Object.keys(updateFields).length > 2) {
            await supabase.from("retail_listings").update(updateFields).eq("id", result.id);
          }
        }
      } catch (itemErr) {
        if (metrics.errors.length < 5) {
          metrics.errors.push(`Item: ${itemErr instanceof Error ? itemErr.message : String(itemErr)}`);
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // Heartbeat
    await supabase.from("cron_heartbeat").upsert({
      cron_name: "easyauto-ingest",
      last_seen_at: new Date().toISOString(),
      last_ok: metrics.errors.length === 0,
      note: `recv=${metrics.received} new=${metrics.new} upd=${metrics.updated} skip=${metrics.skipped} ms=${elapsed}`,
    }, { onConflict: "cron_name" });

    // Audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "easyauto-ingest",
      success: metrics.errors.length === 0,
      result: { ...metrics, elapsed_ms: elapsed },
      error: metrics.errors.length > 0 ? metrics.errors.join("; ") : null,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log(`[EASYAUTO-INGEST] Done in ${elapsed}ms:`, metrics);
    return respond(200, { ok: true, ...metrics, elapsed_ms: elapsed });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EASYAUTO-INGEST] Fatal error:", msg);

    await supabase.from("cron_heartbeat").upsert({
      cron_name: "easyauto-ingest",
      last_seen_at: new Date().toISOString(),
      last_ok: false,
      note: msg.substring(0, 200),
    }, { onConflict: "cron_name" });

    return respond(500, { ok: false, error: msg });
  }
});
