import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// PICKLES SEARCH HARVESTER + BUY NOW RADAR
// Two modes:
// POST with body {"mode":"buynow","force":true} -> Buy Now radar
// POST with body (default) -> Original Apify harvester

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- BUY NOW RADAR CONSTANTS ---
var BN_SEARCH_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
var BN_MAX_PAGES = 10;
var BN_MAX_DETAIL = 15;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

async function collectBuyNowUrls(key: string) {
  var allUrls = new Map();
  for (var pg = 1; pg <= BN_MAX_PAGES; pg++) {
    var pgUrl = BN_SEARCH_URL + "&page=" + pg;
    console.log("[BN] Page " + pg);
    var resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ url: pgUrl, formats: ["markdown"], waitFor: 5000, onlyMainContent: false })
    });
    if (!resp.ok) { console.error("[BN] Firecrawl err page " + pg); break; }
    var data = await resp.json();
    var md = data.data?.markdown || data.markdown || "";
    if (!md || md.length < 200) { console.log("[BN] No content page " + pg); break; }
    var urls = md.match(/https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s)"]+/gi) || [];
    console.log("[BN] Page " + pg + ": " + urls.length + " URLs");
    if (urls.length === 0) break;
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (allUrls.has(u)) continue;
      var sm = u.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
      if (!sm) continue;
      var yr = parseInt(sm[1]);
      var mk = sm[2].charAt(0).toUpperCase() + sm[2].slice(1);
      var ml = sm[3].split("-").map(function(w: string) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
      allUrls.set(u, { id: "pickles-" + sm[4], year: yr, make: mk, model: ml, url: u });
    }
  }
  return allUrls;
}

async function fetchDetailPrice(url: string, key: string) {
  try {
    var resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, formats: ["markdown"], waitFor: 3000, onlyMainContent: false })
    });
    if (!resp.ok) return { price: 0, kms: null };
    var data = await resp.json();
    var md = data.data?.markdown || data.markdown || "";
    var price = 0;
    var p1 = md.match(/buy\s*now[:\s]*\$\s*([\d,]+)/i);
    if (p1) { var v1 = parseInt(p1[1].replace(/,/g, "")); if (v1 >= 2000 && v1 <= 200000) price = v1; }
    if (price === 0) {
      var p2 = md.match(/price[:\s]*\$\s*([\d,]+)/i);
      if (p2) { var v2 = parseInt(p2[1].replace(/,/g, "")); if (v2 >= 2000 && v2 <= 200000) price = v2; }
    }
    if (price === 0) {
      var gp = /\$\s*([\d,]+)/g;
      var gm;
      while ((gm = gp.exec(md)) !== null) {
        var gv = parseInt(gm[1].replace(/,/g, ""));
        if (gv >= 2000 && gv <= 200000) { price = gv; break; }
      }
    }
    var kms: number | null = null;
    var km = md.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
    if (km) kms = parseInt(km[1].replace(/,/g, ""));
    return { price: price, kms: kms };
  } catch (e) {
    console.error("[BN] Detail err " + url);
    return { price: 0, kms: null };
  }
}

async function runBuyNowRadar(force: boolean) {
  var sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!force) {
    var aestHour = (new Date().getUTCHours() + 10) % 24;
    if (aestHour < 8 || aestHour >= 18) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
  var fcKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!fcKey) {
    return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  var urlMap = await collectBuyNowUrls(fcKey);
  console.log("[BN] " + urlMap.size + " unique URLs");
  var salvageRe = /salvage|write.?off|wovr|repairable|hail|insurance/i;
  var candidates = Array.from(urlMap.values()).filter(function(item: any) {
    return !salvageRe.test(item.make + " " + item.model);
  });
  console.log("[BN] " + candidates.length + " non-salvage");
  var toFetch = candidates.slice(0, BN_MAX_DETAIL);
  var listings: any[] = [];
  for (var i = 0; i < toFetch.length; i++) {
    var item = toFetch[i];
    var det = await fetchDetailPrice(item.url, fcKey);
    if (det.price > 0) {
      listings.push({ id: item.id, year: item.year, make: item.make, model: item.model, price: det.price, kms: det.kms, listing_url: item.url });
    }
    await new Promise(function(r) { setTimeout(r, 200); });
  }
  console.log("[BN] " + listings.length + " priced from " + toFetch.length + " detail fetches");
  var pr = await sb.from("dealer_liquidity_profiles").select("*");
  var profiles = pr.data || [];
  console.log("[BN] " + profiles.length + " profiles");
  var matched: any[] = [];
  for (var li = 0; li < listings.length; li++) {
    var l = listings[li];
    for (var pi = 0; pi < profiles.length; pi++) {
      var p = profiles[pi];
      var score = 0;
      if (l.make.toLowerCase() === (p.make || "").toLowerCase()) score += 30;
      if (l.model.toLowerCase() === (p.model || "").toLowerCase()) score += 30;
      if (l.year >= p.year_min && l.year <= p.year_max) score += 20;
      if (l.kms !== null && l.kms >= (p.km_min || 0) && l.kms <= (p.km_max || 999999)) score += 20;
      if (score >= 70) {
        var resale = p.median_sell_price || l.price * 1.15;
        var profit = Math.max(0, resale - l.price);
        matched.push({ id: l.id, year: l.year, make: l.make, model: l.model, price: l.price, listing_url: l.listing_url, match_tier: profit > (p.p75_profit || 5000) ? "HIGH" : profit > 2000 ? "MED" : "LOW", match_dealer_key: p.dealer_key, match_expected_profit: profit, match_expected_resale: resale, match_score: score });
        break;
      }
    }
  }
  matched.sort(function(a: any, b: any) { return (b.match_expected_profit || 0) - (a.match_expected_profit || 0); });
  var top = matched.slice(0, 5);
  var wh = Deno.env.get("SLACK_WEBHOOK_URL");
  var sent = 0;
  if (wh && top.length > 0) {
    for (var k = 0; k < top.length; k++) {
      var m = top[k];
      try {
        var r = await fetch(wh, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Pickles Buy Now Alert\n" + m.year + " " + m.make + " " + m.model + "\nPrice: " + fmtMoney(m.price) + " | Resale: " + fmtMoney(m.match_expected_resale) + " | Profit: +" + fmtMoney(m.match_expected_profit) + "\nTier: " + m.match_tier + "\n" + m.listing_url }) });
        if (r.ok) sent++;
      } catch (_e) {}
    }
  }
  var result = { ok: true, urls_found: urlMap.size, detail_fetched: toFetch.length, priced: listings.length, matched: matched.length, alerted: top.length, slack_sent: sent };
  console.log("[BN] Done: " + JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// --- ORIGINAL HARVESTER ---
var PAGE_FUNCTION = "async function pageFunction(context) { var req = context.request; var log = context.log; var dollar = context.$; log.info('Processing: ' + req.url); await context.waitFor(5000); var detailUrls = []; var seen = new Set(); dollar('a[href*=\"/used/details/cars/\"]').each(function(i, el) { var href = dollar(el).attr('href'); var match = href.match(/\\/used\\/details\\/cars\\/[^\\/]+\\/(\\d+)/); if (match && !seen.has(match[1])) { seen.add(match[1]); detailUrls.push({ url: 'https://www.pickles.com.au' + (href.startsWith('/') ? href : '/' + href), stockId: match[1] }); } }); dollar('a[href*=\"/used/item/cars/\"]').each(function(i, el) { var href = dollar(el).attr('href'); var match = href.match(/\\/used\\/item\\/cars\\/[^-]+-?(\\d+)/); if (match && !seen.has(match[1])) { seen.add(match[1]); detailUrls.push({ url: 'https://www.pickles.com.au' + (href.startsWith('/') ? href : '/' + href), stockId: match[1] }); } }); dollar('[data-stock-id], [data-item-id], [data-listing-id]').each(function(i, el) { var stockId = dollar(el).attr('data-stock-id') || dollar(el).attr('data-item-id') || dollar(el).attr('data-listing-id'); if (stockId && !seen.has(stockId)) { seen.add(stockId); detailUrls.push({ url: 'https://www.pickles.com.au/used/details/cars/vehicle/' + stockId, stockId: stockId }); } }); log.info('Found ' + detailUrls.length + ' detail URLs'); return { url: req.url, detailUrls: detailUrls, totalFound: detailUrls.length, timestamp: new Date().toISOString() }; }";

function buildLobSearchUrl(make?: string, model?: string, page?: number, yearMin?: number): string {
  var base = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
  var path = base;
  if (make) {
    path += "/" + make.toLowerCase().trim().replace(/\s+/g, "-");
    if (model) path += "/" + model.toLowerCase().trim().replace(/\s+/g, "-");
  }
  var params = new URLSearchParams();
  params.set("contentkey", "all-cars");
  params.set("limit", "120");
  params.set("page", String(page || 1));
  params.set("sort", "endDate asc");
  params.set("buyMethod", "Pickles Online,Pickles Live");
  if (yearMin) params.set("year-min", String(yearMin));
  return path + "?" + params.toString();
}

async function runOriginalHarvester(req: Request) {
  var supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  var apifyToken = Deno.env.get("APIFY_TOKEN");
  var startTime = Date.now();
  var body = await req.json().catch(function() { return {}; });
  var make = body.make;
  var model = body.model;
  var max_pages = body.max_pages || 5;
  var year_min = body.year_min;
  var debug = body.debug || false;
  if (!apifyToken) {
    return new Response(JSON.stringify({ success: false, error: "APIFY_TOKEN not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  var startUrls: string[] = [];
  for (var pg = 1; pg <= max_pages; pg++) { startUrls.push(buildLobSearchUrl(make, model, pg, year_min)); }
  var baseSearchUrl = buildLobSearchUrl(make, model, 1, year_min);
  console.log("[HARVEST] Starting for " + (make || "all") + " " + (model || ""));
  if (debug) {
    return new Response(JSON.stringify({ success: true, debug: true, start_urls: startUrls }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  var runId = crypto.randomUUID();
  await supabase.from("pickles_harvest_runs").insert({ id: runId, search_url: baseSearchUrl, status: "running" });
  var actorId = "apify/web-scraper";
  var apifyInput = { startUrls: startUrls.map(function(u) { return { url: u }; }), pageFunction: PAGE_FUNCTION, proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "AU" }, waitUntil: ["networkidle2"], maxCrawlingDepth: 0, maxRequestRetries: 2, maxPagesPerCrawl: max_pages };
  var actorResp = await fetch("https://api.apify.com/v2/acts/" + encodeURIComponent(actorId) + "/runs?token=" + apifyToken + "&waitForFinish=0", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apifyInput) });
  if (!actorResp.ok) {
    var errText = await actorResp.text();
    await supabase.from("pickles_harvest_runs").update({ status: "failed", errors: ["Apify trigger failed: " + actorResp.status], duration_ms: Date.now() - startTime }).eq("id", runId);
    return new Response(JSON.stringify({ success: false, error: "Apify trigger failed: " + actorResp.status, details: errText.substring(0, 500) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  var actorData = await actorResp.json();
  var apifyRunId = actorData.data?.id;
  var datasetId = actorData.data?.defaultDatasetId;
  await supabase.from("apify_runs_queue").insert({ source: "pickles-harvest", run_id: apifyRunId, dataset_id: datasetId, input: { make: make, model: model, max_pages: max_pages, year_min: year_min, harvest_run_id: runId, start_urls: startUrls }, status: "queued" });
  await supabase.from("pickles_harvest_runs").update({ status: "queued", duration_ms: Date.now() - startTime }).eq("id", runId);
  return new Response(JSON.stringify({ success: true, run_id: runId, apify_run_id: apifyRunId, dataset_id: datasetId, search_url: baseSearchUrl, pages_queued: startUrls.length, message: "Apify scraper triggered. Use pickles-detail-crawler to fetch results when complete." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// --- ROUTER ---
Deno.serve(async function(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    var body = await req.clone().json().catch(function() { return {}; });
    if (body.mode === "buynow") {
      return await runBuyNowRadar(body.force === true);
    }
    return await runOriginalHarvester(req);
  } catch (error) {
    console.error("[ROUTER] Error: " + String(error));
    return new Response(JSON.stringify({ success: false, error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
