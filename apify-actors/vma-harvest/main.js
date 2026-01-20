/**
 * VMA (Valley Motor Auctions) Phase-1 Harvester
 * 
 * Apify Actor that bypasses 403 blocks by running in Playwright with Apify Proxy.
 * Extracts MTA IDs from VMA search results and sends to Lovable Edge Function.
 * 
 * Input JSON:
 * {
 *   "searchUrl": "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models&fromyear=2016",
 *   "maxPages": 5,
 *   "INGEST_URL": "https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/ingest-vma",
 *   "INGEST_KEY": "your-vma-ingest-key-value"
 * }
 */

import { Actor } from "apify";
import { chromium } from "playwright";

await Actor.init();

const input = (await Actor.getInput()) || {};

const searchUrl = input.searchUrl;
const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : 5;

const INGEST_URL = input.INGEST_URL;
const INGEST_KEY = input.INGEST_KEY;

if (!searchUrl) throw new Error("Missing input.searchUrl");
if (!INGEST_URL) throw new Error("Missing input.INGEST_URL");
if (!INGEST_KEY) throw new Error("Missing input.INGEST_KEY");

// ---- Apify Proxy (residential preferred, falls back to AUTO) ----
const proxyConfiguration = await Actor.createProxyConfiguration({
  // If you don't have residential on your plan, change to ["RESIDENTIAL"] → ["AUTO"]
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

    console.log(`[VMA] Attempt ${i}/${attempts} loading via proxy...`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

    const title = await page.title().catch(() => "");
    const bodySample = await page.evaluate(() => (document.body?.innerText || "").slice(0, 200));
    const blocked =
      title.toLowerCase().includes("service unavailable") ||
      bodySample.toLowerCase().includes("request is blocked") ||
      bodySample.toLowerCase().includes("blocked");

    if (!blocked) {
      console.log("[VMA] Page loaded OK (not blocked).");
      return { browser, context, page };
    }

    console.log(`[VMA] Blocked response detected. Rotating proxy... Title="${title}" Sample="${bodySample}"`);
    await browser.close();
  }

  throw new Error("VMA is blocking all proxy attempts. Need RESIDENTIAL proxy or different pool.");
}

const itemsMap = new Map(); // mta -> {mta, detail_url, search_url, page_no}

/**
 * Extracts MTAs using multiple strategies
 */
function extractMtasFromHtml(html, baseUrl) {
  const results = new Map(); // mta -> detail_url

  // Strategy 1: MTA= in query strings (most common)
  const mtaRegex = /[?&]MTA=(\d{5,10})\b/gi;
  let m;
  while ((m = mtaRegex.exec(html)) !== null) {
    const mta = m[1];
    if (!results.has(mta)) {
      results.set(mta, `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`);
    }
  }

  // Strategy 2: Full href links to detail pages
  const hrefRegex = /href=["']([^"']*(?:cp_veh_inspection_report|vehicle_detail|lot_detail)[^"']*MTA=(\d{5,10})[^"']*)/gi;
  while ((m = hrefRegex.exec(html)) !== null) {
    const fullUrl = m[1];
    const mta = m[2];
    if (!results.has(mta)) {
      // Ensure absolute URL
      const detailUrl = fullUrl.startsWith('http') ? fullUrl : `https://www.valleymotorauctions.com.au/${fullUrl.replace(/^\//, '')}`;
      results.set(mta, detailUrl);
    }
  }

  // Strategy 3: JavaScript onclick handlers with MTA
  const onclickRegex = /onclick=["'][^"']*MTA[=:]["']?(\d{5,10})/gi;
  while ((m = onclickRegex.exec(html)) !== null) {
    const mta = m[1];
    if (!results.has(mta)) {
      results.set(mta, `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`);
    }
  }

  // Strategy 4: data-mta attributes
  const dataMtaRegex = /data-mta=["']?(\d{5,10})/gi;
  while ((m = dataMtaRegex.exec(html)) !== null) {
    const mta = m[1];
    if (!results.has(mta)) {
      results.set(mta, `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`);
    }
  }

  // Strategy 5: Stock ID patterns (stockid, stock_id, stocknumber)
  const stockRegex = /(?:stock[_-]?(?:id|number)|item[_-]?id)[\s:='"]+(\d{5,10})/gi;
  while ((m = stockRegex.exec(html)) !== null) {
    const mta = m[1];
    if (!results.has(mta)) {
      results.set(mta, `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`);
    }
  }

  // Strategy 6: JSON data in script tags
  const jsonMtaRegex = /"(?:mta|MTA|stockId|vehicleId)":\s*"?(\d{5,10})"?/gi;
  while ((m = jsonMtaRegex.exec(html)) !== null) {
    const mta = m[1];
    if (!results.has(mta)) {
      results.set(mta, `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`);
    }
  }

  return results;
}

/**
 * Detect pagination type and find next page action
 */
async function detectPagingMode(page) {
  return await page.evaluate(() => {
    // Check for page parameter in URL
    const url = new URL(window.location.href);
    if (url.searchParams.has('page') || url.searchParams.has('Page') || url.searchParams.has('PageNum')) {
      return { mode: 'page_param', param: url.searchParams.has('page') ? 'page' : (url.searchParams.has('Page') ? 'Page' : 'PageNum') };
    }

    // Check for ASP.NET paging (postback)
    const allLinks = Array.from(document.querySelectorAll('a'));
    const postbackLink = allLinks.find(a => {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').toLowerCase().trim();
      return href.includes('__doPostBack') && (text === 'next' || text === '>' || text === '»' || text === 'next page');
    });

    if (postbackLink) {
      return { mode: 'postback', selector: null, element: 'found' };
    }

    // Check for clickable next button
    const nextButton = allLinks.find(a => {
      const text = (a.textContent || '').toLowerCase().trim();
      return text === 'next' || text === '>' || text === '»' || text === 'next page' || text.includes('next');
    }) || document.querySelector('button[aria-label*="next" i], .pagination .next, .pager-next, [class*="next-page"]');

    if (nextButton) {
      return { mode: 'click', element: 'found' };
    }

    return { mode: 'none' };
  });
}

async function clickNextPage(page) {
  // Try to find and click the next button
  const clicked = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a'));
    
    // Look for postback links first
    const postbackLink = allLinks.find(a => {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').toLowerCase().trim();
      return href.includes('__doPostBack') && (text === 'next' || text === '>' || text === '»' || text === 'next page');
    });
    
    if (postbackLink) {
      postbackLink.click();
      return true;
    }

    // Look for regular next links
    const nextLink = allLinks.find(a => {
      const text = (a.textContent || '').toLowerCase().trim();
      return text === 'next' || text === '>' || text === '»' || text === 'next page';
    });

    if (nextLink) {
      nextLink.click();
      return true;
    }

    // Try button selectors
    const nextButton = document.querySelector('button[aria-label*="next" i], .pagination .next, .pager-next, [class*="next-page"]');
    if (nextButton) {
      nextButton.click();
      return true;
    }

    return false;
  });

  if (clicked) {
    await page.waitForTimeout(3000); // Wait for page to load
    return true;
  }
  return false;
}

async function harvestPage(page, pageNo) {
  const html = await page.content();
  const results = extractMtasFromHtml(html, searchUrl);

  let added = 0;
  for (const [mta, detailUrl] of results) {
    if (itemsMap.has(mta)) continue;
    itemsMap.set(mta, {
      mta,
      detail_url: detailUrl,
      search_url: searchUrl,
      page_no: pageNo,
    });
    added++;
  }

  // Debug: Log a sample of the HTML if no MTAs found
  if (results.size === 0 && pageNo === 1) {
    console.log("[VMA] DEBUG: No MTAs found. HTML sample (first 2000 chars):");
    console.log(html.substring(0, 2000));
    
    // Log any links found
    const allHrefs = html.match(/href=["'][^"']+["']/gi) || [];
    console.log(`[VMA] DEBUG: Found ${allHrefs.length} href attributes. Sample:`, allHrefs.slice(0, 10));
  }

  return { mtasFound: results.size, added, total: itemsMap.size };
}

// ---- Main execution with proxy + retry ----
console.log(`[VMA] Loading search URL: ${searchUrl}`);

const { browser, page } = await loadWithRetries(searchUrl, 5);

// DEBUG: confirm we loaded the right page
console.log("[VMA] URL:", page.url());

// DEBUG: look for telltale text
const title = await page.title().catch(() => "");
console.log("[VMA] Title:", title);

const bodyTextSample = await page.evaluate(() => (document.body?.innerText || "").slice(0, 400));
console.log("[VMA] Body sample:", bodyTextSample.replace(/\s+/g, " "));

// DEBUG: count all links
const linkCount = await page.$$eval("a", (as) => as.length);
console.log("[VMA] Link count:", linkCount);

// Harvest first page
let stats = await harvestPage(page, 1);
console.log(`[VMA] Page 1: mtasFound=${stats.mtasFound}, added=${stats.added}, total=${stats.total}`);

// Detect pagination mode
const pagingMode = await detectPagingMode(page);
console.log(`[VMA] Paging mode detected: ${pagingMode.mode}`);

// Harvest additional pages if pagination exists
if (pagingMode.mode !== 'none' && maxPages > 1) {
  for (let p = 2; p <= maxPages; p++) {
    const prevTotal = itemsMap.size;
    
    if (pagingMode.mode === 'page_param') {
      const url = new URL(searchUrl);
      url.searchParams.set(pagingMode.param, String(p));
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
    } else {
      // click or postback
      const clicked = await clickNextPage(page);
      if (!clicked) {
        console.log(`[VMA] Could not click next page at page ${p}`);
        break;
      }
    }
    
    stats = await harvestPage(page, p);
    console.log(`[VMA] Page ${p}: mtasFound=${stats.mtasFound}, added=${stats.added}, total=${stats.total}`);
    
    // Stop if no new items found (likely end of results)
    if (itemsMap.size === prevTotal) {
      console.log(`[VMA] No new items on page ${p}, stopping pagination`);
      break;
    }
  }
}

await browser.close();

const items = Array.from(itemsMap.values());

// Don't ingest if no items found
if (items.length === 0) {
  console.log("[VMA] No items found; skipping ingest.");
  await Actor.exit();
}

console.log(`[VMA] Prepared ${items.length} items. Posting to ingest...`);

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

console.log("[VMA] Ingest OK:", text);

await Actor.exit();
