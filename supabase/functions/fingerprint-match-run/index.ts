import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * fingerprint-match-run
 *
 * Loads normalized listings, joins to sales_fingerprints_v1,
 * scores each match, and upserts into matched_opportunities_v1.
 *
 * Input (JSON body):
 *   account_id  — required uuid
 *   batch_size  — optional, default 200
 *   refresh_fingerprints — optional boolean, default true
 *
 * Scoring (0-100):
 *   +40  make+model match (required baseline)
 *   +25  km inside IQR (p25–p75)
 *   +10  km near band (±20k outside IQR)
 *   +15  asking price ≤ price_median
 *   +10  extraction confidence high/medium
 *
 * Only creates opportunities with score ≥ 60.
 */

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
      `[fingerprint-match-run] Starting for account=${accountId}, batch=${batchSize}`
    );
    const startTime = Date.now();

    // Step 1: Optionally refresh the materialized view
    if (refreshFingerprints) {
      console.log("[fingerprint-match-run] Refreshing sales_fingerprints_v1...");
      const { error: refreshErr } = await supabase.rpc(
        "refresh_sales_fingerprints"
      );
      if (refreshErr) {
        console.warn(
          "[fingerprint-match-run] Refresh warning (may be empty):",
          refreshErr.message
        );
        // Don't fail — view may be empty on first run
      }
    }

    // Step 2: Load fingerprints for this account
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
      console.log(
        "[fingerprint-match-run] No fingerprints found for account. Need sales data first."
      );
      return new Response(
        JSON.stringify({
          success: true,
          fingerprints_loaded: 0,
          listings_checked: 0,
          matched: 0,
          skipped: 0,
          message:
            "No fingerprints found. Log sales into vehicle_sales_truth first.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[fingerprint-match-run] Loaded ${fingerprints.length} fingerprints`
    );

    // Build a lookup map: "MAKE|MODEL" → fingerprint
    const fpMap = new Map<string, (typeof fingerprints)[0]>();
    for (const fp of fingerprints) {
      const key = `${(fp.make || "").toUpperCase()}|${(fp.model || "").toUpperCase()}`;
      fpMap.set(key, fp);
    }

    // Step 3: Load recent normalized listings for this account
    // Only listings not already matched (left anti-join via NOT EXISTS would be ideal,
    // but we'll use upsert with ON CONFLICT to handle duplicates)
    const { data: listings, error: listErr } = await supabase
      .from("listing_details_norm")
      .select(
        "id, account_id, raw_id, url_canonical, make, model, year, km, price, extraction_confidence"
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
      console.log(
        "[fingerprint-match-run] No normalized listings found for account."
      );
      return new Response(
        JSON.stringify({
          success: true,
          fingerprints_loaded: fingerprints.length,
          listings_checked: 0,
          matched: 0,
          skipped: 0,
          message: "No normalized listings to match against.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[fingerprint-match-run] Checking ${listings.length} listings against ${fingerprints.length} fingerprints`
    );

    // Step 4: Score each listing against fingerprints
    const opportunities: Array<Record<string, unknown>> = [];
    let skipped = 0;

    for (const listing of listings) {
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

      // ---- Scoring ----
      let score = 40; // Base: make+model match
      const reasons: Record<string, string> = {
        make_model: "make+model match (+40)",
      };

      // KM band scoring
      let kmBand = "unknown";
      if (listing.km != null && fp.km_p25 != null && fp.km_p75 != null) {
        const p25 = Number(fp.km_p25);
        const p75 = Number(fp.km_p75);
        if (listing.km >= p25 && listing.km <= p75) {
          kmBand = "inside";
          score += 25;
          reasons.km = `km ${listing.km} inside IQR [${Math.round(p25)}–${Math.round(p75)}] (+25)`;
        } else if (
          listing.km >= p25 - 20000 &&
          listing.km <= p75 + 20000
        ) {
          kmBand = "near";
          score += 10;
          reasons.km = `km ${listing.km} near IQR ±20k (+10)`;
        } else {
          kmBand = "outside";
          reasons.km = `km ${listing.km} outside IQR [${Math.round(p25)}–${Math.round(p75)}] (+0)`;
        }
      } else {
        reasons.km = "km data missing (+0)";
      }

      // Price scoring
      let priceBand = "unknown";
      if (
        listing.price != null &&
        fp.price_median != null
      ) {
        const median = Number(fp.price_median);
        if (listing.price <= median) {
          priceBand = "below";
          score += 15;
          reasons.price = `asking $${listing.price} ≤ median $${Math.round(median)} (+15)`;
        } else if (listing.price <= median * 1.1) {
          priceBand = "near";
          score += 5;
          reasons.price = `asking $${listing.price} near median $${Math.round(median)} (+5)`;
        } else {
          priceBand = "above";
          reasons.price = `asking $${listing.price} > median $${Math.round(median)} (+0)`;
        }
      } else {
        reasons.price = "price data missing (+0)";
      }

      // Extraction confidence scoring
      const conf = (listing.extraction_confidence || "").toLowerCase();
      if (conf === "high" || conf === "medium") {
        score += 10;
        reasons.confidence = `extraction confidence ${conf} (+10)`;
      } else {
        reasons.confidence = `extraction confidence ${conf || "unknown"} (+0)`;
      }

      // ---- Threshold check ----
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
        km_band: kmBand,
        price_band: priceBand,
        match_score: score,
        reasons,
        status: "open",
      });
    }

    console.log(
      `[fingerprint-match-run] Scored: ${opportunities.length} matched, ${skipped} skipped`
    );

    // Step 5: Upsert opportunities
    let upserted = 0;
    if (opportunities.length > 0) {
      // Batch in chunks of 50
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
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
