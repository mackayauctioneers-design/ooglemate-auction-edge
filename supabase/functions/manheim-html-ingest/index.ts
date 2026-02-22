import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Cache-Control": "no-cache",
  "Referer": "https://www.manheim.com.au/home/publicsearch",
};

const MAX_PAGES = 3;
const RECORDS_PER_PAGE = 120;

interface ParsedListing {
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
}

/**
 * Build Manheim search URL
 */
function buildSearchUrl(page: number): string {
  const params = new URLSearchParams({
    PageNumber: String(page),
    RecordsPerPage: String(RECORDS_PER_PAGE),
    SelectedOrderBy: "BuildYearDescending",
    searchType: "P",
  });
  return `https://www.manheim.com.au/home/publicsearch/resultpartial?${params.toString()}`;
}

/**
 * Fetch a page with retry
 */
async function fetchPage(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: "follow",
      });
      if (res.status === 403 || res.status === 429) {
        console.warn(`[MANHEIM] ${res.status} on attempt ${attempt + 1}, retrying...`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        console.error(`[MANHEIM] HTTP ${res.status} for ${url}`);
        return null;
      }
      return await res.text();
    } catch (e) {
      console.error(`[MANHEIM] Fetch error attempt ${attempt + 1}:`, e);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Extract listing ID from Manheim URL
 * Pattern: /home/{numeric-id}/slug
 */
function extractListingId(href: string): string | null {
  const match = href.match(/\/home\/(\d+)\//);
  if (match) return match[1];
  const endMatch = href.match(/\/home\/(\d+)$/);
  return endMatch ? endMatch[1] : null;
}

/**
 * Parse listings from HTML using Cheerio
 * Uses li.vehicle-item wrapper and h2.heading.vehicle title selector
 * Falls back to link-based extraction if no .vehicle-item elements found
 */
function parseListings(html: string): ParsedListing[] {
  const $ = cheerio.load(html);
  const listings: ParsedListing[] = [];
  const seen = new Set<string>();

  // Primary: structured selectors per user spec
  const vehicleItems = $("li.vehicle-item");

  if (vehicleItems.length > 0) {
    vehicleItems.each((_, el) => {
      const $el = $(el);
      const title = $el.find("h2.heading.vehicle").text().trim();

      // Find first link with /home/{id}/ pattern
      let href = "";
      $el.find("a").each((_, a) => {
        const h = $(a).attr("href") || "";
        if (/\/home\/\d+\//.test(h) && !href) href = h;
      });

      if (!href) {
        // Fallback: any href with passenger-vehicles/{id}/
        $el.find("a").each((_, a) => {
          const h = $(a).attr("href") || "";
          if (/passenger-vehicles\/\d+\//.test(h) && !href) href = h;
        });
      }

      const externalId = extractListingId(href) ||
        (href.match(/passenger-vehicles\/(\d+)\//) || [])[1];

      if (!externalId || seen.has(externalId)) return;
      seen.add(externalId);

      const parsed = parseTitleAndMeta($el, $, title, href, externalId);
      if (parsed) listings.push(parsed);
    });
  }

  // Fallback: link-based extraction (existing Manheim HTML structure)
  if (listings.length === 0) {
    const linkRegex = /href="(\/home\/(\d+)\/[^"]+)"/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const externalId = match[2];
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      // Get surrounding context for parsing
      const pos = match.index;
      const context = html.substring(
        Math.max(0, pos - 400),
        Math.min(html.length, pos + 600)
      );

      const parsed = parseFromContext(context, href, externalId);
      if (parsed) listings.push(parsed);
    }
  }

  return listings;
}

/**
 * Parse make/model/year/km from a Cheerio element
 */
function parseTitleAndMeta(
  $el: cheerio.Cheerio<cheerio.Element>,
  $: cheerio.CheerioAPI,
  title: string,
  href: string,
  externalId: string
): ParsedListing | null {
  const url = href.startsWith("http")
    ? href
    : `https://www.manheim.com.au${href}`;

  // Extract from URL slug: /home/{id}/2022-toyota-hilux-sr5
  const slugMatch = url.match(/\/home\/\d+\/(\d{4})-([a-z0-9]+)-([a-z0-9-]+)/i);

  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  let variant: string | null = null;

  if (slugMatch) {
    year = parseInt(slugMatch[1]);
    make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
    const modelParts = slugMatch[3].split("-");
    model = modelParts[0].charAt(0).toUpperCase() + modelParts[0].slice(1);
    variant = modelParts.length > 1
      ? modelParts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
      : null;
  }

  // Fallback: parse from title text
  if (!make || !model) {
    const titleText = title || $el.text().substring(0, 200);
    const yearMatch = titleText.match(/\b(20[0-2]\d|19[89]\d)\b/);
    if (yearMatch && !year) year = parseInt(yearMatch[0]);

    const cleaned = titleText.replace(/\b(20[0-2]\d|19[89]\d)\b/, "").trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      make = make || parts[0];
      model = model || parts[1];
      variant = variant || (parts.length > 2 ? parts.slice(2).join(" ") : null);
    }
  }

  // Skip if we can't extract required fields
  if (!make || !model || !year) return null;

  // Extract KM
  const elText = $el.text();
  const kmMatch = elText.match(/(\d{1,3}(?:,\d{3})*)\s*km/i) ||
    elText.match(/odometer[:\s]*(\d{1,3}(?:,\d{3})*)/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, "")) : null;

  // Extract location
  const locMatch = elText.match(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i
  );
  const location = locMatch ? locMatch[0].trim() : null;

  return {
    listing_id: `manheim:${externalId}`,
    source: "manheim",
    make,
    model,
    year,
    variant_raw: variant,
    km,
    location,
    listing_url: url,
    source_class: "auction",
    auction_house: "Manheim",
    status: "catalogue",
  };
}

/**
 * Parse from raw HTML context (fallback when no structured selectors match)
 */
function parseFromContext(
  context: string,
  href: string,
  externalId: string
): ParsedListing | null {
  const url = href.startsWith("http")
    ? href
    : `https://www.manheim.com.au${href}`;

  const slugMatch = url.match(/\/home\/\d+\/(\d{4})-([a-z0-9]+)-([a-z0-9-]+)/i);

  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  let variant: string | null = null;

  if (slugMatch) {
    year = parseInt(slugMatch[1]);
    make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
    const modelParts = slugMatch[3].split("-");
    model = modelParts[0].charAt(0).toUpperCase() + modelParts[0].slice(1);
    variant = modelParts.length > 1
      ? modelParts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
      : null;
  }

  // Fallback: extract from context text
  if (!year) {
    const yearMatch = context.match(/\b(20[0-2]\d|19[89]\d)\b/);
    year = yearMatch ? parseInt(yearMatch[0]) : null;
  }

  if (!make) {
    const makes = ["Toyota", "Mazda", "Ford", "Holden", "Nissan", "Mitsubishi",
      "Hyundai", "Kia", "Volkswagen", "Honda", "Subaru", "Isuzu", "Suzuki",
      "BMW", "Mercedes", "Audi", "Lexus", "Jeep", "LDV", "GWM", "MG"];
    for (const m of makes) {
      if (new RegExp(`\\b${m}\\b`, "i").test(context)) {
        make = m;
        const modelMatch = context.match(new RegExp(`${m}\\s+([A-Za-z0-9]+)`, "i"));
        if (modelMatch) model = modelMatch[1];
        break;
      }
    }
  }

  if (!make || !model || !year) return null;

  const kmMatch = context.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, "")) : null;

  const locMatch = context.match(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i
  );
  const location = locMatch ? locMatch[0].trim() : null;

  return {
    listing_id: `manheim:${externalId}`,
    source: "manheim",
    make,
    model,
    year,
    variant_raw: variant,
    km,
    location,
    listing_url: url,
    source_class: "auction",
    auction_house: "Manheim",
    status: "catalogue",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const metrics = {
    pages_fetched: 0,
    total_found: 0,
    total_new: 0,
    total_updated: 0,
    total_skipped: 0,
    errors: [] as string[],
  };

  try {
    const body = await req.json().catch(() => ({}));
    const maxPages = body.max_pages || MAX_PAGES;

    console.log(`[MANHEIM] Starting HTML ingest, pages 1-${maxPages}`);

    for (let page = 1; page <= maxPages; page++) {
      const url = buildSearchUrl(page);
      console.log(`[MANHEIM] Fetching page ${page}`);

      const html = await fetchPage(url);
      if (!html) {
        metrics.errors.push(`Page ${page}: fetch failed`);
        continue;
      }

      metrics.pages_fetched++;
      const listings = parseListings(html);
      metrics.total_found += listings.length;

      console.log(`[MANHEIM] Page ${page}: ${listings.length} listings parsed`);

      if (listings.length === 0) {
        console.log(`[MANHEIM] Page ${page}: empty, stopping`);
        break;
      }

      // Upsert each listing into vehicle_listings
      for (const l of listings) {
        const { data, error } = await supabase
          .from("vehicle_listings")
          .upsert(
            {
              listing_id: l.listing_id,
              source: l.source,
              make: l.make,
              model: l.model,
              year: l.year,
              variant_raw: l.variant_raw,
              km: l.km,
              location: l.location,
              listing_url: l.listing_url,
              source_class: l.source_class,
              auction_house: l.auction_house,
              status: l.status,
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "listing_id,source" }
          )
          .select("id, first_seen_at, last_seen_at");

        if (error) {
          metrics.total_skipped++;
          if (metrics.errors.length < 5) {
            metrics.errors.push(`Upsert ${l.listing_id}: ${error.message}`);
          }
        } else if (data && data.length > 0) {
          const row = data[0];
          // If first_seen_at equals last_seen_at (within 1s), it's a new insert
          const firstSeen = new Date(row.first_seen_at).getTime();
          const lastSeen = new Date(row.last_seen_at).getTime();
          if (Math.abs(lastSeen - firstSeen) < 2000) {
            metrics.total_new++;
          } else {
            metrics.total_updated++;
          }
        }
      }

      // Rate limit between pages
      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const elapsed = Date.now() - startTime;

    // Write heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "manheim-html-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: metrics.errors.length === 0,
        note: `found=${metrics.total_found} new=${metrics.total_new} updated=${metrics.total_updated} ms=${elapsed}`,
      },
      { onConflict: "cron_name" }
    );

    // Write audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "manheim-html-ingest",
      success: metrics.errors.length === 0,
      result: {
        ...metrics,
        elapsed_ms: elapsed,
      },
      error: metrics.errors.length > 0 ? metrics.errors.join("; ") : null,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log(`[MANHEIM] Done in ${elapsed}ms:`, metrics);

    return new Response(
      JSON.stringify({ success: true, ...metrics, elapsed_ms: elapsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[MANHEIM] Fatal error:", msg);

    // Still log heartbeat on failure
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "manheim-html-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: msg.substring(0, 200),
      },
      { onConflict: "cron_name" }
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "manheim-html-ingest",
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
