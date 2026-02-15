import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * EasyAuto123 Retail Under-Market Engine (Simplified)
 * 
 * 1. Scrape via Firecrawl
 * 2. Structural filter (price, km, year, salvage)
 * 3. AI: "How many dollars under market?" → single integer
 * 4. delta ≥ $4k → opportunity, delta ≥ $8k → CODE RED
 */

const SALVAGE_KEYWORDS = [
  "salvage", "write-off", "writeoff", "write off", "hail",
  "damaged", "repairable", "stat write", "wovr", "statutory",
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

function parsePriceString(s: string): number | null {
  const m = s.replace(/[,$\s]/g, "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseKmString(s: string): number | null {
  const m = s.replace(/[,\s]/g, "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseListingsFromMarkdown(markdown: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const blocks = markdown.split(/\n{2,}/);

  for (const block of blocks) {
    try {
      const lines = block.trim().split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const yearMakeMatch = lines[0]?.match(/(\d{4})\s+(\w+)\s+(.+)/);
      if (!yearMakeMatch) continue;

      const year = parseInt(yearMakeMatch[1], 10);
      if (year < 1990 || year > 2030) continue;

      const make = yearMakeMatch[2];
      const modelBadge = yearMakeMatch[3];
      const modelParts = modelBadge.split(/\s+/);
      const model = modelParts[0] || "";
      const badge = modelParts.slice(1).join(" ") || "";

      let price: number | null = null;
      let kms: number | null = null;
      let location = "";
      let url = "";

      for (const line of lines) {
        if (!price) { const m = line.match(/\$[\d,]+/); if (m) price = parsePriceString(m[0]); }
        if (!kms) { const m = line.match(/([\d,]+)\s*km/i); if (m) kms = parseKmString(m[1]); }
        if (!location) { const m = line.match(/(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i); if (m) location = m[0].toUpperCase(); }
        if (!url) { const m = line.match(/https?:\/\/[^\s)]+easyauto[^\s)]+/i); if (m) url = m[0]; }
      }
      if (!url) {
        const m = block.match(/\(https?:\/\/[^\s)]*easyauto[^\s)]*\)/i);
        if (m) url = m[0].replace(/[()]/g, "");
      }

      if (!price || !year || !make || !model) continue;

      listings.push({ url: url || `easyauto123-${year}-${make}-${model}-${price}`, year, make, model, badge, kms: kms || 0, price, location, raw_text: block });
    } catch { continue; }
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
  const prompt = `Return ONLY a single integer.\n\nHow many dollars UNDER current Australian retail market is this vehicle?\n\nYear: ${listing.year}\nMake: ${listing.make}\nModel: ${listing.model}\nBadge: ${listing.badge || "N/A"}\nKM: ${listing.kms || "Unknown"}\nState: ${listing.location || "NSW"}\nAsking Price: $${listing.price.toLocaleString()}\n\nIf not under market, return 0.\nReturn only the number.`;

  try {
    // Try Lovable AI first
    const resp = await fetch(`${supabaseUrl}/functions/v1/bob-sales-truth`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an Australian used car pricing expert. Return ONLY a single integer. No text, no currency, no explanation." },
          { role: "user", content: prompt },
        ],
        max_tokens: 20,
        temperature: 0.1,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content?.trim() || data.content || data.text || "0";
      return parseInt(String(raw).replace(/[^0-9]/g, ""), 10) || 0;
    }

    // Fallback to OpenAI
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
        max_tokens: 20,
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const searchUrl = body.url || "https://easyauto123.com.au/buy/used-cars?limit=48&page=1";
    const maxAiCalls = body.max_ai_calls || 30;

    const stats = { parsed: 0, structural_passed: 0, ai_called: 0, opportunities: 0, slack_sent: 0, errors: [] as string[] };

    // Scrape
    console.log("Scraping:", searchUrl);
    const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: searchUrl, formats: ["markdown"], waitFor: 8000, onlyMainContent: false,
        actions: [{ type: "wait", milliseconds: 3000 }, { type: "scroll", direction: "down", amount: 3 }, { type: "wait", milliseconds: 2000 }],
      }),
    });

    if (!scrapeResp.ok) throw new Error(`Firecrawl error: ${scrapeResp.status}`);
    const scrapeData = await scrapeResp.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";
    if (!markdown) throw new Error("No content from Firecrawl");

    const allListings = parseListingsFromMarkdown(markdown);
    stats.parsed = allListings.length;

    const passed = allListings.filter(passesStructuralFilter);
    stats.structural_passed = passed.length;
    console.log(`Parsed ${allListings.length}, structural pass ${passed.length}`);

    // Upsert all scraped into retail_source_listings
    for (const l of allListings) {
      if (!l.url.startsWith("http")) continue;
      await sb.from("retail_source_listings").upsert({
        source: "easyauto123", listing_url: l.url, year: l.year, make: l.make, model: l.model,
        badge: l.badge, kms: l.kms || null, price: l.price, location: l.location || null,
        scraped_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "listing_url" });
    }

    // AI valuation for structural-passed listings
    let aiCalls = 0;
    for (const l of passed) {
      if (aiCalls >= maxAiCalls) break;
      if (!l.url.startsWith("http")) continue;

      // Check cache
      const { data: existing } = await sb.from("retail_source_listings")
        .select("grok_estimate, price_at_grok").eq("listing_url", l.url).single();

      const needsEval = !existing?.grok_estimate || (existing.price_at_grok && l.price < existing.price_at_grok - 2000);

      if (!needsEval && existing?.grok_estimate) {
        // Use cached — the "estimate" here is the delta directly
        const delta = existing.grok_estimate;
        if (delta >= 4000) {
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

      if (delta < 4000) continue;

      const priority = delta >= 8000 ? 1 : 2;
      await upsertOpp(sb, l, delta, priority);
      stats.opportunities++;
      if (slackWebhook) stats.slack_sent += await sendSlack(slackWebhook, l, delta);

      await new Promise(r => setTimeout(r, 500));
    }

    // Audit log
    await sb.from("cron_audit_log").insert({ cron_name: "easyauto-scrape", success: true, result: stats, run_date: new Date().toISOString().split("T")[0] });

    console.log("Done:", stats);
    return new Response(JSON.stringify({ success: true, ...stats }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error:", msg);
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
