import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES INGEST CRON — Clean, reliable ingestion
 * 
 * Contract:
 * 1. Scrape Buy Now search pages (paginate until empty)
 * 2. Upsert every listing into vehicle_listings
 * 3. Mark listings not seen for 48h as inactive
 * 4. Log to cron_audit_log + cron_heartbeat
 * 5. No AI. No Grok. No detail scrapes unless new.
 * 
 * Schedule: Every 30 minutes
 * Credit budget: ~10-12 Firecrawl calls per run (search pages only)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE = "pickles";
const SEARCH_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
const MAX_PAGES = 10;
const STALE_HOURS = 48;
const DAILY_CREDIT_LIMIT = 150; // hard cap

const SALVAGE_RE = /salvage|write.?off|wovr|repairable|hail|insurance|damaged|statutory/i;

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

// ─── SEARCH PAGE SCRAPER ─────────────────────────────────────────────────────

async function scrapeSearchPages(firecrawlKey: string): Promise<{ listings: ScrapedListing[]; pages_scraped: number; firecrawl_calls: number }> {
  const allListings: ScrapedListing[] = [];
  const seen = new Set<string>();
  let firecrawlCalls = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = SEARCH_URL + "&page=" + page;
    console.log(`[PICKLES] Scraping page ${page}`);

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + firecrawlKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: pageUrl,
        formats: ["markdown"],
        waitFor: 5000,
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
    const md = data.data?.markdown || data.markdown || "";
    if (!md || md.length < 200) {
      console.log(`[PICKLES] Empty page ${page}, stopping`);
      break;
    }

    // Extract listing URLs from markdown
    const urls = md.match(/https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s)"]+/gi) || [];
    if (urls.length === 0) {
      console.log(`[PICKLES] No URLs on page ${page}, stopping`);
      break;
    }

    let pageNew = 0;
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);

      // Parse from URL slug: /2024-toyota-hilux-sr5/12345
      const slugMatch = url.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
      if (!slugMatch) continue;

      const year = parseInt(slugMatch[1]);
      if (year < 2008) continue;

      const make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
      const modelParts = slugMatch[3].split("-");
      const model = modelParts[0].charAt(0).toUpperCase() + modelParts[0].slice(1);
      const variant = modelParts.slice(1).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      const lotId = slugMatch[4];

      if (SALVAGE_RE.test(`${make} ${model} ${variant}`)) continue;

      // Try to extract price from markdown context near this URL
      const urlIdx = md.indexOf(url);
      const context = md.substring(Math.max(0, urlIdx - 300), Math.min(md.length, urlIdx + 300));
      let price = 0;
      const priceMatch = context.match(/\$\s*([\d,]+)/);
      if (priceMatch) {
        const v = parseInt(priceMatch[1].replace(/,/g, ""));
        if (v >= 2000 && v <= 300000) price = v;
      }

      // Try to extract KMs
      let kms: number | null = null;
      const kmMatch = context.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
      if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""));

      // Location
      let location = "";
      const locMatch = context.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
      if (locMatch) location = locMatch[1].toUpperCase();

      allListings.push({
        lot_id: lotId,
        year, make, model, variant,
        listing_url: url,
        price, kms, location,
      });
      pageNew++;
    }

    console.log(`[PICKLES] Page ${page}: ${urls.length} URLs, ${pageNew} new listings`);

    // Rate limit between pages
    await new Promise(r => setTimeout(r, 1000));
  }

  return { listings: allListings, pages_scraped: Math.min(MAX_PAGES, allListings.length > 0 ? MAX_PAGES : 1), firecrawl_calls: firecrawlCalls };
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
    if (!firecrawlKey) {
      throw new Error("FIRECRAWL_API_KEY not configured");
    }

    // ── CREDIT GUARDRAIL ──
    const creditsUsed = await getCreditUsedToday(sb);
    if (creditsUsed >= DAILY_CREDIT_LIMIT) {
      console.log(`[PICKLES] Daily credit limit reached (${creditsUsed}/${DAILY_CREDIT_LIMIT}). Aborting.`);
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: "daily_credit_limit",
        credits_used_today: creditsUsed,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── STEP 1: Scrape search pages ──
    const { listings, pages_scraped, firecrawl_calls } = await scrapeSearchPages(firecrawlKey);
    console.log(`[PICKLES] Scraped ${listings.length} listings from ${pages_scraped} pages`);

    // ── STEP 2: Upsert into vehicle_listings ──
    let newListings = 0;
    let updatedListings = 0;
    let errors: string[] = [];
    const now = new Date().toISOString();

    for (const l of listings) {
      const listingId = `pickles:${l.lot_id}`;

      // Check if exists
      const { data: existing } = await sb
        .from("vehicle_listings")
        .select("id, asking_price, status")
        .eq("listing_id", listingId)
        .eq("source", SOURCE)
        .maybeSingle();

      if (existing) {
        // Update: touch last_seen_at, update price if changed
        const updates: Record<string, any> = {
          last_seen_at: now,
          updated_at: now,
          status: "listed",
          missing_streak: 0,
        };
        if (l.price > 0 && l.price !== existing.asking_price) {
          updates.asking_price = l.price;
        }
        if (l.kms) updates.km = l.kms;
        if (l.location) updates.location = l.location;

        const { error } = await sb
          .from("vehicle_listings")
          .update(updates)
          .eq("id", existing.id);

        if (error) {
          errors.push(`Update ${listingId}: ${error.message}`);
        } else {
          updatedListings++;
        }
      } else {
        // Insert new listing
        const { error } = await sb
          .from("vehicle_listings")
          .insert({
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
            lifecycle_state: "active",
          });

        if (error) {
          errors.push(`Insert ${listingId}: ${error.message}`);
        } else {
          newListings++;
        }
      }
    }

    console.log(`[PICKLES] Upserted: ${newListings} new, ${updatedListings} updated, ${errors.length} errors`);

    // ── STEP 3: Mark stale listings inactive ──
    const staleThreshold = new Date(Date.now() - STALE_HOURS * 3600000).toISOString();
    const { data: staleResult } = await sb
      .from("vehicle_listings")
      .update({ status: "inactive", updated_at: now })
      .eq("source", SOURCE)
      .eq("status", "listed")
      .lt("last_seen_at", staleThreshold)
      .select("id");

    const markedInactive = staleResult?.length || 0;
    console.log(`[PICKLES] Marked ${markedInactive} stale listings inactive`);

    // ── STEP 4: Log to cron_audit_log + heartbeat ──
    const runtimeMs = Date.now() - startTime;
    const result = {
      listings_found: listings.length,
      new_listings: newListings,
      updated_listings: updatedListings,
      marked_inactive: markedInactive,
      pages_scraped,
      firecrawl_calls,
      runtime_ms: runtimeMs,
      errors: errors.slice(0, 10),
    };

    await sb.from("cron_audit_log").insert({
      cron_name: "pickles-ingest-cron",
      run_date: new Date().toISOString().split("T")[0],
      success: errors.length < listings.length / 2, // success if <50% errors
      result,
    });

    await sb.from("cron_heartbeat").upsert({
      cron_name: "pickles-ingest-cron",
      last_seen_at: now,
      last_ok: errors.length < listings.length / 2,
      note: `found=${listings.length} new=${newListings} updated=${updatedListings} inactive=${markedInactive}`,
    }, { onConflict: "cron_name" });

    // ── STEP 5: Ingestion alarm — if 0 listings seen in 24h, alert Slack ──
    if (listings.length === 0) {
      const { count } = await sb
        .from("vehicle_listings")
        .select("id", { count: "exact", head: true })
        .eq("source", SOURCE)
        .gte("last_seen_at", new Date(Date.now() - 24 * 3600000).toISOString());

      if ((count || 0) === 0) {
        const wh = Deno.env.get("SLACK_WEBHOOK_URL");
        if (wh) {
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
      }
    }

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
    } catch (_) { /* best-effort logging */ }

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
