import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function isBusinessHours(force: boolean): boolean {
  if (force) return true;
  const now = new Date();
  const aestHour = (now.getUTCHours() + 10) % 24;
  return aestHour >= 8 && aestHour < 18;
}

function fmtMoney(n: any): string {
  if (!n) return "--";
  return "$" + Math.round(n).toLocaleString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const force = new URL(req.url).searchParams.get("force") === "true";

  if (!isBusinessHours(force)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  try {
    console.log("Scanner starting");

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + firecrawlKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now",
        formats: ["markdown"],
        waitFor: 5000,
        onlyMainContent: false
      })
    });

    if (!scrapeResp.ok) {
      const errText = await scrapeResp.text();
      console.error("Firecrawl error: " + errText);
      return new Response(JSON.stringify({ ok: true, listings_found: 0, matched: 0, slack_sent: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const scrapeData = await scrapeResp.json();
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
    console.log("Markdown length: " + markdown.length);

    if (!markdown) {
      return new Response(JSON.stringify({ ok: true, listings_found: 0, matched: 0, slack_sent: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const listings: any[] = [];
    const urlPattern = /https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/(\d{4})-([a-z]+)-([a-z0-9\-]+)\/(\d+)/gi;
    let urlMatch;

    while ((urlMatch = urlPattern.exec(markdown)) !== null) {
      const year = parseInt(urlMatch[1]);
      const make = urlMatch[2].charAt(0).toUpperCase() + urlMatch[2].slice(1);
      const parts = urlMatch[3].split("-");
      const model = parts.map(function(w: string) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");

      listings.push({
        id: "pickles-" + urlMatch[4],
        year: year,
        make: make,
        model: model,
        variant: null,
        price: 0,
        kms: null,
        listing_url: urlMatch[0]
      });
    }

    const genericPattern = /https:\/\/www\.pickles\.com\.au\/used\/[^\s)"]+/gi;
    const allUrls = markdown.match(genericPattern) || [];
    console.log("Generic URLs found: " + allUrls.length);

    console.log("Extracted: " + listings.length + " listings");

    const profilesResult = await sb.from("dealer_liquidity_profiles").select("*");
    const profiles = profilesResult.data || [];
    console.log("Profiles: " + profiles.length);

    const salvagePattern = /salvage|write.?off|wovr|repairable|hail|insurance/i;
    const validListings = listings.filter(function(l: any) {
      if (!l.price || l.price <= 0) return false;
      const text = l.make + " " + l.model + " " + (l.variant || "");
      return !salvagePattern.test(text);
    });

    const matched: any[] = [];
    for (var i = 0; i < validListings.length; i++) {
      const listing = validListings[i];
      for (var j = 0; j < profiles.length; j++) {
        const profile = profiles[j];
        var score = 0;
        if (listing.make === profile.make) score += 30;
        if (listing.model === profile.model) score += 30;
        if (listing.year >= profile.year_min && listing.year <= profile.year_max) score += 20;
        if (listing.kms !== null && listing.kms >= (profile.km_min || 0) && listing.kms <= (profile.km_max || 999999)) score += 20;

        if (score >= 70) {
          const expectedResale = profile.median_sell_price || listing.price * 1.15;
          const expectedProfit = Math.max(0, expectedResale - (listing.price || 0));

          matched.push({
            id: listing.id,
            year: listing.year,
            make: listing.make,
            model: listing.model,
            price: listing.price,
            listing_url: listing.listing_url,
            match_tier: expectedProfit > (profile.p75_profit || 5000) ? "HIGH" : expectedProfit > 2000 ? "MED" : "LOW",
            match_dealer_key: profile.dealer_key,
            match_expected_profit: expectedProfit,
            match_expected_resale: expectedResale,
            match_score: score
          });
          break;
        }
      }
    }

    matched.sort(function(a: any, b: any) { return (b.match_expected_profit || 0) - (a.match_expected_profit || 0); });
    const topMatches = matched.slice(0, 5);

    const webhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    var alertsSent = 0;
    if (webhookUrl) {
      for (var k = 0; k < topMatches.length; k++) {
        const m = topMatches[k];
        const msg = "Pickles Alert\n" + m.year + " " + m.make + " " + m.model + "\nPrice: " + fmtMoney(m.price) + " | Est. Resale: " + fmtMoney(m.match_expected_resale) + " | Profit: +" + fmtMoney(m.match_expected_profit) + "\nTier: " + m.match_tier + "\nLink: " + m.listing_url;
        try {
          const slackResp = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: msg })
          });
          if (slackResp.ok) alertsSent++;
        } catch (_e) {
          // skip
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      listings_found: listings.length,
      valid: validListings.length,
      matched: matched.length,
      alerted: topMatches.length,
      slack_sent: alertsSent
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error: " + String(error));
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
