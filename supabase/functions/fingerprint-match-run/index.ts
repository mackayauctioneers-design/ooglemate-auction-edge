import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * fingerprint-match-run v1.5
 *
 * Loads normalized listings, joins to sales_fingerprints_v1,
 * scores each match (including identity alignment), and upserts
 * into matched_opportunities_v1.
 *
 * Scoring (0-100):
 *   +40  make+model match (required baseline)
 *   +25  km inside IQR (p25–p75)
 *   +10  km near band (±20k outside IQR)
 *   +15  asking price ≤ price_median
 *   +5   asking price within 10% above median
 *   +10  transmission matches dominant
 *   +10  body_type matches dominant
 *   +10  fuel_type matches dominant
 *   +10  drive_type matches dominant
 *   +10  extraction confidence high/medium
 *
 * Only creates opportunities with score ≥ 60.
 */

interface Fingerprint {
  account_id: string;
  make: string;
  model: string;
  sales_count: number;
  km_median: number | null;
  km_p25: number | null;
  km_p75: number | null;
  price_median: number | null;
  last_sold_at: string | null;
  dominant_transmission: string | null;
  dominant_body_type: string | null;
  dominant_fuel_type: string | null;
  dominant_drive_type: string | null;
  transmission_count: number;
  body_type_count: number;
  fuel_type_count: number;
  drive_type_count: number;
}

interface NormListing {
  id: string;
  account_id: string;
  raw_id: string | null;
  url_canonical: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  extraction_confidence: string | null;
  transmission: string | null;
  body_type: string | null;
  fuel_type: string | null;
  domain: string | null;
  variant: string | null;
}

// ── Badge/Variant helpers ──
function normalizeVariant(v: string | null | undefined): string {
  if (!v) return "";
  return v.toUpperCase()
    .replace(/\b(4X[24]|AWD|2WD|RWD|4WD|AUTO|MANUAL|CVT|DCT|DSG)\b/g, "")
    .replace(/\b\d+\.\d+[A-Z]*\b/g, "")
    .replace(/\b(DIESEL|PETROL|TURBO|HYBRID)\b/g, "")
    .replace(/\b(DUAL\s*CAB|SINGLE\s*CAB|DOUBLE\s*CAB|CREW\s*CAB|CAB\s*CHASSIS|UTE|WAGON|SEDAN|HATCH)\b/g, "")
    .replace(/\b(MY\d{2,4})\b/g, "")
    .replace(/\b[A-Z]{2}\d{2,4}[A-Z]{0,3}\b/g, "")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVariantMatch(listingVariant: string | null, fpVariant: string | null): { score: number; label: string; reason: string } {
  const lv = normalizeVariant(listingVariant);
  const fv = normalizeVariant(fpVariant);
  if (!lv && !fv) return { score: 5, label: "no_badge_data", reason: "No badge data on either side (+5)" };
  if (!fv) return { score: 5, label: "no_fp_badge", reason: "No fingerprint badge to compare (+5)" };
  if (!lv) return { score: 0, label: "missing_listing_badge", reason: `Listing missing badge, fingerprint has "${fv}" (+0)` };
  if (lv === fv) return { score: 15, label: "exact_badge", reason: `Badge "${lv}" exact match (+15)` };
  if (lv.includes(fv) || fv.includes(lv)) return { score: 10, label: "close_badge", reason: `Badge "${lv}" close to "${fv}" (+10)` };
  return { score: -20, label: "badge_mismatch", reason: `Badge "${lv}" ≠ "${fv}" (-20 penalty)` };
}

// ── KM extraction helper ──
function extractKmFromText(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometers|odometer|ODO|km's)/i);
  if (!m) return null;
  const val = parseInt(m[1].replace(/,/g, ""), 10);
  return val > 0 && val < 1000000 ? val : null;
}

function scoreKm(
  km: number | null,
  p25: number | null,
  p75: number | null
): { score: number; band: string; reason: string } {
  if (km == null || p25 == null || p75 == null) {
    return { score: 0, band: "unknown", reason: "km data missing (+0)" };
  }
  const lo = Number(p25);
  const hi = Number(p75);
  if (km >= lo && km <= hi) {
    return {
      score: 25,
      band: "inside",
      reason: `km ${km.toLocaleString()} inside proven range [${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()}] (+25)`,
    };
  }
  if (km >= lo - 20000 && km <= hi + 20000) {
    return {
      score: 10,
      band: "near",
      reason: `km ${km.toLocaleString()} near proven range ±20k (+10)`,
    };
  }
  return {
    score: 0,
    band: "outside",
    reason: `km ${km.toLocaleString()} outside proven range [${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()}] (+0)`,
  };
}

function scorePrice(
  price: number | null,
  median: number | null
): { score: number; band: string; reason: string } {
  if (price == null || median == null) {
    return { score: 0, band: "unknown", reason: "price data missing (+0)" };
  }
  const med = Number(median);
  if (price <= med) {
    return {
      score: 15,
      band: "below",
      reason: `$${price.toLocaleString()} ≤ median $${Math.round(med).toLocaleString()} (+15)`,
    };
  }
  if (price <= med * 1.1) {
    return {
      score: 5,
      band: "near",
      reason: `$${price.toLocaleString()} near median $${Math.round(med).toLocaleString()} (+5)`,
    };
  }
  return {
    score: 0,
    band: "above",
    reason: `$${price.toLocaleString()} above median $${Math.round(med).toLocaleString()} (+0)`,
  };
}

function scoreIdentity(
  listingVal: string | null,
  fpDominant: string | null,
  fpCount: number,
  label: string
): { score: number; reason: string } {
  if (!listingVal || !fpDominant || fpCount === 0) {
    return { score: 0, reason: `${label} data insufficient (+0)` };
  }
  if (listingVal.toLowerCase().trim() === fpDominant.toLowerCase().trim()) {
    return {
      score: 10,
      reason: `${label} "${listingVal}" matches sales history (+10)`,
    };
  }
  return {
    score: 0,
    reason: `${label} "${listingVal}" differs from dominant "${fpDominant}" (+0)`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body.account_id;
    const batchSize: number = body.batch_size ?? 200;
    const refreshFingerprints: boolean = body.refresh_fingerprints ?? true;

    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[fingerprint-match-run] v1.5 starting for account=${accountId}, batch=${batchSize}`
    );
    const startTime = Date.now();

    // ── Step 1: Check dirty flag and refresh fingerprints ──
    const { data: dirtyFlag } = await supabase
      .from("fingerprint_refresh_pending")
      .select("dirty_since, refreshed_at")
      .eq("account_id", accountId)
      .maybeSingle();

    const needsRefresh =
      refreshFingerprints ||
      (dirtyFlag &&
        (!dirtyFlag.refreshed_at ||
          new Date(dirtyFlag.dirty_since) > new Date(dirtyFlag.refreshed_at)));

    if (needsRefresh) {
      console.log("[fingerprint-match-run] Refreshing fingerprints...");
      const { error: refreshErr } = await supabase.rpc(
        "refresh_sales_fingerprints"
      );
      if (refreshErr) {
        console.warn("[fingerprint-match-run] Refresh warning:", refreshErr.message);
      } else {
        await supabase
          .from("fingerprint_refresh_pending")
          .upsert(
            {
              account_id: accountId,
              dirty_since: dirtyFlag?.dirty_since || new Date().toISOString(),
              refreshed_at: new Date().toISOString(),
            },
            { onConflict: "account_id" }
          );
        console.log("[fingerprint-match-run] Dirty flag cleared.");
      }
    }

    // ── Step 2: Load fingerprints ──
    const { data: fingerprints, error: fpErr } = await supabase
      .from("sales_fingerprints_v1")
      .select("*")
      .eq("account_id", accountId);

    if (fpErr) {
      console.error("[fingerprint-match-run] Fingerprint load error:", fpErr);
      return new Response(JSON.stringify({ error: fpErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!fingerprints || fingerprints.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          fingerprints_loaded: 0,
          listings_checked: 0,
          matched: 0,
          skipped: 0,
          message: "No fingerprints found. Log sales into vehicle_sales_truth first.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[fingerprint-match-run] ${fingerprints.length} fingerprints loaded`);

    // Build lookup map
    const fpMap = new Map<string, Fingerprint>();
    for (const fp of fingerprints as Fingerprint[]) {
      const key = `${(fp.make || "").toUpperCase()}|${(fp.model || "").toUpperCase()}`;
      fpMap.set(key, fp);
    }

    // ── Step 3: Load normalized listings ──
    const { data: listings, error: listErr } = await supabase
      .from("listing_details_norm")
      .select(
        "id, account_id, raw_id, url_canonical, make, model, year, km, price, extraction_confidence, transmission, body_type, fuel_type, domain, variant"
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(batchSize);

    if (listErr) {
      console.error("[fingerprint-match-run] Listing load error:", listErr);
      return new Response(JSON.stringify({ error: listErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          fingerprints_loaded: fingerprints.length,
          listings_checked: 0,
          matched: 0,
          skipped: 0,
          message: "No normalized listings to match against.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[fingerprint-match-run] Scoring ${listings.length} listings against ${fingerprints.length} fingerprints`
    );

    // ── Step 4: Score each listing ──
    const opportunities: Array<Record<string, unknown>> = [];
    let skipped = 0;

    for (const listing of listings as NormListing[]) {
      const listingMake = (listing.make || "").toUpperCase().trim();
      const listingModel = (listing.model || "").toUpperCase().trim();

      if (!listingMake || !listingModel) {
        skipped++;
        continue;
      }

      const key = `${listingMake}|${listingModel}`;
      const fp = fpMap.get(key);

      if (!fp) {
        skipped++;
        continue;
      }

      // ── Scoring ──
      let score = 40; // Base: make+model match
      const reasons: Record<string, string> = {
        make_model: `${listingMake} ${listingModel} matches sales history (+40)`,
      };

      // Badge/Variant scoring (NEW in v1.6)
      const variantResult = scoreVariantMatch(listing.variant, null); // TODO: fp needs dominant_variant
      score += variantResult.score;
      reasons.variant = variantResult.reason;
      console.log(`[VARIANT MATCH] ${listingMake} ${listingModel} variant="${listing.variant || ""}" → ${variantResult.label} (${variantResult.score > 0 ? "+" : ""}${variantResult.score})`);

      // KM scoring
      const kmResult = scoreKm(listing.km, fp.km_p25, fp.km_p75);
      score += kmResult.score;
      reasons.km = kmResult.reason;
      if (listing.km) {
        console.log(`[KM MATCH] ${listingMake} ${listingModel} km=${listing.km} → ${kmResult.band} (${kmResult.score > 0 ? "+" : ""}${kmResult.score})`);
      }

      // Price scoring
      const priceResult = scorePrice(listing.price, fp.price_median);
      score += priceResult.score;
      reasons.price = priceResult.reason;

      // Identity alignment scoring
      const transResult = scoreIdentity(
        listing.transmission,
        fp.dominant_transmission,
        fp.transmission_count,
        "Transmission"
      );
      score += transResult.score;
      if (transResult.score > 0) reasons.transmission = transResult.reason;

      const bodyResult = scoreIdentity(
        listing.body_type,
        fp.dominant_body_type,
        fp.body_type_count,
        "Body type"
      );
      score += bodyResult.score;
      if (bodyResult.score > 0) reasons.body_type = bodyResult.reason;

      const fuelResult = scoreIdentity(
        listing.fuel_type,
        fp.dominant_fuel_type,
        fp.fuel_type_count,
        "Fuel type"
      );
      score += fuelResult.score;
      if (fuelResult.score > 0) reasons.fuel_type = fuelResult.reason;

      // drive_type: listing_details_norm may not have it yet, score if present
      const driveResult = scoreIdentity(
        null, // drive_type not yet in listing_details_norm
        fp.dominant_drive_type,
        fp.drive_type_count,
        "Drive type"
      );
      score += driveResult.score;
      if (driveResult.score > 0) reasons.drive_type = driveResult.reason;

      // Extraction confidence
      const conf = (listing.extraction_confidence || "").toLowerCase();
      if (conf === "high" || conf === "medium") {
        score += 10;
        reasons.confidence = `Extraction confidence ${conf} (+10)`;
      }

      // ── Threshold ──
      if (score < 60) {
        skipped++;
        continue;
      }

      opportunities.push({
        account_id: accountId,
        listing_norm_id: listing.id,
        raw_id: listing.raw_id || null,
        url_canonical: listing.url_canonical,
        make: listing.make,
        model: listing.model,
        year: listing.year,
        km: listing.km,
        asking_price: listing.price,
        fingerprint_make: fp.make,
        fingerprint_model: fp.model,
        sales_count: Number(fp.sales_count),
        km_band: kmResult.band,
        price_band: priceResult.band,
        match_score: score,
        reasons,
        status: "open",
        // Identity fields
        transmission: listing.transmission,
        body_type: listing.body_type,
        fuel_type: listing.fuel_type,
        // Recall metadata
        source_searched: listing.domain || null,
        source_match_count: 1,
        last_search_at: new Date().toISOString(),
      });
    }

    console.log(
      `[fingerprint-match-run] Scored: ${opportunities.length} matched, ${skipped} skipped`
    );

    // ── Step 5: Upsert opportunities ──
    let upserted = 0;
    if (opportunities.length > 0) {
      const chunkSize = 50;
      for (let i = 0; i < opportunities.length; i += chunkSize) {
        const chunk = opportunities.slice(i, i + chunkSize);
        const { error: upsertErr } = await supabase
          .from("matched_opportunities_v1")
          .upsert(chunk as any, {
            onConflict: "account_id,listing_norm_id",
            ignoreDuplicates: false,
          });

        if (upsertErr) {
          console.error(
            `[fingerprint-match-run] Upsert error (chunk ${i}):`,
            upsertErr
          );
        } else {
          upserted += chunk.length;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[fingerprint-match-run] Complete: ${upserted} upserted, ${skipped} skipped, ${durationMs}ms`
    );

    return new Response(
      JSON.stringify({
        success: true,
        fingerprints_loaded: fingerprints.length,
        listings_checked: listings.length,
        matched: upserted,
        skipped,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[fingerprint-match-run] Error:", error);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
