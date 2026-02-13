import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

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

const tierOrder: Record<string, number> = { HIGH: 3, MED: 2, LOW: 1 };

async function fetchPicklesMarkdown(): Promise<string> {
  try {
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      console.error("FIRECRAWL_API_KEY not configured");
      return "";
    }

    console.log("Calling Firecrawl with waitFor...");
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://www.pickles.com.au/used/search/cars?filter=%7B%22buyMethod%22%3A%22Buy%20Now%22%2C%22category%22%3A%22Cars%22%7D",
        formats: ["markdown"],
        waitFor: 5000,
        onlyMainContent: false
      })
    });

    console.log(`Firecrawl response status: ${response.status}`);
    
    if (!response.ok) {
      const error = await response.text();
      console.error("Firecrawl error:", error);
      return "";
    }

    const data = await response.json();
    console.log(`Firecrawl data keys: ${Object.keys(data).join(", ")}`);
    
    // Handle nested data structure
    const markdown = data.data?.markdown || data.markdown || "";
    console.log(`Markdown length: ${markdown.length}`);
    return markdown;
  } catch (error) {
    console.error("Fetch markdown error:", error);
    return "";
  }
}

async function extractListingsFromMarkdown(markdown: string): Promise<any[]> {
  const listings: any[] = [];
  
  // Extract links matching Pickles detail URL pattern
  const urlPattern = /https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/(\d{4})-([a-z]+)-([a-z0-9\-]+)\/(\d+)/gi;
  let match;
  
  while ((match = urlPattern.exec(markdown)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].charAt(0).toUpperCase() + match[2].slice(1);
    const model = match[3].split("-").map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    
    listings.push({
      id: `pickles-${match[4]}`,
      year,
      make,
      model,
      variant: null,
      price: 0,
      kms: null,
      location: null,
      listing_url: match[0],
      scraped_at: new Date().toISOString()
    });
  }
  
  return listings;
}

async function matchToProfiles(listing: any, profiles: any[]): Promise<any | null> {
  for (const profile of profiles) {
    let score = 0;
    if (listing.make === profile.make) score += 30;
    if (listing.model === profile.model) score += 30;
    if (listing.year >= profile.year_min && listing.year <= profile.year_max) score += 20;
    if (listing.kms >= (profile.km_min || 0) && listing.kms <= (profile.km_max || 999999)) score += 20;
    
    if (score >= 70) {
      const expectedResale = profile.median_sell_price || listing.price * 1.15;
      const expectedProfit = Math.max(0, expectedResale - (listing.price || 0));
      
      return {
        ...listing,
        match_tier: expectedProfit > (profile.p75_profit || 5000) ? "HIGH" : expectedProfit > 2000 ? "MED" : "LOW",
        match_dealer_key: profile.dealer_key,
        match_expected_profit: expectedProfit,
        match_expected_resale: expectedResale,
        match_alerted_at: new Date().toISOString(),
        match_score: score
      };
    }
  }
  return null;
}

async function logToSlack(message: string): Promise<boolean> {
  const webhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!webhookUrl) {
    console.log("⚠️ SLACK_WEBHOOK_URL not configured");
    return false;
  }
  
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
    return response.ok;
  } catch (error) {
    console.error("Slack error:", error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const force = new URL(req.url).searchParams.get("force") === "true";
  
  if (!isBusinessHours(force)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  
  try {
    console.log("Starting Pickles scanner...");
    
    const markdown = await fetchPicklesMarkdown();
    if (!markdown) {
      console.warn("No markdown returned from Firecrawl");
      return new Response(JSON.stringify({ ok: true, listings_found: 0, matched: 0, slack_sent: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    
    console.log(`Markdown length: ${markdown.length}`);
    console.log("=== MARKDOWN START (first 3000 chars) ===");
    console.log(markdown.substring(0, 3000));
    console.log("=== MARKDOWN END ===");
    
    // Try generic Pickles URL pattern
    const genericUrlPattern = /https:\/\/www\.pickles\.com\.au\/used\/[^\s)"]+/gi;
    const allUrls = markdown.match(genericUrlPattern) || [];
    console.log(`Found ${allUrls.length} generic Pickles URLs`);
    if (allUrls.length > 0) {
      console.log("First 5 URLs found:");
      allUrls.slice(0, 5).forEach((url: string) => console.log(`  ${url}`));
    }
    
    const listings = await extractListingsFromMarkdown(markdown);
    console.log(`Extracted ${listings.length} listings`);
    
    const { data: profiles } = await sb.from("dealer_liquidity_profiles").select("*");
    console.log(`Loaded ${(profiles || []).length} liquidity profiles`);
    
    // Filter: require price > 0 and exclude salvage keywords
    const salvagePattern = /salvage|write.?off|wovr|repairable|hail|insurance/i;
    const validListings = listings.filter((l: any) => {
      if (!l.price || l.price <= 0) return false;
      const text = `${l.make} ${l.model} ${l.variant || ""}`;
      if (salvagePattern.test(text)) return false;
      return true;
    });
    console.log(`Valid listings after price/salvage filter: ${validListings.length} (from ${listings.length})`);

    const matched: any[] = [];
    for (const listing of validListings) {
      const match = await matchToProfiles(listing, profiles || []);
      if (match) {
        matched.push(match);
      }
    }
    
    // Sort by expected profit descending, cap at top 5
    matched.sort((a: any, b: any) => (b.match_expected_profit || 0) - (a.match_expected_profit || 0));
    const topMatches = matched.slice(0, 5);
    
    console.log(`Matched ${matched.length} listings`);
    
    let alertsSent = 0;
    for (const match of topMatches) {
      const msg = `🔥 Pickles Alert\n${match.year} ${match.make} ${match.model}\nPrice: ${fmtMoney(match.price)} | Est. Resale: ${fmtMoney(match.match_expected_resale)} | Profit: +${fmtMoney(match.match_expected_profit)}\nTier: ${match.match_tier}\nLink: ${match.listing_url}`;
      if (await logToSlack(msg)) alertsSent++;
    }
    
    console.log(`Sent ${alertsSent} Slack alerts`);
    
    return new Response(JSON.stringify({ ok: true, listings_found: listings.length, valid: validListings.length, matched: matched.length, alerted: topMatches.length, slack_sent: alertsSent }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Scanner error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
