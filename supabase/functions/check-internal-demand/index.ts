import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * check-internal-demand v1.0
 *
 * Given a demand_id, searches vehicle_listings for matches,
 * scores them, inserts into demand_opportunities, and optionally
 * falls back to OpenClaw if < 3 internal matches found.
 * Sends Slack alert for any high-scoring matches.
 */

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

    // ── Internal search against vehicle_listings ──
    let query = sb
      .from("vehicle_listings")
      .select("id, listing_id, make, model, year, km, asking_price, state, variant_raw, listing_url, source, first_seen_at, transmission, fuel, drivetrain")
      .in("status", ["listed", "catalogue"])
      .ilike("make", `%${demand.make}%`)
      .ilike("model", `%${demand.model}%`);

    if (demand.km_max) query = query.lte("km", demand.km_max);
    if (demand.price_max) query = query.lte("asking_price", demand.price_max);
    if (demand.year_min) query = query.gte("year", demand.year_min);
    if (demand.year_max) query = query.lte("year", demand.year_max);

    const { data: listings, error: listErr } = await query.order("asking_price", { ascending: true }).limit(50);

    if (listErr) {
      console.error("[check-demand] Listing search error:", listErr);
      return new Response(JSON.stringify({ error: listErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[check-demand] Found ${listings?.length || 0} internal matches`);

    // ── Helper: listing hash for cross-demand dedup ──
    function listingHash(url: string | null, price: number | null, km: number | null): string {
      const u = (url || "").replace(/\?.*$/, "").toLowerCase();
      const p = price ? Math.round(price / 500) * 500 : 0;
      const k = km ? Math.round(km / 5000) * 5000 : 0;
      return `${u}|${p}|${k}`;
    }

    // ── Helper: estimate margin from dealer_profit_patterns ──
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

    // ── Score and insert opportunities ──
    const opps: any[] = [];
    for (const l of listings || []) {
      let score = 50; // Base: make+model match

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

      // Colour match (if specified)
      if (demand.colour && l.variant_raw) {
        if (l.variant_raw.toLowerCase().includes(demand.colour.toLowerCase())) {
          score += 5;
        }
      }

      const price = l.asking_price ? Math.round(Number(l.asking_price)) : null;
      const marginKey = `${l.make}|${l.model}`;
      const patternMargin = marginMap.get(marginKey);
      let marginEstimate: number | null = null;
      if (patternMargin) {
        marginEstimate = Math.round(patternMargin);
      } else if (price && demand.price_max) {
        // Rough estimate: budget headroom
        marginEstimate = Math.max(0, Math.round((demand.price_max - price) * 0.6));
      }

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
        score: Math.min(score, 100),
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

    // ── Slack alert for top matches ──
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");
    const topMatches = opps.filter(o => o.score >= 70).slice(0, 5);

    if (slackWebhook && topMatches.length > 0) {
      const lines = topMatches.map(m =>
        `• ${m.year || "?"} ${m.make} ${m.model} — ${m.km ? m.km.toLocaleString() + "km" : "?"} — $${m.price ? m.price.toLocaleString() : "?"} — ${m.location || "?"}\n  ${m.listing_url || ""}`
      ).join("\n");

      try {
        await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🚨 *Demand Match: ${demand.dealer_name}*\n_${demand.make} ${demand.model}${demand.engine ? " " + demand.engine : ""}${demand.colour ? " " + demand.colour : ""}_\n\n${lines}\n\n${topMatches.length} of ${inserted} total matches`,
          }),
        });
        console.log("[check-demand] Slack alert sent");
      } catch (e) {
        console.warn("[check-demand] Slack alert failed:", e);
      }
    }

    // ── Outward search fallback if < 3 internal matches ──
    let outwardResults = 0;
    let openclawResults = 0;

    if (inserted < 3) {
      console.log(`[check-demand] < 3 internal matches (${inserted}), triggering outward recon`);

      // Phase A: Trigger run-outward-search-v2 (internal DB + Lindy discovery)
      const sbUrl = Deno.env.get("SUPABASE_URL")!;
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

          const outwardOpps = results.map((r: any) => ({
            demand_id,
            source: r.source || "outward_search",
            make: r.make || demand.make,
            model: r.model || demand.model,
            year: r.year,
            km: r.km || r.odometer,
            price: r.price || r.asking_price,
            colour: r.colour || r.color || null,
            location: r.location || r.state || null,
            listing_url: r.listing_url || r.url || null,
            score: r.score || 55,
            status: "new",
          })).filter((o: any) => o.listing_url);

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

      // Phase B: OpenClaw recon (supplementary)
      const openclawKey = Deno.env.get("OPENCLAW_API_KEY");
      if (openclawKey && (inserted + outwardResults) < 3) {
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
              score: 60,
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
