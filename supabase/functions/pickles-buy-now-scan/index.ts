import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUY_NOW_URL =
  "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";

// ── Types ──
interface ParsedListing {
  url: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  kms: number | null;
  price: number | null;
  location: string | null;
}

// ── Deterministic Markdown Parser ──
// Pickles markdown structure per listing block:
//   URL slug: /used/details/cars/YYYY-make-model/stockid
//   Block content (backslash-delimited): location, kms, year, seats, engine, trans, drive, stock, price
function parseListingsFromMarkdown(markdown: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const seen = new Set<string>();

  // Find all detail page URLs — the slug contains year-make-model
  const detailUrlRegex = /https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/gi;
  let match: RegExpExecArray | null;

  while ((match = detailUrlRegex.exec(markdown)) !== null) {
    const fullUrl = match[0];
    const stockId = match[4];

    // Dedup — same listing URL appears multiple times (photo links, "View X more photos", "MORE DETAILS")
    if (seen.has(stockId)) continue;
    seen.add(stockId);

    const year = parseInt(match[1], 10);
    const make = match[2].charAt(0).toUpperCase() + match[2].slice(1);
    const modelRaw = match[3].replace(/-/g, " ");
    const model = modelRaw.charAt(0).toUpperCase() + modelRaw.slice(1);

    // Find the listing detail block — the "MORE DETAILS" link block: [content](url)
    // Each listing block starts fresh after "#### Interested?" and photo links.
    // We search backwards from the URL to find the block containing price/km/location.
    const escapedUrl = fullUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let kms: number | null = null;
    let price: number | null = null;
    let location: string | null = null;

    // Strategy: find the position of "MORE DETAILS](url)" in the markdown,
    // then scan backwards to find the opening "[" of that link
    const moreDetailsPattern = `MORE DETAILS](${fullUrl})`;
    const moreDetailsIdx = markdown.indexOf(moreDetailsPattern);

    if (moreDetailsIdx > 0) {
      // Scan backwards to find the "[" that opens this link
      let openBracketIdx = moreDetailsIdx;
      for (let i = moreDetailsIdx - 1; i >= Math.max(0, moreDetailsIdx - 2000); i--) {
        if (markdown[i] === "[") {
          openBracketIdx = i;
          break;
        }
      }

      const blockContent = markdown.substring(openBracketIdx, moreDetailsIdx);

      // Extract kms: "21,778 km"
      const kmMatch = blockContent.match(/([\d,]+)\s*km\b/i);
      if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""), 10);

      // Extract price: "Buy $41,720"
      const priceMatch = blockContent.match(/Buy\s*\$\s*([\d,]+)/i);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ""), 10);

      // Extract location: right after "[" — "Moonah, TAS\\" or "Bibra Lake, WA\\"
      const locMatch = blockContent.match(/([A-Za-z][A-Za-z ]+,\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT))/);
      if (locMatch) location = locMatch[1].trim();
    }

    listings.push({
      url: fullUrl,
      year,
      make,
      model,
      variant: null, // Pickles search page doesn't expose variant
      kms,
      price,
      location,
    });
  }

  return listings;
}

// ── SHA-256 hash for change detection ──
async function computeHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Business hours gate (AEST 8am–6pm) ──
function isWithinBusinessHours(): boolean {
  const now = new Date();
  const aestHour = (now.getUTCHours() + 10) % 24;
  return aestHour >= 8 && aestHour < 18;
}

// ── Credit logger ──
async function logCredit(
  supabase: ReturnType<typeof createClient>,
  functionName: string,
  endpoint: string,
  format: string,
  estimatedCredits: number,
  url: string,
  note?: string
) {
  await supabase.from("firecrawl_credit_log").insert({
    function_name: functionName,
    endpoint,
    format_used: format,
    estimated_credits: estimatedCredits,
    url_scraped: url,
    note: note ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  if (!force && !isWithinBusinessHours()) {
    return new Response(
      JSON.stringify({ success: true, skipped: true, reason: "Outside business hours (AEST 8am–6pm)" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("[pickles-buy-now-scan] Starting markdown scrape…");

    // ── 1. Scrape via Firecrawl (markdown only — 1 credit) ──
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url: BUY_NOW_URL,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    if (!scrapeRes.ok) {
      const errText = await scrapeRes.text();
      await logCredit(supabase, "pickles-buy-now-scan", "/v1/scrape", "markdown", 1, BUY_NOW_URL, `Error: ${scrapeRes.status}`);
      throw new Error(`Firecrawl error ${scrapeRes.status}: ${errText}`);
    }

    const scrapeData = await scrapeRes.json();
    const markdown: string = scrapeData?.data?.markdown ?? scrapeData?.markdown ?? "";

    await logCredit(supabase, "pickles-buy-now-scan", "/v1/scrape", "markdown", 1, BUY_NOW_URL);

    if (!markdown || markdown.length < 100) {
      console.log("[pickles-buy-now-scan] Empty or minimal markdown returned");
      return new Response(
        JSON.stringify({ success: true, scraped: 0, reason: "No content returned" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Change detection ──
    const contentHash = await computeHash(markdown);

    const { data: lastHash } = await supabase
      .from("pickles_buy_now_listings")
      .select("scrape_content_hash")
      .not("scrape_content_hash", "is", null)
      .order("scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastHash?.scrape_content_hash === contentHash) {
      console.log("[pickles-buy-now-scan] Content unchanged — skipping parse & match");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "Content unchanged (hash match)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Deterministic parse ──
    const rawListings = parseListingsFromMarkdown(markdown);
    console.log(`[pickles-buy-now-scan] Parsed ${rawListings.length} listings from markdown`);

    if (rawListings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, scraped: 0, inserted: 0, updated: 0, matched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 4. Upsert with dedup ──
    let inserted = 0;
    let updated = 0;
    const now = new Date().toISOString();

    for (const listing of rawListings) {
      if (!listing.url) continue;

      const { data: existing } = await supabase
        .from("pickles_buy_now_listings")
        .select("id")
        .eq("listing_url", listing.url)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("pickles_buy_now_listings")
          .update({
            last_seen_at: now,
            scraped_at: now,
            price: listing.price ?? null,
            kms: listing.kms ?? null,
            scrape_content_hash: contentHash,
          })
          .eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("pickles_buy_now_listings").insert({
          listing_url: listing.url,
          year: listing.year ?? null,
          make: listing.make ?? null,
          model: listing.model ?? null,
          variant: listing.variant ?? null,
          kms: listing.kms ?? null,
          price: listing.price ?? null,
          location: listing.location ?? null,
          scrape_content_hash: contentHash,
        });
        inserted++;
      }
    }

    console.log(`[pickles-buy-now-scan] Upserted: ${inserted} new, ${updated} updated`);

    // ── 5. Fingerprint match — $3,000 minimum spread ──
    const MINIMUM_SPREAD = 3000;

    const { data: unmatched } = await supabase
      .from("pickles_buy_now_listings")
      .select("id, year, make, model, variant, kms, price, listing_url")
      .is("matched_fingerprint_id", null)
      .is("match_alerted_at", null)
      .not("make", "is", null)
      .not("model", "is", null);

    let matched = 0;
    const alerts: {
      listing_id: string;
      listing_summary: string;
      fingerprint_id: string;
      fingerprint_label: string;
      pickles_price: number;
      historical_sold_price: number;
      estimated_margin: number;
      direct_link: string;
    }[] = [];

    if (unmatched && unmatched.length > 0) {
      const { data: fingerprints } = await supabase
        .from("sales_target_candidates")
        .select("id, make, model, variant, year_min, year_max, median_km, median_sold_price, target_buy_price, score")
        .eq("status", "active");

      if (fingerprints && fingerprints.length > 0) {
        for (const listing of unmatched) {
          for (const fp of fingerprints) {
            if (listing.make?.toLowerCase() !== fp.make?.toLowerCase()) continue;
            if (listing.model?.toLowerCase() !== fp.model?.toLowerCase()) continue;

            if (listing.year && fp.year_min && fp.year_max) {
              if (listing.year < fp.year_min - 1 || listing.year > fp.year_max + 1) continue;
            }

            if (listing.kms && fp.median_km) {
              if (listing.kms < fp.median_km * 0.7 || listing.kms > fp.median_km * 1.3) continue;
            }

            const soldPrice = fp.median_sold_price;
            const picklesPrice = listing.price;
            if (!soldPrice || !picklesPrice) continue;

            const spread = soldPrice - picklesPrice;
            if (spread < MINIMUM_SPREAD) continue;

            const summary = `${listing.year ?? "?"} ${listing.make} ${listing.model} ${listing.variant ?? ""} — ${listing.kms ? listing.kms.toLocaleString() + " km" : "? km"} — $${picklesPrice.toLocaleString()}`;

            await supabase
              .from("pickles_buy_now_listings")
              .update({ matched_fingerprint_id: fp.id, match_alerted_at: now })
              .eq("id", listing.id);

            alerts.push({
              listing_id: listing.id,
              listing_summary: summary,
              fingerprint_id: fp.id,
              fingerprint_label: `${fp.make} ${fp.model} ${fp.variant ?? ""}`.trim(),
              pickles_price: picklesPrice,
              historical_sold_price: soldPrice,
              estimated_margin: spread,
              direct_link: listing.listing_url ?? "",
            });

            matched++;
            break;
          }
        }
      }
    }

    console.log(`[pickles-buy-now-scan] Matched: ${matched}, Alerts: ${alerts.length}`);

    // ── 6. Slack alert ──
    if (alerts.length > 0) {
      const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
      if (slackUrl) {
        const blocks = alerts.map((a) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              `🎯 *Pickles Buy Now Match*`,
              a.listing_summary,
              `Fingerprint: _${a.fingerprint_label}_`,
              `Pickles: $${a.pickles_price.toLocaleString()} | Sold: $${a.historical_sold_price.toLocaleString()} | Spread: *$${a.estimated_margin.toLocaleString()}*`,
              a.direct_link ? `<${a.direct_link}|View Listing>` : "",
            ].filter(Boolean).join("\n"),
          },
        }));

        await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks }),
        }).catch((e) => console.error("[pickles-buy-now-scan] Slack error:", e));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scraped: rawListings.length,
        inserted,
        updated,
        matched,
        alerts: alerts.length,
        content_hash: contentHash,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[pickles-buy-now-scan] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
