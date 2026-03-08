import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normaliseToOffroad } from "../_shared/price-normalisation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * fingerprint-match-run v4.0
 *
 * Scores directly against vehicle_listings (active only).
 * Now uses MARKET-REBASED prices and fingerprint expiry.
 *
 * Rebasing: Historical margin % is preserved, but price anchors
 * are recomputed from current market medians for that spec.
 * rebased_buy_anchor = current market median
 * rebased_sell_price = market median * (1 + historical_margin_pct)
 *
 * Expiry:
 *   - 'expired' (>24mo, no recent sale) → skipped entirely
 *   - 'watch' (>12mo + >10% market drift) → match_score capped, status='watch'
 *   - 'active' → full scoring
 *
 * Scoring (0-100 base, then scaled by decay multiplier):
 *   +40  make+model match (required baseline)
 *   +25  km inside IQR (p25–p75)
 *   +10  km near band (±20k outside IQR)
 *   +15  asking price ≤ rebased_buy_anchor
 *   +5   asking price within 10% above rebased anchor
 *   +10  transmission matches dominant
 *   +10  body_type/fuel_type matches dominant
 *   +10  drive_type matches dominant
 *
 * Final score = base_score * decay_multiplier
 * Only creates opportunities with final score ≥ 60 (or watch-only if fingerprint is 'watch').
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
  // Time-decay columns
  weighted_profit_sum: number | null;
  weighted_profit_avg: number | null;
  avg_decay_factor: number | null;
  raw_profit_avg: number | null;
  avg_months_ago: number | null;
  // Rebased columns
  historical_margin_pct: number | null;
  historical_buy_median: number | null;
  historical_sell_median: number | null;
  rebased_buy_anchor: number | null;
  rebased_sell_price: number | null;
  market_sample_size: number;
  market_drift_pct: number | null;
  fingerprint_status: string;
  newest_sale_months_ago: number | null;
  recent_sales_count: number;
}

interface VehicleListing {
  id: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  price_type: string | null;
  state: string | null;
  variant_raw: string | null;
  transmission: string | null;
  fuel: string | null;
  drivetrain: string | null;
  listing_url: string | null;
  source: string | null;
  platform_class: string | null;
  first_seen_at: string | null;
}

// ── Listing Age Scoring ──

function scoreListingAge(firstSeenAt: string | null): { score: number; reason: string } {
  if (!firstSeenAt) return { score: 0, reason: "first_seen_at missing (+0)" };
  const daysListed = Math.floor((Date.now() - new Date(firstSeenAt).getTime()) / 86400000);
  if (daysListed > 90) return { score: 0, reason: `Age ${daysListed}d >90d stale (+0)` };
  let score = 0;
  if (daysListed <= 3) score = 0;
  else if (daysListed <= 10) score = 3;
  else if (daysListed <= 20) score = 6;
  else if (daysListed <= 30) score = 8;
  else score = 10;
  return { score, reason: `Age ${daysListed}d → +${score}` };
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
  rebasedAnchor: number | null
): { score: number; band: string; reason: string } {
  if (price == null || rebasedAnchor == null) {
    return { score: 0, band: "unknown", reason: "price data missing (+0)" };
  }
  const anchor = Number(rebasedAnchor);
  if (price <= anchor) {
    return {
      score: 15,
      band: "below",
      reason: `$${price.toLocaleString()} ≤ rebased anchor $${Math.round(anchor).toLocaleString()} (+15)`,
    };
  }
  if (price <= anchor * 1.1) {
    return {
      score: 5,
      band: "near",
      reason: `$${price.toLocaleString()} near rebased anchor (+5)`,
    };
  }
  return {
    score: 0,
    band: "above",
    reason: `$${price.toLocaleString()} above rebased anchor (+0)`,
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

function computeDecayMultiplier(avgDecayFactor: number | null): number {
  if (avgDecayFactor == null) return 0.8;
  const clamped = Math.max(0, Math.min(1, Number(avgDecayFactor)));
  return 0.6 + 0.4 * clamped;
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

    console.log(`[fingerprint-match-run] v4.0 (market-rebased) starting for account=${accountId}, batch=${batchSize}`);
    const startTime = Date.now();

    // ── Step 1: Optionally refresh fingerprints ──
    if (refreshFingerprints) {
      console.log("[fingerprint-match-run] Refreshing fingerprints...");
      const { error: refreshErr } = await supabase.rpc("refresh_sales_fingerprints");
      if (refreshErr) {
        console.warn("[fingerprint-match-run] Refresh warning:", refreshErr.message);
      }
    }

    // ── Step 2: Load fingerprints (now includes rebased + status columns) ──
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

    // Log fingerprint status breakdown
    let activeCount = 0, watchCount = 0, expiredCount = 0;
    for (const fp of fingerprints as Fingerprint[]) {
      if (fp.fingerprint_status === 'expired') expiredCount++;
      else if (fp.fingerprint_status === 'watch') watchCount++;
      else activeCount++;
      console.log(`[fingerprint] ${fp.make} ${fp.model} | status=${fp.fingerprint_status} | sales=${fp.sales_count} | margin=${((fp.historical_margin_pct ?? 0) * 100).toFixed(1)}% | rebased_buy=$${fp.rebased_buy_anchor} | rebased_sell=$${fp.rebased_sell_price} | drift=${fp.market_drift_pct}% | market_n=${fp.market_sample_size} | decay=${fp.avg_decay_factor}`);
    }
    console.log(`[fingerprint-match-run] ${fingerprints.length} fingerprints: ${activeCount} active, ${watchCount} watch, ${expiredCount} expired`);

    // Build lookup map keyed by platform_class (skip expired)
    const fpMap = new Map<string, Fingerprint>();
    for (const fp of fingerprints as Fingerprint[]) {
      if (fp.fingerprint_status === 'expired') continue; // Stop using expired
      const key = fp.platform_class || `${(fp.make || "").toUpperCase()}:${(fp.model || "").toUpperCase()}`;
      fpMap.set(key, fp);
    }

    // ── Step 3: Load active vehicle_listings ──
    const { data: listings, error: listErr } = await supabase
      .from("vehicle_listings")
      .select("id, listing_id, make, model, year, km, asking_price, price_type, state, variant_raw, transmission, fuel, drivetrain, listing_url, source, platform_class, first_seen_at")
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

    console.log(`[fingerprint-match-run] Scoring ${listings.length} active listings against ${fpMap.size} usable fingerprints`);

    // ── Step 3b: Load fingerprint accuracy scores ──
    const fpAccuracyMap = new Map<string, number>();
    try {
      const { data: fpMetrics } = await supabase
        .from("fingerprint_performance_metrics")
        .select("platform_class, fingerprint_accuracy_score")
        .is("account_id", null);
      for (const m of fpMetrics || []) {
        fpAccuracyMap.set(m.platform_class, Number(m.fingerprint_accuracy_score));
      }
      console.log(`[fingerprint-match-run] Loaded ${fpAccuracyMap.size} accuracy scores`);
    } catch (e) {
      console.warn("[fingerprint-match-run] Accuracy scores unavailable (non-fatal)");
    }

    // ── Step 4: Score each listing ──
    const opportunities: Array<Record<string, unknown>> = [];
    let skipped = 0;
    let skippedBadUrl = 0;
    let skippedDedupe = 0;
    let skippedDecay = 0;
    let skippedExpired = 0;
    let watchOnly = 0;

    const seenVehicles = new Set<string>();

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

      if (isGenericUrl(listing.listing_url)) {
        skippedBadUrl++;
        continue;
      }

      const vehicleKey = `${listingMake}:${listingModel}:${listing.year ?? 0}:${listing.km ?? 0}:${listing.asking_price ?? 0}`;
      if (seenVehicles.has(vehicleKey)) {
        skippedDedupe++;
        continue;
      }
      seenVehicles.add(vehicleKey);

      const platformKey = listing.platform_class || `${listingMake}:${listingModel}`;
      const fp = fpMap.get(platformKey);

      if (!fp) {
        skipped++;
        continue;
      }

      // ── Base Scoring (using rebased prices) ──
      let baseScore = 40;
      const reasons: Record<string, string> = {
        make_model: `${listingMake} ${listingModel} matches fingerprint (+40)`,
      };

      const kmResult = scoreKm(listing.km, fp.km_p25, fp.km_p75);
      baseScore += kmResult.score;
      reasons.km = kmResult.reason;

      // Score price against REBASED buy anchor (not historical median)
      // Normalise asking price to off-road equivalent before scoring
      const normalisedAskPrice = normaliseToOffroad(listing.asking_price, listing.price_type, listing.state);
      const priceResult = scorePrice(normalisedAskPrice, fp.rebased_buy_anchor);
      baseScore += priceResult.score;
      reasons.price = priceResult.reason;

      const transResult = scoreIdentity(listing.transmission, fp.dominant_transmission, fp.transmission_count, "Transmission");
      baseScore += transResult.score;
      if (transResult.score > 0) reasons.transmission = transResult.reason;

      const fuelResult = scoreIdentity(listing.fuel, fp.dominant_fuel_type, fp.fuel_type_count, "Fuel");
      baseScore += fuelResult.score;
      if (fuelResult.score > 0) reasons.fuel = fuelResult.reason;

      const driveResult = scoreIdentity(listing.drivetrain, fp.dominant_drive_type, fp.drive_type_count, "Drivetrain");
      baseScore += driveResult.score;
      if (driveResult.score > 0) reasons.drivetrain = driveResult.reason;

      // ── Listing age score ──
      const ageResult = scoreListingAge(listing.first_seen_at);
      baseScore += ageResult.score;
      if (ageResult.score > 0) reasons.listing_age = ageResult.reason;

      // ── Apply time-decay multiplier ──
      const decayMultiplier = computeDecayMultiplier(fp.avg_decay_factor);
      let finalScore = Math.min(Math.round(baseScore * decayMultiplier), 100);

      // ── Fingerprint accuracy modifier (secondary, never overrides gates) ──
      const platformKey2 = fp.platform_class || `${(fp.make || "").toUpperCase()}:${(fp.model || "").toUpperCase()}`;
      const fpAccuracy = fpAccuracyMap.get(platformKey2) ?? 50;
      if (fpAccuracy >= 70) finalScore = Math.min(finalScore + 3, 100);
      else if (fpAccuracy < 30) finalScore = Math.max(finalScore - 3, 0);
      if (fpAccuracy < 30 || fpAccuracy >= 70) {
        reasons.accuracy = `fp_accuracy=${fpAccuracy} → ${fpAccuracy >= 70 ? "+3" : "-3"}`;
      }

      // ── Watch-only fingerprints: cap score and flag ──
      const isWatch = fp.fingerprint_status === 'watch';
      if (isWatch) {
        finalScore = Math.min(finalScore, 69); // Cap below "high confidence"
      }

      reasons.rebase = `rebased_buy=$${fp.rebased_buy_anchor} rebased_sell=$${fp.rebased_sell_price} margin=${((fp.historical_margin_pct ?? 0) * 100).toFixed(1)}% drift=${fp.market_drift_pct}%`;
      reasons.decay = `decay_mult=${decayMultiplier.toFixed(2)} (avg_decay=${fp.avg_decay_factor}, months=${fp.avg_months_ago})`;
      if (isWatch) reasons.status = `WATCH-only: fingerprint >12mo + market drifted ${fp.market_drift_pct}%`;

      // ── Threshold ──
      if (finalScore < 60) {
        if (baseScore >= 60) skippedDecay++;
        else skipped++;
        continue;
      }

      if (isWatch) watchOnly++;

      // Compute expected margin using rebased prices and normalised asking price
      const expectedMargin = (fp.rebased_sell_price && normalisedAskPrice)
        ? Math.round(Number(fp.rebased_sell_price) - normalisedAskPrice)
        : null;

      opportunities.push({
        account_id: accountId,
        listing_id: listing.id,
        listing_norm_id: null,
        raw_id: null,
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
        match_score: finalScore,
        reasons,
        status: isWatch ? "watch" : "open",
        transmission: listing.transmission,
        fuel_type: listing.fuel,
        drive_type: listing.drivetrain,
        source_searched: listing.source || null,
        source_match_count: 1,
        last_search_at: new Date().toISOString(),
        // Rebased anchor prices
        anchor_buy_price: fp.rebased_buy_anchor ? Math.round(Number(fp.rebased_buy_anchor)) : null,
        anchor_sell_price: fp.rebased_sell_price ? Math.round(Number(fp.rebased_sell_price)) : null,
        anchor_profit: expectedMargin,
        median_sell_price: fp.historical_sell_median ? Math.round(Number(fp.historical_sell_median)) : null,
      });
    }

    console.log(`[fingerprint-match-run] Scored: ${opportunities.length} matched (${watchOnly} watch-only), ${skipped} skipped, ${skippedBadUrl} bad-url, ${skippedDedupe} deduped, ${skippedDecay} killed-by-decay, ${expiredCount} expired-fingerprints`);

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
    console.log(`[fingerprint-match-run] Complete: ${upserted} upserted, ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        fingerprints_loaded: fingerprints.length,
        fingerprints_active: activeCount,
        fingerprints_watch: watchCount,
        fingerprints_expired: expiredCount,
        listings_checked: listings.length,
        matched: upserted,
        watch_only: watchOnly,
        skipped,
        skipped_bad_url: skippedBadUrl,
        skipped_dedupe: skippedDedupe,
        skipped_decay: skippedDecay,
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
