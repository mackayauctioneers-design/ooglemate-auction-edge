import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * check-internal-demand v2.0 — Auction-Priority Search Pipeline
 *
 * Search priority order:
 *   1. Internal listings (auction sources first)
 *   2. Auction feeds (Pickles, Manheim, Grays, Slattery)
 *   3. Dealer website inventory (outward search)
 *   4. Classified marketplaces (Carsales, Gumtree, FB)
 *   5. OpenClaw recon (last resort)
 *
 * Source scoring bonuses:
 *   Auction listing: +15 score
 *   Dealer website:  +10 score
 *   Classified:       +5 score
 */

// ── Auction source identifiers ──
const AUCTION_SOURCES = new Set([
  "pickles", "manheim", "grays", "slattery", "f3",
  "auto_auctions", "auto_auctions_aav", "uaa_nsw",
  "vma", "bidsonline", "pickles_crawl",
]);

const DEALER_SITE_SOURCES = new Set([
  "dealer_site", "dealer_website", "outward_search",
  "easyauto123", "toyota_used", "weststar",
]);

// ── Source score bonus ──
function sourceBonus(source: string | null): number {
  const s = (source || "").toLowerCase();
  if (AUCTION_SOURCES.has(s)) return 15;
  if (DEALER_SITE_SOURCES.has(s)) return 10;
  return 5; // classified / unknown
}

// ── Source priority for sorting (lower = higher priority) ──
function sourcePriority(source: string | null, sourceClass: string | null, auctionHouse: string | null): number {
  if (auctionHouse || sourceClass === "auction" || AUCTION_SOURCES.has((source || "").toLowerCase())) return 1;
  if (DEALER_SITE_SOURCES.has((source || "").toLowerCase())) return 2;
  return 3; // classified
}

// ── Listing hash for cross-demand dedup ──
function listingHash(url: string | null, price: number | null, km: number | null): string {
  const u = (url || "").replace(/\?.*$/, "").toLowerCase();
  const p = price ? Math.round(price / 500) * 500 : 0;
  const k = km ? Math.round(km / 5000) * 5000 : 0;
  return `${u}|${p}|${k}`;
}

// ── Score a listing against demand ──
function scoreListing(
  l: any,
  demand: any,
  patternMargin: number | undefined,
): { score: number; marginEstimate: number | null } {
  let score = 50; // Base: make+model match

  // Source bonus (auction priority)
  score += sourceBonus(l.source);

  // KM scoring
  if (l.km && demand.km_max) {
    const kmPct = l.km / demand.km_max;
    if (kmPct <= 0.5) score += 15;
    else if (kmPct <= 0.8) score += 10;
    else if (kmPct <= 1.0) score += 5;
  }

  // Price scoring
  if (l.asking_price && demand.price_max) {
    const pricePct = l.asking_price / demand.price_max;
    if (pricePct <= 0.8) score += 20;
    else if (pricePct <= 0.95) score += 10;
    else if (pricePct <= 1.0) score += 5;
  }

  // Year match
  if (l.year) {
    if (demand.year_min && demand.year_max) {
      const midYear = (demand.year_min + demand.year_max) / 2;
      if (Math.abs(l.year - midYear) <= 1) score += 10;
      else if (Math.abs(l.year - midYear) <= 2) score += 5;
    } else {
      score += 5;
    }
  }

  // Colour match
  if (demand.colour && l.variant_raw) {
    if (l.variant_raw.toLowerCase().includes(demand.colour.toLowerCase())) {
      score += 5;
    }
  }

  // Margin estimate
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
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load demand
    const { data: demand, error: demandErr } = await sb
      .from("dealer_demands")
      .select("*")
      .eq("id", demand_id)
      .single();

    if (demandErr || !demand) {
      return new Response(JSON.stringify({ error: "Demand not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[check-demand] Searching for: ${demand.make} ${demand.model} (${demand.dealer_name})`);

    // ── Load margin patterns ──
    let marginMap: Map<string, number> = new Map();
    try {
      const { data: patterns } = await sb
        .from("dealer_profit_patterns")
        .select("make, model, median_profit, median_sell_price")
        .ilike("make", `%${demand.make}%`)
        .ilike("model", `%${demand.model}%`)
        .limit(10);
      if (patterns) {
        for (const p of patterns) {
          if (p.median_profit) marginMap.set(`${p.make}|${p.model}`, Number(p.median_profit));
        }
      }
    } catch { /* non-critical */ }

    const marginKey = `${demand.make}|${demand.model}`;
    const patternMargin = marginMap.get(marginKey);

    // ══════════════════════════════════════════════════════════
    // PHASE 1: Internal DB — Auction sources first, then rest
    // ══════════════════════════════════════════════════════════

    let baseQuery = sb
      .from("vehicle_listings")
      .select("id, listing_id, make, model, year, km, asking_price, state, variant_raw, listing_url, source, source_class, auction_house, first_seen_at, transmission, fuel, drivetrain")
      .in("status", ["listed", "catalogue"])
      .ilike("make", `%${demand.make}%`)
      .ilike("model", `%${demand.model}%`);

    if (demand.km_max) baseQuery = baseQuery.lte("km", demand.km_max);
    if (demand.price_max) baseQuery = baseQuery.lte("asking_price", demand.price_max);
    if (demand.year_min) baseQuery = baseQuery.gte("year", demand.year_min);
    if (demand.year_max) baseQuery = baseQuery.lte("year", demand.year_max);

    const { data: listings, error: listErr } = await baseQuery
      .order("asking_price", { ascending: true })
      .limit(50);

    if (listErr) {
      console.error("[check-demand] Listing search error:", listErr);
      return new Response(JSON.stringify({ error: listErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Partition into auction vs non-auction, auction first
    const auctionListings: any[] = [];
    const otherListings: any[] = [];
    for (const l of listings || []) {
      const sp = sourcePriority(l.source, l.source_class, l.auction_house);
      if (sp === 1) auctionListings.push(l);
      else otherListings.push(l);
    }

    const sortedListings = [...auctionListings, ...otherListings];

    console.log(`[check-demand] Found ${sortedListings.length} internal matches (${auctionListings.length} auction, ${otherListings.length} other)`);

    // ── Score and build opportunities ──
    const opps: any[] = [];
    for (const l of sortedListings) {
      const { score, marginEstimate } = scoreListing(l, demand, patternMargin);
      const price = l.asking_price ? Math.round(Number(l.asking_price)) : null;

      opps.push({
        demand_id,
        source: l.source || "internal",
        make: l.make,
        model: l.model,
        year: l.year,
        km: l.km,
        price,
        colour: null,
        location: l.state,
        listing_url: l.listing_url,
        listing_id: l.id,
        listing_hash: listingHash(l.listing_url, price, l.km),
        margin_estimate: marginEstimate,
        score,
        status: "new",
      });
    }

    // ── Insert opportunities ──
    let inserted = 0;
    if (opps.length > 0) {
      const { error: insErr } = await sb
        .from("demand_opportunities")
        .upsert(opps, { onConflict: "demand_id,listing_url", ignoreDuplicates: true });
      if (insErr) {
        console.error("[check-demand] Insert error:", insErr.message);
      } else {
        inserted = opps.length;
      }
    }

    // Update demand record
    await sb.from("dealer_demands").update({
      matches_found: inserted,
      last_searched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", demand_id);

    // ── Slack alert for top matches (auction matches highlighted) ──
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");
    const topMatches = opps.filter(o => o.score >= 70).slice(0, 5);

    if (slackWebhook && topMatches.length > 0) {
      const lines = topMatches.map(m => {
        const isAuction = AUCTION_SOURCES.has((m.source || "").toLowerCase());
        const tag = isAuction ? "🔨 AUCTION" : "🏷️";
        return `• ${tag} ${m.year || "?"} ${m.make} ${m.model} — ${m.km ? m.km.toLocaleString() + "km" : "?"} — $${m.price ? m.price.toLocaleString() : "?"} — ${m.location || "?"}\n  ${m.listing_url || ""}`;
      }).join("\n");

      try {
        await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🚨 *Demand Match: ${demand.dealer_name}*\n_${demand.make} ${demand.model}${demand.engine ? " " + demand.engine : ""}${demand.colour ? " " + demand.colour : ""}_\n\n${lines}\n\n${topMatches.length} of ${inserted} total matches (${auctionListings.length} from auction)`,
          }),
        });
        console.log("[check-demand] Slack alert sent");
      } catch (e) {
        console.warn("[check-demand] Slack alert failed:", e);
      }
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 2+: Outward search fallback if < 3 internal matches
    // ══════════════════════════════════════════════════════════

    let outwardResults = 0;
    let openclawResults = 0;

    if (inserted < 3) {
      console.log(`[check-demand] < 3 internal matches (${inserted}), triggering outward recon`);

      const sbUrl = Deno.env.get("SUPABASE_URL")!;
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Phase 2A: run-outward-search-v2 (dealer inventory + discovery)
      try {
        const instruction = [
          demand.year_min || demand.year_max ? `${demand.year_min || ""}${demand.year_min && demand.year_max ? "-" : ""}${demand.year_max || ""}` : "",
          demand.make,
          demand.model,
          demand.engine,
          demand.colour,
          demand.km_max ? `under ${demand.km_max}km` : "",
          demand.price_max ? `under $${demand.price_max}` : "",
          "Australia",
        ].filter(Boolean).join(" ");

        console.log(`[check-demand] Outward search instruction: "${instruction}"`);

        const outwardResp = await fetch(`${sbUrl}/functions/v1/run-outward-search-v2`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${sbKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            instruction,
            full_market_scan: true,
            is_operator: true,
          }),
        });

        if (outwardResp.ok) {
          const outwardData = await outwardResp.json();
          const results = outwardData.results || [];
          console.log(`[check-demand] Outward search returned ${results.length} results`);

          const outwardOpps = results.map((r: any) => {
            const src = r.source || "outward_search";
            const isAuc = AUCTION_SOURCES.has(src.toLowerCase()) || r.source_class === "auction";
            const bonus = isAuc ? 15 : DEALER_SITE_SOURCES.has(src.toLowerCase()) ? 10 : 5;

            return {
              demand_id,
              source: src,
              make: r.make || demand.make,
              model: r.model || demand.model,
              year: r.year,
              km: r.km || r.odometer,
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
          const errText = await outwardResp.text();
          console.warn(`[check-demand] Outward search error ${outwardResp.status}: ${errText}`);
        }
      } catch (e) {
        console.warn("[check-demand] Outward search call failed:", e);
      }

      // Phase 2B: OpenClaw recon — skip for low-urgency demands
      const openclawKey = Deno.env.get("OPENCLAW_API_KEY");
      if (openclawKey && (inserted + outwardResults) < 3 && demand.urgency !== "low") {
        console.log("[check-demand] Still < 3 matches, triggering OpenClaw recon");
        try {
          const searchQuery = [
            demand.make, demand.model, demand.engine, demand.colour,
            demand.km_max ? `under ${demand.km_max}km` : "", "Australia",
          ].filter(Boolean).join(" ");

          const resp = await fetch("https://api.openclaw.ai/run", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openclawKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: searchQuery }),
          });

          if (resp.ok) {
            const result = await resp.json();
            const clawListings = result.listings || result.results || result.data || [];

            const clawOpps = clawListings.map((cl: any) => ({
              demand_id,
              source: "openclaw",
              make: cl.make || demand.make,
              model: cl.model || demand.model,
              year: cl.year,
              km: cl.km || cl.odometer,
              price: cl.price || cl.asking_price,
              colour: cl.colour || cl.color,
              location: cl.location || cl.state,
              listing_url: cl.url || cl.listing_url,
              score: 60 + 5, // classified-level bonus
              status: "new",
            })).filter((o: any) => o.listing_url);

            if (clawOpps.length > 0) {
              const { error: clawErr } = await sb
                .from("demand_opportunities")
                .upsert(clawOpps, { onConflict: "demand_id,listing_url", ignoreDuplicates: true });
              if (!clawErr) openclawResults = clawOpps.length;
            }
            console.log(`[check-demand] OpenClaw returned ${clawOpps.length} results`);
          } else {
            const errText = await resp.text();
            console.warn(`[check-demand] OpenClaw error ${resp.status}: ${errText}`);
          }
        } catch (e) {
          console.warn("[check-demand] OpenClaw call failed:", e);
        }
      }
    }

    // Update demand with total match count
    const totalMatches = inserted + outwardResults + openclawResults;
    await sb.from("dealer_demands").update({
      matches_found: totalMatches,
      last_searched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", demand_id);

    return new Response(JSON.stringify({
      success: true,
      demand_id,
      internal_matches: inserted,
      internal_auction: auctionListings.length,
      outward_matches: outwardResults,
      openclaw_matches: openclawResults,
      total: totalMatches,
      slack_alerted: topMatches.length > 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[check-demand] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
