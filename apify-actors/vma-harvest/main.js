/**
 * VMA (Valley Motor Auctions) Phase-1 Harvester
 * 
 * Apify Actor that bypasses 403 blocks by running in Playwright.
 * Extracts MTA IDs from VMA search results and sends to Lovable Edge Function.
 * 
 * Input JSON:
 * {
 *   "searchUrl": "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models&fromyear=2016",
 *   "maxPages": 1,
 *   "INGEST_URL": "https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/ingest-vma",
 *   "INGEST_KEY": "your-vma-ingest-key-value"
 * }
 */

import { Actor } from "apify";
import { chromium } from "playwright";

await Actor.init();

const input = (await Actor.getInput()) || {};

const searchUrl = input.searchUrl;
const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : 1;

const INGEST_URL = input.INGEST_URL;
const INGEST_KEY = input.INGEST_KEY;

if (!searchUrl) throw new Error("Missing input.searchUrl");
if (!INGEST_URL) throw new Error("Missing input.INGEST_URL");
if (!INGEST_KEY) throw new Error("Missing input.INGEST_KEY");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});

const itemsMap = new Map(); // mta -> {mta, detail_url, search_url, page_no}

function extractMtasFromHtml(html) {
  const mtas = new Set();

  // Most reliable: find any link/query mention containing MTA=
  const re = /[?&]MTA=(\d{5,10})\b/g;
  let m;
  while ((m = re.exec(html)) !== null) mtas.add(m[1]);

  return [...mtas];
}

async function harvestPage() {
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const html = await page.content();
  const mtas = extractMtasFromHtml(html);

  let added = 0;
  for (const mta of mtas) {
    if (itemsMap.has(mta)) continue;

    itemsMap.set(mta, {
      mta,
      detail_url: `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`,
      search_url: searchUrl,
      page_no: null,
    });
    added++;
  }

  return { mtasFound: mtas.length, added, total: itemsMap.size };
}

for (let p = 1; p <= maxPages; p++) {
  const stats = await harvestPage();
  console.log(`[VMA] Page ${p}: mtasFound=${stats.mtasFound}, added=${stats.added}, total=${stats.total}`);

  // v1: no confirmed paging yet; keep it single-page until we prove ingestion is working.
  break;
}

await browser.close();

const items = Array.from(itemsMap.values());
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
