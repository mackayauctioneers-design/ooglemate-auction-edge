import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEARCH_URL = "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";
const MAX_PAGES = 10;
const MAX_DETAIL_FETCHES = 50;

const SALVAGE_RE = /salvage|write.?off|wovr|repairable|hail|insurance|damaged|statutory/i;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

interface Listing {
  id: string;
  year: number;
  make: string;
  model: string;
  variant: string;
  price: number;
  kms: number | null;
  location: string;
  listing_url: string;
}

interface HistoricalBand {
  make: string;
  model: string;
  median_buy: number;
  count: number;
}

// ─── PHASE 1: Scrape search pages ──────────────────────────────────────────

async function collectListings(firecrawlKey: string): Promise<Listing[]> {
  const allListings: Listing[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = SEARCH_URL + "&page=" + page;
    console.log(`[SEARCH] Page ${page}`);

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + firecrawlKey, "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl, formats: ["markdown"], waitFor: 5000, onlyMainContent: false }),
    });

    if (!resp.ok) { console.error(`[SEARCH] Firecrawl error page ${page}`); break; }

    const data = await resp.json();
    const md = data.data?.markdown || data.markdown || "";
    if (!md || md.length < 200) { console.log(`[SEARCH] No content page ${page}`); break; }

    const urls = md.match(/https:\/\/www\.pickles\.com\.au\/used\/details\/cars\/[^\s)"]+/gi) || [];
    if (urls.length === 0) break;

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);

      const slugMatch = url.match(/\/(\d{4})-([a-z]+)-([a-z0-9-]+)\/(\d+)/i);
      if (!slugMatch) continue;

      const year = parseInt(slugMatch[1]);
      const make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1);
      const modelParts = slugMatch[3].split("-");
      const model = modelParts[0].charAt(0).toUpperCase() + modelParts[0].slice(1);
      const variant = modelParts.slice(1).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

      if (SALVAGE_RE.test(make + " " + model + " " + variant)) continue;
      if (year < 2008) continue;

      allListings.push({
        id: "pickles-" + slugMatch[4],
        year, make, model, variant,
        price: 0, kms: null, location: "",
        listing_url: url,
      });
    }
    console.log(`[SEARCH] Page ${page}: ${urls.length} URLs, ${allListings.length} total`);
  }

  return allListings;
}

// ─── PHASE 2: Fetch detail page for price/km ───────────────────────────────

// Known badge tokens that indicate a variant/trim level
const KNOWN_BADGES = [
  "XLT", "XL", "XLS", "XLS+", "WILDTRAK", "RAPTOR", "SPORT",
  "ST-X", "ST", "STX", "SL", "RX", "PRO-4X", "N-TREK", "N-SPORT",
  "SR", "SR5", "ROGUE", "GR", "RUGGED", "CRUISER",
  "LIMITED", "OVERLAND", "LAREDO", "TRAILHAWK", "NIGHT EAGLE", "S-LIMITED", "SUMMIT",
  "XTR", "XT", "GT", "GSX", "EXCEED", "GLX", "GLX+", "GLS", "LS",
  "LT", "LT-R", "LTZ", "Z71", "HIGH COUNTRY", "STORM",
  "TITANIUM", "TREND", "AMBIENTE", "ST-LINE",
  "HIGHLANDER", "SAHARA", "GXL", "EDGE",
  "VARIS", "VX", "SX", "EX", "DX",
];
const BADGE_SET = new Set(KNOWN_BADGES.map(b => b.toUpperCase()));
// Also match multi-word badges
const MULTI_BADGES = KNOWN_BADGES.filter(b => b.includes(" ") || b.includes("-")).map(b => b.toUpperCase());

function extractVariantFromTitle(title: string, make: string, model: string): string {
  // Remove year, make, model from start of title to isolate variant area
  let remainder = title.toUpperCase()
    .replace(/^\d{4}\s+/, "")
    .replace(new RegExp("^" + make.toUpperCase() + "\\s+", "i"), "")
    .replace(new RegExp("^" + model.toUpperCase() + "\\s+", "i"), "")
    .trim();

  // Check multi-word badges first (e.g. "HIGH COUNTRY", "N-TREK")
  for (const mb of MULTI_BADGES) {
    if (remainder.includes(mb)) return mb;
  }

  // Check single-word badges
  const words = remainder.split(/[\s]+/);
  for (const w of words) {
    const clean = w.replace(/[^A-Z0-9+-]/g, "");
    if (BADGE_SET.has(clean)) return clean;
  }

  // Fallback: first word if it looks like a badge (2-6 uppercase chars, not a spec)
  if (words.length > 0) {
    const first = words[0].replace(/[^A-Z0-9+-]/g, "");
    if (first.length >= 2 && first.length <= 8 && !/^\d/.test(first) &&
        !/^(UTILITY|WAGON|SEDAN|HATCH|CAB|DUAL|SINGLE|CREW|DOUBLE|AUTO|MANUAL|DIESEL|PETROL|TURBO)$/.test(first)) {
      return first;
    }
  }
  return "";
}

async function fetchDetailPrice(url: string, firecrawlKey: string, make: string, model: string): Promise<{ price: number; kms: number | null; location: string; variant: string }> {
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": "Bearer " + firecrawlKey, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], waitFor: 3000, onlyMainContent: false }),
    });

    if (!resp.ok) return { price: 0, kms: null, location: "", variant: "" };

    const data = await resp.json();
    const md = data.data?.markdown || data.markdown || "";

    let price = 0;
    const pricePatterns = [/buy\s*now[:\s]*\$\s*([\d,]+)/i, /price[:\s]*\$\s*([\d,]+)/i];
    for (const p of pricePatterns) {
      const m = md.match(p);
      if (m) { const v = parseInt(m[1].replace(/,/g, "")); if (v >= 2000 && v <= 200000) { price = v; break; } }
    }
    if (price === 0) {
      const all: number[] = [];
      let m; const g = /\$\s*([\d,]+)/g;
      while ((m = g.exec(md)) !== null) { const v = parseInt(m[1].replace(/,/g, "")); if (v >= 2000 && v <= 200000) all.push(v); }
      if (all.length > 0) price = all[0];
    }

    let kms: number | null = null;
    const kmMatch = md.match(/(\d{1,3}(?:,\d{3})*)\s*km/i);
    if (kmMatch) kms = parseInt(kmMatch[1].replace(/,/g, ""));

    let location = "";
    const locMatch = md.match(/(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i);
    if (locMatch) location = locMatch[0].toUpperCase();

    // Extract variant from the detail page title
    // Pickles titles typically: "Year Make Model Variant Specs" e.g. "2019 Ford Ranger XLT 3.2DT Utility Dual Cab"
    let variant = "";
    // Try h1/title patterns in markdown
    const titlePatterns = [
      new RegExp(`\\d{4}\\s+${make}\\s+${model}\\s+(.+?)(?:\\s*\\||\\s*-|$)`, "i"),
      /^#\s*(.+)/m,
      /title[:\s]*["']?([^"'\n]+)/i,
    ];
    for (const tp of titlePatterns) {
      const tm = md.match(tp);
      if (tm) {
        variant = extractVariantFromTitle(tm[1] || tm[0], make, model);
        if (variant) break;
      }
    }
    // Fallback: search for known badge anywhere in first 2000 chars
    if (!variant) {
      const head = md.substring(0, 2000).toUpperCase();
      for (const mb of MULTI_BADGES) {
        if (head.includes(mb)) { variant = mb; break; }
      }
      if (!variant) {
        for (const b of KNOWN_BADGES) {
          const bu = b.toUpperCase();
          // Must appear near the make/model context
          const contextRe = new RegExp(`${model}\\s+(?:\\S+\\s+){0,3}${bu.replace(/[+-]/g, "\\$&")}\\b`, "i");
          if (contextRe.test(md.substring(0, 3000))) { variant = bu; break; }
        }
      }
    }

    if (variant) console.log(`[DETAIL] ${make} ${model} → variant "${variant}" from detail page`);

    return { price, kms, location, variant };
  } catch (e) {
    console.error(`[DETAIL] Error ${url}:`, e);
    return { price: 0, kms: null, location: "", variant: "" };
  }
}

// ─── STEP A: Historical Replication Check ──────────────────────────────────

async function getHistoricalBands(sb: any): Promise<Map<string, HistoricalBand>> {
  const { data, error } = await sb.rpc("get_historical_buy_bands");
  
  // Fallback: query directly if RPC doesn't exist
  if (error) {
    console.log("[RADAR] RPC not available, querying vehicle_sales_truth directly");
    const { data: raw } = await sb
      .from("vehicle_sales_truth")
      .select("make, model, badge, buy_price")
      .gt("buy_price", 0);

    const map = new Map<string, { prices: number[] }>();
    for (const r of (raw || [])) {
      // Build make|model band
      const mmKey = `${(r.make || "").toUpperCase()}|${(r.model || "").toUpperCase()}`;
      if (!map.has(mmKey)) map.set(mmKey, { prices: [] });
      map.get(mmKey)!.prices.push(Number(r.buy_price));

      // Build make|model|badge band if badge exists
      if (r.badge) {
        const badgeNorm = (r.badge || "").toUpperCase().trim();
        if (badgeNorm) {
          const vKey = `${mmKey}|${badgeNorm}`;
          if (!map.has(vKey)) map.set(vKey, { prices: [] });
          map.get(vKey)!.prices.push(Number(r.buy_price));
        }
      }
    }

    const bands = new Map<string, HistoricalBand>();
    for (const [key, val] of map) {
      if (val.prices.length < 3) continue; // need at least 3 sales
      const parts = key.split("|");
      const [make, model] = parts;
      val.prices.sort((a, b) => a - b);
      const median = val.prices[Math.floor(val.prices.length / 2)];
      bands.set(key, { make, model, median_buy: median, count: val.prices.length });
    }
    return bands;
  }

  const bands = new Map<string, HistoricalBand>();
  for (const r of (data || [])) {
    const key = `${r.make.toUpperCase()}|${r.model.toUpperCase()}`;
    bands.set(key, r);
  }
  return bands;
}

function checkReplication(listing: Listing, bands: Map<string, HistoricalBand>): { hit: boolean; delta: number; median_buy: number } {
  // Try variant-specific band first (more accurate)
  const variantNorm = normalizeVariant(listing.variant);
  if (variantNorm) {
    const variantKey = `${listing.make.toUpperCase()}|${listing.model.toUpperCase()}|${variantNorm}`;
    const variantBand = bands.get(variantKey);
    if (variantBand) {
      const delta = variantBand.median_buy - listing.price;
      return { hit: delta >= 5000, delta, median_buy: variantBand.median_buy };
    }
  }
  // Fall back to make/model only
  const key = `${listing.make.toUpperCase()}|${listing.model.toUpperCase()}`;
  const band = bands.get(key);
  if (!band) return { hit: false, delta: 0, median_buy: 0 };

  const delta = band.median_buy - listing.price;
  return { hit: delta >= 5000, delta, median_buy: band.median_buy };
}

// ─── STEP B: AI Retail Deviation ───────────────────────────────────────────

async function getRetailDelta(listing: Listing, supabaseUrl: string, supabaseKey: string): Promise<number> {
  const prompt = `Return ONLY a single integer.\n\nHow many dollars UNDER current Australian retail market is this vehicle?\n\nYear: ${listing.year}\nMake: ${listing.make}\nModel: ${listing.model}\nVariant: ${listing.variant || "N/A"}\nKM: ${listing.kms || "Unknown"}\nState: ${listing.location || "NSW"}\nAsking Price: $${listing.price.toLocaleString()}\n\nIf not under market, return 0.\nReturn only the number.`;

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/bob-sales-truth`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
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

    if (!resp.ok) {
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
      const raw = oData.choices?.[0]?.message?.content?.trim() || "0";
      return parseInt(raw.replace(/[^0-9]/g, ""), 10) || 0;
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || data.content || data.text || "0";
    return parseInt(String(raw).replace(/[^0-9]/g, ""), 10) || 0;
  } catch (e) {
    console.error("[AI] Error:", e);
    return 0;
  }
}

// ─── Winner Watchlist Check (multi-account) ───
interface WinnerRow {
  account_id: string;
  make: string; model: string; variant: string | null;
  avg_profit: number; times_sold: number; last_sale_price: number;
  year_min: number | null; year_max: number | null;
}

async function loadAllWinners(sb: any): Promise<WinnerRow[]> {
  const { data } = await sb.from("winners_watchlist")
    .select("account_id, make, model, variant, avg_profit, times_sold, last_sale_price, year_min, year_max");
  return (data || []) as WinnerRow[];
}

interface WinnerMatch {
  winner: WinnerRow;
  variantScore: number; // 1.0 = exact, 0.7 = close, 0.3 = no variant data
}

function normalizeVariant(v: string | null | undefined): string {
  if (!v) return "";
  return v.toUpperCase()
    .replace(/\b(4X[24]|AWD|2WD|RWD|4WD)\b/g, "")
    .replace(/\b\d+\.\d+[A-Z]*\b/g, "")              // 3.2DT, 2.0T
    .replace(/\b(AUTO|MANUAL|CVT|DCT|DSG)\b/g, "")
    .replace(/\b(DIESEL|PETROL|TURBO|HYBRID)\b/g, "")
    .replace(/\b(DUAL\s*CAB|SINGLE\s*CAB|DOUBLE\s*CAB|CREW\s*CAB|CAB\s*CHASSIS|UTE|WAGON|SEDAN|HATCH)\b/g, "")
    .replace(/\b(MY\d{2,4})\b/g, "")                  // MY14, MY2014
    .replace(/\b[A-Z]{2}\d{2,4}[A-Z]{0,3}\b/g, "")    // chassis codes PX, D23, WK
    .replace(/[-]+/g, " ")                              // hyphens to spaces for matching
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVariantMatch(listingVariant: string | null, winnerVariant: string | null): number {
  const lv = normalizeVariant(listingVariant);
  const wv = normalizeVariant(winnerVariant);

  // Both empty = generic match (acceptable but lower confidence)
  if (!lv && !wv) return 0.5;
  // Winner has no variant = matches any (spec-agnostic winner)
  if (!wv) return 0.5;
  // Listing has no variant but winner does = can't confirm badge
  if (!lv) return 0.3;

  // Exact badge match
  if (lv === wv) return 1.0;
  // One contains the other (e.g. "XLT" in "XLT HI RIDER", or "LT" in "LT-R")
  if (lv.includes(wv) || wv.includes(lv)) return 0.7;

  // No badge alignment
  return 0.0;
}

function findWinnerMatches(winners: WinnerRow[], make: string, model: string, year: number, variant: string | null): WinnerMatch[] {
  const results: WinnerMatch[] = [];
  for (const w of winners) {
    const makeOk = w.make.toUpperCase() === make.toUpperCase();
    const modelOk = w.model.toUpperCase() === model.toUpperCase();
    const yearOk = !w.year_min || !w.year_max || (year >= w.year_min - 1 && year <= w.year_max + 1);
    if (!makeOk || !modelOk || !yearOk) continue;

    const variantScore = scoreVariantMatch(variant, w.variant);
    // Only match if variant score >= 0.3 (at least partial alignment)
    if (variantScore >= 0.3) {
      results.push({ winner: w, variantScore });
    }
  }
  // Sort: exact variant matches first, then by profit
  results.sort((a, b) => b.variantScore - a.variantScore || Number(b.winner.avg_profit) - Number(a.winner.avg_profit));
  return results;
}

async function getAccountName(sb: any, accountId: string): Promise<string> {
  const { data } = await sb.from("accounts").select("display_name").eq("id", accountId).single();
  return data?.display_name || "Unknown";
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const force = new URL(req.url).searchParams.get("force") === "true";

  if (!force) {
    const aestHour = (new Date().getUTCHours() + 10) % 24;
    if (aestHour < 8 || aestHour >= 18) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
  }

  try {
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") || "";
    const body = await req.json().catch(() => ({}));
    const maxAiCalls = body.max_ai_calls || 20;

    const stats = {
      urls_found: 0, detail_fetched: 0, priced: 0,
      replication_hits: 0, winner_hits: 0, ai_called: 0, ai_signals: 0,
      opportunities: 0, slack_sent: 0,
    };

    // Phase 1: Collect listings from search pages
    const listings = await collectListings(firecrawlKey);
    stats.urls_found = listings.length;
    console.log(`[RADAR] ${listings.length} candidate URLs`);

    // Phase 2: Fetch detail pages for prices (capped)
    const toFetch = listings.slice(0, MAX_DETAIL_FETCHES);
    const pricedListings: Listing[] = [];

    for (const li of toFetch) {
      const detail = await fetchDetailPrice(li.listing_url, firecrawlKey, li.make, li.model);
      stats.detail_fetched++;
      if (detail.price > 0 && detail.price >= 8000 && detail.price <= 120000) {
        li.price = detail.price;
        li.kms = detail.kms;
        li.location = detail.location;
        // Override slug-derived variant with detail-page extracted variant (much more accurate)
        if (detail.variant) {
          li.variant = detail.variant;
          console.log(`[RADAR] ${li.make} ${li.model} variant set to "${detail.variant}" from detail page`);
        }
        if (li.kms === null || li.kms < 250000) {
          pricedListings.push(li);
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    stats.priced = pricedListings.length;
    console.log(`[RADAR] ${pricedListings.length} priced listings passing structural filter`);

    // Load historical buy bands
    const bands = await getHistoricalBands(sb);
    console.log(`[RADAR] ${bands.size} historical make/model bands`);

    // ─── STEP 1: Historical Replication (runs on 100% of listings) ───
    const remainingAfterReplication: Listing[] = [];

    for (const li of pricedListings) {
      const rep = checkReplication(li, bands);
      if (rep.hit) {
        stats.replication_hits++;
        await sb.from("opportunities").upsert({
          source_type: "replication",
          listing_url: li.listing_url,
          year: li.year, make: li.make, model: li.model, variant: li.variant || null,
          kms: li.kms, location: li.location || null,
          buy_price: li.price,
          dealer_median_price: rep.median_buy,
          deviation: rep.delta,
          retail_gap: rep.delta,
          priority_level: 1,
          confidence_score: rep.delta,
          confidence_tier: "HIGH",
          status: "new",
        }, { onConflict: "listing_url" });
        stats.opportunities++;

        if (slackWebhook) {
          try {
            await fetch(slackWebhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `🔴 CODE RED\n\n${li.year} ${li.make} ${li.model} ${li.variant || ""}\nPrice: ${fmtMoney(li.price)}\nBelow historical buy band by: +${fmtMoney(rep.delta)}\n\n${li.listing_url}`,
              }),
            });
            stats.slack_sent++;
          } catch (_) { /* ignore */ }
        }
        continue; // Stop processing — no AI needed
      }
      remainingAfterReplication.push(li);
    }

    // ─── STEP 1.5: Winner Watchlist Check (multi-account) ───
    const allWinners = await loadAllWinners(sb);
    console.log(`[RADAR] Loaded ${allWinners.length} winners across all accounts`);
    const accountNames = new Map<string, string>();
    const remainingAfterWinners: Listing[] = [];

    for (const li of remainingAfterReplication) {
      const matches = findWinnerMatches(allWinners, li.make, li.model, li.year, li.variant);
      if (matches.length > 0) {
        console.log(`[PICKLES] ${li.make} ${li.model} ${li.variant || ""} → variantScore ${matches[0].variantScore}`);
      }
      let matched = false;

      for (const { winner, variantScore } of matches) {
        const avgSell = Number(winner.last_sale_price);
        const avgProfit = Number(winner.avg_profit);
        const historicalBuy = avgSell - avgProfit;
        const delta = historicalBuy - li.price;
        if (delta >= 3000) {
          matched = true;
          stats.winner_hits++;

          if (!accountNames.has(winner.account_id)) {
            accountNames.set(winner.account_id, await getAccountName(sb, winner.account_id));
          }
          const dealerName = accountNames.get(winner.account_id)!;
          const targetBuy = Math.round(li.price - delta * 0.6);

          // Confidence tier now factors in variant match quality
          const confTier = variantScore >= 0.7 ? "HIGH" : variantScore >= 0.5 ? "MEDIUM" : "LOW";
          const badgeLabel = variantScore >= 1.0 ? "EXACT BADGE" : variantScore >= 0.7 ? "CLOSE BADGE" : "MAKE/MODEL ONLY";

          await sb.from("opportunities").upsert({
            source_type: "winner_replication",
            listing_url: li.listing_url,
            year: li.year, make: li.make, model: li.model, variant: li.variant || null,
            kms: li.kms, location: li.location || null,
            buy_price: li.price,
            dealer_median_price: historicalBuy,
            deviation: delta, retail_gap: delta,
            priority_level: variantScore >= 0.7 ? 1 : 2,
            confidence_score: delta * variantScore,
            confidence_tier: confTier,
            status: "new",
            account_id: winner.account_id,
            notes: `${badgeLabel} for ${dealerName} — ${li.variant || li.model} vs winner ${winner.variant || winner.model}. Avg profit ${fmtMoney(avgProfit)} from ${winner.times_sold} sales. Avg sell: ${fmtMoney(avgSell)}. Target buy: ${fmtMoney(targetBuy)}`,
          }, { onConflict: "listing_url" });
          stats.opportunities++;

          if (slackWebhook && variantScore >= 0.5) {
            const emoji = variantScore >= 0.7 ? "🔴 PROVEN WINNER" : "🟡 CLOSE MATCH";
            try {
              await fetch(slackWebhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: `${emoji} (${badgeLabel})\n\n${li.year} ${li.make} ${li.model} ${li.variant || ""}\nAsking: ${fmtMoney(li.price)}\nTheir avg sell: ${fmtMoney(avgSell)}\nMargin edge: +${fmtMoney(delta)}\nTarget buy: ${fmtMoney(targetBuy)}\nPrevious avg profit: ${fmtMoney(avgProfit)} from ${winner.times_sold} sales\nDealer: ${dealerName}\n\n${li.listing_url}`,
                }),
              });
              stats.slack_sent++;
            } catch (_) { /* ignore */ }
          }
          break; // Use best variant match only (already sorted)
        }
      }
      if (!matched) remainingAfterWinners.push(li);
    }

    // ─── STEP 2: Cheap Filter — bottom 40% by price ───
    remainingAfterWinners.sort((a, b) => a.price - b.price);
    const cutoff = Math.ceil(remainingAfterWinners.length * 0.4);
    const cheapest = remainingAfterWinners.slice(0, cutoff);
    console.log(`[RADAR] Winners: ${stats.winner_hits}, Bottom 40%: ${cheapest.length} of ${remainingAfterWinners.length} go to AI`);

    // ─── STEP 3: Grok Retail Deviation (only bottom 40%) ───
    let aiCalls = 0;

    for (const li of cheapest) {
      if (aiCalls >= maxAiCalls) continue;
      aiCalls++;
      stats.ai_called++;

      const delta = await getRetailDelta(li, supabaseUrl, supabaseKey);

      // Guardrails: reject nonsense
      if (delta < 0 || delta > 25000 || delta > li.price * 0.4) {
        console.log(`[RADAR] Guardrail rejected delta=${delta} for ${li.make} ${li.model} @ ${fmtMoney(li.price)}`);
        continue;
      }

      if (delta < 4000) continue;

      stats.ai_signals++;
      const priorityLevel = delta >= 8000 ? 1 : 2;

      await sb.from("opportunities").upsert({
        source_type: "retail_deviation",
        listing_url: li.listing_url,
        year: li.year, make: li.make, model: li.model, variant: li.variant || null,
        kms: li.kms, location: li.location || null,
        buy_price: li.price,
        retail_median_price: li.price + delta,
        deviation: delta,
        retail_gap: delta,
        priority_level: priorityLevel,
        confidence_score: delta,
        confidence_tier: priorityLevel === 1 ? "HIGH" : "MEDIUM",
        status: "new",
      }, { onConflict: "listing_url" });
      stats.opportunities++;

      // Slack alert
      if (slackWebhook) {
        const emoji = delta >= 8000 ? "🔴 CODE RED" : "🟢 Under Market";
        try {
          await fetch(slackWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `${emoji}\n\n${li.year} ${li.make} ${li.model} ${li.variant || ""}\nPrice: ${fmtMoney(li.price)}\nUnder Market: +${fmtMoney(delta)}\n\n${li.listing_url}`,
            }),
          });
          stats.slack_sent++;
        } catch (_) { /* ignore */ }
      }

      await new Promise(r => setTimeout(r, 500));
    }

    console.log("[RADAR] Done:", stats);
    return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("[RADAR] Error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
