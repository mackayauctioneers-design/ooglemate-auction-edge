/**
 * VMA (Valley Motor Auctions) Phase-1 Harvester
 * 
 * Apify Actor that bypasses 403 blocks by running in Playwright.
 * Extracts MTA IDs from VMA search results and upserts to pickles_detail_queue via RPC.
 * 
 * Environment Variables (Apify Secrets):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * 
 * Input JSON:
 * {
 *   "searchUrl": "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models&fromyear=2016",
 *   "maxPages": 1,
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
const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : 1;
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

for (let p = 1; p <= maxPages; p++) {
  // v1: no confirmed paging param, so harvest the first page.
  // Once we identify paging links, we'll add pagination properly.
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Give JS time to hydrate if required
  await page.waitForTimeout(2500);

  // Pull all inspection links
  const links = await page.$$eval("a", (as) =>
    as
      .map((a) => a.href)
      .filter((h) => h && h.includes("cp_veh_inspection_report.aspx") && h.includes("MTA="))
  );

  console.log(`[VMA] Page ${p}: Found ${links.length} raw links`);

  for (const href of links) {
    try {
      const u = new URL(href);
      const mta = u.searchParams.get("MTA");
      const sitekey = u.searchParams.get("sitekey") || "VMA";
      if (!mta) continue;

      const cleanUrl = `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=${sitekey}`;

      itemsMap.set(String(mta), {
        source_listing_id: String(mta),
        detail_url: cleanUrl,
        search_url: searchUrl,
        page_no: null,
      });
    } catch {
      // ignore malformed
    }
  }

  // Check for pager (for future pagination support)
  const pagerInfo = await page.evaluate(() => {
    // Look for common pager patterns
    const nextBtn = document.querySelector('a[href*="page="], a:contains("Next"), .pagination a');
    const pageLinks = document.querySelectorAll('.pager a, .pagination a, a[href*="__EVENTARGUMENT"]');
    return {
      hasNextButton: !!nextBtn,
      pageLinksCount: pageLinks.length,
      pagerHtml: document.querySelector('.pager, .pagination')?.outerHTML?.slice(0, 500) || null
    };
  });
  
  console.log(`[VMA] Pager info:`, JSON.stringify(pagerInfo));

  // break until we implement paging
  break;
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
  timestamp: new Date().toISOString(),
});

await Actor.exit();
