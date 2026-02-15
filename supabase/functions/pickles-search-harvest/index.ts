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
var BN_DEVIATION_FLOOR = 4000;
var BN_DAILY_CAP = 5;

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
      var mlParts = sm[3].split("-");
      var ml = mlParts[0].charAt(0).toUpperCase() + mlParts[0].slice(1);
      var variant = mlParts.slice(1).map(function(w: string) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
      allUrls.set(u, { id: "pickles-" + sm[4], year: yr, make: mk, model: ml, variant: variant, url: u });
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

function isPatternStrong(profile: any): boolean {
  if ((profile.flip_count || 0) < 5) return false;
  if ((profile.median_profit || 0) < 3000) return false;
  if (!profile.last_sale_date) return false;
  var lastSale = new Date(profile.last_sale_date);
  var daysSince = (Date.now() - lastSale.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince <= 365;
}

async function callGrokWholesale(listing: any, profile: any, openaiKey: string): Promise<number> {
  try {
    var prompt = "You are a conservative Australian wholesale vehicle pricing analyst.\n\nVehicle:\nYear: " + listing.year + "\nMake: " + listing.make + "\nModel: " + listing.model + "\nKM: " + (listing.kms || "unknown") + "\nBuy Now Price: $" + listing.price + "\n\nInternal Data:\nDealer median sell price: $" + (profile.median_sell_price || 0) + "\nDealer median profit: $" + (profile.median_profit || 0) + "\n\nTask:\n1. Estimate realistic dealer-to-dealer wholesale value (conservative).\n2. Return ONLY the estimated wholesale value as a number. No text, no dollar sign, just the number.";
    var resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 50
      })
    });
    if (!resp.ok) { console.error("[BN] Grok API err " + resp.status); return 0; }
    var data = await resp.json();
    var text = (data.choices?.[0]?.message?.content || "").trim();
    var numMatch = text.match(/[\d,]+/);
    if (!numMatch) return 0;
    return parseInt(numMatch[0].replace(/,/g, ""));
  } catch (e) {
    console.error("[BN] Grok call failed: " + String(e));
    return 0;
  }
}

async function getTodayAlertCount(sb: any): Promise<number> {
  var today = new Date().toISOString().split("T")[0];
  var res = await sb.from("cron_audit_log").select("id", { count: "exact", head: true }).eq("cron_name", "buynow-radar-alert").eq("run_date", today);
  return res.count || 0;
}

async function logAlert(sb: any, listing: any) {
  var today = new Date().toISOString().split("T")[0];
  await sb.from("cron_audit_log").insert({
    cron_name: "buynow-radar-alert",
    run_date: today,
    success: true,
    result: { listing_id: listing.id, make: listing.make, model: listing.model, price: listing.price }
  });
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
  var openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!fcKey) {
    return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!openaiKey) {
    return new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Check daily cap
  var alertsSentToday = await getTodayAlertCount(sb);
  console.log("[BN] Alerts sent today so far: " + alertsSentToday);
  if (alertsSentToday >= BN_DAILY_CAP) {
    return new Response(JSON.stringify({ ok: true, capped: true, alerts_sent_today: alertsSentToday }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

  // Load liquidity profiles
  var pr = await sb.from("dealer_liquidity_profiles").select("*");
  var profiles = pr.data || [];
  console.log("[BN] " + profiles.length + " profiles");

  // STEP 1: Match + compute deviation with hard $4k gate + badge awareness
  var qualified: any[] = [];
  for (var li = 0; li < listings.length; li++) {
    var l = listings[li];
    for (var pi = 0; pi < profiles.length; pi++) {
      var p = profiles[pi];
      var score = 0;
      if (l.make.toLowerCase() === (p.make || "").toLowerCase()) score += 30;
      if (l.model.toLowerCase() === (p.model || "").toLowerCase()) score += 30;
      if (l.year >= p.year_min && l.year <= p.year_max) score += 20;
      if (l.kms !== null && l.kms >= (p.km_min || 0) && l.kms <= (p.km_max || 999999)) score += 20;
      if (score < 70) continue;

      // Badge/variant scoring
      var badgeScore = 0.5; // default: no badge data
      var listingVariant = (l.variant || "").toUpperCase().replace(/\b(4X[24]|AWD|2WD|RWD|4WD|AUTO|MANUAL|CVT|DIESEL|PETROL|TURBO|DUAL\s*CAB|SINGLE\s*CAB|DOUBLE\s*CAB|UTE|WAGON|SEDAN|HATCH)\b/g, "").replace(/\s+/g, " ").trim();
      var profileBadge = (p.badge || "").toUpperCase().trim();
      if (listingVariant && profileBadge) {
        if (listingVariant === profileBadge) badgeScore = 1.0;
        else if (listingVariant.includes(profileBadge) || profileBadge.includes(listingVariant)) badgeScore = 0.7;
        else badgeScore = 0.0; // Badge mismatch — skip
      } else if (profileBadge && !listingVariant) {
        badgeScore = 0.3; // Profile has badge but listing doesn't — low confidence
      }
      if (badgeScore === 0.0) continue; // Hard badge mismatch

      var liquidity_gap = (p.median_sell_price || 0) - l.price;
      var deviation = Math.max(0, liquidity_gap);

      // HARD DEVIATION GATE
      if (deviation < BN_DEVIATION_FLOOR) continue;

      var strong = isPatternStrong(p);

      // CLEAN TRIGGER RULE
      var passes_trigger = (deviation >= 6000) || (deviation >= 4500 && strong);
      if (!passes_trigger) continue;

      var badgeLabel = badgeScore >= 1.0 ? "EXACT BADGE" : badgeScore >= 0.7 ? "CLOSE BADGE" : "MAKE/MODEL ONLY";

      qualified.push({
        id: l.id, year: l.year, make: l.make, model: l.model,
        variant: l.variant || null, badge_label: badgeLabel, badge_score: badgeScore,
        price: l.price, kms: l.kms, listing_url: l.listing_url,
        deviation: deviation, pattern_strong: strong,
        dealer_key: p.dealer_key, dealer_name: p.dealer_name,
        median_sell_price: p.median_sell_price || 0,
        median_profit: p.median_profit || 0,
        flip_count: p.flip_count || 0,
        match_score: score * badgeScore
      });
      break;
    }
  }
  qualified.sort(function(a: any, b: any) { return b.deviation - a.deviation; });
  console.log("[BN] " + qualified.length + " qualified before Grok (passed deviation + trigger)");

  // STEP 2: Grok confirmation layer
  var grokPassed: any[] = [];
  var remainingSlots = BN_DAILY_CAP - alertsSentToday;
  // Only send top candidates to Grok (cap at remaining slots + buffer)
  var toGrok = qualified.slice(0, Math.min(qualified.length, remainingSlots + 3));
  for (var gi = 0; gi < toGrok.length; gi++) {
    var q = toGrok[gi];
    var grokEstimate = await callGrokWholesale(q, q, openaiKey);
    var grok_gap = grokEstimate - q.price;
    console.log("[BN] Grok: " + q.year + " " + q.make + " " + q.model + " estimate=" + grokEstimate + " gap=" + grok_gap);
    if (grok_gap >= 3500) {
      grokPassed.push({ ...q, grok_estimate: grokEstimate, grok_gap: grok_gap });
    }
  }
  console.log("[BN] " + grokPassed.length + " passed Grok confirmation");

  // STEP 3: Insert ALL grok-passed into opportunities table (no cap on DB)
  var dbInserted = 0;
  for (var di = 0; di < grokPassed.length; di++) {
    var d = grokPassed[di];
    var confScore = (d.deviation * 0.5) + (d.grok_gap * 0.4) + (d.pattern_strong ? 1000 : 0);
    var confTier = confScore >= 5000 ? "HIGH" : confScore >= 3000 ? "MEDIUM" : "LOW";
    var oppRow = {
      source_type: "buy_now",
      listing_url: d.listing_url,
      stock_id: d.id,
      year: d.year,
      make: d.make,
      model: d.model,
      kms: d.kms,
      buy_price: d.price,
      dealer_median_price: d.median_sell_price,
      liquidity_gap: d.deviation,
      deviation: d.deviation,
      grok_wholesale_estimate: d.grok_estimate,
      grok_gap: d.grok_gap,
      flip_count: d.flip_count,
      median_profit: d.median_profit,
      pattern_strong: d.pattern_strong,
      confidence_score: confScore,
      confidence_tier: confTier,
      status: "new"
    };
    var upsertRes = await sb.from("opportunities").upsert(oppRow, { onConflict: "listing_url", ignoreDuplicates: false });
    if (!upsertRes.error) dbInserted++;
    else console.error("[BN] Opp upsert err: " + JSON.stringify(upsertRes.error));
  }
  console.log("[BN] " + dbInserted + " opportunities upserted");

  // STEP 4: Send Slack alerts (capped)
  var wh = Deno.env.get("SLACK_WEBHOOK_URL");
  var sent = 0;
  var toAlert = grokPassed.slice(0, remainingSlots);
  if (wh && toAlert.length > 0) {
    for (var k = 0; k < toAlert.length; k++) {
      var m = toAlert[k];
      try {
        var confScoreSlack = (m.deviation * 0.5) + (m.grok_gap * 0.4) + (m.pattern_strong ? 1000 : 0);
        var slackText = "HIGH-CONVICTION BUY NOW SIGNAL" + (m.badge_label ? " (" + m.badge_label + ")" : "") + "\n\n"
          + "Vehicle: " + m.year + " " + m.make + " " + m.model + " " + (m.variant || "") + "\n"
          + "Buy Now: " + fmtMoney(m.price) + "\n"
          + "Dealer Median: " + fmtMoney(m.median_sell_price) + "\n"
          + "Spread: +" + fmtMoney(m.deviation) + "\n"
          + "Grok Wholesale: " + fmtMoney(m.grok_estimate) + "\n"
          + "AI Gap: +" + fmtMoney(m.grok_gap) + "\n"
          + "History: " + m.flip_count + " flips | Median profit " + fmtMoney(m.median_profit) + "\n"
          + "Source: buy_now\n\n"
          + m.listing_url;
        var r = await fetch(wh, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: slackText })
        });
        if (r.ok) {
          sent++;
          await logAlert(sb, m);
        }
      } catch (_e) {}
    }
  }

  var result = {
    ok: true,
    urls_found: urlMap.size,
    detail_fetched: toFetch.length,
    priced: listings.length,
    qualified_before_grok: qualified.length,
    grok_passed: grokPassed.length,
    db_inserted: dbInserted,
    alerts_sent_today: alertsSentToday + sent,
    slack_sent: sent
  };
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
