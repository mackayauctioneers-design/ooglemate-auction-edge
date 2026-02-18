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
const MAX_PAGES = 5;
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

// ─── DERIVE TRIM CLASS (mirrors DB function) ────────────────────────────────

function deriveTrimClass(make: string, model: string, variant: string): string {
  const m = (make || "").toUpperCase().trim();
  const mo = (model || "").toUpperCase().trim();
  const v = (variant || "").toUpperCase();

  if (m === "TOYOTA" && mo === "LANDCRUISER") {
    if (v.includes("WORKMATE")) return "LC70_BASE";
    if (v.includes("GXL")) return "LC70_GXL";
    if (v.includes("GX")) return "LC70_GX";
    if (v.includes("VX")) return "LC70_VX";
    if (v.includes("SAHARA")) return "LC70_SAHARA";
    if (v.includes("70TH")) return "LC70_SPECIAL";
  }
  if (m === "TOYOTA" && mo === "LANDCRUISER 200") {
    if (v.includes("GXL")) return "LC200_GXL";
    if (v.includes("GX")) return "LC200_GX";
    if (v.includes("VX")) return "LC200_VX";
    if (v.includes("SAHARA")) return "LC200_SAHARA";
  }
  if (m === "TOYOTA" && mo === "LANDCRUISER 300") {
    if (v.includes("GXL")) return "LC300_GXL";
    if (v.includes("GX")) return "LC300_GX";
    if (v.includes("VX")) return "LC300_VX";
    if (v.includes("SAHARA")) return "LC300_SAHARA";
  }
  if (m === "TOYOTA" && mo.includes("PRADO")) {
    if (v.includes("GXL")) return "PRADO_GXL";
    if (v.includes("GX")) return "PRADO_GX";
    if (v.includes("VX")) return "PRADO_VX";
    if (v.includes("KAKADU")) return "PRADO_KAKADU";
  }
  if (m === "TOYOTA" && mo === "HILUX") {
    if (v.includes("SR5")) return "HILUX_SR5";
    if (v.includes("SR")) return "HILUX_SR";
    if (v.includes("ROGUE")) return "HILUX_ROGUE";
    if (v.includes("RUGGED")) return "HILUX_RUGGED";
    if (v.includes("WORKMATE")) return "HILUX_BASE";
  }
  if (m === "TOYOTA" && mo === "HIACE") {
    if (v.includes("COMMUTER")) return "HIACE_COMMUTER";
    if (v.includes("SLWB")) return "HIACE_SLWB";
    if (v.includes("LWB")) return "HIACE_LWB";
  }
  if (m === "FORD" && mo === "RANGER") {
    if (v.includes("RAPTOR")) return "RANGER_RAPTOR";
    if (v.includes("WILDTRAK")) return "RANGER_WILDTRAK";
    if (v.includes("XLT")) return "RANGER_XLT";
    if (v.includes("XLS")) return "RANGER_XLS";
    if (v.includes("XL")) return "RANGER_XL";
  }
  if (m === "FORD" && mo === "EVEREST") {
    if (v.includes("TITANIUM")) return "EVEREST_TITANIUM";
    if (v.includes("TREND")) return "EVEREST_TREND";
    if (v.includes("AMBIENTE")) return "EVEREST_AMBIENTE";
  }
  if (m === "ISUZU" && (mo === "D-MAX" || mo === "DMAX")) {
    if (v.includes("X-TERRAIN") || v.includes("XTERRAIN")) return "DMAX_XTERRAIN";
    if (v.includes("LS-U") || v.includes("LSU")) return "DMAX_LSU";
    if (v.includes("LS-M") || v.includes("LSM")) return "DMAX_LSM";
    if (v.includes("SX")) return "DMAX_SX";
  }
  if (m === "ISUZU" && (mo === "MU-X" || mo === "MUX")) {
    if (v.includes("LS-T") || v.includes("LST")) return "MUX_LST";
    if (v.includes("LS-U") || v.includes("LSU")) return "MUX_LSU";
    if (v.includes("LS-M") || v.includes("LSM")) return "MUX_LSM";
  }
  if (m === "MITSUBISHI" && mo === "TRITON") {
    if (v.includes("GLS")) return "TRITON_GLS";
    if (v.includes("GLX+") || v.includes("GLX PLUS")) return "TRITON_GLXPLUS";
    if (v.includes("GLX")) return "TRITON_GLX";
  }
  if (m === "NISSAN" && mo === "NAVARA") {
    if (v.includes("PRO-4X") || v.includes("PRO4X")) return "NAVARA_PRO4X";
    if (v.includes("ST-X") || v.includes("STX")) return "NAVARA_STX";
    if (v.includes("ST-L") || v.includes("STL")) return "NAVARA_STL";
    if (v.includes("ST")) return "NAVARA_ST";
    if (v.includes("SL")) return "NAVARA_SL";
  }
  if (m === "NISSAN" && mo === "PATROL") {
    if (v.includes("TI-L") || v.includes("TIL")) return "PATROL_TIL";
    if (v.includes("TI")) return "PATROL_TI";
  }
  return mo + "_STANDARD";
}

// ─── DRIVETRAIN BUCKET ───────────────────────────────────────────────────────

function drivetrainBucket(val: string | null): string {
  if (!val) return "UNKNOWN";
  const v = val.toUpperCase();
  if (/4X4|4WD|AWD/.test(v)) return "4X4";
  if (/2WD|2X4|FWD|RWD|4X2/.test(v)) return "2WD";
  return "UNKNOWN";
}

// ─── TRIM LADDER (one-step upgrade matching) ─────────────────────────────────

const TRIM_LADDER: Record<string, Record<string, number>> = {
  "TOYOTA:LANDCRUISER": { LC70_BASE: 1, LC70_GX: 2, LC70_GXL: 3, LC70_VX: 4, LC70_SAHARA: 5, LC70_SPECIAL: 6 },
  "TOYOTA:LANDCRUISER 200": { LC200_GX: 1, LC200_GXL: 2, LC200_VX: 3, LC200_SAHARA: 4 },
  "TOYOTA:LANDCRUISER 300": { LC300_GX: 1, LC300_GXL: 2, LC300_VX: 3, LC300_SAHARA: 4 },
  "TOYOTA:PRADO": { PRADO_GX: 1, PRADO_GXL: 2, PRADO_VX: 3, PRADO_KAKADU: 4 },
  "TOYOTA:HILUX": { HILUX_BASE: 1, HILUX_SR: 2, HILUX_SR5: 3, HILUX_ROGUE: 4, HILUX_RUGGED: 5 },
  "TOYOTA:HIACE": { HIACE_LWB: 1, HIACE_SLWB: 2, HIACE_COMMUTER: 3 },
  "FORD:RANGER": { RANGER_XL: 1, RANGER_XLS: 2, RANGER_XLT: 3, RANGER_WILDTRAK: 4, RANGER_RAPTOR: 5 },
  "FORD:EVEREST": { EVEREST_AMBIENTE: 1, EVEREST_TREND: 2, EVEREST_TITANIUM: 3 },
  "ISUZU:D-MAX": { DMAX_SX: 1, DMAX_LSM: 2, DMAX_LSU: 3, DMAX_XTERRAIN: 4 },
  "ISUZU:DMAX": { DMAX_SX: 1, DMAX_LSM: 2, DMAX_LSU: 3, DMAX_XTERRAIN: 4 },
  "ISUZU:MU-X": { MUX_LSM: 1, MUX_LSU: 2, MUX_LST: 3 },
  "ISUZU:MUX": { MUX_LSM: 1, MUX_LSU: 2, MUX_LST: 3 },
  "MITSUBISHI:TRITON": { TRITON_GLX: 1, TRITON_GLXPLUS: 2, TRITON_GLS: 3 },
  "NISSAN:NAVARA": { NAVARA_SL: 1, NAVARA_ST: 2, NAVARA_STL: 3, NAVARA_STX: 4, NAVARA_PRO4X: 5 },
  "NISSAN:PATROL": { PATROL_TI: 1, PATROL_TIL: 2 },
};

function trimAllowed(listingMake: string, listingModel: string, listingTrim: string, saleTrim: string): "EXACT" | "UPGRADE" | false {
  if (saleTrim === listingTrim) return "EXACT";
  const key = `${listingMake}:${listingModel}`;
  const ladder = TRIM_LADDER[key];
  if (!ladder) return false; // trim not in ladder → exact only, already failed
  const listingRank = ladder[listingTrim];
  const saleRank = ladder[saleTrim];
  if (listingRank == null || saleRank == null) return false;
  // Allow listing to be exactly one step ABOVE the sale (upgrade)
  if (listingRank === saleRank + 1) return "UPGRADE";
  return false; // downgrade or multi-step → rejected
}

// ─── FINGERPRINT REPLICATION ENGINE (STRICT MODE) ────────────────────────────
// For each priced Pickles listing, find the SINGLE nearest historical sale
// using strict filters + deterministic sort (year → km → recency).
// No medians. No clusters. No fuzzy scoring.
// Trim class: exact or one-step upgrade only (never downgrade).

async function runFingerprintReplication(sb: any): Promise<{
  matched: number;
  opportunities_created: number;
  slack_alerts: number;
  errors: string[];
}> {
  let matched = 0;
  let opportunitiesCreated = 0;
  let slackAlerts = 0;
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
    return { matched: 0, opportunities_created: 0, slack_alerts: 0, errors: [] };
  }

  console.log(`[REPLICATION] Running STRICT fingerprint match for ${listings.length} priced listings`);

  // Load all profitable sales (one query)
  const { data: allSales } = await sb
    .from("vehicle_sales_truth")
    .select("id, make, model, variant, badge, year, km, buy_price, sale_price, sold_at, drive_type")
    .not("buy_price", "is", null)
    .not("sale_price", "is", null);

  if (!allSales || allSales.length === 0) {
    console.log("[REPLICATION] No sales in vehicle_sales_truth");
    return { matched: 0, opportunities_created: 0, slack_alerts: 0, errors: [] };
  }

  const profitableSales = allSales.filter((s: any) => (s.sale_price - Number(s.buy_price)) > 0);
  console.log(`[REPLICATION] ${profitableSales.length} profitable sales loaded`);

  // Pre-compute trim classes for all sales
  const salesWithTrim = profitableSales.map((s: any) => ({
    ...s,
    _trim: deriveTrimClass(s.make, s.model, s.variant || s.badge || ""),
    _drive: drivetrainBucket(s.drive_type),
  }));

  const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL");

  for (const listing of listings) {
    const listingMake = (listing.make || "").toUpperCase();
    const listingModel = (listing.model || "").toUpperCase();
    const listingYear = listing.year;
    const listingKm = listing.km;
    const listingPrice = listing.asking_price;
    const listingTrim = deriveTrimClass(listing.make, listing.model, listing.variant_raw || "");
    const listingDrive = drivetrainBucket(listing.drivetrain);

    if (!listingYear || !listingKm || !listingPrice) continue;

    // STRICT FILTERS (with trim ladder: exact or one-step upgrade only)
    const candidates = salesWithTrim.filter((s: any) => {
      // Make exact
      if ((s.make || "").toUpperCase() !== listingMake) return false;
      // Model exact
      if ((s.model || "").toUpperCase() !== listingModel) return false;
      // Trim class: exact or one-step upgrade only (never downgrade)
      const trimResult = trimAllowed(listingMake, listingModel, listingTrim, s._trim);
      if (!trimResult) return false;
      // Year within ±1 (STRICT)
      if (Math.abs(s.year - listingYear) > 1) return false;
      // KM within ±15,000
      if (s.km && Math.abs(s.km - listingKm) > 15000) return false;
      // Drivetrain: 4x4 never matches 2wd
      if (listingDrive !== "UNKNOWN" && s._drive !== "UNKNOWN" && listingDrive !== s._drive) return false;
      return true;
    });

    if (candidates.length === 0) continue;

    // Sort: year diff ASC → km diff ASC → sold_at DESC (most recent)
    candidates.sort((a: any, b: any) => {
      const yearDiffA = Math.abs(a.year - listingYear);
      const yearDiffB = Math.abs(b.year - listingYear);
      if (yearDiffA !== yearDiffB) return yearDiffA - yearDiffB;
      const kmDiffA = a.km ? Math.abs(a.km - listingKm) : 99999;
      const kmDiffB = b.km ? Math.abs(b.km - listingKm) : 99999;
      if (kmDiffA !== kmDiffB) return kmDiffA - kmDiffB;
      // Most recent sold_at first
      const dateA = a.sold_at ? new Date(a.sold_at).getTime() : 0;
      const dateB = b.sold_at ? new Date(b.sold_at).getTime() : 0;
      return dateB - dateA;
    });

    const best = candidates[0];
    const historicalBuy = Number(best.buy_price);
    const historicalSale = best.sale_price;
    const expectedMargin = historicalSale - listingPrice;

    matched++;

    // SANITY: never flag a listing priced ABOVE what we sold it for
    if (listingPrice >= historicalSale) continue;

    // Only insert if margin >= $1,500
    if (expectedMargin < 1500) continue;

    let confidenceTier: string;
    let priorityLevel: number;
    // DB constraint allows only HIGH/MEDIUM/LOW — map our tiers accordingly
    if (expectedMargin >= 6000) { confidenceTier = "HIGH"; priorityLevel = 1; }
    else if (expectedMargin >= 4000) { confidenceTier = "HIGH"; priorityLevel = 2; }
    else { confidenceTier = "MEDIUM"; priorityLevel = 3; }

    const kmDiff = best.km ? Math.abs(best.km - listingKm) : null;
    const stockId = listing.listing_id;
    const notes = JSON.stringify({
      matched_sale_id: best.id,
      historical_buy_price: historicalBuy,
      historical_sell_price: historicalSale,
      historical_profit: historicalSale - historicalBuy,
      km_difference: kmDiff,
      expected_margin: expectedMargin,
      trim_class: listingTrim,
      drivetrain: listingDrive,
      sold_at: best.sold_at,
    });

    const oppData = {
      source_type: "replication",
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
      median_profit: expectedMargin,
      deviation: expectedMargin,
      confidence_score: expectedMargin,
      confidence_tier: confidenceTier,
      priority_level: priorityLevel,
      status: "new",
      notes,
      updated_at: new Date().toISOString(),
    };

    // Idempotent: check then insert/update
    const { data: existingOpp } = await sb
      .from("opportunities")
      .select("id")
      .eq("stock_id", stockId)
      .eq("source_type", "replication")
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
      console.log(`[REPLICATION] ${confidenceTier}: ${listingYear} ${listingMake} ${listingModel} ${listingTrim} — Ask $${listingPrice} vs Sold $${historicalSale} — Margin +$${expectedMargin}`);
    }

    // Slack alert for HIGH+ signals
    if (!error && expectedMargin >= 4000 && slackWebhook) {
      try {
        await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🔴 PICKLES FINGERPRINT MATCH\n${listingYear} ${listingMake} ${listingModel} ${listingTrim}\nAsk: $${listingPrice.toLocaleString()}\nLast Sold: $${historicalSale.toLocaleString()}\nLast Buy: $${historicalBuy.toLocaleString()}\nExpected Margin: +$${expectedMargin.toLocaleString()}\n${listing.listing_url || ""}`,
          }),
        });
        slackAlerts++;
      } catch (e) {
        console.error("[REPLICATION] Slack alert failed:", e);
      }
    }
  }

  console.log(`[REPLICATION] Matched: ${matched}, Opportunities: ${opportunitiesCreated}, Slack: ${slackAlerts}, Errors: ${errors.length}`);
  return { matched, opportunities_created: opportunitiesCreated, slack_alerts: slackAlerts, errors };
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
      slack_alerts: replication.slack_alerts,
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
