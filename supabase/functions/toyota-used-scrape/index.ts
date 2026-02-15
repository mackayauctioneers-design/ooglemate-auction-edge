import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SALVAGE_KEYWORDS = [
  "salvage", "write-off", "writeoff", "write off", "hail",
  "damaged", "repairable", "stat write", "wovr", "statutory", "insurance",
];

interface ParsedListing {
  url: string;
  year: number;
  make: string;
  model: string;
  badge: string;
  kms: number;
  price: number;
  location: string;
  raw_text: string;
}

function parseListingsFromMarkdown(markdown: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  // Toyota format: [2017 Toyota Fortuner Crusade](url) [79,624km, Auto, Diesel\nlocationPialba, QLD](url) [$45,990\nDrive Away](url)
  // We match the title link pattern: [YEAR Toyota MODEL BADGE](detail-url)
  const titlePattern = /\[(\d{4})\s+(\w+)\s+([^\]]+)\]\((https:\/\/www\.toyota\.com\.au\/used-vehicles\/vehicle-listing\/[^\)]+)\)/g;

  let match;
  while ((match = titlePattern.exec(markdown)) !== null) {
    const year = parseInt(match[1], 10);
    if (year < 1990 || year > 2030) continue;

    const make = match[2]; // Usually "Toyota"
    const modelBadge = match[3].trim();
    const url = match[4];

    const modelParts = modelBadge.split(/\s+/);
    const model = modelParts[0] || "";
    const badge = modelParts.slice(1).join(" ") || "";

    // Look ahead in the markdown for km, location, and price near this URL
    const urlEscaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contextPattern = new RegExp(urlEscaped + "[\\s\\S]{0,500}", "i");
    const contextMatch = markdown.slice(match.index).match(contextPattern);
    const context = contextMatch ? contextMatch[0] : markdown.slice(match.index, match.index + 800);

    // Parse KM: "79,624km"
    let kms = 0;
    const kmMatch = context.match(/([\d,]+)\s*km/i);
    if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""), 10) || 0;

    // Parse location: "locationPialba, QLD" or "locationSydney, NSW"
    let location = "";
    const locMatch = context.match(/location([A-Za-z\s]+),\s*(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i);
    if (locMatch) location = `${locMatch[1].trim()}, ${locMatch[2].toUpperCase()}`;

    // Parse price: "$45,990"
    let price = 0;
    const priceMatch = context.match(/\$(\d[\d,]*)/);
    if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ""), 10) || 0;

    if (!price || !model) continue;

    // Dedup: skip if we already have this URL
    if (listings.some(l => l.url === url)) continue;

    listings.push({
      url, year, make, model, badge,
      kms, price, location,
      raw_text: context.slice(0, 300),
    });
  }

  return listings;
}

function passesStructuralFilter(l: ParsedListing): boolean {
  if (l.price < 8000 || l.price > 120000) return false;
  if (l.kms > 250000) return false;
  if (l.year < 2008) return false;
  if (!l.year || !l.make || !l.model) return false;
  const text = l.raw_text.toLowerCase();
  for (const kw of SALVAGE_KEYWORDS) { if (text.includes(kw)) return false; }
  return true;
}

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

async function getRetailDelta(listing: ParsedListing, supabaseUrl: string, supabaseKey: string): Promise<number> {
  const prompt = `Return ONLY a single integer.\n\nHow many dollars UNDER current Australian retail market is this vehicle?\n\nYear: ${listing.year}\nMake: ${listing.make}\nModel: ${listing.model}\nVariant: ${listing.badge || "N/A"}\nKM: ${listing.kms || "Unknown"}\nState: ${listing.location || "NSW"}\nAsking Price: $${listing.price.toLocaleString()}\n\nIf not under market, return 0.\nReturn only the number.`;

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/bob-sales-truth`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an Australian used car pricing expert. Return ONLY a single integer. No text, no currency, no explanation." },
          { role: "user", content: prompt },
        ],
        max_tokens: 25,
        temperature: 0.1,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content?.trim() || data.content || data.text || "0";
      return parseInt(String(raw).replace(/[^0-9]/g, ""), 10) || 0;
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return 0;

    const oResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an Australian used car pricing expert. Return ONLY a single integer. No text, no currency, no explanation." },
          { role: "user", content: prompt },
        ],
        max_tokens: 25,
        temperature: 0.1,
      }),
    });
    if (!oResp.ok) return 0;
    const oData = await oResp.json();
    return parseInt(oData.choices?.[0]?.message?.content?.trim().replace(/[^0-9]/g, "") || "0", 10) || 0;
  } catch (e) {
    console.error("[AI] Error:", e);
    return 0;
  }
}

async function scrapePage(firecrawlKey: string, pageNum: number): Promise<string> {
  const url = `https://www.toyota.com.au/used-vehicles/search?page=${pageNum}&limit=20`;
  console.log(`[SCRAPE] Page ${pageNum}: ${url}`);

  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url, formats: ["markdown"], waitFor: 8000, onlyMainContent: false,
      actions: [
        { type: "wait", milliseconds: 3000 },
        { type: "scroll", direction: "down", amount: 3 },
        { type: "wait", milliseconds: 2000 },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`Firecrawl page ${pageNum}: ${resp.status}`);
  const data = await resp.json();
  return data?.data?.markdown || data?.markdown || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const maxPages = body.max_pages || 10;
    const maxAiCalls = body.max_ai_calls || 30;

    const stats = { pages_scraped: 0, parsed: 0, structural_passed: 0, cheap_filter_passed: 0, ai_called: 0, opportunities: 0, slack_sent: 0 };

    // ─── STEP 1: Paginate ───
    const allListings: ParsedListing[] = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const markdown = await scrapePage(firecrawlKey, page);
        stats.pages_scraped++;

        if (!markdown || markdown.length < 300) {
          console.log(`[SCRAPE] Page ${page}: empty/short — stopping`);
          break;
        }

        const pageParsed = parseListingsFromMarkdown(markdown);
        console.log(`[SCRAPE] Page ${page}: ${pageParsed.length} listings parsed`);

        if (pageParsed.length === 0) {
          console.log(`[SCRAPE] Page ${page}: 0 listings — stopping`);
          break;
        }

        allListings.push(...pageParsed);
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.error(`[SCRAPE] Page ${page} error:`, e);
        break;
      }
    }

    stats.parsed = allListings.length;
    console.log(`[TOYOTA] Total parsed: ${allListings.length} from ${stats.pages_scraped} pages`);

    // ─── STEP 2: Structural Filter ───
    const passed = allListings.filter(passesStructuralFilter);
    stats.structural_passed = passed.length;

    // Upsert all scraped into retail_source_listings
    for (const l of allListings) {
      await sb.from("retail_source_listings").upsert({
        source: "toyota.com.au", listing_url: l.url, year: l.year, make: l.make, model: l.model,
        badge: l.badge, kms: l.kms || null, price: l.price, location: l.location || null,
        scraped_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "listing_url" });
    }

    // ─── STEP 3: Bottom 40% Cheap Filter ───
    passed.sort((a, b) => a.price - b.price);
    const cutoff = Math.ceil(passed.length * 0.4);
    const cheapest = passed.slice(0, cutoff);
    stats.cheap_filter_passed = cheapest.length;
    console.log(`[TOYOTA] Bottom 40%: ${cheapest.length} of ${passed.length}`);

    // ─── STEP 4: Grok Retail Deviation ───
    let aiCalls = 0;

    for (const l of cheapest) {
      if (aiCalls >= maxAiCalls) break;

      // Check cache
      const { data: existing } = await sb.from("retail_source_listings")
        .select("grok_estimate, price_at_grok").eq("listing_url", l.url).single();

      const needsEval = !existing?.grok_estimate || (existing.price_at_grok && l.price < existing.price_at_grok - 2000);

      if (!needsEval && existing?.grok_estimate) {
        const delta = existing.grok_estimate;
        if (delta >= 4000 && delta <= 25000 && delta <= l.price * 0.4) {
          const priority = delta >= 8000 ? 1 : 2;
          await upsertOpp(sb, l, delta, priority);
          stats.opportunities++;
          if (slackWebhook) stats.slack_sent += await sendSlack(slackWebhook, l, delta);
        }
        continue;
      }

      aiCalls++;
      stats.ai_called++;
      const delta = await getRetailDelta(l, supabaseUrl, serviceKey);

      // Save estimate
      await sb.from("retail_source_listings").update({
        grok_estimate: delta, grok_estimated_at: new Date().toISOString(), price_at_grok: l.price,
      }).eq("listing_url", l.url);

      // Guardrails
      if (delta < 0 || delta > 25000 || delta > l.price * 0.4) {
        console.log(`[TOYOTA] Guardrail rejected delta=${delta} for ${l.make} ${l.model} @ ${fmtMoney(l.price)}`);
        continue;
      }

      if (delta < 4000) continue;

      const priority = delta >= 8000 ? 1 : 2;
      await upsertOpp(sb, l, delta, priority);
      stats.opportunities++;
      if (slackWebhook) stats.slack_sent += await sendSlack(slackWebhook, l, delta);

      await new Promise(r => setTimeout(r, 500));
    }

    // Audit log
    await sb.from("cron_audit_log").insert({ cron_name: "toyota-used-scrape", success: true, result: stats, run_date: new Date().toISOString().split("T")[0] });

    console.log("[TOYOTA] Done:", stats);
    return new Response(JSON.stringify({ success: true, ...stats }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[TOYOTA] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function upsertOpp(sb: any, l: ParsedListing, delta: number, priority: number) {
  await sb.from("opportunities").upsert({
    source_type: "retail_deviation",
    listing_url: l.url,
    year: l.year, make: l.make, model: l.model, variant: l.badge || null,
    kms: l.kms || null, location: l.location || null,
    buy_price: l.price,
    retail_median_price: l.price + delta,
    retail_gap: delta, deviation: delta,
    priority_level: priority,
    confidence_score: delta,
    confidence_tier: priority === 1 ? "HIGH" : "MEDIUM",
    status: "new",
  }, { onConflict: "listing_url" });
}

async function sendSlack(webhook: string, l: ParsedListing, delta: number): Promise<number> {
  const emoji = delta >= 8000 ? "🔴 CODE RED" : "🟢 Under Market";
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${emoji}\n\n${l.year} ${l.make} ${l.model} ${l.badge || ""}\nPrice: ${fmtMoney(l.price)}\nUnder Market: +${fmtMoney(delta)}\n\n${l.url}`,
      }),
    });
    return 1;
  } catch { return 0; }
}
