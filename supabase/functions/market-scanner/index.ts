import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * MARKET SCANNER — Opportunity Engine
 * 
 * Clusters active listings by make/model/year_band/km_band,
 * then detects:
 *   - CHEAPEST_IN_MARKET: lowest price with significant spread to 2nd cheapest
 *   - UNDER_MARKET: price significantly below cluster median
 * 
 * Runs every 10-15 minutes via cron.
 */

const RECENCY_DAYS = 14;
const MIN_CLUSTER_SIZE = 3;
const CHEAPEST_MIN_SPREAD_DOLLARS = 1500;
const CHEAPEST_MIN_SPREAD_PCT = 3;
const UNDER_MARKET_THRESHOLD_PCT = 10;

// Year bands: group into 2-year windows
function yearBand(year: number | null): string {
  if (!year) return "unknown";
  const base = Math.floor(year / 2) * 2;
  return `${base}-${base + 1}`;
}

// KM bands: 0-50k, 50-100k, 100-150k, 150k+
function kmBand(km: number | null): string {
  if (!km || km <= 0) return "unknown";
  if (km < 50000) return "0-50k";
  if (km < 100000) return "50-100k";
  if (km < 150000) return "100-150k";
  return "150k+";
}

function clusterKey(make: string, model: string, yb: string, kb: string): string {
  return `${make.toUpperCase()}|${model.toUpperCase()}|${yb}|${kb}`;
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
    const recencyCutoff = new Date(Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Fetch active listings from market_listings
    const { data: listings, error } = await sb
      .from("market_listings")
      .select("id, make, model, variant_resolved, year, km, price, source, location, listing_url, lifecycle_status")
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
      return new Response(JSON.stringify({ status: "ok", flags_created: 0, message: "No active listings" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group into clusters
    const clusters = new Map<string, typeof listings>();
    for (const l of listings) {
      const key = clusterKey(l.make, l.model, yearBand(l.year), kmBand(l.km));
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(l);
    }

    console.log(`[market-scanner] ${clusters.size} clusters formed`);

    const flags: Array<{
      listing_id: string;
      listing_url: string | null;
      flag_type: string;
      confidence: number;
      price: number;
      price_gap: number;
      price_gap_pct: number;
      market_spread: number;
      cluster_key: string;
      cluster_size: number;
      make: string;
      model: string;
      variant: string | null;
      year: number | null;
      km: number | null;
      source: string;
      location: string | null;
      expires_at: string;
    }> = [];

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    for (const [key, cluster] of clusters) {
      if (cluster.length < MIN_CLUSTER_SIZE) continue;

      // Already sorted by price ascending
      const sorted = cluster.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
      const cheapest = sorted[0];
      const secondCheapest = sorted[1];

      // System B: CHEAPEST_IN_MARKET detection
      const spread = (secondCheapest.price ?? 0) - (cheapest.price ?? 0);
      const spreadPct = cheapest.price ? (spread / cheapest.price) * 100 : 0;

      if (spread >= CHEAPEST_MIN_SPREAD_DOLLARS || spreadPct >= CHEAPEST_MIN_SPREAD_PCT) {
        const confidence = Math.min(95, 50 + Math.round(spreadPct * 5) + (cluster.length >= 10 ? 15 : cluster.length >= 5 ? 10 : 0));
        flags.push({
          listing_id: cheapest.id,
          listing_url: cheapest.listing_url,
          flag_type: "CHEAPEST_IN_MARKET",
          confidence,
          price: cheapest.price!,
          price_gap: spread,
          price_gap_pct: Math.round(spreadPct * 10) / 10,
          market_spread: spread,
          cluster_key: key,
          cluster_size: cluster.length,
          make: cheapest.make,
          model: cheapest.model,
          variant: cheapest.variant_resolved,
          year: cheapest.year,
          km: cheapest.km,
          source: cheapest.source,
          location: cheapest.location,
          expires_at: expiresAt,
        });
      }

      // System A: UNDER_MARKET detection
      // Calculate median price for cluster
      const mid = Math.floor(sorted.length / 2);
      const medianPrice = sorted.length % 2 === 0
        ? ((sorted[mid - 1].price ?? 0) + (sorted[mid].price ?? 0)) / 2
        : (sorted[mid].price ?? 0);

      for (const l of sorted) {
        if (!l.price || l.price >= medianPrice) break; // only check below-median listings
        const delta = medianPrice - l.price;
        const deltaPct = (delta / medianPrice) * 100;

        if (deltaPct >= UNDER_MARKET_THRESHOLD_PCT) {
          const confidence = Math.min(95, 40 + Math.round(deltaPct * 2) + (cluster.length >= 10 ? 15 : cluster.length >= 5 ? 10 : 0));
          flags.push({
            listing_id: l.id,
            listing_url: l.listing_url,
            flag_type: "UNDER_MARKET",
            confidence,
            price: l.price,
            price_gap: Math.round(delta),
            price_gap_pct: Math.round(deltaPct * 10) / 10,
            market_spread: spread,
            cluster_key: key,
            cluster_size: cluster.length,
            make: l.make,
            model: l.model,
            variant: l.variant_resolved,
            year: l.year,
            km: l.km,
            source: l.source,
            location: l.location,
            expires_at: expiresAt,
          });
        }
      }
    }

    console.log(`[market-scanner] ${flags.length} deal flags detected`);

    // Upsert flags
    if (flags.length > 0) {
      // Delete expired flags first
      await sb.from("deal_flags").delete().lt("expires_at", new Date().toISOString());

      // Batch upsert in chunks of 50
      for (let i = 0; i < flags.length; i += 50) {
        const batch = flags.slice(i, i + 50);
        const { error: upsertError } = await sb
          .from("deal_flags")
          .upsert(batch, { onConflict: "listing_id,flag_type" });

        if (upsertError) {
          console.error(`[market-scanner] Upsert error (batch ${i}):`, upsertError.message);
        }
      }
    }

    const durationMs = Math.round(performance.now() - startMs);
    console.log(`[market-scanner] Complete in ${durationMs}ms — ${flags.length} flags upserted`);

    return new Response(JSON.stringify({
      status: "ok",
      clusters_analysed: clusters.size,
      flags_created: flags.length,
      cheapest_in_market: flags.filter(f => f.flag_type === "CHEAPEST_IN_MARKET").length,
      under_market: flags.filter(f => f.flag_type === "UNDER_MARKET").length,
      duration_ms: durationMs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[market-scanner] Error:", err);
    return new Response(JSON.stringify({ status: "error", error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
