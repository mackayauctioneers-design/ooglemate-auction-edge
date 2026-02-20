import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * fingerprint-match-run v2.0
 *
 * Rewired to score directly against vehicle_listings (active only)
 * instead of listing_details_norm. This eliminates the broken
 * raw→norm pipeline bottleneck.
 *
 * Scoring (0-100):
 *   +40  make+model match (required baseline)
 *   +25  km inside IQR (p25–p75)
 *   +10  km near band (±20k outside IQR)
 *   +15  asking price ≤ price_median
 *   +5   asking price within 10% above median
 *   +10  transmission matches dominant
 *   +10  body_type/fuel_type matches dominant
 *   +10  drive_type matches dominant
 *
 * Only creates opportunities with score ≥ 60.
 */

interface Fingerprint {
  account_id: string;
  make: string;
  model: string;
  platform_class: string;
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

interface VehicleListing {
  id: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  variant_raw: string | null;
  transmission: string | null;
  fuel: string | null;
  drivetrain: string | null;
  listing_url: string | null;
  source: string | null;
  platform_class: string | null;
}

// ── Scoring helpers ──

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
      reason: `km ${km.toLocaleString()} inside [${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()}] (+25)`,
    };
  }
  if (km >= lo - 20000 && km <= hi + 20000) {
    return {
      score: 10,
      band: "near",
      reason: `km ${km.toLocaleString()} near range ±20k (+10)`,
    };
  }
  return {
    score: 0,
    band: "outside",
    reason: `km ${km.toLocaleString()} outside range (+0)`,
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
      reason: `$${price.toLocaleString()} near median (+5)`,
    };
  }
  return {
    score: 0,
    band: "above",
    reason: `$${price.toLocaleString()} above median (+0)`,
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
    reason: `${label} "${listingVal}" differs from "${fpDominant}" (+0)`,
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
    const batchSize: number = body.batch_size ?? 500;
    const refreshFingerprints: boolean = body.refresh_fingerprints ?? true;

    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[fingerprint-match-run] v2.0 starting for account=${accountId}, batch=${batchSize}`);
    const startTime = Date.now();

    // ── Step 1: Optionally refresh fingerprints ──
    if (refreshFingerprints) {
      console.log("[fingerprint-match-run] Refreshing fingerprints...");
      const { error: refreshErr } = await supabase.rpc("refresh_sales_fingerprints");
      if (refreshErr) {
        console.warn("[fingerprint-match-run] Refresh warning:", refreshErr.message);
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
          message: "No fingerprints found.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[fingerprint-match-run] ${fingerprints.length} fingerprints loaded`);

    // Build lookup map keyed by platform_class (e.g. "TOYOTA:PRADO")
    const fpMap = new Map<string, Fingerprint>();
    for (const fp of fingerprints as Fingerprint[]) {
      const key = (fp.platform_class || `${(fp.make || "").toUpperCase()}:${(fp.model || "").toUpperCase()}`);
      fpMap.set(key, fp);
    }

    // ── Step 3: Load active vehicle_listings directly ──
    const { data: listings, error: listErr } = await supabase
      .from("vehicle_listings")
      .select("id, listing_id, make, model, year, km, asking_price, variant_raw, transmission, fuel, drivetrain, listing_url, source, platform_class")
      .in("status", ["listed", "catalogue"])
      .order("last_seen_at", { ascending: false })
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
          message: "No active listings to match against.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[fingerprint-match-run] Scoring ${listings.length} active listings against ${fingerprints.length} fingerprints`);

    // ── Step 4: Score each listing ──
    const opportunities: Array<Record<string, unknown>> = [];
    let skipped = 0;
    let skippedBadUrl = 0;
    let skippedDedupe = 0;

    // Composite dedupe: collapse dealer-group mirrors (same physical car across syndicated sites)
    const seenVehicles = new Set<string>();

    // URL sanity patterns — reject generic category/homepage URLs with no vehicle identifier
    const BAD_URL_PATTERNS = [
      /\/used-cars\/?$/i,
      /\/stock\/?$/i,
      /\/inventory\/?$/i,
      /\/vehicles\/?$/i,
      /\/new-cars\/?$/i,
      /\/pre-owned\/?$/i,
    ];

    function isGenericUrl(url: string | null): boolean {
      if (!url) return true;
      return BAD_URL_PATTERNS.some(p => p.test(url));
    }

    for (const listing of listings as VehicleListing[]) {
      const listingMake = (listing.make || "").toUpperCase().trim();
      const listingModel = (listing.model || "").toUpperCase().trim();

      if (!listingMake || !listingModel) {
        skipped++;
        continue;
      }

      // ── URL sanity gate ──
      if (isGenericUrl(listing.listing_url)) {
        skippedBadUrl++;
        continue;
      }

      // ── Composite dedupe gate (collapse dealer-group mirrors) ──
      const vehicleKey = `${listingMake}:${listingModel}:${listing.year ?? 0}:${listing.km ?? 0}:${listing.asking_price ?? 0}`;
      if (seenVehicles.has(vehicleKey)) {
        skippedDedupe++;
        continue;
      }
      seenVehicles.add(vehicleKey);

      // Use platform_class for lookup (strict platform gate)
      const platformKey = listing.platform_class || `${listingMake}:${listingModel}`;
      const fp = fpMap.get(platformKey);

      if (!fp) {
        skipped++;
        continue;
      }

      // ── Scoring ──
      let score = 40; // Base: make+model+platform match
      const reasons: Record<string, string> = {
        make_model: `${listingMake} ${listingModel} matches fingerprint (+40)`,
      };

      // KM scoring
      const kmResult = scoreKm(listing.km, fp.km_p25, fp.km_p75);
      score += kmResult.score;
      reasons.km = kmResult.reason;

      // Price scoring
      const priceResult = scorePrice(listing.asking_price, fp.price_median);
      score += priceResult.score;
      reasons.price = priceResult.reason;

      // Identity alignment: transmission
      const transResult = scoreIdentity(
        listing.transmission, fp.dominant_transmission, fp.transmission_count, "Transmission"
      );
      score += transResult.score;
      if (transResult.score > 0) reasons.transmission = transResult.reason;

      // Identity alignment: fuel
      const fuelResult = scoreIdentity(
        listing.fuel, fp.dominant_fuel_type, fp.fuel_type_count, "Fuel"
      );
      score += fuelResult.score;
      if (fuelResult.score > 0) reasons.fuel = fuelResult.reason;

      // Identity alignment: drivetrain
      const driveResult = scoreIdentity(
        listing.drivetrain, fp.dominant_drive_type, fp.drive_type_count, "Drivetrain"
      );
      score += driveResult.score;
      if (driveResult.score > 0) reasons.drivetrain = driveResult.reason;

      // ── Threshold ──
      if (score < 60) {
        skipped++;
        continue;
      }

      opportunities.push({
        account_id: accountId,
        listing_id: listing.id,
        listing_norm_id: null, // legacy column, no longer used
        raw_id: null, // listing_id is not UUID format
        url_canonical: listing.listing_url,
        make: listing.make,
        model: listing.model,
        year: listing.year,
        km: listing.km,
        asking_price: listing.asking_price,
        fingerprint_make: fp.make,
        fingerprint_model: fp.model,
        sales_count: Number(fp.sales_count),
        km_band: kmResult.band,
        price_band: priceResult.band,
        match_score: score,
        reasons,
        status: "open",
        transmission: listing.transmission,
        fuel_type: listing.fuel,
        drive_type: listing.drivetrain,
        source_searched: listing.source || null,
        source_match_count: 1,
        last_search_at: new Date().toISOString(),
      });
    }

    console.log(`[fingerprint-match-run] Scored: ${opportunities.length} matched, ${skipped} skipped, ${skippedBadUrl} bad-url, ${skippedDedupe} deduped`);

    // ── Step 5: Upsert opportunities ──
    let upserted = 0;
    if (opportunities.length > 0) {
      const chunkSize = 50;
      for (let i = 0; i < opportunities.length; i += chunkSize) {
        const chunk = opportunities.slice(i, i + chunkSize);
        const { error: upsertErr } = await supabase
          .from("matched_opportunities_v1")
          .upsert(chunk as any, {
            onConflict: "account_id,listing_id",
            ignoreDuplicates: false,
          });

        if (upsertErr) {
          console.error(`[fingerprint-match-run] Upsert error (chunk ${i}):`, upsertErr);
        } else {
          upserted += chunk.length;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[fingerprint-match-run] Complete: ${upserted} upserted, ${skipped} skipped, ${skippedBadUrl} bad-url, ${skippedDedupe} deduped, ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        fingerprints_loaded: fingerprints.length,
        listings_checked: listings.length,
        matched: upserted,
        skipped,
        skipped_bad_url: skippedBadUrl,
        skipped_dedupe: skippedDedupe,
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
