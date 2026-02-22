import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeVehicleIdentity } from "../_shared/taxonomy/normalizeVehicleIdentity.ts";
import { createTaxonomyDeps } from "../_shared/taxonomy/taxonomyRepo.ts";

/**
 * SLATTERY CRAWL - Firecrawl-based crawler for slatteryauctions.com.au
 * 
 * Scrapes the motor vehicles category page using Firecrawl markdown mode,
 * parses structured card data, normalizes via taxonomy, and upserts to vehicle_listings.
 * 
 * Replaces the previous Apify Playwright actor approach.
 * 
 * Endpoint: POST /slattery-crawl
 * Auth: Authorization header (anon key or service role)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_YEAR = 2016;
const BASE_URL = "https://slatteryauctions.com.au";
const CATEGORY_URL = `${BASE_URL}/category-groups/motor-vehicles`;

interface ParsedListing {
  asset_id: string;
  auction_id: string;
  detail_url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  transmission: string | null;
  fuel: string | null;
  drivetrain: string | null;
  km: number | null;
  current_bid: number | null;
  location: string | null;
  state: string | null;
  lot_number: number | null;
}

/**
 * Parse a single listing card block from markdown
 */
function parseListingBlock(block: string): ParsedListing | null {
  // Extract asset URL: /assets/{id}?auctionId={auctionId}
  const urlMatch = block.match(/\(https:\/\/slatteryauctions\.com\.au\/assets\/(\d+)\?auctionId=(\d+)\)/);
  if (!urlMatch) return null;

  const asset_id = urlMatch[1];
  const auction_id = urlMatch[2];
  const detail_url = `${BASE_URL}/assets/${asset_id}?auctionId=${auction_id}`;

  // Extract title: "2024 Toyota Camry SX Hybrid-Petrol"
  // Pattern: Year Make Model Variant Fuel in the text block after "Lot No."
  const titleMatch = block.match(/(\d{4}\s+[A-Z][a-zA-Z]+\s+[A-Za-z0-9][\w\s*-]*?)\\{0,2}\n/);
  const title = titleMatch ? titleMatch[1].replace(/\\\\/g, '').replace(/\*\*/g, '').trim() : '';

  // Year/Make/Model from title
  const ymmMatch = title.match(/^(\d{4})\s+(\S+)\s+(.+)/);
  let year: number | null = null;
  let make: string | null = null;
  let modelRaw: string | null = null;
  let variant_raw: string | null = null;

  if (ymmMatch) {
    year = parseInt(ymmMatch[1], 10);
    make = ymmMatch[2].toUpperCase();
    // Model is everything after make, before fuel/defence markers
    const rest = ymmMatch[3]
      .replace(/\*\*Ex Defence\*\*/gi, '')
      .replace(/\b(Hybrid-Petrol|Petrol|Diesel|Electric|Hybrid)\b/gi, '')
      .trim();
    const parts = rest.split(/\s+/);
    modelRaw = parts[0] || null;
    variant_raw = parts.length > 1 ? parts.slice(1).join(' ').trim() || null : null;
  }

  // Transmission
  let transmission: string | null = null;
  if (/Continuously Variable/i.test(block)) transmission = 'CVT';
  else if (/Sports?\s*Automatic/i.test(block)) transmission = 'automatic';
  else if (/\bAutomatic\b/i.test(block)) transmission = 'automatic';
  else if (/\bManual\b/i.test(block)) transmission = 'manual';

  // Fuel
  let fuel: string | null = null;
  if (/Hybrid-Petrol/i.test(block)) fuel = 'hybrid';
  else if (/\bDiesel\b/i.test(block)) fuel = 'diesel';
  else if (/\bPetrol\b/i.test(block)) fuel = 'petrol';
  else if (/\bElectric\b/i.test(block)) fuel = 'electric';
  else if (/\bHybrid\b/i.test(block)) fuel = 'hybrid';

  // Drivetrain
  let drivetrain: string | null = null;
  if (/Front Wheel Drive/i.test(block)) drivetrain = 'FWD';
  else if (/Rear Wheel Drive/i.test(block)) drivetrain = 'RWD';
  else if (/All Wheel Drive|AWD|4WD|4x4/i.test(block)) drivetrain = '4WD';

  // KMs
  const kmMatch = block.match(/([\d,]+)\s*KMs?\s*Showing/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : null;

  // Current bid
  const bidMatch = block.match(/\$([0-9,]+)/);
  const current_bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;

  // Location
  const locMatch = block.match(/Location(.+?)\\?\n/);
  const locationRaw = locMatch ? locMatch[1].replace(/\\+$/, '').trim() : null;

  // State
  let state: string | null = null;
  const stateMatch = (locationRaw || '').match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/);
  if (stateMatch) state = stateMatch[1];

  // Lot number
  const lotMatch = block.match(/Lot No\.?\s*(\d+)/);
  const lot_number = lotMatch ? parseInt(lotMatch[1], 10) : null;

  return {
    asset_id,
    auction_id,
    detail_url,
    title,
    year,
    make,
    model: modelRaw,
    variant_raw,
    transmission,
    fuel,
    drivetrain,
    km,
    current_bid,
    location: locationRaw,
    state,
    lot_number,
  };
}

/**
 * Parse all listing blocks from Slattery markdown
 */
function parseSlatteryMarkdown(markdown: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  // Split on asset URL blocks - each listing card links to /assets/{id}
  // We split by "Lot No." which starts each card's text section
  const blocks = markdown.split(/(?=\[Lot No\.)/);

  for (const block of blocks) {
    const parsed = parseListingBlock(block);
    if (parsed && parsed.asset_id) {
      listings.push(parsed);
    }
  }

  return listings;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

  if (!firecrawlKey) {
    return new Response(
      JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json().catch(() => ({})); } catch { /* empty */ }
  const debug = body.debug === true;
  const dryRun = body.dry_run === true;

  const metrics = {
    pages_fetched: 0,
    raw_listings: 0,
    valid_listings: 0,
    year_filtered: 0,
    upserted: 0,
    stubs_created: 0,
    errors: [] as string[],
    duration_ms: 0,
  };

  try {
    // ── STEP 1: Fetch category page via Firecrawl ──
    console.log("[SLATTERY-CRAWL] Fetching category page via Firecrawl...");

    const fcResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: CATEGORY_URL,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 5000, // wait for JS rendering
      }),
    });

    if (!fcResponse.ok) {
      const errText = await fcResponse.text();
      throw new Error(`Firecrawl error ${fcResponse.status}: ${errText}`);
    }

    const fcData = await fcResponse.json();
    const markdown = fcData?.data?.markdown || fcData?.markdown || "";
    metrics.pages_fetched = 1;

    if (!markdown) {
      throw new Error("Empty markdown from Firecrawl");
    }

    console.log(`[SLATTERY-CRAWL] Got ${markdown.length} chars of markdown`);

    // ── STEP 2: Parse listings from markdown ──
    const allListings = parseSlatteryMarkdown(markdown);
    metrics.raw_listings = allListings.length;
    console.log(`[SLATTERY-CRAWL] Parsed ${allListings.length} raw listings`);

    // ── STEP 3: Filter by year ──
    const validListings = allListings.filter(l => {
      if (!l.year || l.year < MIN_YEAR) {
        metrics.year_filtered++;
        return false;
      }
      return true;
    });
    metrics.valid_listings = validListings.length;
    console.log(`[SLATTERY-CRAWL] ${validListings.length} valid (year >= ${MIN_YEAR}), filtered out ${metrics.year_filtered}`);

    if (dryRun) {
      metrics.duration_ms = Date.now() - startTime;
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          metrics,
          sample: validListings.slice(0, 5),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 4: Normalize and upsert ──
    const taxonomyDeps = createTaxonomyDeps(supabase);

    for (const listing of validListings) {
      try {
        // Normalize via taxonomy
        let makeNorm = listing.make;
        let modelNorm = listing.model;
        let variantFamily: string | null = null;

        try {
          const normResult = await normalizeVehicleIdentity(taxonomyDeps, {
            makeRaw: listing.make || "",
            modelRaw: listing.model || "",
            year: listing.year,
            km: listing.km,
            title: listing.title,
            source: "slattery",
          });
          if (normResult.make) makeNorm = normResult.make;
          if (normResult.model) modelNorm = normResult.model;
          if (normResult.variantFamily) variantFamily = normResult.variantFamily;
        } catch (normErr) {
          console.warn(`[SLATTERY-CRAWL] Normalization failed for ${listing.title}:`, normErr);
        }

        const listingId = `slattery:${listing.asset_id}`;

        // Upsert to vehicle_listings
        const { error: upsertError } = await supabase
          .from("vehicle_listings")
          .upsert({
            listing_id: listingId,
            source: "slattery",
            listing_url: listing.detail_url,
            make: makeNorm,
            model: modelNorm,
            year: listing.year,
            variant_raw: listing.variant_raw || listing.title,
            variant_family: variantFamily,
            km: listing.km,
            asking_price: listing.current_bid,
            fuel: listing.fuel,
            transmission: listing.transmission,
            drivetrain: listing.drivetrain,
            location: listing.location,
            state: listing.state,
            auction_house: "slattery",
            status: "active",
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }, {
            onConflict: "listing_id,source",
            ignoreDuplicates: false,
          });

        if (upsertError) {
          metrics.errors.push(`Upsert error ${listing.asset_id}: ${upsertError.message}`);
          continue;
        }
        metrics.upserted++;

        // Also create stub anchor for hunt matching
        const stubPayload = [{
          source_stock_id: listing.asset_id,
          detail_url: listing.detail_url,
          year: listing.year,
          make_raw: makeNorm,
          model_raw: modelNorm,
          location: listing.location,
          raw_text: listing.title,
        }];

        const { error: stubError } = await supabase.rpc("upsert_stub_anchor_batch", {
          p_source: "slattery",
          p_stubs: stubPayload,
        });

        if (stubError) {
          console.warn(`[SLATTERY-CRAWL] Stub error for ${listing.asset_id}:`, stubError.message);
        } else {
          metrics.stubs_created++;
        }

      } catch (itemErr) {
        metrics.errors.push(`Item error ${listing.asset_id}: ${itemErr instanceof Error ? itemErr.message : String(itemErr)}`);
      }
    }

    metrics.duration_ms = Date.now() - startTime;
    console.log(`[SLATTERY-CRAWL] Done in ${metrics.duration_ms}ms:`, JSON.stringify(metrics));

    // ── Log to cron_audit_log ──
    await supabase.from("cron_audit_log").insert({
      cron_name: "slattery-crawl",
      run_date: new Date().toISOString().slice(0, 10),
      success: metrics.errors.length === 0,
      error: metrics.errors.length > 0 ? metrics.errors.join("; ").slice(0, 500) : null,
      result: metrics,
    });

    return new Response(
      JSON.stringify({ success: true, metrics }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    metrics.duration_ms = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[SLATTERY-CRAWL] Fatal error:", errMsg);

    // Log failure
    await supabase.from("cron_audit_log").insert({
      cron_name: "slattery-crawl",
      run_date: new Date().toISOString().slice(0, 10),
      success: false,
      error: errMsg.slice(0, 500),
      result: metrics,
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: false, error: errMsg, metrics }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
