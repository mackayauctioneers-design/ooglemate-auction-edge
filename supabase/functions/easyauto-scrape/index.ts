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
  const url = `https://easyauto123.com.au/buy/used-cars?page=${pageNum}&limit=20`;
  console.log(`[SCRAPE] Page ${pageNum}: ${url}`);

  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url, formats: ["markdown"], waitFor: 8000, onlyMainContent: true, timeout: 15000,
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

// ─── Winner Watchlist Check (multi-account) ───
interface WinnerRow {
  account_id: string;
  make: string; model: string; variant: string | null;
  avg_profit: number; times_sold: number; last_sale_price: number;
  year_min: number | null; year_max: number | null;
  avg_km: number | null; median_km: number | null;
  km_band_low: number | null; km_band_high: number | null;
}

async function loadAllWinners(sb: any): Promise<WinnerRow[]> {
  const { data } = await sb.from("winners_watchlist")
    .select("account_id, make, model, variant, avg_profit, times_sold, last_sale_price, year_min, year_max, avg_km, median_km, km_band_low, km_band_high");
  return (data || []) as WinnerRow[];
}

const KM_TOLERANCE = 10000;

function scoreKm(listingKms: number | null, winnerMedianKm: number | null): number {
  if (listingKms == null || winnerMedianKm == null) return 0.5;
  const diff = Math.abs(listingKms - winnerMedianKm);
  if (diff <= KM_TOLERANCE) return 1.0;
  if (diff <= KM_TOLERANCE * 1.5) return 0.7;
  if (diff <= KM_TOLERANCE * 2) return 0.4;
  return 0.0;
}

function normalizeVariant(v: string | null | undefined): string {
  if (!v) return "";
  return v.toUpperCase()
    .replace(/\b(4X[24]|AWD|2WD|RWD|4WD|AUTO|MANUAL|CVT|DCT|DSG)\b/g, "")
    .replace(/\b\d+\.\d+[A-Z]*\b/g, "")
    .replace(/\b(DIESEL|PETROL|TURBO|HYBRID)\b/g, "")
    .replace(/\b(DUAL\s*CAB|SINGLE\s*CAB|DOUBLE\s*CAB|CREW\s*CAB|CAB\s*CHASSIS|UTE|WAGON|SEDAN|HATCH)\b/g, "")
    .replace(/\b(MY\d{2,4})\b/g, "")
    .replace(/\b[A-Z]{2}\d{2,4}[A-Z]{0,3}\b/g, "")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVariantMatch(listingVariant: string | null, winnerVariant: string | null): number {
  const lv = normalizeVariant(listingVariant);
  const wv = normalizeVariant(winnerVariant);
  if (!lv && !wv) return 0.5;
  if (!wv) return 0.5;
  if (!lv) return 0.3;
  if (lv === wv) return 1.0;
  if (lv.includes(wv) || wv.includes(lv)) return 0.7;
  return 0.0;
}

function findWinnerMatches(winners: WinnerRow[], make: string, model: string, year: number, kms: number | null = null): { winner: WinnerRow; kmScore: number }[] {
  const results: { winner: WinnerRow; kmScore: number }[] = [];
  for (const w of winners) {
    const makeOk = w.make.toUpperCase() === make.toUpperCase();
    const modelOk = w.model.toUpperCase() === model.toUpperCase();
    const yearOk = !w.year_min || !w.year_max || (year >= w.year_min - 1 && year <= w.year_max + 1);
    if (!makeOk || !modelOk || !yearOk) continue;
    const kmSc = scoreKm(kms, w.median_km ?? w.avg_km);
    if (kmSc === 0.0 && kms != null && (w.median_km ?? w.avg_km) != null) continue;
    results.push({ winner: w, kmScore: kmSc });
  }
  return results;
}

async function getAccountName(sb: any, accountId: string): Promise<string> {
  const { data } = await sb.from("accounts").select("display_name").eq("id", accountId).single();
  return data?.display_name || "Unknown";
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
    const maxPages = Math.min(body.max_pages || 2, 3); // LOCKED: max 3 pages
    const maxAiCalls = body.max_ai_calls || 30;

    const stats = { pages_scraped: 0, parsed: 0, structural_passed: 0, cheap_filter_passed: 0, ai_called: 0, opportunities: 0, slack_sent: 0, winner_hits: 0 };

    // ─── STEP 1: Paginate pages 1–10 ───
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
        console.log(`[SCRAPE] Page ${page}: ${pageParsed.length} listings`);

        if (pageParsed.length === 0) {
          console.log(`[SCRAPE] Page ${page}: 0 listings — stopping`);
          break;
        }

        allListings.push(...pageParsed);
        await new Promise(r => setTimeout(r, 1500)); // polite delay
      } catch (e) {
        console.error(`[SCRAPE] Page ${page} error:`, e);
        break;
      }
    }

    stats.parsed = allListings.length;
    console.log(`[EASYAUTO] Total parsed: ${allListings.length} from ${stats.pages_scraped} pages`);

    // ─── STEP 2: Structural Filter ───
    const passed = allListings.filter(passesStructuralFilter);
    stats.structural_passed = passed.length;

    // Upsert all scraped into retail_source_listings
    for (const l of allListings) {
      if (!l.url.startsWith("http")) continue;
      await sb.from("retail_source_listings").upsert({
        source: "easyauto123", listing_url: l.url, year: l.year, make: l.make, model: l.model,
        badge: l.badge, kms: l.kms || null, price: l.price, location: l.location || null,
        scraped_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "listing_url" });
    }

    // ─── STEP 2.5: Winner Watchlist Check (multi-account) ───
    const allWinners = await loadAllWinners(sb);
    console.log(`[EASYAUTO] Loaded ${allWinners.length} winners across all accounts`);
    const accountNames = new Map<string, string>();
    const remainingAfterWinners: ParsedListing[] = [];
    const winnerMatched = new Set<string>(); // track URLs already matched

    for (const l of passed) {
      const matches = findWinnerMatches(allWinners, l.make, l.model, l.year, l.kms);
      let matched = false;

      for (const { winner, kmScore } of matches) {
        // Badge/variant scoring
        const badgeScore = scoreVariantMatch(l.badge, winner.variant);
        console.log(`[EASYAUTO BADGE] ${l.year} ${l.make} ${l.model} "${l.badge || ""}" vs winner "${winner.variant || ""}" → badge ${badgeScore}, km ${kmScore}`);
        
        // Hard badge mismatch → skip this winner
        if (badgeScore === 0.0) {
          console.log(`[EASYAUTO BADGE] Skipping — badge mismatch`);
          continue;
        }

        const avgSell = Number(winner.last_sale_price);
        const avgProfit = Number(winner.avg_profit);
        const historicalBuy = avgSell - avgProfit;
        const delta = historicalBuy - l.price;
        
        // Adjust delta threshold by badge confidence
        const adjustedThreshold = badgeScore >= 1.0 ? 3000 : badgeScore >= 0.7 ? 3500 : 4500;
        if (delta < adjustedThreshold) continue;

        // KM scoring against winner's historical KM band
        let kmScore = 0.5; // default neutral
        let kmNote = "";
        if (l.kms && l.kms > 0) {
          console.log(`[KM EXTRACT] ${l.year} ${l.make} ${l.model} → ${l.kms} km`);
          if (l.kms > 250000) {
            console.log(`[EASYAUTO KM] Skipping — ${l.kms}km exceeds 250k ceiling`);
            continue;
          }
          kmNote = ` | ${l.kms.toLocaleString()}km`;
          if (winner.avg_km && winner.avg_km > 0) {
            const diff = Math.abs(l.kms - winner.avg_km);
            kmScore = diff <= 30000 ? 1.0 : diff <= 60000 ? 0.7 : 0.3;
            console.log(`[EASYAUTO KM SCORE] ${l.kms}km vs avg ${winner.avg_km}km → diff ${diff} → score ${kmScore}`);
          }
        }

        // Combined confidence: badge 60%, KM 40%
        const totalScore = badgeScore * 0.6 + kmScore * 0.4;
        console.log(`[MATCH] ${l.year} ${l.make} ${l.model} ${l.badge || ""} ${l.kms || 0}km → badge ${badgeScore}, km ${kmScore}, total ${totalScore.toFixed(2)}`);

        matched = true;
        stats.winner_hits++;

        // Get dealer name
        if (!accountNames.has(winner.account_id)) {
          accountNames.set(winner.account_id, await getAccountName(sb, winner.account_id));
        }
        const dealerName = accountNames.get(winner.account_id)!;
        const targetBuy = Math.round(l.price - delta * 0.6);
        const badgeLabel = badgeScore >= 1.0 ? "EXACT BADGE" : badgeScore >= 0.7 ? "CLOSE BADGE" : "MAKE/MODEL ONLY";

        await sb.from("opportunities").upsert({
          source_type: "winner_replication",
          listing_url: l.url,
          year: l.year, make: l.make, model: l.model, variant: l.badge || null,
          kms: l.kms || null, location: l.location || null,
          buy_price: l.price,
          dealer_median_price: historicalBuy,
          deviation: delta, retail_gap: delta,
          priority_level: totalScore >= 0.7 ? 1 : 2,
          confidence_score: Math.round(delta * totalScore),
          confidence_tier: totalScore >= 0.7 ? "HIGH" : totalScore >= 0.5 ? "MEDIUM" : "LOW",
          status: "new",
          account_id: winner.account_id,
          notes: `${badgeLabel} WINNER for ${dealerName} — ${l.badge || "no badge"}${kmNote} — avg profit ${fmtMoney(avgProfit)} from ${winner.times_sold} sales. Their avg sell: ${fmtMoney(avgSell)}. Target buy: ${fmtMoney(targetBuy)}`,
        }, { onConflict: "listing_url" });
        stats.opportunities++;

        if (slackWebhook) {
          try {
            await fetch(slackWebhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `🔴 ${badgeLabel} WINNER\n\n${l.year} ${l.make} ${l.model} ${l.badge || ""}${kmNote}\nAsking: ${fmtMoney(l.price)}\nTheir avg sell: ${fmtMoney(avgSell)}\nMargin edge: +${fmtMoney(delta)}\nTarget buy: ${fmtMoney(targetBuy)}\nPrevious avg profit: ${fmtMoney(avgProfit)} from ${winner.times_sold} sales\nDealer: ${dealerName}\nMatch: ${badgeLabel}\n\n${l.url}`,
              }),
            });
            stats.slack_sent++;
          } catch (_) { /* ignore */ }
        }
        break; // Best winner matched, stop checking others
      }
      if (!matched) remainingAfterWinners.push(l);
    }

    // ─── STEP 3: Bottom 40% Cheap Filter ───
    remainingAfterWinners.sort((a, b) => a.price - b.price);
    const cutoff = Math.ceil(remainingAfterWinners.length * 0.4);
    const cheapest = remainingAfterWinners.slice(0, cutoff);
    stats.cheap_filter_passed = cheapest.length;
    console.log(`[EASYAUTO] Winners: ${stats.winner_hits}, Bottom 40%: ${cheapest.length} of ${remainingAfterWinners.length}`);

    // ─── STEP 4: Grok Retail Deviation ───
    let aiCalls = 0;

    for (const l of cheapest) {
      if (aiCalls >= maxAiCalls) break;
      if (!l.url.startsWith("http")) continue;

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
        console.log(`[EASYAUTO] Guardrail rejected delta=${delta} for ${l.make} ${l.model} @ ${fmtMoney(l.price)}`);
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
    await sb.from("cron_audit_log").insert({ cron_name: "easyauto-scrape", success: true, result: stats, run_date: new Date().toISOString().split("T")[0] });

    console.log("[EASYAUTO] Done:", stats);
    return new Response(JSON.stringify({ success: true, ...stats }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EASYAUTO] Error:", msg);
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
