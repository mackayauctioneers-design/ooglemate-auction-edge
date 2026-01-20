/**
 * VMA (Valley Motor Auctions) Phase-1 Harvester
 * 
 * Apify Actor that bypasses 403 blocks by running in Playwright.
 * Extracts MTA IDs from VMA search results and upserts to pickles_detail_queue via RPC.
 * 
 * Auto-detects pagination mode:
 * - page_param: querystring-based (?page=2)
 * - postback_or_click: ASP.NET postback / "Next" button click
 * - none: single page
 * 
 * Environment Variables (Apify Secrets):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * 
 * Input JSON:
 * {
 *   "searchUrl": "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models&fromyear=2016",
 *   "maxPages": 5,
 *   "runId": null
 * }
 */

import { Actor } from "apify";
import { chromium } from "playwright";

await Actor.init();

const input = (await Actor.getInput()) || {};
const searchUrl =
  input.searchUrl ||
  "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models";
const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : 5;
const runId = input.runId || crypto.randomUUID();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Apify secrets");
}

const RPC_NAME = "upsert_harvest_batch";
const SOURCE = "vma";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});

const itemsMap = new Map(); // mta -> item

// --- Helpers ---
function withPageParam(url, pageNum) {
  const u = new URL(url);
  u.searchParams.set("page", String(pageNum));
  return u.toString();
}

async function extractMtas(pg, searchUrlRef) {
  // wait briefly for links to exist (don't hard fail)
  await pg.waitForFunction(() => {
    return Array.from(document.querySelectorAll("a"))
      .some(a => (a.href || "").includes("cp_veh_inspection_report.aspx") && (a.href || "").includes("MTA="));
  }, { timeout: 15000 }).catch(() => {});

  const links = await pg.$$eval("a", (as) =>
    [...new Set(as
      .map((a) => a.href)
      .filter((h) => h && h.includes("cp_veh_inspection_report.aspx") && h.includes("MTA="))
    )]
  );

  let added = 0;
  for (const href of links) {
    try {
      const u = new URL(href);
      const mta = u.searchParams.get("MTA");
      const sitekey = u.searchParams.get("sitekey") || "VMA";
      if (!mta) continue;

      const cleanUrl = `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=${sitekey}`;
      const before = itemsMap.size;
      itemsMap.set(String(mta), {
        source_listing_id: String(mta),
        detail_url: cleanUrl,
        search_url: searchUrlRef,
        page_no: null,
      });
      if (itemsMap.size > before) added++;
    } catch {}
  }
  return { rawLinks: links.length, added };
}

async function detectPagingMode(pg) {
  return await pg.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a"));
    const hrefs = anchors.map(a => a.getAttribute("href") || "");

    const hasPageParamLinks = hrefs.some(h => /[?&]page=\d+/i.test(h));
    const hasPostBackLinks = hrefs.some(h => h.includes("__doPostBack"));

    const nextByText = anchors.find(a => (a.textContent || "").trim().toLowerCase().includes("next"));
    const pagerEl =
      document.querySelector(".pager") ||
      document.querySelector(".pagination") ||
      document.querySelector("#pager") ||
      document.querySelector("[class*='pager']") ||
      document.querySelector("[class*='pagination']");

    const hasEventTarget = !!document.querySelector("input[name='__EVENTTARGET']");
    const hasEventArgument = !!document.querySelector("input[name='__EVENTARGUMENT']");

    return {
      hasPagerContainer: !!pagerEl,
      hasNextByText: !!nextByText,
      hasPageParamLinks,
      hasPostBackLinks,
      hasEventTarget,
      hasEventArgument,
      pagerHtmlSample: pagerEl ? pagerEl.outerHTML.slice(0, 800) : null,
    };
  });
}

async function clickNextIfExists(pg) {
  // try click "Next" by text
  const clicked = await pg.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a"));
    const next = anchors.find(a => (a.textContent || "").trim().toLowerCase().includes("next"));
    if (next) { next.click(); return true; }
    return false;
  });
  if (clicked) {
    await pg.waitForTimeout(2000);
    return true;
  }
  return false;
}

// --- Main paging loop ---
await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);

const paging = await detectPagingMode(page);
console.log("[VMA] Pager info:", JSON.stringify(paging));

let mode = "none";
if (paging.hasPageParamLinks) mode = "page_param";
else if (paging.hasPostBackLinks || paging.hasEventTarget) mode = "postback_or_click";

console.log(`[VMA] Paging mode: ${mode}`);

let lastCount = 0;

for (let p = 1; p <= maxPages; p++) {
  if (p === 1) {
    // already loaded
  } else if (mode === "page_param") {
    const url = withPageParam(searchUrl, p);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
  } else if (mode === "postback_or_click") {
    const ok = await clickNextIfExists(page);
    if (!ok) {
      console.log(`[VMA] No Next clickable on page ${p}. Stopping.`);
      break;
    }
  } else {
    // no paging - just process page 1 and stop
    if (p > 1) break;
  }

  const { rawLinks, added } = await extractMtas(page, searchUrl);
  console.log(`[VMA] Page ${p}: rawLinks=${rawLinks}, added=${added}, totalUnique=${itemsMap.size}`);

  // stop if no growth (end reached)
  if (p > 1 && itemsMap.size === lastCount) {
    console.log(`[VMA] No increase after page ${p}. Stopping.`);
    break;
  }
  lastCount = itemsMap.size;
}

await browser.close();

const items = Array.from(itemsMap.values());

console.log(`[VMA] Found ${items.length} unique MTAs. Calling RPC...`);

if (items.length === 0) {
  console.log("[VMA] No items found - skipping RPC call");
  await Actor.exit();
}

const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${RPC_NAME}`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    p_source: SOURCE,
    p_items: items,
    p_run_id: runId,
  }),
});

const rpcText = await rpcRes.text();

if (!rpcRes.ok) {
  throw new Error(`RPC failed ${rpcRes.status}: ${rpcText}`);
}

console.log(`[VMA] RPC OK: ${rpcText}`);

// Store output for Apify dataset
await Actor.pushData({
  runId,
  source: SOURCE,
  searchUrl,
  uniqueMtasFound: items.length,
  rpcResult: JSON.parse(rpcText),
  pagingMode: mode,
  timestamp: new Date().toISOString(),
});

await Actor.exit();
