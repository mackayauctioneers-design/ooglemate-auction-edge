import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SEARCH_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
const MAX_PAGES = 10;
const MAX_DETAIL_FETCHES = 50;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

interface Listing {
  id: string;
  year: number;
  make: string;
  model: string;
  price: number;
  kms: number | null;
  listing_url: string;
}

/** Phase 1: Scrape search pages, collect detail URLs only */
async function collectDetailUrls(firecrawlKey: string): Promise<Map<string, { id: string; year: number; make: string; model: string; url: string }>> {
  const allUrls = new Map<string, { id: string; year: number; make: string; model: string; url: string }>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = SEARCH_URL + "&page=" + page;
    console.log(`[SEARCH] Page ${page}`);

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + firecrawlKey, "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl, formats: ["markdown"], waitFor: 5000, onlyMainContent: false })
    });

    if (!resp.ok) { console.error(`[SEARCH] Firecrawl error page ${page}`); break; }

    const data = await resp.json();
    const md = data.data?.markdown || data.markdown || "";
    if (!md || md.length < 200) { console.log(`[SEARCH] No content page ${page}, stopping`); break; }

    const urls = md.match(/https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s)"]+/gi) || [];
    console.log(`[SEARCH] Page ${page}: ${urls.length} URLs`);
    if (urls.length === 0) break;

    for (const url of urls) {
      if (allUrls.has(url)) continue;
      const slugMatch = url.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
      if (!slugMatch) continue;

      const year = parseInt(slugMatch[1]);
      const make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
      const model = slugMatch[3].split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

      allUrls.set(url, { id: "pickles-" + slugMatch[4], year, make, model, url });
    }
  }

  return allUrls;
}

/** Phase 2: Scrape individual detail pages for price */
async function fetchDetailPrice(url: string, firecrawlKey: string): Promise<{ price: number; kms: number | null }> {
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + firecrawlKey, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], waitFor: 3000, onlyMainContent: false })
    });

    if (!resp.ok) return { price: 0, kms: null };

    const data = await resp.json();
    const md = data.data?.markdown || data.markdown || "";

    // Price extraction - detail pages have clear price labels
    let price = 0;
    const pricePatterns = [
      /buy\s*now[:\s]*\$\s*([\d,]+)/i,
      /price[:\s]*\$\s*([\d,]+)/i,
      /\$\s*([\d,]+(?:\.\d{2})?)\s*/g,
    ];

    for (const pattern of pricePatterns) {
      const match = md.match(pattern);
      if (match) {
        const raw = (match[1] || "").replace(/,/g, "");
        const parsed = parseInt(raw);
        // Only accept prices in realistic vehicle range
        if (parsed >= 2000 && parsed <= 200000) {
          price = parsed;
          break;
        }
      }
    }

    // If no labeled price found, collect all dollar amounts and pick the most likely
    if (price === 0) {
      const allPrices: number[] = [];
      const globalPattern = /\$\s*([\d,]+)/g;
      let m;
      while ((m = globalPattern.exec(md)) !== null) {
        const val = parseInt(m[1].replace(/,/g, ""));
        if (val >= 2000 && val <= 200000) allPrices.push(val);
      }
      if (allPrices.length > 0) {
        // Most prominent price is usually the first large one
        price = allPrices[0];
      }
    }

    // KM extraction
    let kms: number | null = null;
    const kmMatch = md.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
    if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""));

    return { price, kms };
  } catch (e) {
    console.error(`[DETAIL] Error fetching ${url}:`, e);
    return { price: 0, kms: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const force = new URL(req.url).searchParams.get("force") === "true";

  if (!force) {
    const aestHour = (new Date().getUTCHours() + 10) % 24;
    if (aestHour < 8 || aestHour >= 18) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
  }

  try {
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Phase 1: Collect all detail URLs from search pages
    const urlMap = await collectDetailUrls(firecrawlKey);
    console.log(`[RADAR] Collected ${urlMap.size} unique detail URLs`);

    // Filter salvage before wasting detail fetches
    const salvageRe = /salvage|write.?off|wovr|repairable|hail|insurance/i;
    const candidates = Array.from(urlMap.values()).filter(
      (item) => !salvageRe.test(item.make + " " + item.model)
    );
    console.log(`[RADAR] ${candidates.length} non-salvage candidates`);

    // Phase 2: Fetch detail pages for price (capped)
    const toFetch = candidates.slice(0, MAX_DETAIL_FETCHES);
    const listings: Listing[] = [];

    for (const item of toFetch) {
      const { price, kms } = await fetchDetailPrice(item.url, firecrawlKey);
      if (price > 0) {
        listings.push({ id: item.id, year: item.year, make: item.make, model: item.model, price, kms, listing_url: item.url });
      }
      // Small delay to be polite
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[RADAR] ${listings.length} listings with valid prices from ${toFetch.length} detail fetches`);

    // Phase 3: Match against liquidity profiles
    const { data: profiles } = await sb.from("dealer_liquidity_profiles").select("*");
    console.log(`[RADAR] ${(profiles || []).length} liquidity profiles`);

    const matched: any[] = [];
    for (const li of listings) {
      for (const p of (profiles || [])) {
        let score = 0;
        if (li.make.toLowerCase() === (p.make || "").toLowerCase()) score += 30;
        if (li.model.toLowerCase() === (p.model || "").toLowerCase()) score += 30;
        if (li.year >= p.year_min && li.year <= p.year_max) score += 20;
        if (li.kms !== null && li.kms >= (p.km_min || 0) && li.kms <= (p.km_max || 999999)) score += 20;
        if (score >= 70) {
          const resale = p.median_sell_price || li.price * 1.15;
          const profit = Math.max(0, resale - li.price);
          matched.push({
            id: li.id, year: li.year, make: li.make, model: li.model,
            price: li.price, listing_url: li.listing_url,
            match_tier: profit > (p.p75_profit || 5000) ? "HIGH" : profit > 2000 ? "MED" : "LOW",
            match_dealer_key: p.dealer_key,
            match_expected_profit: profit, match_expected_resale: resale, match_score: score
          });
          break;
        }
      }
    }

    matched.sort((a, b) => (b.match_expected_profit || 0) - (a.match_expected_profit || 0));
    const top = matched.slice(0, 5);

    // Phase 4: Slack alerts
    const wh = Deno.env.get("SLACK_WEBHOOK_URL");
    let sent = 0;
    if (wh && top.length > 0) {
      for (const m of top) {
        try {
          const r = await fetch(wh, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🟢 Pickles Buy Now Alert\n${m.year} ${m.make} ${m.model}\nPrice: ${fmtMoney(m.price)} | Resale: ${fmtMoney(m.match_expected_resale)} | Profit: +${fmtMoney(m.match_expected_profit)}\nTier: ${m.match_tier}\n${m.listing_url}`
            })
          });
          if (r.ok) sent++;
        } catch (_e) { /* ignore slack errors */ }
      }
    }

    const result = { ok: true, urls_found: urlMap.size, detail_fetched: toFetch.length, priced: listings.length, matched: matched.length, alerted: top.length, slack_sent: sent };
    console.log("[RADAR] Done:", result);
    return new Response(JSON.stringify(result), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("[RADAR] Error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
