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
  "Referer": "https://www.manheim.com.au/home/publicsearch",
};

const MAX_PAGES = 3;
const RECORDS_PER_PAGE = 120;

// Mackay Traders account ID for fingerprint matching
const MACKAY_TRADERS_ACCOUNT_ID = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51";

interface RawParsedListing {
  externalId: string;
  makeRaw: string;
  modelRaw: string;
  year: number;
  variantRaw: string | null;
  km: number | null;
  location: string | null;
  listingUrl: string;
  title: string;
}

// ─── URL / HTML helpers ────────────────────────────────────────────────────

function buildSearchUrl(page: number): string {
  const params = new URLSearchParams({
    PageNumber: String(page),
    RecordsPerPage: String(RECORDS_PER_PAGE),
    SelectedOrderBy: "BuildYearDescending",
    searchType: "P",
  });
  return `https://www.manheim.com.au/home/publicsearch/resultpartial?${params.toString()}`;
}

async function fetchPage(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
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

function extractListingId(href: string): string | null {
  const match = href.match(/\/home\/(\d+)\//);
  if (match) return match[1];
  const endMatch = href.match(/\/home\/(\d+)$/);
  return endMatch ? endMatch[1] : null;
}

// ─── HTML parsing (raw extraction — no normalization here) ─────────────────

function parseListings(html: string): RawParsedListing[] {
  const $ = cheerio.load(html);
  const listings: RawParsedListing[] = [];
  const seen = new Set<string>();

  const vehicleItems = $("li.vehicle-item");

  if (vehicleItems.length > 0) {
    vehicleItems.each((_, el) => {
      const $el = $(el);
      const title = $el.find("h2.heading.vehicle").text().trim();

      let href = "";
      $el.find("a").each((_, a) => {
        const h = $(a).attr("href") || "";
        if (/\/home\/\d+\//.test(h) && !href) href = h;
      });
      if (!href) {
        $el.find("a").each((_, a) => {
          const h = $(a).attr("href") || "";
          if (/passenger-vehicles\/\d+\//.test(h) && !href) href = h;
        });
      }

      const externalId = extractListingId(href) ||
        (href.match(/passenger-vehicles\/(\d+)\//) || [])[1];
      if (!externalId || seen.has(externalId)) return;
      seen.add(externalId);

      const parsed = extractRawFields($el, $, title, href, externalId);
      if (parsed) listings.push(parsed);
    });
  }

  // Fallback: link-based extraction
  if (listings.length === 0) {
    const linkRegex = /href="(\/home\/(\d+)\/[^"]+)"/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const externalId = match[2];
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      const parsed = extractRawFromContext(html, match.index, href, externalId);
      if (parsed) listings.push(parsed);
    }
  }

  return listings;
}

function extractRawFields(
  $el: cheerio.Cheerio<cheerio.Element>,
  $: cheerio.CheerioAPI,
  title: string,
  href: string,
  externalId: string
): RawParsedListing | null {
  const url = href.startsWith("http") ? href : `https://www.manheim.com.au${href}`;

  const slugMatch = url.match(/\/home\/\d+\/(\d{4})-([a-z0-9]+)-([a-z0-9-]+)/i);

  let year: number | null = null;
  let makeRaw: string | null = null;
  let modelRaw: string | null = null;
  let variantRaw: string | null = null;

  if (slugMatch) {
    year = parseInt(slugMatch[1]);
    makeRaw = slugMatch[2];
    // Keep the full slug model+variant together for the normalizer
    modelRaw = slugMatch[3].replace(/-/g, " ");
  }

  if (!makeRaw || !modelRaw) {
    const titleText = title || $el.text().substring(0, 200);
    const yearMatch = titleText.match(/\b(20[0-2]\d|19[89]\d)\b/);
    if (yearMatch && !year) year = parseInt(yearMatch[0]);

    const cleaned = titleText.replace(/\b(20[0-2]\d|19[89]\d)\b/, "").trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      makeRaw = makeRaw || parts[0];
      modelRaw = modelRaw || parts.slice(1).join(" ");
    }
  }

  if (!makeRaw || !modelRaw || !year) return null;

  const elText = $el.text();
  const kmMatch = elText.match(/(\d{1,3}(?:,\d{3})*)\s*km/i) ||
    elText.match(/odometer[:\s]*(\d{1,3}(?:,\d{3})*)/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, "")) : null;

  const locMatch = elText.match(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i
  );
  const location = locMatch ? locMatch[0].trim() : null;

  return {
    externalId,
    makeRaw,
    modelRaw,
    year,
    variantRaw,
    km,
    location,
    listingUrl: url,
    title: title || `${year} ${makeRaw} ${modelRaw}`,
  };
}

function extractRawFromContext(
  html: string,
  pos: number,
  href: string,
  externalId: string
): RawParsedListing | null {
  const url = href.startsWith("http") ? href : `https://www.manheim.com.au${href}`;
  const context = html.substring(Math.max(0, pos - 400), Math.min(html.length, pos + 600));

  const slugMatch = url.match(/\/home\/\d+\/(\d{4})-([a-z0-9]+)-([a-z0-9-]+)/i);

  let year: number | null = null;
  let makeRaw: string | null = null;
  let modelRaw: string | null = null;

  if (slugMatch) {
    year = parseInt(slugMatch[1]);
    makeRaw = slugMatch[2];
    modelRaw = slugMatch[3].replace(/-/g, " ");
  }

  if (!year) {
    const yearMatch = context.match(/\b(20[0-2]\d|19[89]\d)\b/);
    year = yearMatch ? parseInt(yearMatch[0]) : null;
  }

  if (!makeRaw) {
    const makes = ["Toyota", "Mazda", "Ford", "Holden", "Nissan", "Mitsubishi",
      "Hyundai", "Kia", "Volkswagen", "Honda", "Subaru", "Isuzu", "Suzuki",
      "BMW", "Mercedes", "Audi", "Lexus", "Jeep", "LDV", "GWM", "MG"];
    for (const m of makes) {
      if (new RegExp(`\\b${m}\\b`, "i").test(context)) {
        makeRaw = m;
        const modelMatch = context.match(new RegExp(`${m}\\s+([A-Za-z0-9-]+(?:\\s+[A-Za-z0-9-]+)*)`, "i"));
        if (modelMatch) modelRaw = modelMatch[1];
        break;
      }
    }
  }

  if (!makeRaw || !modelRaw || !year) return null;

  const kmMatch = context.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, "")) : null;

  const locMatch = context.match(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i
  );
  const location = locMatch ? locMatch[0].trim() : null;

  return {
    externalId,
    makeRaw,
    modelRaw,
    year,
    variantRaw: null,
    km,
    location,
    listingUrl: url,
    title: `${year} ${makeRaw} ${modelRaw}`,
  };
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create taxonomy deps for the normalizer
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
    const maxPages = body.max_pages || MAX_PAGES;

    console.log(`[MANHEIM] Starting HTML ingest with normalizer, pages 1-${maxPages}`);

    for (let page = 1; page <= maxPages; page++) {
      const url = buildSearchUrl(page);
      console.log(`[MANHEIM] Fetching page ${page}`);

      const html = await fetchPage(url);
      if (!html) {
        metrics.errors.push(`Page ${page}: fetch failed`);
        continue;
      }

      metrics.pages_fetched++;
      const rawListings = parseListings(html);
      metrics.total_found += rawListings.length;

      console.log(`[MANHEIM] Page ${page}: ${rawListings.length} listings parsed`);

      if (rawListings.length === 0) {
        console.log(`[MANHEIM] Page ${page}: empty, stopping`);
        break;
      }

      // Normalize and upsert each listing
      for (const raw of rawListings) {
        try {
          // ── CANONICAL NORMALIZATION ──
          const normResult = await normalizeVehicleIdentity(taxonomyDeps, {
            source: "manheim",
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

          if (normResult.confidence < 20) {
            metrics.norm_low_confidence++;
            console.warn(`[MANHEIM] Low confidence (${normResult.confidence}) for ${raw.listingUrl}: ${normResult.explain.join(",")}`);
          }

          metrics.normalized++;

          const { data, error } = await supabase
            .from("vehicle_listings")
            .upsert(
              {
                listing_id: `manheim:${raw.externalId}`,
                source: "manheim",
                make,
                model,
                year: raw.year,
                variant_raw: variant,
                km: raw.km,
                location: raw.location,
                listing_url: raw.listingUrl,
                source_class: "auction",
                auction_house: "Manheim",
                status: "catalogue",
                last_seen_at: new Date().toISOString(),
                fingerprint_confidence: normResult.confidence,
                variant_source: `normalizer:${normResult.normalizerVersion}`,
              },
              { onConflict: "listing_id,source" }
            )
            .select("id, first_seen_at, last_seen_at");

          if (error) {
            metrics.total_skipped++;
            if (metrics.errors.length < 5) {
              metrics.errors.push(`Upsert manheim:${raw.externalId}: ${error.message}`);
            }
          } else if (data && data.length > 0) {
            const row = data[0];
            const firstSeen = new Date(row.first_seen_at).getTime();
            const lastSeen = new Date(row.last_seen_at).getTime();
            if (Math.abs(lastSeen - firstSeen) < 2000) {
              metrics.total_new++;
            } else {
              metrics.total_updated++;
            }
          }
        } catch (normErr) {
          metrics.total_skipped++;
          if (metrics.errors.length < 5) {
            metrics.errors.push(`Norm error ${raw.externalId}: ${normErr instanceof Error ? normErr.message : String(normErr)}`);
          }
        }
      }

      // Rate limit between pages
      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const elapsed = Date.now() - startTime;

    // ── POST-INGEST: Trigger fingerprint-match-run ──
    if (metrics.total_found > 0) {
      console.log(`[MANHEIM] Triggering fingerprint-match-run for account ${MACKAY_TRADERS_ACCOUNT_ID}`);
      try {
        const matchRes = await fetch(
          `${supabaseUrl}/functions/v1/fingerprint-match-run`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              account_id: MACKAY_TRADERS_ACCOUNT_ID,
              batch_size: 500,
              refresh_fingerprints: false, // fingerprints already fresh
            }),
          }
        );
        const matchResult = await matchRes.json();
        console.log(`[MANHEIM] fingerprint-match-run result:`, JSON.stringify(matchResult));
      } catch (matchErr) {
        console.error(`[MANHEIM] fingerprint-match-run trigger failed:`, matchErr);
        // Non-fatal — ingestion still succeeded
      }
    }

    // Write heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "manheim-html-ingest",
        last_seen_at: new Date().toISOString(),
        last_ok: metrics.errors.length === 0,
        note: `found=${metrics.total_found} new=${metrics.total_new} updated=${metrics.total_updated} normalized=${metrics.normalized} lowConf=${metrics.norm_low_confidence} ms=${elapsed}`,
      },
      { onConflict: "cron_name" }
    );

    // Write audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "manheim-html-ingest",
      success: metrics.errors.length === 0,
      result: { ...metrics, elapsed_ms: elapsed },
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
