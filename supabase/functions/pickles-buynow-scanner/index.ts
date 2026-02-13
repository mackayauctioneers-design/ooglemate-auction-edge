import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

async function fetchPicklesListings(): Promise<any[]> {
  try {
    const response = await fetch("https://pickles.com.au/used/search/cars?filter=%7B%22buyMethod%22:%22Buy%20Now%22%7D", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) return [];
    const html = await response.text();
    
    const listings: any[] = [];
    const listingMatches = html.matchAll(/"inventory":\s*({[^}]*"make":"([^"]+)"[^}]*"model":"([^"]+)"[^}]*"price":(\d+)[^}]*})/g);
    
    for (const match of listingMatches) {
      try {
        const listing = JSON.parse(match[1]);
        listings.push({
          id: `pickles-${Date.now()}-${Math.random()}`,
          make: listing.make || "",
          model: listing.model || "",
          year: listing.year || null,
          price: listing.price || 0,
          kms: listing.kms || null,
          location: listing.location || "",
          variant: listing.variant || null,
          listing_url: listing.url || "",
          scraped_at: new Date().toISOString()
        });
      } catch {
        continue;
      }
    }
    return listings;
  } catch {
    return [];
  }
}

async function matchToProfiles(listing: any, profiles: any[]): Promise<any | null> {
  const baseCriteria: Record<string, number> = {};
  
  for (const profile of profiles) {
    let score = 0;
    if (listing.make === profile.make) score += 30;
    if (listing.model === profile.model) score += 30;
    if (listing.year >= profile.year_min && listing.year <= profile.year_max) score += 20;
    if (listing.kms >= profile.km_min && listing.kms <= profile.km_max) score += 20;
    
    if (score >= 50) {
      const expectedResale = profile.median_sell_price || listing.price * 1.15;
      const expectedProfit = Math.max(0, expectedResale - listing.price);
      
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
  } catch {
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
    const listings = await fetchPicklesListings();
    
    const { data: profiles } = await sb.from("dealer_liquidity_profiles").select("*");
    
    const matched: any[] = [];
    for (const listing of listings) {
      const match = await matchToProfiles(listing, profiles || []);
      if (match) {
        matched.push(match);
      }
    }
    
    let alertsSent = 0;
    for (const match of matched) {
      const msg = `🔥 Pickles Alert\n${match.year} ${match.make} ${match.model}\nPrice: ${fmtMoney(match.price)} | Est. Resale: ${fmtMoney(match.match_expected_resale)} | Profit: +${fmtMoney(match.match_expected_profit)}\nTier: ${match.match_tier}`;
      if (await logToSlack(msg)) alertsSent++;
    }
    
    return new Response(JSON.stringify({ ok: true, listings_found: listings.length, matched: matched.length, slack_sent: alertsSent }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Scanner error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
