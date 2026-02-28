import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MORNING BRIEF — Daily auction buy list generator
 *
 * Runs at 6am AEST (20:00 UTC) every weekday.
 * Also callable on-demand via POST.
 *
 * What it does:
 *   1. Fetches all auction lots from vehicle_listings closing today or next business day
 *      (sale_close_at within next 24h, or Monday if run on Friday/weekend)
 *   2. Joins to operator_opportunities for scored lots (tier, margin, benchmark)
 *   3. Filters against active dealer_specs (make/model/year/km/drivetrain match)
 *   4. Flags WOVR, damage, no-reserve, condition issues
 *   5. Ranks by: tier score → expected margin → guide vs benchmark gap
 *   6. Upserts results into morning_brief_items table
 *   7. Optionally sends a Slack summary
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIER_SCORE: Record<string, number> = {
  CODE_RED: 100,
  HIGH: 80,
  BUY: 60,
  RETAIL_BUY: 70,
  AUCTION_WATCH: 40,
  WATCH: 20,
};

function tierScore(tier: string | null): number {
  return TIER_SCORE[tier || ""] ?? 0;
}

function nextBusinessDay(): { from: string; to: string; label: string } {
  const now = new Date();
  // Convert to AEST (UTC+10)
  const aest = new Date(now.getTime() + 10 * 60 * 60 * 1000);
  const day = aest.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  let hoursAhead = 24;
  let label = "today";

  if (day === 5) {
    // Friday — next business day is Monday (72h)
    hoursAhead = 72;
    label = "Monday";
  } else if (day === 6) {
    // Saturday — next business day is Monday (48h)
    hoursAhead = 48;
    label = "Monday";
  } else if (day === 0) {
    // Sunday — next business day is Monday (24h)
    hoursAhead = 24;
    label = "Monday";
  }

  const from = now.toISOString();
  const to = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000).toISOString();
  return { from, to, label };
}

function matchesSpec(
  listing: any,
  spec: any
): boolean {
  // Make match (case-insensitive)
  if (spec.make_norm && listing.make) {
    if (listing.make.toUpperCase() !== spec.make_norm.toUpperCase()) return false;
  } else if (spec.make && listing.make) {
    if (listing.make.toUpperCase() !== spec.make.toUpperCase()) return false;
  }

  // Model match (case-insensitive, partial ok)
  if (spec.model_norm && listing.model) {
    if (!listing.model.toUpperCase().includes(spec.model_norm.toUpperCase())) return false;
  } else if (spec.model && listing.model) {
    if (!listing.model.toUpperCase().includes(spec.model.toUpperCase())) return false;
  }

  // Year range
  if (spec.year_min && listing.year && listing.year < spec.year_min) return false;
  if (spec.year_max && listing.year && listing.year > spec.year_max) return false;

  // KM range
  if (spec.km_min && listing.km && listing.km < spec.km_min) return false;
  if (spec.km_max && listing.km && listing.km > spec.km_max) return false;

  // Hard max price
  if (spec.hard_max_price && listing.asking_price && listing.asking_price > spec.hard_max_price) return false;

  // Drivetrain
  if (spec.drive_allow && spec.drive_allow.length > 0 && listing.drivetrain) {
    const dt = listing.drivetrain.toUpperCase();
    const allowed = spec.drive_allow.map((d: string) => d.toUpperCase());
    if (!allowed.some((a: string) => dt.includes(a) || a.includes(dt))) return false;
  }

  // Fuel
  if (spec.fuel_allow && spec.fuel_allow.length > 0 && listing.fuel) {
    const f = listing.fuel.toLowerCase();
    const allowed = spec.fuel_allow.map((d: string) => d.toLowerCase());
    if (!allowed.includes(f)) return false;
  }

  // Transmission
  if (spec.trans_allow && spec.trans_allow.length > 0 && listing.transmission) {
    const t = listing.transmission.toLowerCase();
    const allowed = spec.trans_allow.map((d: string) => d.toLowerCase());
    if (!allowed.includes(t)) return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const startTime = Date.now();
  const { from, to, label } = nextBusinessDay();

  console.log(`[MORNING-BRIEF] Generating brief for ${label} — window: ${from} → ${to}`);

  try {
    // ── 1. Fetch auction lots closing in the window ──────────────────────────
    const { data: auctionLots, error: lotsError } = await sb
      .from("vehicle_listings")
      .select(`
        id, listing_id, make, model, year, km, variant_raw, variant_used,
        asking_price, guide_price, reserve_price, sold_price,
        buy_method, sale_status, sale_close_at, reserve_status,
        wovr_indicator, damage_noted, condition_notes, keys_present, starts_drives,
        fuel, transmission, drivetrain, location, state, source,
        listing_url, auction_house, platform_class, trim_class
      `)
      .in("source", ["pickles", "grays", "manheim", "slattery", "bidsonline"])
      .gte("sale_close_at", from)
      .lte("sale_close_at", to)
      .not("sale_status", "eq", "sold")
      .not("sale_status", "eq", "withdrawn")
      .order("sale_close_at", { ascending: true })
      .limit(500);

    if (lotsError) throw lotsError;

    console.log(`[MORNING-BRIEF] Found ${auctionLots?.length ?? 0} auction lots closing ${label}`);

    if (!auctionLots || auctionLots.length === 0) {
      // No enriched lots yet — fall back to unfiltered auction listings
      const { data: fallbackLots } = await sb
        .from("vehicle_listings")
        .select(`
          id, listing_id, make, model, year, km, variant_raw,
          asking_price, guide_price, buy_method, sale_close_at, sale_status,
          wovr_indicator, damage_noted, source, listing_url, auction_house
        `)
        .in("source", ["pickles", "grays", "manheim", "slattery", "bidsonline"])
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(200);

      console.log(`[MORNING-BRIEF] Fallback: ${fallbackLots?.length ?? 0} active auction lots (no sale_close_at filter)`);
    }

    const lots = auctionLots || [];

    // ── 2. Fetch scored opportunities for these listings ─────────────────────
    const listingIds = lots.map((l: any) => l.listing_id).filter(Boolean);
    let oppMap: Record<string, any> = {};

    if (listingIds.length > 0) {
      const { data: opps } = await sb
        .from("operator_opportunities")
        .select(`
          listing_id, tier, best_expected_margin, best_under_buy,
          best_account_name, retail_median, retail_median_confidence,
          retail_vs_ask_pct, anchor_sale_buy_price, anchor_sale_profit,
          auction_target_price, motivation_signal, margin_flag
        `)
        .in("listing_id", listingIds)
        .not("status", "in", '("ignored","expired","bought")')
        .order("best_expected_margin", { ascending: false });

      (opps || []).forEach((o: any) => {
        if (!oppMap[o.listing_id]) oppMap[o.listing_id] = o;
      });
    }

    // ── 3. Fetch active dealer specs ─────────────────────────────────────────
    const { data: specs } = await sb
      .from("dealer_specs")
      .select("*")
      .eq("enabled", true)
      .is("deleted_at", null);

    const activeSpecs = specs || [];
    console.log(`[MORNING-BRIEF] ${activeSpecs.length} active dealer specs`);

    // ── 4. Score and rank each lot ───────────────────────────────────────────
    interface BriefItem {
      listing_id: string;
      make: string;
      model: string;
      year: number | null;
      km: number | null;
      variant: string | null;
      asking_price: number | null;
      guide_price: number | null;
      reserve_price: number | null;
      buy_method: string | null;
      sale_close_at: string | null;
      sale_status: string | null;
      reserve_status: string | null;
      source: string;
      location: string | null;
      state: string | null;
      listing_url: string | null;
      auction_house: string | null;
      wovr_indicator: boolean | null;
      damage_noted: boolean | null;
      condition_notes: string[] | null;
      keys_present: boolean | null;
      starts_drives: boolean | null;
      fuel: string | null;
      transmission: string | null;
      drivetrain: string | null;
      // Scoring
      tier: string | null;
      expected_margin: number | null;
      under_buy: number | null;
      retail_median: number | null;
      retail_median_confidence: string | null;
      guide_vs_median_gap: number | null;
      auction_target_price: number | null;
      motivation_signal: string | null;
      margin_flag: string | null;
      matched_spec_names: string[];
      composite_score: number;
      brief_date: string;
    }

    const briefItems: BriefItem[] = [];

    for (const lot of lots) {
      const opp = oppMap[lot.listing_id];

      // Match against dealer specs
      const matchedSpecs = activeSpecs.filter((s: any) => matchesSpec(lot, s));
      const matchedSpecNames = matchedSpecs.map((s: any) => s.name);

      // Guide vs retail median gap (how much below market is the guide?)
      let guideVsMedianGap: number | null = null;
      if (opp?.retail_median && lot.guide_price) {
        guideVsMedianGap = opp.retail_median - lot.guide_price;
      } else if (opp?.retail_median && lot.asking_price) {
        guideVsMedianGap = opp.retail_median - lot.asking_price;
      }

      // Composite score: tier + margin + spec match bonus + no_reserve bonus + guide gap bonus
      let score = tierScore(opp?.tier);
      if (opp?.best_expected_margin) score += Math.min(opp.best_expected_margin / 500, 20);
      if (matchedSpecs.length > 0) score += 15; // spec match bonus
      if (lot.reserve_status === "no_reserve") score += 10;
      if (guideVsMedianGap && guideVsMedianGap > 5000) score += 10;
      if (lot.wovr_indicator) score -= 30; // WOVR penalty
      if (lot.damage_noted) score -= 10;
      if (!lot.starts_drives && lot.starts_drives !== null) score -= 20;

      briefItems.push({
        listing_id: lot.listing_id,
        make: lot.make,
        model: lot.model,
        year: lot.year,
        km: lot.km,
        variant: lot.variant_used || lot.variant_raw,
        asking_price: lot.asking_price,
        guide_price: lot.guide_price,
        reserve_price: lot.reserve_price,
        buy_method: lot.buy_method,
        sale_close_at: lot.sale_close_at,
        sale_status: lot.sale_status,
        reserve_status: lot.reserve_status,
        source: lot.source,
        location: lot.location,
        state: lot.state,
        listing_url: lot.listing_url,
        auction_house: lot.auction_house,
        wovr_indicator: lot.wovr_indicator,
        damage_noted: lot.damage_noted,
        condition_notes: lot.condition_notes,
        keys_present: lot.keys_present,
        starts_drives: lot.starts_drives,
        fuel: lot.fuel,
        transmission: lot.transmission,
        drivetrain: lot.drivetrain,
        tier: opp?.tier ?? null,
        expected_margin: opp?.best_expected_margin ?? null,
        under_buy: opp?.best_under_buy ?? null,
        retail_median: opp?.retail_median ?? null,
        retail_median_confidence: opp?.retail_median_confidence ?? null,
        guide_vs_median_gap: guideVsMedianGap,
        auction_target_price: opp?.auction_target_price ?? null,
        motivation_signal: opp?.motivation_signal ?? null,
        margin_flag: opp?.margin_flag ?? null,
        matched_spec_names: matchedSpecNames,
        composite_score: Math.round(score),
        brief_date: new Date().toISOString().split("T")[0],
      });
    }

    // Sort by composite score descending
    briefItems.sort((a, b) => b.composite_score - a.composite_score);

    console.log(`[MORNING-BRIEF] Scored ${briefItems.length} lots — top score: ${briefItems[0]?.composite_score ?? 0}`);

    // ── 5. Upsert into morning_brief_items ───────────────────────────────────
    if (briefItems.length > 0) {
      const { error: upsertError } = await sb
        .from("morning_brief_items" as any)
        .upsert(briefItems, { onConflict: "listing_id,brief_date" });

      if (upsertError) {
        console.warn("[MORNING-BRIEF] Upsert error (table may not exist yet):", upsertError.message);
      }
    }

    // ── 6. Slack summary ─────────────────────────────────────────────────────
    const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    if (slackUrl && briefItems.length > 0) {
      const topItems = briefItems.slice(0, 5);
      const codeRed = briefItems.filter(i => i.tier === "CODE_RED").length;
      const high = briefItems.filter(i => i.tier === "HIGH").length;
      const specMatched = briefItems.filter(i => i.matched_spec_names.length > 0).length;
      const noReserve = briefItems.filter(i => i.reserve_status === "no_reserve").length;

      const lines = [
        `*🦅 CarBitrage Morning Brief — ${label.charAt(0).toUpperCase() + label.slice(1)}*`,
        `${briefItems.length} auction lots closing ${label} | ${specMatched} match dealer specs | ${codeRed} CODE RED | ${high} HIGH | ${noReserve} no reserve`,
        "",
        "*Top 5 Targets:*",
        ...topItems.map((item, i) => {
          const price = item.guide_price
            ? `Guide $${(item.guide_price / 1000).toFixed(0)}k`
            : item.asking_price
            ? `Ask $${(item.asking_price / 1000).toFixed(0)}k`
            : "No price";
          const margin = item.expected_margin
            ? ` | Margin ~$${(item.expected_margin / 1000).toFixed(0)}k`
            : "";
          const flags = [
            item.wovr_indicator ? "⚠️ WOVR" : null,
            item.reserve_status === "no_reserve" ? "🟢 No Reserve" : null,
            item.tier === "CODE_RED" ? "🔴 CODE RED" : item.tier === "HIGH" ? "🟠 HIGH" : null,
          ].filter(Boolean).join(" ");
          const close = item.sale_close_at
            ? ` | Closes ${new Date(item.sale_close_at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: "Australia/Sydney" })} AEST`
            : "";
          return `${i + 1}. *${item.year ?? ""} ${item.make} ${item.model}* ${item.variant ? `(${item.variant})` : ""} — ${item.km ? `${(item.km / 1000).toFixed(0)}k km` : "km?"} — ${price}${margin}${close} ${flags}`;
        }),
        "",
        `<${Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "carbitrage.app") ?? "https://carbitrage.app"}/operator/morning-brief|View full brief →>`,
      ];

      await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lines.join("\n") }),
      });
    }

    // ── 7. Health heartbeat ──────────────────────────────────────────────────
    await sb.from("cron_heartbeat").upsert({
      cron_name: "morning-brief",
      last_run_at: new Date().toISOString(),
      last_run_status: "ok",
      last_run_meta: { lots: briefItems.length, runtime_ms: Date.now() - startTime },
    }, { onConflict: "cron_name" }).then(({ error: e }) => {
      if (e) console.warn("[MORNING-BRIEF] heartbeat write failed:", e.message);
    });

    await sb.from("cron_audit_log").insert({
      cron_name: "morning-brief",
      status: "ok",
      meta: {
        lots_total: briefItems.length,
        code_red: briefItems.filter(i => i.tier === "CODE_RED").length,
        high: briefItems.filter(i => i.tier === "HIGH").length,
        spec_matched: briefItems.filter(i => i.matched_spec_names.length > 0).length,
        no_reserve: briefItems.filter(i => i.reserve_status === "no_reserve").length,
        runtime_ms: Date.now() - startTime,
        brief_date: new Date().toISOString().split("T")[0],
        window_label: label,
      },
    }).then(({ error: e }) => {
      if (e) console.warn("[MORNING-BRIEF] audit log write failed:", e.message);
    });

    return new Response(
      JSON.stringify({
        success: true,
        lots: briefItems.length,
        brief_date: new Date().toISOString().split("T")[0],
        window_label: label,
        top_score: briefItems[0]?.composite_score ?? 0,
        code_red: briefItems.filter(i => i.tier === "CODE_RED").length,
        high: briefItems.filter(i => i.tier === "HIGH").length,
        spec_matched: briefItems.filter(i => i.matched_spec_names.length > 0).length,
        no_reserve: briefItems.filter(i => i.reserve_status === "no_reserve").length,
        runtime_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[MORNING-BRIEF] Error:", err.message);

    await sb.from("cron_audit_log").insert({
      cron_name: "morning-brief",
      status: "error",
      meta: { error: err.message, runtime_ms: Date.now() - startTime },
    }).then(({ error: e }) => {
      if (e) console.warn("[MORNING-BRIEF] audit log error write failed:", e.message);
    });

    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
