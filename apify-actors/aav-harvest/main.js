/**
 * AAV (Auto Auctions) Phase-1 Harvester
 * 
 * Apify Actor that bypasses 403/WAF blocks by running in Playwright with Apify Proxy.
 * Extracts MTA IDs from AAV search results and sends to Lovable Edge Function.
 * 
 * Same BidsOnline platform as VMA/F3 — identical extraction strategy.
 * 
 * Input JSON:
 * {
 *   "searchUrl": "https://www.auto-auctions.com.au/search_results.aspx?sitekey=AAV&make=All%20Makes&model=All%20Models&fromyear=2016&toklm=100,000",
 *   "maxPages": 5,
 *   "INGEST_URL": "https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/auto-auctions-ingest",
 *   "INGEST_KEY": "your-aav-ingest-key-value"
 * }
 */

import { Actor } from "apify";
import { chromium } from "playwright";

await Actor.init();

const input = (await Actor.getInput()) || {};

const searchUrl = input.searchUrl || "https://www.auto-auctions.com.au/search_results.aspx?sitekey=AAV&make=All%20Makes&model=All%20Models&fromyear=2016&toklm=100,000";
const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : 5;

const INGEST_URL = input.INGEST_URL;
const INGEST_KEY = input.INGEST_KEY;

if (!INGEST_URL) throw new Error("Missing input.INGEST_URL");
if (!INGEST_KEY) throw new Error("Missing input.INGEST_KEY");

const SITE_DOMAIN = "www.auto-auctions.com.au";
const SITEKEY = "AAV";

// ---- Apify Proxy (residential preferred, falls back to AUTO) ----
const proxyConfiguration = await Actor.createProxyConfiguration({
  groups: ["RESIDENTIAL"],
});

async function newProxyLaunch() {
  const proxyUrl = await proxyConfiguration.newUrl();
  const u = new URL(proxyUrl);

  return chromium.launch({
    headless: true,
    proxy: {
      server: `${u.protocol}//${u.host}`,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    },
  });
}

async function loadWithRetries(url, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    const browser = await newProxyLaunch();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    console.log(`[AAV] Attempt ${i}/${attempts} loading via proxy...`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

    const title = await page.title().catch(() => "");
    const bodySample = await page.evaluate(() => (document.body?.innerText || "").slice(0, 200));
    const blocked =
      title.toLowerCase().includes("service unavailable") ||
      bodySample.toLowerCase().includes("request is blocked") ||
      bodySample.toLowerCase().includes("blocked");

    if (!blocked) {
      console.log("[AAV] Page loaded OK (not blocked).");
      return { browser, context, page };
    }

    console.log(`[AAV] Blocked response detected. Rotating proxy... Title="${title}" Sample="${bodySample}"`);
    await browser.close();
  }

  throw new Error("AAV is blocking all proxy attempts. Need RESIDENTIAL proxy or different pool.");
}

const itemsMap = new Map(); // mta -> {mta, detail_url, title, year, make, model, variant, km, fuel, transmission, body_type}

/**
 * Extracts vehicle data from result-item HTML blocks (BidsOnline platform)
 */
function extractListingsFromHtml(html) {
  const results = [];
  const seen = new Set();

  // Strategy 1: Extract MTA IDs from links
  const mtaRegex = /[?&]MTA=(\d{5,10})\b/gi;
  const mtaIds = new Set();
  let m;
  while ((m = mtaRegex.exec(html)) !== null) {
    mtaIds.add(m[1]);
  }

  // Strategy 2: Parse result-item blocks for structured data
  const itemPattern = /<div[^>]*class="[^"]*result-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*result-item|$)/gi;
  while ((m = itemPattern.exec(html)) !== null) {
    const block = m[0];
    
    // Extract MTA ID
    const mtaMatch = block.match(/MTA=(\d+)/);
    if (!mtaMatch) continue;
    const mta = mtaMatch[1];
    if (seen.has(mta)) continue;
    seen.add(mta);

    // Extract title
    const titleMatch = block.match(/<(?:h[1-6]|a)[^>]*>([^<]*\d{4}\s+[^<]+)<\/(?:h[1-6]|a)>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Parse year/make/model from title
    const ymmMatch = title.match(/^(\d{4})\s+(\S+)\s+(.+)/);
    let year = null, makeRaw = '', modelRaw = '', variant = null;
    if (ymmMatch) {
      year = parseInt(ymmMatch[1]);
      makeRaw = ymmMatch[2];
      const rest = ymmMatch[3];
      const parenMatch = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (parenMatch) {
        modelRaw = parenMatch[1].trim();
        variant = parenMatch[2].trim();
      } else {
        const parts = rest.split(/\s+/);
        modelRaw = parts[0] || '';
        variant = parts.length > 1 ? parts.slice(1).join(' ') : null;
      }
    }

    // Extract km from features
    const kmMatch = block.match(/(\d[\d,]*)\s*(?:kms?\s+showing|kilometres)/i);
    const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, '')) : null;

    // Extract fuel/transmission/body from gear sections
    let fuel = null, transmission = null, bodyType = null;
    if (/diesel/i.test(block)) fuel = 'Diesel';
    else if (/petrol|unleaded/i.test(block)) fuel = 'Petrol';
    else if (/hybrid/i.test(block)) fuel = 'Hybrid';
    else if (/electric/i.test(block)) fuel = 'Electric';

    if (/automatic/i.test(block)) transmission = 'Automatic';
    else if (/manual/i.test(block)) transmission = 'Manual';
    else if (/cvt/i.test(block)) transmission = 'CVT';

    const detailUrl = `https://${SITE_DOMAIN}/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=${SITEKEY}`;

    results.push({
      mta,
      detail_url: detailUrl,
      title,
      year,
      make_raw: makeRaw,
      model_raw: modelRaw,
      variant,
      km,
      fuel,
      transmission,
      body_type: bodyType,
    });
  }

  // If structured parsing found nothing, fall back to MTA-only extraction
  if (results.length === 0 && mtaIds.size > 0) {
    for (const mta of mtaIds) {
      results.push({
        mta,
        detail_url: `https://${SITE_DOMAIN}/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=${SITEKEY}`,
        title: '',
        year: null,
        make_raw: '',
        model_raw: '',
        variant: null,
        km: null,
        fuel: null,
        transmission: null,
        body_type: null,
      });
    }
  }

  return results;
}

async function clickNextPage(page) {
  const clicked = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a'));
    
    // Postback links first
    const postbackLink = allLinks.find(a => {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').toLowerCase().trim();
      return href.includes('__doPostBack') && (text === 'next' || text === '>' || text === '»' || text === 'next page');
    });
    
    if (postbackLink) { postbackLink.click(); return true; }

    // Regular next links
    const nextLink = allLinks.find(a => {
      const text = (a.textContent || '').toLowerCase().trim();
      return text === 'next' || text === '>' || text === '»' || text === 'next page';
    });
    if (nextLink) { nextLink.click(); return true; }

    // Button selectors
    const nextButton = document.querySelector('button[aria-label*="next" i], .pagination .next, .pager-next, [class*="next-page"]');
    if (nextButton) { nextButton.click(); return true; }

    return false;
  });

  if (clicked) {
    await page.waitForTimeout(3000);
    return true;
  }
  return false;
}

async function harvestPage(page, pageNo) {
  const html = await page.content();
  const listings = extractListingsFromHtml(html);

  let added = 0;
  for (const item of listings) {
    if (itemsMap.has(item.mta)) continue;
    itemsMap.set(item.mta, { ...item, page_no: pageNo });
    added++;
  }

  if (listings.length === 0 && pageNo === 1) {
    console.log("[AAV] DEBUG: No listings found. HTML sample (first 2000 chars):");
    console.log(html.substring(0, 2000));
  }

  return { found: listings.length, added, total: itemsMap.size };
}

// ---- Main execution ----
console.log(`[AAV] Loading search URL: ${searchUrl}`);

const { browser, page } = await loadWithRetries(searchUrl, 5);

console.log("[AAV] URL:", page.url());
const title = await page.title().catch(() => "");
console.log("[AAV] Title:", title);

const bodyTextSample = await page.evaluate(() => (document.body?.innerText || "").slice(0, 400));
console.log("[AAV] Body sample:", bodyTextSample.replace(/\s+/g, " "));

// Harvest first page
let stats = await harvestPage(page, 1);
console.log(`[AAV] Page 1: found=${stats.found}, added=${stats.added}, total=${stats.total}`);

// Paginate
for (let p = 2; p <= maxPages; p++) {
  const prevTotal = itemsMap.size;
  const clicked = await clickNextPage(page);
  if (!clicked) {
    console.log(`[AAV] Could not click next page at page ${p}`);
    break;
  }
  stats = await harvestPage(page, p);
  console.log(`[AAV] Page ${p}: found=${stats.found}, added=${stats.added}, total=${stats.total}`);
  if (itemsMap.size === prevTotal) {
    console.log(`[AAV] No new items on page ${p}, stopping`);
    break;
  }
}

await browser.close();

const items = Array.from(itemsMap.values());

if (items.length === 0) {
  console.log("[AAV] No items found; skipping ingest.");
  await Actor.exit();
}

console.log(`[AAV] Prepared ${items.length} items. Posting to ingest...`);

const res = await fetch(INGEST_URL, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${INGEST_KEY}`,
  },
  body: JSON.stringify({ items }),
});

const text = await res.text();
if (!res.ok) {
  throw new Error(`Ingest failed ${res.status}: ${text}`);
}

console.log("[AAV] Ingest OK:", text);

await Actor.exit();