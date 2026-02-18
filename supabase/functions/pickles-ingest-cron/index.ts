import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES INGEST CRON v5 — Structured Extract + Fingerprint Replication
 * 
 * 1. Scrape Buy Now search pages using Firecrawl EXTRACT mode (JSON schema)
 * 2. Upsert every listing into vehicle_listings
 * 3. Mark listings not seen for 48h as inactive
 * 4. Run fingerprint replication: match each priced listing to nearest historical sale
 * 5. Insert/update opportunities for under-market signals
 * 6. Log to cron_audit_log + cron_heartbeat
 * 
 * Schedule: Every 30 minutes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE = "pickles";
const SEARCH_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
const MAX_PAGES = 10;
const STALE_HOURS = 48;
const DAILY_CREDIT_LIMIT = 150;

const SALVAGE_RE = /salvage|write.?off|wovr|repairable|hail|insurance|damaged|statutory/i;

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ExtractedListing {
  title: string;
  price: number | null;
  kms: number | null;
  location: string | null;
  url: string;
}

interface ScrapedListing {
  lot_id: string;
  year: number;
  make: string;
  model: string;
  variant: string;
  listing_url: string;
  price: number;
  kms: number | null;
  location: string;
}

// ─── CREDIT GUARDRAIL ────────────────────────────────────────────────────────

async function getCreditUsedToday(sb: any): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await sb
    .from("cron_audit_log")
    .select("result")
    .eq("cron_name", "pickles-ingest-cron")
    .eq("run_date", today);
  
  let total = 0;
  for (const row of (data || [])) {
    total += (row.result as any)?.firecrawl_calls || 0;
  }
  return total;
}

// ─── EXTRACT SCHEMA ──────────────────────────────────────────────────────────

const LISTING_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Full vehicle title e.g. '2024 Toyota Hilux SR5 Auto 4x4'" },
          price: { type: "number", description: "Price in AUD dollars (number only, no $ sign). Null if not shown." },
          kms: { type: "number", description: "Odometer reading in km (number only). Null if not shown." },
          location: { type: "string", description: "Location/state e.g. 'NSW', 'VIC', 'QLD'" },
          url: { type: "string", description: "Full URL to the listing detail page on pickles.com.au" },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["listings"],
};

// ─── SEARCH PAGE SCRAPER (EXTRACT MODE) ──────────────────────────────────────

async function scrapeSearchPages(firecrawlKey: string): Promise<{ listings: ScrapedListing[]; pages_scraped: number; firecrawl_calls: number }> {
  const allListings: ScrapedListing[] = [];
  const seen = new Set<string>();
  let firecrawlCalls = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = SEARCH_URL + "&page=" + page;
    console.log(`[PICKLES] Extracting page ${page}`);

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + firecrawlKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: pageUrl,
        formats: ["json"],
        jsonOptions: { schema: LISTING_EXTRACT_SCHEMA },
        waitFor: 8000,
        onlyMainContent: false,
      }),
    });
    firecrawlCalls++;

    if (!resp.ok) {
      const status = resp.status;
      console.error(`[PICKLES] Firecrawl error page ${page}: ${status}`);
      if (status === 402) {
        console.error("[PICKLES] CREDIT EXHAUSTED — aborting");
        break;
      }
      break;
    }

    const data = await resp.json();
    const extracted: ExtractedListing[] = data?.data?.json?.listings || data?.json?.listings || [];

    if (extracted.length === 0) {
      console.log(`[PICKLES] No listings on page ${page}, stopping`);
      break;
    }

    let pageNew = 0;
    for (const item of extracted) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);

      // Extract lot_id and vehicle info from URL slug
      const slugMatch = item.url.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
      if (!slugMatch) continue;

      const year = parseInt(slugMatch[1]);
      if (year < 2008) continue;

      const make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
      const modelParts = slugMatch[3].split("-");
      const model = modelParts[0].charAt(0).toUpperCase() + modelParts[0].slice(1);
      const variant = modelParts.slice(1).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      const lotId = slugMatch[4];

      if (SALVAGE_RE.test(`${item.title || ""} ${make} ${model} ${variant}`)) continue;

      // Use extracted price (structured), fall back to 0
      let price = 0;
      if (item.price && item.price >= 2000 && item.price <= 300000) {
        price = item.price;
      }

      // Use extracted KMs
      let kms: number | null = null;
      if (item.kms && item.kms > 0 && item.kms < 999999) {
        kms = item.kms;
      }

      // Location from extraction or URL
      let location = "";
      if (item.location) {
        const locMatch = item.location.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
        if (locMatch) location = locMatch[1].toUpperCase();
      }

      allListings.push({
        lot_id: lotId,
        year, make, model, variant,
        listing_url: item.url,
        price, kms, location,
      });
      pageNew++;
    }

    console.log(`[PICKLES] Page ${page}: ${extracted.length} extracted, ${pageNew} new listings`);
    await new Promise(r => setTimeout(r, 1000));
  }

  return { listings: allListings, pages_scraped: Math.min(MAX_PAGES, allListings.length > 0 ? MAX_PAGES : 1), firecrawl_calls: firecrawlCalls };
}

// ─── UPSERT LISTINGS ─────────────────────────────────────────────────────────

async function upsertListings(sb: any, listings: ScrapedListing[]): Promise<{ newListings: number; updatedListings: number; errors: string[] }> {
  let newListings = 0;
  let updatedListings = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const l of listings) {
    const listingId = `pickles:${l.lot_id}`;

    const { data: existing } = await sb
      .from("vehicle_listings")
      .select("id, asking_price, status")
      .eq("listing_id", listingId)
      .eq("source", SOURCE)
      .maybeSingle();

    if (existing) {
      const updates: Record<string, any> = {
        last_seen_at: now,
        updated_at: now,
        status: "listed",
        missing_streak: 0,
      };
      if (l.price > 0 && l.price !== existing.asking_price) updates.asking_price = l.price;
      if (l.kms) updates.km = l.kms;
      if (l.location) updates.location = l.location;

      const { error } = await sb.from("vehicle_listings").update(updates).eq("id", existing.id);
      if (error) errors.push(`Update ${listingId}: ${error.message}`);
      else updatedListings++;
    } else {
      const { error } = await sb.from("vehicle_listings").insert({
        listing_id: listingId,
        lot_id: l.lot_id,
        source: SOURCE,
        auction_house: "pickles",
        make: l.make.toUpperCase(),
        model: l.model.toUpperCase(),
        variant_raw: l.variant || null,
        year: l.year,
        km: l.kms,
        asking_price: l.price > 0 ? l.price : null,
        listing_url: l.listing_url,
        location: l.location || null,
        status: "listed",
        first_seen_at: now,
        last_seen_at: now,
        updated_at: now,
        seller_type: "auction",
        source_class: "auction",
        lifecycle_state: "NEW",
      });
      if (error) errors.push(`Insert ${listingId}: ${error.message}`);
      else newListings++;
    }
  }

  return { newListings, updatedListings, errors };
}

// ─── MARK STALE ──────────────────────────────────────────────────────────────

async function markStaleInactive(sb: any): Promise<number> {
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - STALE_HOURS * 3600000).toISOString();
  const { data } = await sb
    .from("vehicle_listings")
    .update({ status: "inactive", updated_at: now })
    .eq("source", SOURCE)
    .eq("status", "listed")
    .lt("last_seen_at", staleThreshold)
    .select("id");
  return data?.length || 0;
}

// ─── FINGERPRINT REPLICATION ENGINE ──────────────────────────────────────────
// For each priced Pickles listing, find the nearest historical sale
// using weighted score (KM proximity + profit strength).
// Insert opportunity if under_buy meets threshold.

async function runFingerprintReplication(sb: any): Promise<{
  matched: number;
  opportunities_created: number;
  errors: string[];
}> {
  let matched = 0;
  let opportunitiesCreated = 0;
  const errors: string[] = [];

  // Get active Pickles listings WITH a price
  const { data: listings } = await sb
    .from("vehicle_listings")
    .select("id, listing_id, make, model, variant_raw, drivetrain, year, km, asking_price, listing_url, location")
    .eq("source", SOURCE)
    .in("status", ["listed", "catalogue"])
    .not("asking_price", "is", null)
    .gt("asking_price", 0);

  if (!listings || listings.length === 0) {
    console.log("[REPLICATION] No priced Pickles listings to replicate against");
    return { matched: 0, opportunities_created: 0, errors: [] };
  }

  console.log(`[REPLICATION] Running fingerprint match for ${listings.length} priced listings`);

  // Get all profitable sales (one query, filter in memory)
  const { data: allSales } = await sb
    .from("vehicle_sales_truth")
    .select("id, make, model, variant, badge, year, km, buy_price, sale_price, sold_at, drive_type")
    .not("buy_price", "is", null)
    .not("sale_price", "is", null);

  if (!allSales || allSales.length === 0) {
    console.log("[REPLICATION] No profitable sales in vehicle_sales_truth");
    return { matched: 0, opportunities_created: 0, errors: [] };
  }

  // Pre-filter to profitable sales
  const profitableSales = allSales.filter((s: any) => (s.sale_price - Number(s.buy_price)) > 0);
  console.log(`[REPLICATION] ${profitableSales.length} profitable sales loaded`);

  // Load trim ladder for upgrade matching
  const { data: trimLadder } = await sb
    .from("trim_ladder")
    .select("make, model, trim_class, trim_rank");

  const trimMap = new Map<string, Map<string, number>>();
  for (const t of (trimLadder || [])) {
    const key = `${t.make}:${t.model}`;
    if (!trimMap.has(key)) trimMap.set(key, new Map());
    trimMap.get(key)!.set(t.trim_class, t.trim_rank);
  }

  // Load derive_trim_class function results for listings and sales won't work directly
  // Instead, do simple variant-based trim matching

  for (const listing of listings) {
    const listingMake = (listing.make || "").toUpperCase();
    const listingModel = (listing.model || "").toUpperCase();
    const listingYear = listing.year;
    const listingKm = listing.km;
    const listingPrice = listing.asking_price;

    if (!listingYear || !listingKm || !listingPrice) continue;

    // Find matching sales: make exact, model exact, year ±2, km ±15k
    const candidates = profitableSales.filter((s: any) => {
      const saleMake = (s.make || "").toUpperCase();
      const saleModel = (s.model || "").toUpperCase();
      if (saleMake !== listingMake) return false;
      if (saleModel !== listingModel) return false;
      if (Math.abs(s.year - listingYear) > 2) return false;
      if (s.km && listingKm && Math.abs(s.km - listingKm) > 15000) return false;
      // Drivetrain check: if both have values, must match
      if (listing.drivetrain && s.drive_type) {
        const ld = listing.drivetrain.toUpperCase();
        const sd = s.drive_type.toUpperCase();
        if (ld !== sd) return false;
      }
      return true;
    });

    if (candidates.length === 0) continue;

    // Weighted score: lower is better
    // Normalize KM diff (0-1 where 0 = identical) and profit (higher = better)
    const scored = candidates.map((s: any) => {
      const kmDiff = (s.km && listingKm) ? Math.abs(s.km - listingKm) : 7500;
      const profit = s.sale_price - Number(s.buy_price);
      // KM proximity score: 0 = perfect, 1 = 15k away
      const kmScore = kmDiff / 15000;
      // Profit score: higher profit = better (normalized roughly)
      const profitScore = Math.min(profit / 20000, 1);
      // Combined: lower kmScore + higher profitScore = better
      // Weighted: 40% KM proximity, 60% profit strength
      const weightedScore = (kmScore * 0.4) - (profitScore * 0.6);
      return { sale: s, kmDiff, profit, weightedScore };
    });

    // Sort by weighted score ascending (best first)
    scored.sort((a, b) => a.weightedScore - b.weightedScore);
    const best = scored[0];

    const historicalBuy = Number(best.sale.buy_price);
    const historicalSale = best.sale.sale_price;
    const historicalProfit = best.profit;
    const underBuy = historicalBuy - listingPrice;

    matched++;

    // Determine priority level
    let priorityLevel: number | null = null;
    let confidenceTier = "IGNORE";

    if (underBuy >= 6000) {
      priorityLevel = 1;
      confidenceTier = "CODE_RED";
    } else if (underBuy >= 3000) {
      priorityLevel = 2;
      confidenceTier = "HIGH";
    } else if (underBuy >= 1500) {
      priorityLevel = 3;
      confidenceTier = "WATCH";
    }

    if (!priorityLevel) continue; // Below threshold, skip

    // Insert or update opportunity (manual check for idempotency)
    const stockId = listing.listing_id;
    const notes = `Matched sale: ${best.sale.year} ${best.sale.make} ${best.sale.model} | Bought: $${historicalBuy.toLocaleString()} | Sold: $${historicalSale.toLocaleString()} | Profit: $${historicalProfit.toLocaleString()} | KM diff: ${best.kmDiff.toLocaleString()} | Under buy: $${underBuy.toLocaleString()}`;

    const oppData = {
      source_type: "auction_replication",
      listing_url: listing.listing_url || "",
      stock_id: stockId,
      year: listingYear,
      make: listingMake,
      model: listingModel,
      variant: listing.variant_raw,
      kms: listingKm,
      location: listing.location,
      buy_price: listingPrice,
      dealer_median_price: historicalBuy,
      retail_median_price: historicalSale,
      median_profit: historicalProfit,
      deviation: underBuy,
      confidence_score: Math.abs(best.weightedScore),
      confidence_tier: confidenceTier,
      priority_level: priorityLevel,
      status: "new",
      notes,
      updated_at: new Date().toISOString(),
    };

    // Check if exists
    const { data: existingOpp } = await sb
      .from("opportunities")
      .select("id")
      .eq("stock_id", stockId)
      .eq("source_type", "auction_replication")
      .maybeSingle();

    let error;
    if (existingOpp) {
      ({ error } = await sb.from("opportunities").update(oppData).eq("id", existingOpp.id));
    } else {
      ({ error } = await sb.from("opportunities").insert(oppData));
    }

    if (error) {
      errors.push(`Opportunity ${stockId}: ${error.message}`);
    } else {
      opportunitiesCreated++;
    }
  }

  console.log(`[REPLICATION] Matched: ${matched}, Opportunities: ${opportunitiesCreated}, Errors: ${errors.length}`);
  return { matched, opportunities_created: opportunitiesCreated, errors };
}

// ─── SLACK ALARM ─────────────────────────────────────────────────────────────

async function sendSlackAlarmIfNeeded(sb: any, listingsFound: number) {
  if (listingsFound > 0) return;

  const { count } = await sb
    .from("vehicle_listings")
    .select("id", { count: "exact", head: true })
    .eq("source", SOURCE)
    .gte("last_seen_at", new Date(Date.now() - 24 * 3600000).toISOString());

  if ((count || 0) > 0) return;

  const wh = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!wh) return;

  const { data: lastOk } = await sb
    .from("cron_audit_log")
    .select("run_at")
    .eq("cron_name", "pickles-ingest-cron")
    .eq("success", true)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await fetch(wh, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `🚨 PICKLES INGESTION FAILURE\n0 listings updated in 24h.\nLast successful run: ${lastOk?.run_at || "NEVER"}\nCheck pickles-ingest-cron immediately.`,
    }),
  });
  console.log("[PICKLES] ⚠️ Slack alarm sent — 0 listings in 24h");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY not configured");

    // ── CREDIT GUARDRAIL ──
    const creditsUsed = await getCreditUsedToday(sb);
    if (creditsUsed >= DAILY_CREDIT_LIMIT) {
      console.log(`[PICKLES] Daily credit limit reached (${creditsUsed}/${DAILY_CREDIT_LIMIT}). Aborting.`);
      return new Response(JSON.stringify({
        success: true, skipped: true,
        reason: "daily_credit_limit",
        credits_used_today: creditsUsed,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── STEP 1: Scrape with structured extract ──
    const { listings, pages_scraped, firecrawl_calls } = await scrapeSearchPages(firecrawlKey);
    console.log(`[PICKLES] Scraped ${listings.length} listings from ${pages_scraped} pages`);

    // ── STEP 2: Upsert listings ──
    const { newListings, updatedListings, errors } = await upsertListings(sb, listings);
    console.log(`[PICKLES] Upserted: ${newListings} new, ${updatedListings} updated, ${errors.length} errors`);

    // ── STEP 3: Mark stale inactive ──
    const markedInactive = await markStaleInactive(sb);
    console.log(`[PICKLES] Marked ${markedInactive} stale listings inactive`);

    // ── STEP 4: Fingerprint replication ──
    const replication = await runFingerprintReplication(sb);

    // ── STEP 5: Audit logging ──
    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_found: listings.length,
      new_listings: newListings,
      updated_listings: updatedListings,
      marked_inactive: markedInactive,
      pages_scraped,
      firecrawl_calls,
      replication_matched: replication.matched,
      opportunities_created: replication.opportunities_created,
      runtime_ms: runtimeMs,
      errors: [...errors, ...replication.errors].slice(0, 10),
    };

    await sb.from("cron_audit_log").insert({
      cron_name: "pickles-ingest-cron",
      run_date: new Date().toISOString().split("T")[0],
      success: errors.length < listings.length / 2,
      result,
    });

    await sb.from("cron_heartbeat").upsert({
      cron_name: "pickles-ingest-cron",
      last_seen_at: new Date().toISOString(),
      last_ok: errors.length < listings.length / 2,
      note: `found=${listings.length} new=${newListings} updated=${updatedListings} inactive=${markedInactive} replicated=${replication.opportunities_created}`,
    }, { onConflict: "cron_name" });

    // ── STEP 6: Slack alarm ──
    await sendSlackAlarmIfNeeded(sb, listings.length);

    console.log(`[PICKLES] Run complete in ${runtimeMs}ms:`, result);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[PICKLES] Fatal error:", errorMsg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("cron_audit_log").insert({
        cron_name: "pickles-ingest-cron",
        run_date: new Date().toISOString().split("T")[0],
        success: false,
        error: errorMsg,
        result: { runtime_ms: Date.now() - startTime },
      });
      await sb.from("cron_heartbeat").upsert({
        cron_name: "pickles-ingest-cron",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `ERROR: ${errorMsg.substring(0, 100)}`,
      }, { onConflict: "cron_name" });
    } catch (_) { /* best-effort */ }

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
