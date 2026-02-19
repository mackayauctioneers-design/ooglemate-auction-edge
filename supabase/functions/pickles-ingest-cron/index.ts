import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES INGEST CRON v6 — Ingest Only (no replication)
 * 
 * 1. Scrape Buy Now search pages using Firecrawl EXTRACT mode (JSON schema)
 * 2. Upsert every listing into vehicle_listings
 * 3. Mark listings not seen for 48h as inactive
 * 4. Log to cron_audit_log + cron_heartbeat
 * 
 * Replication is handled separately by pickles-replication-cron.
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
  title_raw: string;
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

      const slugMatch = item.url.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
      if (!slugMatch) continue;

      const year = parseInt(slugMatch[1]);
      if (year < 2008) continue;

      const make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
      const modelParts = slugMatch[3].split("-");

      // ── Multi-word model detection (e.g. landcruiser-prado, pajero-sport, bt-50, d-max, mu-x) ──
      const MULTI_WORD_MODELS: Record<string, string[]> = {
        "landcruiser": ["prado"],
        "pajero": ["sport"],
        "bt": ["50"],
        "d": ["max"],
        "mu": ["x"],
        "cx": ["3", "5", "8", "9", "30", "50", "60"],
        "x": ["trail"],
        "rav": ["4"],
      };

      let modelWordCount = 1;
      const firstPart = modelParts[0].toLowerCase();
      if (MULTI_WORD_MODELS[firstPart] && modelParts.length > 1) {
        const nextPart = modelParts[1].toLowerCase();
        if (MULTI_WORD_MODELS[firstPart].includes(nextPart)) {
          modelWordCount = 2;
        }
      }

      const model = modelParts.slice(0, modelWordCount).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      const variant = modelParts.slice(modelWordCount).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      const lotId = slugMatch[4];

      if (SALVAGE_RE.test(`${item.title || ""} ${make} ${model} ${variant}`)) continue;

      // ── TITLE-BASED TRIM HINT ──
      const titleUpper = (item.title || "").toUpperCase();
      let trimHint: string | null = null;
      if (titleUpper.includes("EXCEED TOURER")) trimHint = "Exceed Tourer";
      else if (titleUpper.includes("EXCEED")) trimHint = "Exceed";
      else if (titleUpper.includes("ASPIRE")) trimHint = "Aspire";
      else if (titleUpper.includes("SR5")) trimHint = "SR5";
      else if (titleUpper.includes("ROGUE")) trimHint = "Rogue";
      else if (titleUpper.includes("RUGGED")) trimHint = "Rugged";
      else if (titleUpper.includes("RAPTOR")) trimHint = "Raptor";
      else if (titleUpper.includes("WILDTRAK")) trimHint = "Wildtrak";
      else if (titleUpper.includes("KAKADU")) trimHint = "Kakadu";
      else if (titleUpper.includes("SAHARA")) trimHint = "Sahara";
      else if (titleUpper.includes("X-TERRAIN")) trimHint = "X-Terrain";
      else if (titleUpper.includes("WORKMATE")) trimHint = "Workmate";
      else if (titleUpper.includes("GXL")) trimHint = "GXL";
      else if (titleUpper.includes("GX") && !titleUpper.includes("GXL")) trimHint = "GX";
      else if (titleUpper.includes("VX")) trimHint = "VX";
      else if (titleUpper.includes("XLT")) trimHint = "XLT";
      else if (titleUpper.includes("XLS")) trimHint = "XLS";
      else if (titleUpper.match(/\bXL\b/)) trimHint = "XL";
      else if (titleUpper.match(/\bSR\b/) && !titleUpper.includes("SR5")) trimHint = "SR";
      else if (titleUpper.match(/\bLS\b/) && !titleUpper.includes("LS-")) trimHint = "LS";
      else if (titleUpper.match(/\bES\b/)) trimHint = "ES";

      const finalVariant = trimHint || variant;

      let price = 0;
      if (item.price && item.price >= 2000 && item.price <= 300000) {
        price = item.price;
      }

      let kms: number | null = null;
      if (item.kms && item.kms > 0 && item.kms < 999999) {
        kms = item.kms;
      }

      let location = "";
      if (item.location) {
        const locMatch = item.location.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
        if (locMatch) location = locMatch[1].toUpperCase();
      }

      allListings.push({
        lot_id: lotId,
        year, make, model, variant: finalVariant,
        title_raw: item.title || "",
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

// ─── EXTRACT HELPERS ─────────────────────────────────────────────────────────

function extractBadgeFromDescription(descRaw: string | null): string {
  if (!descRaw) return "";
  const d = descRaw.toUpperCase();
  const badges = [
    "EXCEED TOURER", "EXCEED", "X-TERRAIN", "XTERRAIN", "PRO-4X", "PRO4X",
    "GLX-R", "GLX+", "GLX PLUS", "SR5", "ROGUE", "RUGGED X", "RUGGED-X", "RUGGED",
    "RAPTOR", "WILDTRAK", "KAKADU", "SAHARA", "ASPIRE", "TITANIUM", "PLATINUM",
    "GXL", "VX", "GX", "XLT", "XLS", "LS-U", "LSU", "LS-M", "LSM", "LS-T", "LST",
    "ST-X", "STX", "ST-L", "STL", "GLS", "GR", "N-TREK", "COMMUTER", "SLWB", "LWB",
    "WORKMATE", "AMBIENTE", "TREND",
  ];
  const shortBadges = ["SR", "XL", "LS", "ES", "SL", "ST", "TI", "LT", "LTZ", "Z71", "SS", "SSV", "SV6"];
  for (const b of badges) { if (d.includes(b)) return b; }
  for (const b of shortBadges) { if (new RegExp(`\\b${b}\\b`).test(d)) return b; }
  return "";
}

function extractDriveFromDescription(descRaw: string | null): string {
  if (!descRaw) return "UNKNOWN";
  const d = descRaw.toUpperCase();
  if (/\b4X4\b|\b4WD\b|\bAWD\b/.test(d)) return "4WD";
  if (/\b2WD\b|\b4X2\b|\bFWD\b|\bRWD\b/.test(d)) return "2WD";
  return "UNKNOWN";
}

// ─── LEMON-CHECK GATE ────────────────────────────────────────────────────────

async function lemonCheck(url: string): Promise<{ ok: boolean; reason: string }> {
  if (!url) return { ok: false, reason: "no_url" };
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CarOogleVerifier/1.0)",
        "accept": "text/html",
      },
    });
    if (resp.status === 404 || resp.status === 410) {
      return { ok: false, reason: `http_${resp.status}` };
    }
    // Check for redirect away from detail page
    const finalUrl = resp.url || url;
    if (!finalUrl.includes("/used/details/") && !finalUrl.includes("/used/item/")) {
      return { ok: false, reason: "redirect_away" };
    }
    if (resp.status >= 500) {
      // Server error — allow through, might be temporary
      return { ok: true, reason: "5xx_passthrough" };
    }
    return { ok: true, reason: "live" };
  } catch (_e) {
    // Network error — allow through to avoid false rejections
    return { ok: true, reason: "fetch_error_passthrough" };
  }
}

// ─── UPSERT LISTINGS ─────────────────────────────────────────────────────────

async function upsertListings(sb: any, listings: ScrapedListing[], runId: string): Promise<{ newListings: number; updatedListings: number; skippedNoPrice: number; skippedLemon: number; errors: string[] }> {
  let newListings = 0;
  let updatedListings = 0;
  let skippedNoPrice = 0;
  let skippedLemon = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const l of listings) {
    const listingId = `pickles:${l.lot_id}`;

    const { data: existing } = await sb
      .from("vehicle_listings")
      .select("id, asking_price, status, drivetrain, variant_raw")
      .eq("listing_id", listingId)
      .eq("source", SOURCE)
      .maybeSingle();

    if (existing) {
      const badgeFromTitle = l.variant || extractBadgeFromDescription(l.title_raw) || null;
      const driveFromTitle = extractDriveFromDescription(l.title_raw);

      const updates: Record<string, any> = {
        last_seen_at: now,
        updated_at: now,
        status: "listed",
        missing_streak: 0,
        last_ingest_run_id: runId,
      };
      if (l.price > 0 && l.price !== existing.asking_price) updates.asking_price = l.price;
      if (l.kms) updates.km = l.kms;
      if (l.location) updates.location = l.location;
      if (badgeFromTitle) {
        updates.variant_raw = badgeFromTitle;
        updates.variant_family = badgeFromTitle.toUpperCase();
      }
      if (driveFromTitle !== "UNKNOWN" && !existing.drivetrain) {
        updates.drivetrain = driveFromTitle === "4WD" ? "4x4" : "2WD";
      }

      const { error } = await sb.from("vehicle_listings").update(updates).eq("id", existing.id);
      if (error) errors.push(`Update ${listingId}: ${error.message}`);
      else updatedListings++;
    } else {
      // ── PRICE GATE: reject zero-price new inserts ──
      if (!l.price || l.price <= 0) {
        console.log(`[PICKLES] PRICE GATE: Skipping ${listingId} — no price`);
        skippedNoPrice++;
        continue;
      }

      // ── LEMON-CHECK GATE: validate URL is live before insert ──
      const lemon = await lemonCheck(l.listing_url);
      if (!lemon.ok) {
        console.log(`[PICKLES] LEMON GATE: Skipping ${listingId} — ${lemon.reason}`);
        skippedLemon++;
        continue;
      }

      const badgeFromTitle = l.variant || extractBadgeFromDescription(l.title_raw) || null;
      const driveFromTitle = extractDriveFromDescription(l.title_raw);

      const { error } = await sb.from("vehicle_listings").insert({
        listing_id: listingId,
        lot_id: l.lot_id,
        source: SOURCE,
        auction_house: "pickles",
        make: l.make.toUpperCase(),
        model: l.model.toUpperCase(),
        variant_raw: badgeFromTitle,
        variant_family: badgeFromTitle ? badgeFromTitle.toUpperCase() : null,
        drivetrain: driveFromTitle !== "UNKNOWN" ? (driveFromTitle === "4WD" ? "4x4" : "2WD") : null,
        year: l.year,
        km: l.kms,
        asking_price: l.price,
        listing_url: l.listing_url,
        location: l.location || null,
        status: "listed",
        first_seen_at: now,
        last_seen_at: now,
        updated_at: now,
        seller_type: "auction",
        source_class: "auction",
        lifecycle_state: "NEW",
        last_ingest_run_id: runId,
      });
      if (error) errors.push(`Insert ${listingId}: ${error.message}`);
      else newListings++;
    }
  }

  return { newListings, updatedListings, skippedNoPrice, skippedLemon, errors };
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

    // ── GENERATE RUN ID FOR PROVENANCE ──
    const runId = crypto.randomUUID();
    console.log(`[PICKLES] Run ID: ${runId}`);

    // ── STEP 1: Scrape ──
    const { listings, pages_scraped, firecrawl_calls } = await scrapeSearchPages(firecrawlKey);
    console.log(`[PICKLES] Scraped ${listings.length} listings from ${pages_scraped} pages`);

    // ── STEP 2: Upsert (with price gate + lemon check + provenance) ──
    const { newListings, updatedListings, skippedNoPrice, skippedLemon, errors } = await upsertListings(sb, listings, runId);
    console.log(`[PICKLES] Upserted: ${newListings} new, ${updatedListings} updated, ${skippedNoPrice} skipped (no price), ${skippedLemon} skipped (lemon), ${errors.length} errors`);

    // ── STEP 3: Mark stale ──
    const markedInactive = await markStaleInactive(sb);
    console.log(`[PICKLES] Marked ${markedInactive} stale listings inactive`);

    // ── STEP 4: Audit logging ──
    const runtimeMs = Date.now() - startTime;
    const result = {
      run_id: runId,
      listings_found: listings.length,
      new_listings: newListings,
      updated_listings: updatedListings,
      skipped_no_price: skippedNoPrice,
      skipped_lemon: skippedLemon,
      marked_inactive: markedInactive,
      pages_scraped,
      firecrawl_calls,
      runtime_ms: runtimeMs,
      errors: errors.slice(0, 10),
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
      note: `found=${listings.length} new=${newListings} updated=${updatedListings} inactive=${markedInactive}`,
    }, { onConflict: "cron_name" });

    // ── STEP 5: Slack alarm ──
    await sendSlackAlarmIfNeeded(sb, listings.length);

    console.log(`[PICKLES] Ingest complete in ${runtimeMs}ms:`, result);

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
        note: `FATAL: ${errorMsg.slice(0, 100)}`,
      }, { onConflict: "cron_name" });
    } catch (_) {}

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
