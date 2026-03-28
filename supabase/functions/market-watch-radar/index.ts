import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * MARKET WATCH RADAR — Unified cheap-car detector across ALL sources
 *
 * Scans every listing in market_listings (retail + auction combined),
 * clusters by year/make/model, and flags anything priced significantly
 * below market with strong comp support.
 *
 * Outputs:
 *   1. Upserts deals into `caroogle_finds` with flag_type MARKET_WATCH
 *   2. Posts top deals to Slack
 *   3. Heartbeat + audit log
 *
 * Schedule: every 30 minutes via cron
 *
 * POST body (optional):
 *   { maxListings: number, minDiscount: number, minMargin: number, dryRun: boolean }
 */

// ── Thresholds ──
const DEFAULT_MIN_DISCOUNT_PCT = 15; // Must be 15%+ below market median
const DEFAULT_MIN_MARGIN = 3000; // At least $3K absolute margin
const MIN_COMPS = 3; // Need 3+ comps for reliable pricing
const MIN_YEAR = 2012; // Ignore pre-2012
const MIN_PRICE = 5000; // Skip sub-$5K (wrecks / parts)
const MAX_PRICE = 250000; // Skip exotics
const MAX_DEALS_SLACK = 15; // Top N deals to post to Slack
const STALE_STATUSES = new Set([
  "STALE",
  "DEAD",
  "SOLD",
  "DELISTED",
  "INVALID",
]);

// Sources considered "auction" (typically wholesale prices)
const AUCTION_SOURCES = new Set([
  "pickles",
  "pickles_crawl",
  "grays",
  "manheim",
  "slattery",
  "f3",
  "auto_auctions",
  "auto_auctions_aav",
  "vma",
  "bidsonline",
]);

interface MarketListing {
  id: string;
  make: string;
  model: string;
  variant_resolved: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  source: string;
  location: string | null;
  listing_url: string | null;
  lifecycle_status: string | null;
  last_seen_at: string | null;
}

interface Deal {
  listing_id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  km: number | null;
  price: number;
  market_median: number;
  market_min: number;
  margin: number;
  discount_pct: number;
  comp_count: number;
  source: string;
  location: string | null;
  listing_url: string | null;
  is_auction: boolean;
  score: number;
  cluster_key: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function clusterKey(year: number, make: string, model: string): string {
  return `${year}|${make.toUpperCase().trim()}|${model.toUpperCase().trim()}`;
}

/**
 * Score a deal: combines discount %, margin size, KM advantage, comp confidence
 * Higher = better deal
 */
function scoreDeal(
  price: number,
  marketMedian: number,
  km: number | null,
  compCount: number,
  medianKm: number | null,
  isAuction: boolean
): number {
  const discountPct = ((marketMedian - price) / marketMedian) * 100;
  const margin = marketMedian - price;

  // Base: discount percentage (0-70 range)
  let score = discountPct;

  // Margin bonus: extra points for large absolute margins
  if (margin > 20000) score += 15;
  else if (margin > 10000) score += 10;
  else if (margin > 5000) score += 5;

  // KM advantage: lower km than market median = bonus
  if (km && km > 0 && medianKm && medianKm > 0) {
    const kmAdvantagePct = ((medianKm - km) / medianKm) * 100;
    if (kmAdvantagePct > 0) {
      score += Math.min(kmAdvantagePct * 0.2, 15); // Cap at +15
    }
  }

  // Comp confidence: more comps = more reliable
  if (compCount >= 20) score += 10;
  else if (compCount >= 10) score += 7;
  else if (compCount >= 5) score += 3;

  // Auction source penalty (auctions are wholesale, expected to be cheaper)
  if (isAuction) score -= 10;

  return Math.round(score * 10) / 10;
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
  const slackWebhookUrl = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  const metrics = {
    listings_scanned: 0,
    clusters_formed: 0,
    deals_found: 0,
    deals_upserted: 0,
    slack_sent: false,
    errors: [] as string[],
  };

  try {
    // Parse optional overrides
    const body = await req.json().catch(() => ({}));
    const maxListings = body.maxListings || 50000;
    const minDiscountPct = body.minDiscount || DEFAULT_MIN_DISCOUNT_PCT;
    const minMargin = body.minMargin || DEFAULT_MIN_MARGIN;
    const dryRun = body.dryRun === true;

    console.log(
      `[RADAR] Starting: minDiscount=${minDiscountPct}% minMargin=$${minMargin} dryRun=${dryRun}`
    );

    // ── Fetch from both tables directly (faster than market_listings view) ──
    const allListings: MarketListing[] = [];

    // Helper to fetch in batches
    async function fetchTable(
      table: string,
      priceCol: string,
      variantCol: string,
      locationCol: string,
      statusCol: string | null,
      statusValue: string | null
    ) {
      let offset = 0;
      const batchSize = 5000;
      while (offset < maxListings) {
        let query = supabase
          .from(table)
          .select(
            `id, make, model, ${variantCol}, year, km, ${priceCol}, source, ${locationCol}, listing_url${statusCol ? ", " + statusCol : ""}`
          )
          .not(priceCol, "is", null)
          .gt(priceCol, MIN_PRICE)
          .lt(priceCol, MAX_PRICE)
          .gte("year", MIN_YEAR)
          .not("make", "is", null)
          .not("model", "is", null)
          .range(offset, offset + batchSize - 1);

        if (statusCol && statusValue) {
          query = query.eq(statusCol, statusValue);
        }

        const { data, error } = await query;
        if (error) {
          console.error(`[RADAR] Fetch ${table} error at offset ${offset}:`, error.message);
          break;
        }
        if (!data || data.length === 0) break;

        for (const row of data as Record<string, unknown>[]) {
          allListings.push({
            id: row.id as string,
            make: row.make as string,
            model: row.model as string,
            variant_resolved: (row[variantCol] as string) || null,
            year: row.year as number,
            km: row.km as number | null,
            price: row[priceCol] as number,
            source: row.source as string,
            location: (row[locationCol] as string) || null,
            listing_url: row.listing_url as string | null,
            lifecycle_status: statusCol ? (row[statusCol] as string) : null,
            last_seen_at: null,
          });
        }

        offset += batchSize;
        if (data.length < batchSize) break;
      }
    }

    // Retail listings (active only)
    await fetchTable(
      "retail_listings", "asking_price", "variant_raw", "state",
      "lifecycle_status", "ACTIVE"
    );
    const retailCount = allListings.length;
    console.log(`[RADAR] Fetched ${retailCount} retail listings`);

    // Vehicle/auction listings
    await fetchTable(
      "vehicle_listings", "asking_price", "variant_raw", "state",
      null, null
    );
    console.log(`[RADAR] Fetched ${allListings.length - retailCount} vehicle listings`);

    metrics.listings_scanned = allListings.length;
    console.log(`[RADAR] Scanned ${allListings.length} active listings`);

    if (allListings.length === 0) {
      return respond(200, { ok: true, ...metrics, message: "No listings" });
    }

    // ── Cluster by year/make/model ──
    const clusters = new Map<string, MarketListing[]>();
    for (const l of allListings) {
      if (!l.year || !l.make || !l.model || !l.price) continue;
      const key = clusterKey(l.year, l.make, l.model);
      const arr = clusters.get(key) || [];
      arr.push(l);
      clusters.set(key, arr);
    }

    metrics.clusters_formed = clusters.size;
    console.log(`[RADAR] Formed ${clusters.size} clusters`);

    // ── Score each listing against its cluster ──
    const deals: Deal[] = [];

    for (const [key, members] of clusters) {
      if (members.length < MIN_COMPS) continue;

      const prices = members
        .map((m) => m.price!)
        .filter((p) => p > 0);
      if (prices.length < MIN_COMPS) continue;

      const medianPrice = median(prices);
      const minPrice = Math.min(...prices);
      const p25 = percentile(prices, 25);

      const kms = members
        .map((m) => m.km)
        .filter((k): k is number => k !== null && k > 0);
      const medianKm = kms.length > 0 ? median(kms) : null;

      for (const l of members) {
        if (!l.price || !l.year) continue;

        const isAuction = AUCTION_SOURCES.has(l.source || "");
        const discountPct =
          ((medianPrice - l.price) / medianPrice) * 100;
        const margin = medianPrice - l.price;

        // Apply thresholds
        if (discountPct < minDiscountPct) continue;
        if (margin < minMargin) continue;

        const score = scoreDeal(
          l.price,
          medianPrice,
          l.km,
          members.length,
          medianKm,
          isAuction
        );

        deals.push({
          listing_id: l.id,
          make: l.make,
          model: l.model,
          variant: l.variant_resolved,
          year: l.year,
          km: l.km,
          price: l.price,
          market_median: Math.round(medianPrice),
          market_min: minPrice,
          margin: Math.round(margin),
          discount_pct: Math.round(discountPct * 10) / 10,
          comp_count: members.length,
          source: l.source,
          location: l.location,
          listing_url: l.listing_url,
          is_auction: isAuction,
          score,
          cluster_key: key,
        });
      }
    }

    // Sort by score descending
    deals.sort((a, b) => b.score - a.score);
    metrics.deals_found = deals.length;
    console.log(`[RADAR] Found ${deals.length} deals`);

    // ── Upsert deals to caroogle_finds ──
    if (!dryRun && deals.length > 0) {
      const topDeals = deals.slice(0, 200); // Cap at 200

      for (const d of topDeals) {
        try {
          const expiresAt = new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString();

          await supabase.from("caroogle_finds").upsert(
            {
              listing_id: d.listing_id,
              make: d.make,
              model: d.model,
              variant: d.variant,
              year: d.year,
              km: d.km,
              price: d.price,
              median_price: d.market_median,
              lowest_price: d.market_min,
              discount_percent: d.discount_pct,
              spread: d.margin,
              score: d.score,
              confidence: d.comp_count >= 10 ? "HIGH" : d.comp_count >= 5 ? "MEDIUM" : "LOW",
              reasons: [
                `${d.discount_pct}% below market`,
                `$${d.margin.toLocaleString()} margin`,
                `${d.comp_count} comps`,
              ],
              flag_types: ["MARKET_WATCH"],
              source: d.source,
              location: d.location,
              listing_url: d.listing_url,
              cluster_key: d.cluster_key,
              cluster_size: d.comp_count,
              is_auction: d.is_auction,
              expires_at: expiresAt,
              status: "active",
            },
            { onConflict: "listing_id" }
          );
          metrics.deals_upserted++;
        } catch (err) {
          if (metrics.errors.length < 5) {
            metrics.errors.push(
              `Upsert: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }
    }

    // ── Slack alert: top deals ──
    if (slackWebhookUrl && deals.length > 0 && !dryRun) {
      try {
        const topSlack = deals.slice(0, MAX_DEALS_SLACK);

        // Group by source for summary
        const sourceCounts: Record<string, number> = {};
        for (const d of deals) {
          sourceCounts[d.source] = (sourceCounts[d.source] || 0) + 1;
        }
        const sourceStr = Object.entries(sourceCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([s, c]) => `${s}: ${c}`)
          .join(" | ");

        const dealLines = topSlack.map((d, i) => {
          const name = `${d.year} ${d.make} ${d.model} ${d.variant || ""}`.trim();
          const kmStr = d.km ? `${Math.round(d.km / 1000)}K km` : "?km";
          const url = d.listing_url || "";
          const link = url ? `<${url}|${name}>` : name;
          const srcTag = d.is_auction ? "🔨" : "🏪";
          return `${i + 1}. ${srcTag} ${link}\n    *$${d.price.toLocaleString()}* vs market $${d.market_median.toLocaleString()} → *$${d.margin.toLocaleString()} margin* (${d.discount_pct}% off, ${kmStr}, ${d.source})`;
        });

        const blocks = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🔍 Market Watch: ${deals.length} Deals Found`,
              emoji: true,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${metrics.listings_scanned.toLocaleString()} listings scanned | ${metrics.clusters_formed.toLocaleString()} clusters | ${sourceStr}`,
              },
            ],
          },
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: dealLines.join("\n\n"),
            },
          },
        ];

        const slackRes = await fetch(slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks }),
        });

        metrics.slack_sent = slackRes.ok;
        if (!slackRes.ok) {
          console.warn(`[RADAR] Slack failed: ${slackRes.status}`);
        }
      } catch (slackErr) {
        console.warn(`[RADAR] Slack error:`, slackErr);
      }
    }

    const elapsed = Date.now() - startTime;

    // Heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "market-watch-radar",
        last_seen_at: new Date().toISOString(),
        last_ok: metrics.errors.length === 0,
        note: `scanned=${metrics.listings_scanned} clusters=${metrics.clusters_formed} deals=${metrics.deals_found} upserted=${metrics.deals_upserted} slack=${metrics.slack_sent} ms=${elapsed}`,
      },
      { onConflict: "cron_name" }
    );

    // Audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "market-watch-radar",
      success: metrics.errors.length === 0,
      result: { ...metrics, elapsed_ms: elapsed },
      error:
        metrics.errors.length > 0 ? metrics.errors.join("; ") : null,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log(`[RADAR] Done in ${elapsed}ms:`, metrics);
    return respond(200, { ok: true, ...metrics, elapsed_ms: elapsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[RADAR] Fatal error:", msg);

    try {
      await supabase.from("cron_heartbeat").upsert(
        {
          cron_name: "market-watch-radar",
          last_seen_at: new Date().toISOString(),
          last_ok: false,
          note: msg.substring(0, 200),
        },
        { onConflict: "cron_name" }
      );
    } catch (_) {
      /* best effort */
    }

    return respond(500, { ok: false, error: msg });
  }
});
