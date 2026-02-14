import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const BASE_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
const MAX_PAGES = 10;

function fmtMoney(n: any): string {
  if (!n) return "--";
  return "$" + Math.round(n).toLocaleString();
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

    const allListings: Map<string, any> = new Map();

    for (var page = 1; page <= MAX_PAGES; page++) {
      var pageUrl = BASE_URL + "&page=" + page;
      console.log("Scraping page " + page);

      var scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { "Authorization": "Bearer " + firecrawlKey, "Content-Type": "application/json" },
        body: JSON.stringify({ url: pageUrl, formats: ["markdown"], waitFor: 5000, onlyMainContent: false })
      });

      if (!scrapeResp.ok) { console.error("Firecrawl err page " + page); break; }

      var scrapeData = await scrapeResp.json();
      var markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
      console.log("Page " + page + " md len: " + markdown.length);
      if (!markdown || markdown.length < 200) break;

      var urls = markdown.match(/https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s)"]+/gi) || [];
      console.log("Page " + page + ": " + urls.length + " URLs");
      if (urls.length === 0) break;

      for (var u = 0; u < urls.length; u++) {
        var url = urls[u];
        if (allListings.has(url)) continue;
        var slugMatch = url.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
        if (!slugMatch) continue;

        var year = parseInt(slugMatch[1]);
        var make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
        var model = slugMatch[3].split("-").map(function(w: string) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");

        var idx = markdown.indexOf(url);
        var chunk = markdown.substring(Math.max(0, idx - 300), Math.min(markdown.length, idx + 300));
        var price = 0;
        var pm = chunk.match(/\$\s?([\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ""));

        allListings.set(url, { id: "pickles-" + slugMatch[4], year: year, make: make, model: model, variant: null, price: price, kms: null, listing_url: url });
      }
    }

    var listings = Array.from(allListings.values());
    console.log("Total unique: " + listings.length);

    var salvageRe = /salvage|write.?off|wovr|repairable|hail|insurance/i;
    var valid = listings.filter(function(l: any) {
      if (!l.price || l.price <= 0) return false;
      return !salvageRe.test(l.make + " " + l.model + " " + (l.variant || ""));
    });
    console.log("Valid: " + valid.length);

    var pr = await sb.from("dealer_liquidity_profiles").select("*");
    var profiles = pr.data || [];
    console.log("Profiles: " + profiles.length);

    var matched: any[] = [];
    for (var i = 0; i < valid.length; i++) {
      var li = valid[i];
      for (var j = 0; j < profiles.length; j++) {
        var p = profiles[j];
        var score = 0;
        if (li.make.toLowerCase() === (p.make || "").toLowerCase()) score += 30;
        if (li.model.toLowerCase() === (p.model || "").toLowerCase()) score += 30;
        if (li.year >= p.year_min && li.year <= p.year_max) score += 20;
        if (li.kms !== null && li.kms >= (p.km_min || 0) && li.kms <= (p.km_max || 999999)) score += 20;
        if (score >= 70) {
          var resale = p.median_sell_price || li.price * 1.15;
          var profit = Math.max(0, resale - li.price);
          matched.push({ id: li.id, year: li.year, make: li.make, model: li.model, price: li.price, listing_url: li.listing_url, match_tier: profit > (p.p75_profit || 5000) ? "HIGH" : profit > 2000 ? "MED" : "LOW", match_dealer_key: p.dealer_key, match_expected_profit: profit, match_expected_resale: resale, match_score: score });
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
          var r = await fetch(wh, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Pickles Alert\n" + m.year + " " + m.make + " " + m.model + "\nPrice: " + fmtMoney(m.price) + " | Resale: " + fmtMoney(m.match_expected_resale) + " | Profit: +" + fmtMoney(m.match_expected_profit) + "\nTier: " + m.match_tier + "\n" + m.listing_url }) });
          if (r.ok) sent++;
        } catch (_e) {}
      }
    }

    return new Response(JSON.stringify({ ok: true, listings_found: listings.length, valid: valid.length, matched: matched.length, alerted: top.length, slack_sent: sent }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error: " + String(error));
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
