import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES SEARCH HARVESTER + BUY NOW RADAR
 * 
 * Two modes:
 * 1. ?mode=buynow → Buy Now radar: scrapes Pickles fixed-price listings,
 *    fetches detail pages for accurate pricing, matches against liquidity
 *    profiles, sends Slack alerts for profitable opportunities.
 * 
 * 2. Default (POST with body) → Original Apify-powered search harvester.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ═══════════════════════════════════════════════════════════════
// BUY NOW RADAR (mode=buynow)
// ═══════════════════════════════════════════════════════════════

const BN_SEARCH_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
const BN_MAX_PAGES = 10;
const BN_MAX_DETAIL_FETCHES = 50;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

async function collectBuyNowUrls(firecrawlKey: string): Promise<Map<string, { id: string; year: number; make: string; model: string; url: string }>> {
  const allUrls = new Map<string, { id: string; year: number; make: string; model: string; url: string }>();

  for (let page = 1; page <= BN_MAX_PAGES; page++) {
    const pageUrl = BN_SEARCH_URL + "&page=" + page;
    console.log(`[BN] Page ${page}`);

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + firecrawlKey, "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl, formats: ["markdown"], waitFor: 5000, onlyMainContent: false })
    });

    if (!resp.ok) { console.error(`[BN] Firecrawl error page ${page}`); break; }

    const data = await resp.json();
    const md = data.data?.markdown || data.markdown || "";
    if (!md || md.length < 200) { console.log(`[BN] No content page ${page}, stopping`); break; }

    const urls = md.match(/https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s)"]+/gi) || [];
    console.log(`[BN] Page ${page}: ${urls.length} URLs`);
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

    let price = 0;
    const pricePatterns = [
      /buy\s*now[:\s]*\$\s*([\d,]+)/i,
      /price[:\s]*\$\s*([\d,]+)/i,
    ];

    for (const pattern of pricePatterns) {
      const match = md.match(pattern);
      if (match) {
        const parsed = parseInt(match[1].replace(/,/g, ""));
        if (parsed >= 2000 && parsed <= 200000) { price = parsed; break; }
      }
    }

    // Fallback: first realistic dollar amount
    if (price === 0) {
      const globalPattern = /\$\s*([\d,]+)/g;
      let m;
      while ((m = globalPattern.exec(md)) !== null) {
        const val = parseInt(m[1].replace(/,/g, ""));
        if (val >= 2000 && val <= 200000) { price = val; break; }
      }
    }

    let kms: number | null = null;
    const kmMatch = md.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
    if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""));

    return { price, kms };
  } catch (e) {
    console.error(`[BN] Detail error ${url}:`, e);
    return { price: 0, kms: null };
  }
}

async function runBuyNowRadar(req: Request): Promise<Response> {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const force = new URL(req.url).searchParams.get("force") === "true";

  if (!force) {
    const aestHour = (new Date().getUTCHours() + 10) % 24;
    if (aestHour < 8 || aestHour >= 18) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Phase 1: Collect URLs from search pages
  const urlMap = await collectBuyNowUrls(firecrawlKey);
  console.log(`[BN] ${urlMap.size} unique URLs`);

  // Filter salvage
  const salvageRe = /salvage|write.?off|wovr|repairable|hail|insurance/i;
  const candidates = Array.from(urlMap.values()).filter(
    (item) => !salvageRe.test(item.make + " " + item.model)
  );

  // Phase 2: Detail page price extraction
  const toFetch = candidates.slice(0, BN_MAX_DETAIL_FETCHES);
  const listings: { id: string; year: number; make: string; model: string; price: number; kms: number | null; listing_url: string }[] = [];

  for (const item of toFetch) {
    const { price, kms } = await fetchDetailPrice(item.url, firecrawlKey);
    if (price > 0) {
      listings.push({ id: item.id, year: item.year, make: item.make, model: item.model, price, kms, listing_url: item.url });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[BN] ${listings.length} priced from ${toFetch.length} detail fetches`);

  // Phase 3: Match against liquidity profiles
  const { data: profiles } = await sb.from("dealer_liquidity_profiles").select("*");

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

  // Phase 4: Slack
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
      } catch (_e) { /* ignore */ }
    }
  }

  const result = { ok: true, urls_found: urlMap.size, detail_fetched: toFetch.length, priced: listings.length, matched: matched.length, alerted: top.length, slack_sent: sent };
  console.log("[BN] Done:", result);
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// ORIGINAL SEARCH HARVESTER (default mode)
// ═══════════════════════════════════════════════════════════════

const PAGE_FUNCTION = `
async function pageFunction(context) {
  const { request, log, $ } = context;
  
  log.info('Processing: ' + request.url);
  
  await context.waitFor(5000);
  
  const detailUrls = [];
  const seen = new Set();
  
  $('a[href*="/used/details/cars/"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\\\\/used\\\\/details\\\\/cars\\\\/[^\\\\/]+\\\\/(\\\\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      detailUrls.push({
        url: 'https://www.pickles.com.au' + (href.startsWith('/') ? href : '/' + href),
        stockId: match[1]
      });
    }
  });
  
  $('a[href*="/used/item/cars/"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\\\\/used\\\\/item\\\\/cars\\\\/[^-]+-?(\\\\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      detailUrls.push({
        url: 'https://www.pickles.com.au' + (href.startsWith('/') ? href : '/' + href),
        stockId: match[1]
      });
    }
  });
  
  $('[data-stock-id], [data-item-id], [data-listing-id]').each((i, el) => {
    const stockId = $(el).attr('data-stock-id') || $(el).attr('data-item-id') || $(el).attr('data-listing-id');
    if (stockId && !seen.has(stockId)) {
      seen.add(stockId);
      detailUrls.push({
        url: 'https://www.pickles.com.au/used/details/cars/vehicle/' + stockId,
        stockId: stockId
      });
    }
  });
  
  log.info('Found ' + detailUrls.length + ' detail URLs');
  
  return {
    url: request.url,
    detailUrls: detailUrls,
    totalFound: detailUrls.length,
    timestamp: new Date().toISOString()
  };
}
`;

function buildLobSearchUrl(make?: string, model?: string, page = 1, yearMin?: number): string {
  const base = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
  
  let path = base;
  if (make) {
    const normMake = make.toLowerCase().trim().replace(/\s+/g, "-");
    path += `/${normMake}`;
    if (model) {
      const normModel = model.toLowerCase().trim().replace(/\s+/g, "-");
      path += `/${normModel}`;
    }
  }
  
  const params = new URLSearchParams();
  params.set("contentkey", "all-cars");
  params.set("limit", "120");
  params.set("page", String(page));
  params.set("sort", "endDate asc");
  params.set("buyMethod", "Pickles Online,Pickles Live");
  
  if (yearMin) {
    params.set("year-min", String(yearMin));
  }
  
  return `${path}?${params.toString()}`;
}

function generateStartUrls(make?: string, model?: string, maxPages = 5, yearMin?: number): string[] {
  const urls: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    urls.push(buildLobSearchUrl(make, model, page, yearMin));
  }
  return urls;
}

async function runOriginalHarvester(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apifyToken = Deno.env.get("APIFY_TOKEN");
  const supabase = createClient(supabaseUrl, supabaseKey);
  const startTime = Date.now();

  const body = await req.json().catch(() => ({}));
  const { make, model, max_pages = 5, year_min, debug = false } = body;

  if (!apifyToken) {
    return new Response(
      JSON.stringify({ success: false, error: "APIFY_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const startUrls = generateStartUrls(make, model, max_pages, year_min);
  const baseSearchUrl = buildLobSearchUrl(make, model, 1, year_min);
  
  console.log(`[HARVEST] Starting Pickles harvest for ${make || 'all'} ${model || ''}`);

  if (debug) {
    return new Response(
      JSON.stringify({ success: true, debug: true, start_urls: startUrls }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const runId = crypto.randomUUID();
  await supabase.from("pickles_harvest_runs").insert({ id: runId, search_url: baseSearchUrl, status: "running" });

  const actorId = "apify/web-scraper";
  const apifyInput = {
    startUrls: startUrls.map(url => ({ url })),
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "AU" },
    waitUntil: ["networkidle2"],
    maxCrawlingDepth: 0,
    maxRequestRetries: 2,
    maxPagesPerCrawl: max_pages,
  };

  const actorResponse = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${apifyToken}&waitForFinish=0`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apifyInput) }
  );

  if (!actorResponse.ok) {
    const errText = await actorResponse.text();
    await supabase.from("pickles_harvest_runs").update({
      status: "failed", errors: [`Apify trigger failed: ${actorResponse.status}`], duration_ms: Date.now() - startTime,
    }).eq("id", runId);
    
    return new Response(
      JSON.stringify({ success: false, error: `Apify trigger failed: ${actorResponse.status}`, details: errText.substring(0, 500) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const actorData = await actorResponse.json();
  const apifyRunId = actorData.data?.id;
  const datasetId = actorData.data?.defaultDatasetId;

  await supabase.from("apify_runs_queue").insert({
    source: "pickles-harvest", run_id: apifyRunId, dataset_id: datasetId,
    input: { make, model, max_pages, year_min, harvest_run_id: runId, start_urls: startUrls },
    status: "queued",
  });

  await supabase.from("pickles_harvest_runs").update({ status: "queued", duration_ms: Date.now() - startTime }).eq("id", runId);

  return new Response(
    JSON.stringify({
      success: true, run_id: runId, apify_run_id: apifyRunId, dataset_id: datasetId,
      search_url: baseSearchUrl, pages_queued: startUrls.length,
      message: "Apify scraper triggered. Use pickles-detail-crawler to fetch results when complete.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ═══════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const mode = new URL(req.url).searchParams.get("mode");

    if (mode === "buynow") {
      return await runBuyNowRadar(req);
    }

    // Default: original harvester
    return await runOriginalHarvester(req);
  } catch (error) {
    console.error("[ROUTER] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
