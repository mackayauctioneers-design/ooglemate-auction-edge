import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * MARKET SCANNER — CarOogle Finds Engine
 *
 * Clusters active listings and detects 4 opportunity types:
 *   1. CHEAPEST_IN_MARKET — lowest price with significant spread to 2nd
 *   2. UNDER_MARKET — priced significantly below cluster median
 *   3. AUCTION_ARBITRAGE — auction price well below retail median
 *   4. FAST_MOVER — cluster with very fast average days on market
 *
 * Results written to `caroogle_finds` with composite score + confidence.
 * Runs every 10 minutes via cron.
 */

const RECENCY_DAYS = 14;
const MIN_CLUSTER_SIZE = 3;

// Thresholds
const CHEAPEST_MIN_SPREAD_DOLLARS = 2000;
const CHEAPEST_MIN_SPREAD_PCT = 3;
const UNDER_MARKET_THRESHOLD_PCT = 8;
const AUCTION_ARB_MIN_GAP = 4000;
const FAST_MOVER_MAX_DAYS = 10;

// Scoring weights
const WEIGHT_CHEAPEST = 40;
const WEIGHT_UNDERVALUE = 35;
const WEIGHT_AUCTION = 15;
const WEIGHT_FAST_MOVER = 10;

const AUCTION_SOURCES = new Set([
  "pickles", "grays", "manheim", "slattery", "f3",
  "auto_auctions", "vma", "bidsonline", "caroogle_shadow",
]);

function yearBand(year: number | null): string {
  if (!year) return "unknown";
  const base = Math.floor(year / 2) * 2;
  return `${base}-${base + 1}`;
}

function kmBand(km: number | null): string {
  if (!km || km <= 0) return "unknown";
  if (km < 50000) return "0-50k";
  if (km < 100000) return "50-100k";
  if (km < 150000) return "100-150k";
  return "150k+";
}

function buildClusterKey(make: string, model: string, yb: string, kb: string): string {
  return `${make.toUpperCase()}|${model.toUpperCase()}|${yb}|${kb}`;
}

function confidenceLabel(score: number): string {
  if (score >= 80) return "HIGH";
  if (score >= 60) return "MEDIUM";
  return "LOW";
}

interface Listing {
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
  image_url: string | null;
  lifecycle_status: string | null;
  days_on_market: number | null;
}

interface Find {
  listing_id: string;
  make: string | null;
  model: string | null;
  series: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  median_price: number | null;
  lowest_price: number | null;
  second_lowest_price: number | null;
  spread: number | null;
  discount_percent: number | null;
  score: number;
  confidence: string;
  reasons: string[];
  flag_types: string[];
  source: string | null;
  location: string | null;
  listing_url: string | null;
  image_url: string | null;
  cluster_key: string;
  cluster_size: number;
  avg_days_on_market: number | null;
  is_auction: boolean;
  auction_arbitrage_gap: number | null;
  expires_at: string;
  status: string;
}

/** Detect series from model/variant text for better clustering */
function detectSeries(model: string, variant?: string | null): string | null {
  const combined = `${model} ${variant || ""}`.toUpperCase();
  // LandCruiser
  if (/PRADO.*(250|J250)/.test(combined)) return "PRADO_250";
  if (/PRADO.*(150|J150|GDJ150)/.test(combined)) return "PRADO_150";
  if (/300|FJA300|GR.?S/.test(combined) && /LAND\s?CRUISER|LC/.test(combined)) return "LC300";
  if (/200|UZJ200|VDJ200/.test(combined) && /LAND\s?CRUISER|LC/.test(combined)) return "LC200";
  if /(70|76|78|79|VDJ7|GDJ7)/.test(combined) && /LAND\s?CRUISER|LC/.test(combined)) return "LC70";
  // Ranger
  if (/RANGER/.test(combined) && /PY|V6|3\.0/.test(combined)) return "RANGER_PY";
  if (/RANGER/.test(combined) && /PX|XL|XLS|XLT|WILDTRAK/.test(combined) && !/PY|V6|3\.0/.test(combined)) return "RANGER_PX";
  // Hilux
  if (/HILUX/.test(combined) && /N80|GUN1|ROGUE|GR.?S/.test(combined)) return "HILUX_N80";
  // Patrol
  if (/PATROL/.test(combined) && /Y62/.test(combined)) return "PATROL_Y62";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const startMs = performance.now();

  try {
    const recencyCutoff = new Date(
      Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // Fetch active listings
    const { data: listings, error } = await sb
      .from("market_listings")
      .select(
        "id, make, model, variant_resolved, year, km, price, source, location, listing_url, image_url, lifecycle_status, days_on_market"
      )
      .not("lifecycle_status", "in", '("STALE","DEAD","SOLD","DELISTED","INVALID")')
      .gte("last_seen_at", recencyCutoff)
      .not("price", "is", null)
      .gt("price", 1000)
      .not("make", "is", null)
      .not("model", "is", null)
      .order("price", { ascending: true })
      .limit(5000);

    if (error) throw error;
    console.log(`[market-scanner] Fetched ${listings?.length ?? 0} active listings`);

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({ status: "ok", finds_created: 0, message: "No active listings" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Cluster ──────────────────────────────────────────────────────────────
    const clusters = new Map<string, Listing[]>();
    for (const l of listings as Listing[]) {
      const series = detectSeries(l.model, l.variant_resolved);
      const modelKey = series || l.model;
      const key = buildClusterKey(l.make, modelKey, yearBand(l.year), kmBand(l.km));
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(l);
    }

    console.log(`[market-scanner] ${clusters.size} clusters formed`);

    // ─── Analyse each cluster ─────────────────────────────────────────────────
    // Map listing_id → Find to merge multiple signals per listing
    const findsMap = new Map<string, Find>();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    for (const [key, cluster] of clusters) {
      if (cluster.length < MIN_CLUSTER_SIZE) continue;

      const sorted = cluster.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
      const cheapest = sorted[0];
      const secondCheapest = sorted[1];

      // ── Cluster stats ──
      const prices = sorted.map((l) => l.price ?? 0);
      const mid = Math.floor(prices.length / 2);
      const medianPrice =
        prices.length % 2 === 0
          ? (prices[mid - 1] + prices[mid]) / 2
          : prices[mid];
      const lowestPrice = prices[0];
      const secondLowestPrice = prices[1];
      const spread = secondLowestPrice - lowestPrice;

      // Average days on market for fast-mover detection
      const daysValues = sorted
        .map((l) => l.days_on_market)
        .filter((d): d is number => d != null && d > 0);
      const avgDays =
        daysValues.length > 0
          ? Math.round(
              daysValues.reduce((a, b) => a + b, 0) / daysValues.length
            )
          : null;

      const isFastMover = avgDays != null && avgDays <= FAST_MOVER_MAX_DAYS;

      // Calculate retail median for auction arbitrage (non-auction prices only)
      const retailPrices = sorted
        .filter((l) => !AUCTION_SOURCES.has(l.source || ""))
        .map((l) => l.price ?? 0)
        .filter((p) => p > 0);
      const retailMedian =
        retailPrices.length >= 2
          ? retailPrices[Math.floor(retailPrices.length / 2)]
          : null;

      const series = detectSeries(cheapest.model, cheapest.variant_resolved);

      // Helper to get or init a find entry
      const getFind = (l: Listing): Find => {
        if (findsMap.has(l.id)) return findsMap.get(l.id)!;
        const f: Find = {
          listing_id: l.id,
          make: l.make,
          model: l.model,
          series,
          variant: l.variant_resolved,
          year: l.year,
          km: l.km,
          price: l.price,
          median_price: Math.round(medianPrice),
          lowest_price: lowestPrice,
          second_lowest_price: secondLowestPrice,
          spread: Math.round(spread),
          discount_percent: null,
          score: 0,
          confidence: "LOW",
          reasons: [],
          flag_types: [],
          source: l.source,
          location: l.location,
          listing_url: l.listing_url,
          image_url: l.image_url,
          cluster_key: key,
          cluster_size: cluster.length,
          avg_days_on_market: avgDays,
          is_auction: AUCTION_SOURCES.has(l.source || ""),
          auction_arbitrage_gap: null,
          expires_at: expiresAt,
          status: "active",
        };
        findsMap.set(l.id, f);
        return f;
      };

      // ── Signal 1: CHEAPEST_IN_MARKET ──
      const spreadPct = cheapest.price
        ? (spread / cheapest.price) * 100
        : 0;
      if (
        spread >= CHEAPEST_MIN_SPREAD_DOLLARS ||
        spreadPct >= CHEAPEST_MIN_SPREAD_PCT
      ) {
        const f = getFind(cheapest);
        f.flag_types.push("CHEAPEST_IN_MARKET");
        f.reasons.push(
          `Cheapest in market — $${Math.round(spread).toLocaleString()} under next listing`
        );
        f.score += WEIGHT_CHEAPEST;
      }

      // ── Signal 2: UNDER_MARKET ──
      for (const l of sorted) {
        if (!l.price || l.price >= medianPrice) break;
        const delta = medianPrice - l.price;
        const deltaPct = (delta / medianPrice) * 100;
        if (deltaPct >= UNDER_MARKET_THRESHOLD_PCT) {
          const f = getFind(l);
          f.discount_percent = Math.round(deltaPct * 10) / 10;
          if (!f.flag_types.includes("UNDER_MARKET")) {
            f.flag_types.push("UNDER_MARKET");
            f.reasons.push(
              `${f.discount_percent}% under market median ($${Math.round(delta).toLocaleString()} gap)`
            );
            f.score += WEIGHT_UNDERVALUE;
          }
        }
      }

      // ── Signal 3: AUCTION_ARBITRAGE ──
      if (retailMedian != null) {
        for (const l of sorted) {
          if (!AUCTION_SOURCES.has(l.source || "")) continue;
          if (!l.price) continue;
          const gap = retailMedian - l.price;
          if (gap >= AUCTION_ARB_MIN_GAP) {
            const f = getFind(l);
            f.auction_arbitrage_gap = Math.round(gap);
            if (!f.flag_types.includes("AUCTION_ARBITRAGE")) {
              f.flag_types.push("AUCTION_ARBITRAGE");
              f.reasons.push(
                `Auction arbitrage — $${Math.round(gap).toLocaleString()} below retail median`
              );
              f.score += WEIGHT_AUCTION;
            }
          }
        }
      }

      // ── Signal 4: FAST_MOVER boost ──
      if (isFastMover) {
        // Boost all flagged listings in this cluster
        for (const [, f] of findsMap) {
          if (f.cluster_key === key && f.flag_types.length > 0) {
            f.score += WEIGHT_FAST_MOVER;
            if (!f.reasons.some((r) => r.includes("Fast mover"))) {
              f.reasons.push(
                `Fast mover cluster — avg ${avgDays} days on market`
              );
              f.flag_types.push("FAST_MOVER");
            }
          }
        }
      }
    }

    // Set confidence based on final score
    const finds = Array.from(findsMap.values()).filter(
      (f) => f.flag_types.length > 0
    );
    for (const f of finds) {
      f.score = Math.min(100, f.score);
      f.confidence = confidenceLabel(f.score);
    }

    // Sort by score descending
    finds.sort((a, b) => b.score - a.score);

    console.log(`[market-scanner] ${finds.length} finds detected`);

    // ─── Write to caroogle_finds ──────────────────────────────────────────────
    if (finds.length > 0) {
      // Expire old finds
      await sb
        .from("caroogle_finds")
        .update({ status: "expired" })
        .lt("expires_at", new Date().toISOString())
        .eq("status", "active");

      // Upsert in batches of 50
      for (let i = 0; i < finds.length; i += 50) {
        const batch = finds.slice(i, i + 50);
        const { error: upsertError } = await sb
          .from("caroogle_finds")
          .upsert(batch, { onConflict: "listing_id" });

        if (upsertError) {
          console.error(
            `[market-scanner] Upsert error (batch ${i}):`,
            upsertError.message
          );
        }
      }
    }

    // Also write to deal_flags for backward compat
    if (finds.length > 0) {
      await sb.from("deal_flags").delete().lt("expires_at", new Date().toISOString());
      const dealFlags = finds.flatMap((f) =>
        f.flag_types
          .filter((ft) => ft === "CHEAPEST_IN_MARKET" || ft === "UNDER_MARKET")
          .map((ft) => ({
            listing_id: f.listing_id,
            listing_url: f.listing_url,
            flag_type: ft,
            confidence: f.score / 100,
            price: f.price,
            price_gap: ft === "UNDER_MARKET" ? f.spread : f.spread,
            price_gap_pct: f.discount_percent || 0,
            market_spread: f.spread,
            cluster_key: f.cluster_key,
            cluster_size: f.cluster_size,
            make: f.make,
            model: f.model,
            variant: f.variant,
            year: f.year,
            km: f.km,
            source: f.source,
            location: f.location,
            expires_at: f.expires_at,
          }))
      );
      for (let i = 0; i < dealFlags.length; i += 50) {
        const batch = dealFlags.slice(i, i + 50);
        await sb
          .from("deal_flags")
          .upsert(batch, { onConflict: "listing_id,flag_type" })
          .then(({ error: e }) => {
            if (e) console.error("[market-scanner] deal_flags upsert:", e.message);
          });
      }
    }

    const durationMs = Math.round(performance.now() - startMs);
    const stats = {
      status: "ok",
      clusters_scanned: clusters.size,
      finds_created: finds.length,
      cheapest_in_market: finds.filter((f) =>
        f.flag_types.includes("CHEAPEST_IN_MARKET")
      ).length,
      under_market: finds.filter((f) =>
        f.flag_types.includes("UNDER_MARKET")
      ).length,
      auction_arbitrage: finds.filter((f) =>
        f.flag_types.includes("AUCTION_ARBITRAGE")
      ).length,
      fast_movers: finds.filter((f) =>
        f.flag_types.includes("FAST_MOVER")
      ).length,
      duration_ms: durationMs,
    };
    console.log("[market-scanner] Complete:", JSON.stringify(stats));

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[market-scanner] Error:", err);
    return new Response(
      JSON.stringify({ status: "error", error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
