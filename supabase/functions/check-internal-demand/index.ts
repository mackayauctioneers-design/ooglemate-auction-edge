import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * check-internal-demand v2.1 — Auction-Priority + Structured Filters
 *
 * Search priority: Internal (auction first) → Outward → OpenClaw
 * Now filters on: series, body_type, variant, fuel, transmission, drivetrain, keywords
 * Source scoring: Auction +15, Dealer site +10, Classified +5
 */

const AUCTION_SOURCES = new Set([
  "pickles", "manheim", "grays", "slattery", "f3",
  "auto_auctions", "auto_auctions_aav", "uaa_nsw",
  "vma", "bidsonline", "pickles_crawl",
]);

const DEALER_SITE_SOURCES = new Set([
  "dealer_site", "dealer_website", "outward_search",
  "easyauto123", "toyota_used", "weststar",
]);

function sourceBonus(source: string | null): number {
  const s = (source || "").toLowerCase();
  if (AUCTION_SOURCES.has(s)) return 15;
  if (DEALER_SITE_SOURCES.has(s)) return 10;
  return 5;
}

function isAuctionSource(source: string | null, sourceClass: string | null, auctionHouse: string | null): boolean {
  return !!(auctionHouse || sourceClass === "auction" || AUCTION_SOURCES.has((source || "").toLowerCase()));
}

function listingHash(url: string | null, price: number | null, km: number | null): string {
  const u = (url || "").replace(/\?.*$/, "").toLowerCase();
  const p = price ? Math.round(price / 500) * 500 : 0;
  const k = km ? Math.round(km / 5000) * 5000 : 0;
  return `${u}|${p}|${k}`;
}

/** Token-boundary badge match (prevents GX matching GXL) */
function badgeMatchesVariant(badge: string, variant: string): boolean {
  const escaped = badge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[\\s\\-\\/,])${escaped}($|[\\s\\-\\/,+])`, "i");
  return re.test(variant);
}

function scoreListing(l: any, demand: any, patternMargin: number | undefined): { score: number; marginEstimate: number | null } {
  let score = 50;
  score += sourceBonus(l.source);

  // KM
  if (l.km && demand.km_max) {
    const r = l.km / demand.km_max;
    if (r <= 0.5) score += 15; else if (r <= 0.8) score += 10; else if (r <= 1.0) score += 5;
  }
  // Price
  if (l.asking_price && demand.price_max) {
    const r = l.asking_price / demand.price_max;
    if (r <= 0.8) score += 20; else if (r <= 0.95) score += 10; else if (r <= 1.0) score += 5;
  }
  // Year
  if (l.year && demand.year_min && demand.year_max) {
    const mid = (demand.year_min + demand.year_max) / 2;
    if (Math.abs(l.year - mid) <= 1) score += 10; else if (Math.abs(l.year - mid) <= 2) score += 5;
  } else if (l.year) { score += 5; }

  // Variant/badge match bonus
  if (demand.variant && l.variant_raw && badgeMatchesVariant(demand.variant, l.variant_raw)) {
    score += 10;
  }
  // Colour
  if (demand.colour && l.variant_raw?.toLowerCase().includes(demand.colour.toLowerCase())) {
    score += 5;
  }
  // Transmission match
  if (demand.transmission && l.transmission?.toLowerCase().includes(demand.transmission.toLowerCase())) {
    score += 5;
  }
  // Fuel match
  if (demand.fuel && l.fuel?.toLowerCase().includes(demand.fuel.toLowerCase())) {
    score += 5;
  }
  // Drivetrain match
  if (demand.drivetrain && l.drivetrain?.toLowerCase().includes(demand.drivetrain.toLowerCase())) {
    score += 5;
  }

  const price = l.asking_price ? Math.round(Number(l.asking_price)) : null;
  let marginEstimate: number | null = null;
  if (patternMargin) {
    marginEstimate = Math.round(patternMargin);
  } else if (price && demand.price_max) {
    marginEstimate = Math.max(0, Math.round((demand.price_max - price) * 0.6));
  }

  return { score: Math.min(score, 100), marginEstimate };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { demand_id } = await req.json();
    if (!demand_id) {
      return new Response(JSON.stringify({ error: "demand_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: demand, error: demandErr } = await sb
      .from("dealer_demands").select("*").eq("id", demand_id).single();

    if (demandErr || !demand) {
      return new Response(JSON.stringify({ error: "Demand not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[check-demand] Searching: ${demand.make} ${demand.model} ${demand.series || ""} ${demand.variant || ""} (${demand.dealer_name})`);

    // ── Margin patterns ──
    let marginMap = new Map<string, number>();
    try {
      const { data: patterns } = await sb
        .from("dealer_profit_patterns")
        .select("make, model, median_profit")
        .ilike("make", `%${demand.make}%`)
        .ilike("model", `%${demand.model}%`)
        .limit(10);
      if (patterns) {
        for (const p of patterns) {
          if (p.median_profit) marginMap.set(`${p.make}|${p.model}`, Number(p.median_profit));
        }
      }
    } catch { /* non-critical */ }

    const patternMargin = marginMap.get(`${demand.make}|${demand.model}`);

    // ══════════════════════════════════════════════════════
    // PHASE 1: Internal DB — structured filters
    // ══════════════════════════════════════════════════════

    // 14-day recency gate — prevents stale/sold auction lots from surfacing
    const recencyCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    let query = sb
      .from("vehicle_listings")
      .select("id, listing_id, make, model, year, km, asking_price, state, variant_raw, listing_url, source, source_class, auction_house, transmission, fuel, drivetrain, last_seen_at")
      .in("status", ["listed", "catalogue"])
      .gte("last_seen_at", recencyCutoff)
      .ilike("make", `%${demand.make}%`)
      .ilike("model", `%${demand.model}%`);

    // Structured filters — allow NULLs through for auction listings (no set price/km)
    if (demand.km_max) query = query.or(`km.lte.${demand.km_max},km.is.null`);
    if (demand.price_max) query = query.or(`asking_price.lte.${demand.price_max},asking_price.is.null`);
    if (demand.year_min) query = query.gte("year", demand.year_min);
    if (demand.year_max) query = query.lte("year", demand.year_max);
    if (demand.fuel) query = query.ilike("fuel", `%${demand.fuel}%`);
    if (demand.transmission) query = query.ilike("transmission", `%${demand.transmission}%`);
    if (demand.drivetrain) query = query.ilike("drivetrain", `%${demand.drivetrain}%`);

    // Auction-only filter
    if (demand.auction_only) {
      query = query.in("source", Array.from(AUCTION_SOURCES));
    }

    // Pull a wide candidate pool — filtering happens post-query
    const { data: listings, error: listErr } = await query
      .order("asking_price", { ascending: true, nullsFirst: true }).limit(500);

    if (listErr) {
      console.error("[check-demand] Search error:", listErr);
      return new Response(JSON.stringify({ error: listErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Partition by source priority: auction (3) → dealer (2) → classified (1)
    const auctionListings: any[] = [];
    const dealerListings: any[] = [];
    const classifiedListings: any[] = [];
    for (const l of listings || []) {
      if (isAuctionSource(l.source, l.source_class, l.auction_house)) {
        auctionListings.push(l);
      } else if (DEALER_SITE_SOURCES.has((l.source || "").toLowerCase())) {
        dealerListings.push(l);
      } else {
        classifiedListings.push(l);
      }
    }
    // Source-priority ordering: auctions first, then dealers, then classifieds
    const sorted = [...auctionListings, ...dealerListings, ...classifiedListings];

    console.log(`[check-demand] Candidates pulled: ${sorted.length} | Auction: ${auctionListings.length} | Dealer: ${dealerListings.length} | Classified: ${classifiedListings.length}`);

    // ── Post-query filters (series, variant, body_type, keywords) ──
    const filtered = sorted.filter(l => {
      const v = (l.variant_raw || "").toLowerCase();

      // Series filter — smart matching for known series aliases
      if (demand.series) {
        const series = demand.series.toLowerCase();
        const modelStr = (l.model || "").toLowerCase();
        const listingUrl = (l.listing_url || "").toLowerCase();

        // LandCruiser 70-series special handling: "79", "76", "78" all map to "70 series"
        const is70Series = ["70", "76", "78", "79"].includes(series) &&
          modelStr.includes("landcruiser");

        if (is70Series) {
          const found70 = v.includes("70") || v.includes(series) ||
            modelStr.includes("70") || modelStr.includes(series) ||
            listingUrl.includes("70-series") || listingUrl.includes(`-${series}`) ||
            listingUrl.includes(series);
          if (!found70) return false;
        } else {
          if (!v.includes(series) && !modelStr.includes(series) && !listingUrl.includes(series)) {
            return false;
          }
        }
      }
      // Variant/badge strict match
      if (demand.variant) {
        if (!l.variant_raw || !badgeMatchesVariant(demand.variant, l.variant_raw)) {
          return false;
        }
      }
      // Body type
      if (demand.body_type) {
        const bt = demand.body_type.replace("_", " ").toLowerCase();
        if (!v.includes(bt)) return false;
      }
      // Keywords (all terms must appear in variant_raw or model)
      if (demand.keywords) {
        const terms = demand.keywords.toLowerCase().split(/\s+/).filter(Boolean);
        const haystack = `${l.make} ${l.model} ${l.variant_raw || ""} ${l.state || ""}`.toLowerCase();
        if (!terms.every(t => haystack.includes(t))) return false;
      }
      return true;
    });

    // Count filtered by source type for diagnostics
    const filteredAuction = filtered.filter(l => isAuctionSource(l.source, l.source_class, l.auction_house)).length;
    const filteredDealer = filtered.filter(l => DEALER_SITE_SOURCES.has((l.source || "").toLowerCase())).length;
    const filteredClassified = filtered.length - filteredAuction - filteredDealer;

    console.log(`[check-demand] After filters: ${filtered.length} | Auction: ${filteredAuction} | Dealer: ${filteredDealer} | Classified: ${filteredClassified}`);

    // ── Score, rank, and cap at top 50 ──
    const allScored: any[] = [];
    for (const l of filtered) {
      const { score, marginEstimate } = scoreListing(l, demand, patternMargin);
      const price = l.asking_price ? Math.round(Number(l.asking_price)) : null;

      allScored.push({
        demand_id,
        source: l.source || "internal",
        make: l.make, model: l.model, year: l.year, km: l.km,
        price, colour: null, location: l.state,
        listing_url: l.listing_url, listing_id: l.id,
        listing_hash: listingHash(l.listing_url, price, l.km),
        margin_estimate: marginEstimate,
        score, status: "new",
      });
    }

    // Sort by score descending, then take top 50
    allScored.sort((a, b) => b.score - a.score);
    const opps = allScored.slice(0, 50);

    console.log(`[check-demand] Scored: ${allScored.length} | Returning top: ${opps.length}`);

    // Insert
    let inserted = 0;
    if (opps.length > 0) {
      const { error: insErr } = await sb
        .from("demand_opportunities")
        .upsert(opps, { onConflict: "demand_id,listing_url", ignoreDuplicates: true });
      if (insErr) console.error("[check-demand] Insert error:", insErr.message);
      else inserted = opps.length;
    }

    await sb.from("dealer_demands").update({
      matches_found: inserted,
      last_searched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", demand_id);

    // Slack alert
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");
    // Only alert on listings with a known price — priceless auction lots are stored but not alerted
    const topMatches = opps.filter(o => o.score >= 70 && o.price != null && o.price > 0).slice(0, 5);
    const auctionCount = filtered.filter(l => isAuctionSource(l.source, l.source_class, l.auction_house)).length;

    if (slackWebhook && topMatches.length > 0) {
      const lines = topMatches.map(m => {
        const isAuc = AUCTION_SOURCES.has((m.source || "").toLowerCase());
        return `• ${isAuc ? "🔨" : "🏷️"} ${m.year || "?"} ${m.make} ${m.model} — ${m.km ? m.km.toLocaleString() + "km" : "?"} — $${m.price ? m.price.toLocaleString() : "?"} — ${m.location || "?"}${m.margin_estimate ? ` (~$${m.margin_estimate.toLocaleString()} margin)` : ""}\n  ${m.listing_url || ""}`;
      }).join("\n");

      try {
        await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🚨 *Demand Match: ${demand.dealer_name}*\n_${demand.make} ${demand.model}${demand.series ? " " + demand.series : ""}${demand.variant ? " " + demand.variant : ""}${demand.fuel ? " " + demand.fuel : ""}${demand.colour ? " " + demand.colour : ""}_\n\n${lines}\n\n${topMatches.length} of ${inserted} matches (${auctionCount} auction)`,
          }),
        });
      } catch (e) { console.warn("[check-demand] Slack failed:", e); }
    }

    // ══════════════════════════════════════════════════════
    // PHASE 2+: Outward search if < 3
    // ══════════════════════════════════════════════════════

    let outwardResults = 0;
    let openclawResults = 0;

    if (inserted < 3) {
      console.log(`[check-demand] < 3 internal (${inserted}), triggering outward`);

      const sbUrl = Deno.env.get("SUPABASE_URL")!;
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      try {
        const instruction = [
          demand.year_min || demand.year_max ? `${demand.year_min || ""}${demand.year_min && demand.year_max ? "-" : ""}${demand.year_max || ""}` : "",
          demand.make, demand.model, demand.series, demand.variant,
          demand.body_type?.replace("_", " "),
          demand.engine, demand.fuel, demand.transmission,
          demand.colour,
          demand.km_max ? `under ${demand.km_max}km` : "",
          demand.price_max ? `under $${demand.price_max}` : "",
          demand.keywords,
          "Australia",
        ].filter(Boolean).join(" ");

        const outwardResp = await fetch(`${sbUrl}/functions/v1/run-outward-search-v2`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${sbKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, full_market_scan: true, is_operator: true }),
        });

        if (outwardResp.ok) {
          const outwardData = await outwardResp.json();
          const results = outwardData.results || [];

          const outwardOpps = results.map((r: any) => {
            const src = r.source || "outward_search";
            const bonus = AUCTION_SOURCES.has(src.toLowerCase()) ? 15 : DEALER_SITE_SOURCES.has(src.toLowerCase()) ? 10 : 5;
            return {
              demand_id, source: src,
              make: r.make || demand.make, model: r.model || demand.model,
              year: r.year, km: r.km || r.odometer,
              price: r.price || r.asking_price,
              colour: r.colour || r.color || null,
              location: r.location || r.state || null,
              listing_url: r.listing_url || r.url || null,
              score: Math.min((r.score || 50) + bonus, 100),
              status: "new",
            };
          }).filter((o: any) => o.listing_url);

          if (outwardOpps.length > 0) {
            const { error: outErr } = await sb
              .from("demand_opportunities")
              .upsert(outwardOpps, { onConflict: "demand_id,listing_url", ignoreDuplicates: true });
            if (!outErr) outwardResults = outwardOpps.length;
          }
        } else {
          console.warn(`[check-demand] Outward error ${outwardResp.status}`);
        }
      } catch (e) { console.warn("[check-demand] Outward failed:", e); }

      // OpenClaw — skip low urgency
      const openclawKey = Deno.env.get("OPENCLAW_API_KEY");
      if (openclawKey && (inserted + outwardResults) < 3 && demand.urgency !== "low") {
        try {
          const searchQuery = [
            demand.make, demand.model, demand.series, demand.variant,
            demand.fuel, demand.engine, demand.colour,
            demand.km_max ? `under ${demand.km_max}km` : "", "Australia",
          ].filter(Boolean).join(" ");

          const resp = await fetch("https://api.openclaw.ai/run", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openclawKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchQuery }),
          });

          if (resp.ok) {
            const result = await resp.json();
            const clawListings = result.listings || result.results || result.data || [];
            const clawOpps = clawListings.map((cl: any) => ({
              demand_id, source: "openclaw",
              make: cl.make || demand.make, model: cl.model || demand.model,
              year: cl.year, km: cl.km || cl.odometer,
              price: cl.price || cl.asking_price,
              colour: cl.colour || cl.color, location: cl.location || cl.state,
              listing_url: cl.url || cl.listing_url, score: 65, status: "new",
            })).filter((o: any) => o.listing_url);

            if (clawOpps.length > 0) {
              const { error: clawErr } = await sb
                .from("demand_opportunities")
                .upsert(clawOpps, { onConflict: "demand_id,listing_url", ignoreDuplicates: true });
              if (!clawErr) openclawResults = clawOpps.length;
            }
          }
        } catch (e) { console.warn("[check-demand] OpenClaw failed:", e); }
      }
    }

    const totalMatches = inserted + outwardResults + openclawResults;
    await sb.from("dealer_demands").update({
      matches_found: totalMatches,
      last_searched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", demand_id);

    return new Response(JSON.stringify({
      success: true, demand_id,
      internal_matches: inserted,
      internal_auction: auctionCount,
      outward_matches: outwardResults,
      openclaw_matches: openclawResults,
      total: totalMatches,
      slack_alerted: topMatches.length > 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[check-demand] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
