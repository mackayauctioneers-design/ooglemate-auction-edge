import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0";
import { normalizeVehicleIdentity } from "../_shared/taxonomy/normalizeVehicleIdentity.ts";
import { createTaxonomyDeps } from "../_shared/taxonomy/taxonomyRepo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Cache-Control": "no-cache",
};

const MACKAY_TRADERS_ACCOUNT_ID = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51";

const BASE_URL = "https://www.auto-auctions.com.au";
const SEARCH_URL = `${BASE_URL}/search_results.aspx?sitekey=AAV&make=All-Makes&model=All-Models&body=All-Body-Types&keyword=&fromyear=2016&toyear=To-Any&fromklm=From-Any&toklm=100,000&fuel=All-Fuel-Types&trans=All-Transmissions`;

// ─── Types ─────────────────────────────────────────────────────────────────

interface RawParsedListing {
  externalId: string;
  makeRaw: string;
  modelRaw: string;
  variantRaw: string | null;
  year: number;
  km: number | null;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  listingUrl: string;
  title: string;
}

interface NormalizedRow {
  listing_id: string;
  source: string;
  make: string;
  model: string;
  year: number;
  variant_raw: string | null;
  km: number | null;
  location: string | null;
  listing_url: string;
  source_class: string;
  auction_house: string;
  status: string;
  last_seen_at: string;
  fingerprint_confidence: number;
  variant_source: string;
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    console.error("[AUTO-AUCTIONS] FIRECRAWL_API_KEY not configured");
    return null;
  }

  try {
    console.log("[AUTO-AUCTIONS] Fetching via Firecrawl:", url.substring(0, 80));
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["rawHtml"],
        onlyMainContent: false,
        waitFor: 10000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[AUTO-AUCTIONS] Firecrawl error ${res.status}: ${errText}`);
      return null;
    }

    const data = await res.json();
    const html = data.data?.rawHtml || data.data?.html || data.rawHtml || data.html || "";
    console.log(`[AUTO-AUCTIONS] Got ${html.length} chars via Firecrawl`);
    return html || null;
  } catch (e) {
    console.error("[AUTO-AUCTIONS] Firecrawl fetch error:", e);
    return null;
  }
}

// ─── HTML Parsing ──────────────────────────────────────────────────────────

function parseListings(html: string): RawParsedListing[] {
  const $ = cheerio.load(html);
  const listings: RawParsedListing[] = [];
  const seen = new Set<string>();

  $("div.listing").each((_, el) => {
    const $el = $(el);

    // Title + URL from div.title > a
    const titleLink = $el.find("div.title a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href") || "";
    if (!title || !href) return;

    // Extract MTA ID from URL: ?MTA=620712
    const mtaMatch = href.match(/MTA=(\d+)/i);
    if (!mtaMatch) return;
    const externalId = mtaMatch[1];
    if (seen.has(externalId)) return;
    seen.add(externalId);

    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;

    // Parse title: "2022 MAZDA CX-3 AKARI (FWD)"
    const yearMatch = title.match(/^(\d{4})\s+/);
    if (!yearMatch) return;
    const year = parseInt(yearMatch[1]);
    if (year < 2007 || year > 2027) return;

    const rest = title.substring(yearMatch[0].length).trim();
    const parts = rest.split(/\s+/);
    if (parts.length < 2) return;

    const makeRaw = parts[0];
    // Model is everything after make, but variant may be in parentheses
    const parenMatch = rest.match(/\(([^)]+)\)/);
    let modelRaw: string;
    let variantRaw: string | null = null;

    if (parenMatch) {
      // Everything between make and parentheses is model
      const beforeParen = rest.substring(makeRaw.length, rest.indexOf("(")).trim();
      modelRaw = beforeParen;
      variantRaw = parenMatch[1].trim();
    } else {
      // Second word is model, rest is variant
      modelRaw = parts[1];
      if (parts.length > 2) {
        variantRaw = parts.slice(2).join(" ");
      }
    }

    // Extract gear fields
    const gears = $el.find("div.gear");
    let km: number | null = null;
    let fuel: string | null = null;
    let transmission: string | null = null;
    let bodyType: string | null = null;

    gears.each((_, gear) => {
      const text = $(gear).text().trim();
      const img = $(gear).find("img").attr("src") || "";

      if (img.includes("odometer")) {
        const kmMatch = text.match(/(\d[\d,]*)\s*kms?\s+showing/i);
        if (kmMatch) {
          km = parseInt(kmMatch[1].replace(/,/g, ""));
        }
      } else if (img.includes("engine-size")) {
        fuel = text.trim() || null;
      } else if (img.includes("transmission")) {
        transmission = text.trim() || null;
      } else if (img.includes("style")) {
        bodyType = text.trim() || null;
      }
    });

    // Keep all listings including zero-km placeholders — they're real inventory

    listings.push({
      externalId,
      makeRaw,
      modelRaw,
      variantRaw,
      year,
      km,
      fuel,
      transmission,
      bodyType,
      listingUrl: fullUrl,
      title,
    });
  });

  return listings;
}

// ─── Batch Normalization ───────────────────────────────────────────────────

async function normalizeBatch(
  taxonomyDeps: ReturnType<typeof createTaxonomyDeps>,
  rawListings: RawParsedListing[],
  metrics: { normalized: number; norm_low_confidence: number; errors: string[] }
): Promise<NormalizedRow[]> {
  const now = new Date().toISOString();
  const rows: NormalizedRow[] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < rawListings.length; i += BATCH_SIZE) {
    const chunk = rawListings.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (raw) => {
        const normResult = await normalizeVehicleIdentity(taxonomyDeps, {
          source: "auto_auctions",
          url: raw.listingUrl,
          title: raw.title,
          makeRaw: raw.makeRaw,
          modelRaw: raw.modelRaw,
          variantRaw: raw.variantRaw,
          year: raw.year,
          km: raw.km,
        });

        const make = normResult.make || raw.makeRaw;
        const model = normResult.model || raw.modelRaw;
        const variant = normResult.variant || raw.variantRaw;

        if (normResult.confidence < 20) metrics.norm_low_confidence++;
        metrics.normalized++;

        return {
          listing_id: `auto_auctions:${raw.externalId}`,
          source: "auto_auctions",
          make,
          model,
          year: raw.year,
          variant_raw: variant,
          km: raw.km,
          location: null, // Site doesn't show location per listing
          listing_url: raw.listingUrl,
          source_class: "auction",
          auction_house: "Auto Auctions",
          status: "catalogue",
          last_seen_at: now,
          fingerprint_confidence: normResult.confidence,
          variant_source: `normalizer:${normResult.normalizerVersion}`,
        };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") rows.push(r.value);
      else if (metrics.errors.length < 5) metrics.errors.push(`Norm error: ${r.reason}`);
    }
  }

  return rows;
}

// ─── Main ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);
  const taxonomyDeps = createTaxonomyDeps(supabase);

  const metrics = {
    pages_fetched: 0,
    total_found: 0,
    total_new: 0,
    total_updated: 0,
    total_skipped: 0,
    normalized: 0,
    norm_low_confidence: 0,
    errors: [] as string[],
  };

  try {
    const body = await req.json().catch(() => ({}));

    // ── MODE 1: Apify webhook — items array provided directly ──
    if (Array.isArray(body.items) && body.items.length > 0) {
      // Validate ingest key
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const expectedKey = Deno.env.get("AAV_INGEST_KEY");
      if (!expectedKey || token !== expectedKey) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(`[AUTO-AUCTIONS] Apify webhook mode: ${body.items.length} items`);
      const rawListings: RawParsedListing[] = [];
      for (const item of body.items) {
        if (!item.mta) continue;
        rawListings.push({
          externalId: item.mta,
          makeRaw: item.make_raw || '',
          modelRaw: item.model_raw || '',
          variantRaw: item.variant || null,
          year: item.year || 0,
          km: item.km || null,
          fuel: item.fuel || null,
          transmission: item.transmission || null,
          bodyType: item.body_type || null,
          listingUrl: item.detail_url || `${BASE_URL}/cp_veh_inspection_report.aspx?MTA=${item.mta}&sitekey=AAV`,
          title: item.title || `${item.year || ''} ${item.make_raw || ''} ${item.model_raw || ''}`.trim(),
        });
      }
      metrics.total_found = rawListings.length;
      metrics.pages_fetched = 0; // Apify did the fetching

      // Normalize and upsert (same as below)
      const normalizedRows = await normalizeBatch(taxonomyDeps, rawListings, metrics);
      for (let i = 0; i < normalizedRows.length; i += 50) {
        const batch = normalizedRows.slice(i, i + 50);
        const { data, error } = await supabase
          .from("vehicle_listings")
          .upsert(batch, { onConflict: "listing_id,source" })
          .select("id, first_seen_at, last_seen_at");
        if (error) {
          metrics.total_skipped += batch.length;
          if (metrics.errors.length < 5) metrics.errors.push(`Upsert: ${error.message}`);
        } else if (data) {
          for (const row of data) {
            const diff = Math.abs(new Date(row.last_seen_at).getTime() - new Date(row.first_seen_at).getTime());
            if (diff < 2000) metrics.total_new++;
            else metrics.total_updated++;
          }
        }
      }

      const elapsed = Date.now() - startTime;
      await supabase.from("cron_heartbeat").upsert({
        cron_name: "auto-auctions-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: metrics.errors.length === 0,
        note: `apify found=${metrics.total_found} new=${metrics.total_new} upd=${metrics.total_updated} ms=${elapsed}`,
      }, { onConflict: "cron_name" });

      await supabase.from("cron_audit_log").insert({
        cron_name: "auto-auctions-ingest",
        success: metrics.errors.length === 0,
        result: { ...metrics, elapsed_ms: elapsed, mode: "apify" },
        error: metrics.errors.length > 0 ? metrics.errors.join("; ") : null,
        run_date: new Date().toISOString().split("T")[0],
      });

      console.log(`[AUTO-AUCTIONS] Apify ingest done in ${elapsed}ms:`, metrics);
      return new Response(
        JSON.stringify({ success: true, mode: "apify", ...metrics, elapsed_ms: elapsed }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── MODE 2: Self-scrape via Firecrawl ──
    const searchUrl = body.search_url || SEARCH_URL;
    console.log(`[AUTO-AUCTIONS] Starting HTML ingest from: ${searchUrl.substring(0, 80)}...`);

    // Fetch the search page
    const html = await fetchPage(searchUrl);
    if (!html) {
      throw new Error("Failed to fetch search page after retries");
    }
    metrics.pages_fetched = 1;

    // Parse listings
    const rawListings = parseListings(html);
    metrics.total_found = rawListings.length;
    console.log(`[AUTO-AUCTIONS] Parsed ${rawListings.length} listings from HTML`);

    if (rawListings.length === 0) {
      await supabase.from("cron_heartbeat").upsert(
        {
          cron_name: "auto-auctions-ingest",
          last_seen_at: new Date().toISOString(),
          last_ok: true,
          note: `Zero listings found — possible reCAPTCHA block`,
        },
        { onConflict: "cron_name" }
      );

      return new Response(
        JSON.stringify({ success: true, ...metrics, warning: "Zero listings — possible reCAPTCHA block" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize
    const normalizedRows = await normalizeBatch(taxonomyDeps, rawListings, metrics);

    // Batch upsert (chunks of 50)
    for (let i = 0; i < normalizedRows.length; i += 50) {
      const batch = normalizedRows.slice(i, i + 50);
      const { data, error } = await supabase
        .from("vehicle_listings")
        .upsert(batch, { onConflict: "listing_id,source" })
        .select("id, first_seen_at, last_seen_at");

      if (error) {
        metrics.total_skipped += batch.length;
        if (metrics.errors.length < 5) metrics.errors.push(`Upsert: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          const diff = Math.abs(new Date(row.last_seen_at).getTime() - new Date(row.first_seen_at).getTime());
          if (diff < 2000) metrics.total_new++;
          else metrics.total_updated++;
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // Post-ingest: trigger fingerprint matching
    if (metrics.total_found > 0) {
      console.log(`[AUTO-AUCTIONS] Triggering fingerprint-match-run`);
      try {
        const matchRes = await fetch(`${supabaseUrl}/functions/v1/fingerprint-match-run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            account_id: MACKAY_TRADERS_ACCOUNT_ID,
            batch_size: 500,
            refresh_fingerprints: false,
          }),
        });
        const matchResult = await matchRes.json();
        console.log(`[AUTO-AUCTIONS] fingerprint-match-run:`, JSON.stringify(matchResult));
      } catch (matchErr) {
        console.error(`[AUTO-AUCTIONS] fingerprint-match-run failed:`, matchErr);
      }
    }

    // Write heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "auto-auctions-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: metrics.errors.length === 0,
        note: `found=${metrics.total_found} new=${metrics.total_new} upd=${metrics.total_updated} ms=${elapsed}`,
      },
      { onConflict: "cron_name" }
    );

    // Write audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "auto-auctions-ingest",
      success: metrics.errors.length === 0,
      result: { ...metrics, elapsed_ms: elapsed },
      error: metrics.errors.length > 0 ? metrics.errors.join("; ") : null,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log(`[AUTO-AUCTIONS] Done in ${elapsed}ms:`, metrics);

    return new Response(
      JSON.stringify({ success: true, ...metrics, elapsed_ms: elapsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[AUTO-AUCTIONS] Fatal error:", msg);

    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "auto-auctions-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: msg.substring(0, 200),
      },
      { onConflict: "cron_name" }
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "auto-auctions-ingest",
      success: false,
      error: msg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
