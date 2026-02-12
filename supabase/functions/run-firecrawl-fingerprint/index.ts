import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * run-firecrawl-fingerprint v1.0
 *
 * Pulls search URLs for a fingerprint (or all), sends to Firecrawl,
 * extracts structured listing data, scores, and stores candidates.
 */

interface ScrapedListing {
  year?: number;
  make?: string;
  model?: string;
  variant?: string;
  kilometres?: number;
  price?: number;
  location?: string;
  seller?: string;
  url?: string;
}

// Scoring: base 10
function scoreCandidate(
  candidate: ScrapedListing,
  fp: { make: string; model: string; variant: string | null; median_km: number | null; median_sale_price: number | null; median_profit: number | null }
): { score: number; upgrade: boolean; downgrade: boolean; reasons: Record<string, string> } {
  let score = 0;
  const reasons: Record<string, string> = {};
  let upgrade = false;
  let downgrade = false;

  // +3 make/model
  const cMake = (candidate.make || "").toUpperCase().trim();
  const cModel = (candidate.model || "").toUpperCase().trim();
  if (cMake === fp.make.toUpperCase() && cModel === fp.model.toUpperCase()) {
    score += 3;
    reasons.make_model = "Exact make/model match (+3)";
  } else {
    reasons.make_model = "Make/model mismatch (+0)";
    return { score, upgrade, downgrade, reasons };
  }

  // +2 exact variant, +1 higher trim, -2 lower trim
  const cVariant = (candidate.variant || "").toUpperCase().trim();
  const fpVariant = (fp.variant || "").toUpperCase().trim();
  if (cVariant && fpVariant) {
    if (cVariant === fpVariant) {
      score += 2;
      reasons.variant = `Exact variant match "${cVariant}" (+2)`;
    } else {
      // Simple trim hierarchy: longer variant name = likely higher trim (heuristic)
      const trimOrder = ["BASE", "ST", "STX", "GX", "GXL", "VX", "SAHARA", "GR", "SR", "SR5", "ROGUE", "RUGGED", "RUGGED X"];
      const fpIdx = trimOrder.indexOf(fpVariant);
      const cIdx = trimOrder.indexOf(cVariant);
      if (fpIdx >= 0 && cIdx >= 0) {
        if (cIdx > fpIdx) {
          score += 1;
          upgrade = true;
          reasons.variant = `Higher trim "${cVariant}" vs "${fpVariant}" → Upgrade Opportunity (+1)`;
        } else {
          score -= 2;
          downgrade = true;
          reasons.variant = `Lower trim "${cVariant}" vs "${fpVariant}" → Downgrade Risk (-2)`;
        }
      } else {
        reasons.variant = `Variant "${cVariant}" differs from "${fpVariant}" (+0)`;
      }
    }
  }

  // +2 kms within band
  if (candidate.kilometres != null && fp.median_km != null) {
    const medKm = fp.median_km;
    let tolerance: number;
    if (medKm <= 80000) tolerance = 15000;
    else if (medKm <= 150000) tolerance = medKm * 0.2;
    else tolerance = medKm * 0.25;

    if (Math.abs(candidate.kilometres - medKm) <= tolerance) {
      score += 2;
      reasons.km = `KM ${candidate.kilometres?.toLocaleString()} within band of ${medKm.toLocaleString()} (+2)`;
    } else {
      reasons.km = `KM ${candidate.kilometres?.toLocaleString()} outside band of ${medKm.toLocaleString()} (+0)`;
    }
  }

  // +2 price below target (median_sale_price - median_profit approximation)
  const targetBuy = fp.median_sale_price && fp.median_profit
    ? fp.median_sale_price - fp.median_profit
    : null;

  if (candidate.price != null && targetBuy != null && candidate.price <= targetBuy) {
    score += 2;
    reasons.price_target = `$${candidate.price.toLocaleString()} ≤ target buy $${targetBuy.toLocaleString()} (+2)`;
  } else if (candidate.price != null && targetBuy != null) {
    reasons.price_target = `$${candidate.price.toLocaleString()} above target buy $${targetBuy.toLocaleString()} (+0)`;
  }

  // +1 price below sold price
  if (candidate.price != null && fp.median_sale_price != null && candidate.price < fp.median_sale_price) {
    score += 1;
    reasons.price_sold = `$${candidate.price.toLocaleString()} below sold median $${fp.median_sale_price.toLocaleString()} (+1)`;
  }

  return { score, upgrade, downgrade, reasons };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body.account_id;
    const fingerprintId: string | undefined = body.fingerprint_id;

    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load search URLs
    let urlQuery = supabase
      .from("fingerprint_search_urls")
      .select("id, fingerprint_id, source, search_url")
      .eq("account_id", accountId);

    if (fingerprintId) {
      urlQuery = urlQuery.eq("fingerprint_id", fingerprintId);
    }

    const { data: searchUrls, error: urlErr } = await urlQuery;
    if (urlErr || !searchUrls?.length) {
      return new Response(
        JSON.stringify({ success: true, scraped: 0, message: urlErr?.message || "No search URLs. Run generate-search-urls first." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load fingerprint details for scoring
    const fpIds = [...new Set(searchUrls.map((u: any) => u.fingerprint_id))];
    const { data: fps } = await supabase
      .from("sales_target_candidates")
      .select("id, make, model, variant, median_km, median_sale_price, median_profit")
      .in("id", fpIds);

    const fpMap = new Map<string, any>();
    for (const fp of (fps || [])) {
      fpMap.set(fp.id, fp);
    }

    console.log(`[run-firecrawl] Scraping ${searchUrls.length} URLs for ${fpIds.length} fingerprints`);

    let totalCandidates = 0;
    let totalScraped = 0;

    // Process each URL (limit concurrency)
    for (const su of searchUrls) {
      try {
        console.log(`[run-firecrawl] Scraping ${su.source}: ${su.search_url.substring(0, 80)}...`);

        const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: su.search_url,
            formats: [
              {
                type: "json",
                schema: {
                  type: "object",
                  properties: {
                    listings: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          year: { type: "number" },
                          make: { type: "string" },
                          model: { type: "string" },
                          variant: { type: "string" },
                          kilometres: { type: "number" },
                          price: { type: "number" },
                          location: { type: "string" },
                          seller: { type: "string" },
                          url: { type: "string" },
                        },
                      },
                    },
                  },
                },
                prompt: "Extract all vehicle listings from this page. For each listing, get the year, make, model, variant/trim, kilometres, price (as number without currency symbol), location, seller name, and the listing URL.",
              },
            ],
            waitFor: 3000,
          }),
        });

        const result = await response.json();
        totalScraped++;

        // Extract listings from response
        const listings: ScrapedListing[] =
          result?.data?.json?.listings ||
          result?.json?.listings ||
          [];

        if (listings.length === 0) {
          console.log(`[run-firecrawl] No listings found from ${su.source}`);
          continue;
        }

        console.log(`[run-firecrawl] Found ${listings.length} listings from ${su.source}`);

        const fp = fpMap.get(su.fingerprint_id);
        if (!fp) continue;

        // Score and prepare candidates
        const candidates: Array<Record<string, unknown>> = [];
        for (const listing of listings) {
          const { score, upgrade, downgrade, reasons } = scoreCandidate(listing, fp);

          candidates.push({
            fingerprint_id: su.fingerprint_id,
            account_id: accountId,
            source: su.source,
            year: listing.year || null,
            make: listing.make || null,
            model: listing.model || null,
            variant: listing.variant || null,
            kms: listing.kilometres || null,
            price: listing.price || null,
            location: listing.location || null,
            seller: listing.seller || null,
            url: listing.url || null,
            match_score: score,
            upgrade_flag: upgrade,
            downgrade_flag: downgrade,
            score_reasons: reasons,
          });
        }

        // Upsert candidates (dedup on fingerprint_id + url)
        if (candidates.length > 0) {
          const { error: upsertErr } = await supabase
            .from("firecrawl_candidates")
            .upsert(candidates as any, {
              onConflict: "fingerprint_id,url",
              ignoreDuplicates: false,
            });

          if (upsertErr) {
            console.error(`[run-firecrawl] Upsert error:`, upsertErr.message);
          } else {
            totalCandidates += candidates.length;
          }
        }
      } catch (scrapeErr: any) {
        console.error(`[run-firecrawl] Scrape error for ${su.source}:`, scrapeErr.message);
      }

      // Small delay between scrapes
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`[run-firecrawl] Done: ${totalScraped} URLs scraped, ${totalCandidates} candidates stored`);

    return new Response(
      JSON.stringify({
        success: true,
        urls_scraped: totalScraped,
        candidates_stored: totalCandidates,
        fingerprints_processed: fpIds.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[run-firecrawl] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
