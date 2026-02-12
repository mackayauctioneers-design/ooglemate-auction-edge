// Pickles Buy Now Scanner v2.1 — Liquidity Profile Matching
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

interface LiquidityProfile {
  id: string;
  dealer_key: string;
  dealer_name: string;
  make: string;
  model: string;
  badge: string | null;
  year_min: number;
  year_max: number;
  km_min: number;
  km_max: number;
  flip_count: number;
  median_sell_price: number | null;
  median_profit: number | null;
  confidence_tier: string;
  min_viable_profit_floor: number;
  last_sale_date: string | null;
}

// ── Deterministic Markdown Parser ──
function parseListingsFromMarkdown(markdown: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const seen = new Set<string>();

  const detailUrlRegex = /https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/gi;
  let match: RegExpExecArray | null;

  while ((match = detailUrlRegex.exec(markdown)) !== null) {
    const fullUrl = match[0];
    const stockId = match[4];

    if (seen.has(stockId)) continue;
    seen.add(stockId);

    const year = parseInt(match[1], 10);
    const make = match[2].charAt(0).toUpperCase() + match[2].slice(1);
    const modelRaw = match[3].replace(/-/g, " ");
    const model = modelRaw.charAt(0).toUpperCase() + modelRaw.slice(1);

    const moreDetailsPattern = `MORE DETAILS](${fullUrl})`;
    const moreDetailsIdx = markdown.indexOf(moreDetailsPattern);

    let kms: number | null = null;
    let price: number | null = null;
    let location: string | null = null;

    if (moreDetailsIdx > 0) {
      let openBracketIdx = moreDetailsIdx;
      for (let i = moreDetailsIdx - 1; i >= Math.max(0, moreDetailsIdx - 2000); i--) {
        if (markdown[i] === "[") { openBracketIdx = i; break; }
      }
      const blockContent = markdown.substring(openBracketIdx, moreDetailsIdx);

      const kmMatch = blockContent.match(/([\d,]+)\s*km\b/i);
      if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""), 10);

      const priceMatch = blockContent.match(/Buy\s*\$\s*([\d,]+)/i);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ""), 10);

      const locMatch = blockContent.match(/([A-Za-z][A-Za-z ]+,\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT))/);
      if (locMatch) location = locMatch[1].trim();
    }

    listings.push({ url: fullUrl, year, make, model, variant: null, kms, price, location });
  }

  return listings;
}

// ── SHA-256 hash for change detection ──
async function computeHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  functionName: string, endpoint: string, format: string,
  estimatedCredits: number, url: string, note?: string
) {
  await supabase.from("firecrawl_credit_log").insert({
    function_name: functionName, endpoint, format_used: format,
    estimated_credits: estimatedCredits, url_scraped: url, note: note ?? null,
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
      body: JSON.stringify({ url: BUY_NOW_URL, formats: ["markdown"], onlyMainContent: true }),
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

    const contentUnchanged = lastHash?.scrape_content_hash === contentHash;
    if (contentUnchanged) {
      console.log("[pickles-buy-now-scan] Content unchanged — skipping parse, running matching only");
    }

    // ── 3. Deterministic parse + upsert (skip if content unchanged) ──
    let inserted = 0;
    let updated = 0;
    const now = new Date().toISOString();

    if (!contentUnchanged) {
      const rawListings = parseListingsFromMarkdown(markdown);
      console.log(`[pickles-buy-now-scan] Parsed ${rawListings.length} listings`);

      for (const listing of rawListings) {
        if (!listing.url) continue;
        const { data: existing } = await supabase
          .from("pickles_buy_now_listings").select("id").eq("listing_url", listing.url).maybeSingle();

        if (existing) {
          await supabase.from("pickles_buy_now_listings").update({
            last_seen_at: now, scraped_at: now, price: listing.price ?? null,
            kms: listing.kms ?? null, scrape_content_hash: contentHash,
          }).eq("id", existing.id);
          updated++;
        } else {
          await supabase.from("pickles_buy_now_listings").insert({
            listing_url: listing.url, year: listing.year ?? null, make: listing.make ?? null,
            model: listing.model ?? null, variant: listing.variant ?? null,
            kms: listing.kms ?? null, price: listing.price ?? null,
            location: listing.location ?? null, scrape_content_hash: contentHash,
          });
          inserted++;
        }
      }
      console.log(`[pickles-buy-now-scan] Upserted: ${inserted} new, ${updated} updated`);
    }

    // ── 5. Liquidity Profile Matching ──
    const { data: unmatched } = await supabase
      .from("pickles_buy_now_listings")
      .select("id, year, make, model, variant, kms, price, listing_url")
      .is("match_alerted_at", null)
      .not("make", "is", null)
      .not("model", "is", null);

    let matched = 0;
    const alerts: {
      listing_summary: string;
      dealer_name: string;
      tier: string;
      pickles_price: number;
      expected_resale: number;
      expected_profit: number;
      direct_link: string;
    }[] = [];

    if (unmatched && unmatched.length > 0) {
      // Fetch all liquidity profiles
      const { data: profiles } = await supabase
        .from("dealer_liquidity_profiles")
        .select("*")
        .gt("median_sell_price", 0);

      if (profiles && profiles.length > 0) {
        for (const listing of unmatched) {
          const listingMake = (listing.make || "").toLowerCase().trim();
          const listingModel = (listing.model || "").toLowerCase().trim();

          // Find all matching profiles
          const candidates: LiquidityProfile[] = [];

          for (const p of profiles) {
            if (listingMake !== (p.make || "").toLowerCase().trim()) continue;
            if (listingModel !== (p.model || "").toLowerCase().trim()) continue;

            if (listing.year && p.year_min && p.year_max) {
              if (listing.year < p.year_min || listing.year > p.year_max) continue;
            }

            if (listing.kms != null && p.km_min != null && p.km_max != null) {
              if (listing.kms < p.km_min || listing.kms > p.km_max) continue;
            }

            candidates.push(p as LiquidityProfile);
          }

          if (candidates.length === 0) continue;

          // Pick best profile: HIGH > MED > LOW, then flip_count, then recency
          const tierOrder: Record<string, number> = { HIGH: 3, MED: 2, LOW: 1 };
          candidates.sort((a, b) => {
            const tierDiff = (tierOrder[b.confidence_tier] || 0) - (tierOrder[a.confidence_tier] || 0);
            if (tierDiff !== 0) return tierDiff;
            if (b.flip_count !== a.flip_count) return b.flip_count - a.flip_count;
            return (a.last_sale_date || "") > (b.last_sale_date || "") ? -1 : 1;
          });

          const bestProfile = candidates[0];
          const picklesPrice = listing.price;
          const expectedResale = bestProfile.median_sell_price;

          if (!picklesPrice || !expectedResale) continue;

          const expectedProfit = expectedResale - picklesPrice;

          // Check minimum profit floor
          if (expectedProfit < bestProfile.min_viable_profit_floor) {
            // Also check "market-obvious" alert (gap >= 7000)
            if (expectedProfit < 7000) continue;
          }

          const summary = `${listing.year ?? "?"} ${listing.make} ${listing.model} ${listing.variant ?? ""} — ${listing.kms ? listing.kms.toLocaleString() + " km" : "? km"} — $${picklesPrice.toLocaleString()}`;

          // Persist match
          await supabase.from("pickles_buy_now_listings").update({
            matched_profile_id: bestProfile.id,
            match_tier: bestProfile.confidence_tier,
            match_expected_resale: expectedResale,
            match_expected_profit: expectedProfit,
            match_dealer_key: bestProfile.dealer_name,
            match_alerted_at: now,
          }).eq("id", listing.id);

          alerts.push({
            listing_summary: summary,
            dealer_name: bestProfile.dealer_name,
            tier: bestProfile.confidence_tier,
            pickles_price: picklesPrice,
            expected_resale: expectedResale,
            expected_profit: expectedProfit,
            direct_link: listing.listing_url ?? "",
          });

          matched++;
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
              `🔥 *${a.tier} Liquidity Match* (${a.dealer_name})`,
              a.listing_summary,
              `Expected resale: $${a.expected_resale.toLocaleString()} | Est profit: *$${a.expected_profit.toLocaleString()}*`,
              a.direct_link ? `<${a.direct_link}|Open Pickles Listing>` : "",
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
        success: true, scraped: contentUnchanged ? 0 : inserted + updated, inserted, updated,
        matched, alerts: alerts.length, content_hash: contentHash,
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
