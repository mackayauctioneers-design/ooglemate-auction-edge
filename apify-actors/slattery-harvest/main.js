/**
 * Slattery Auctions Harvester
 * 
 * Playwright-based actor for slatteryauctions.com.au
 * Two modes: stub (discovery) and detail (extraction)
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const SUPABASE_URL = 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1';

await Actor.init();

const input = await Actor.getInput() || {};
const {
  mode = 'stub',
  maxPages = 10,
  detailUrls = [],
  ingestKey = '',
  batchSize = 50,
  dryRun = false,
} = input;

console.log(`Starting Slattery harvester in ${mode} mode`);

// Collected items for batch posting
let collectedItems = [];

/**
 * Post batch to webhook
 */
async function postBatch(endpoint, items) {
  if (dryRun || items.length === 0) {
    console.log(`[DRY RUN] Would POST ${items.length} items to ${endpoint}`);
    return;
  }

  const url = `${SUPABASE_URL}/${endpoint}`;
  console.log(`POSTing ${items.length} items to ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ingestKey}`,
      },
      body: JSON.stringify({ items }),
    });

    const result = await response.json();
    console.log(`POST response (${response.status}):`, result);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    console.error('POST failed:', error);
    throw error;
  }
}

/**
 * Extract consignment ID from asset URL
 * Pattern: /assets/{consignmentNo}?auctionNum={auctionNo}
 */
function extractConsignmentId(url) {
  const match = url.match(/\/assets\/([^?\/]+)/);
  return match ? match[1] : null;
}

/**
 * Parse year/make/model from text
 */
function parseVehicleInfo(text) {
  if (!text) return { year: null, make: null, model: null };
  
  const match = text.match(/\b(19[89]\d|20[0-2]\d)\s+([A-Z][a-z]+)\s+([A-Za-z0-9]+)/i);
  if (match) {
    return {
      year: parseInt(match[1], 10),
      make: match[2].toUpperCase(),
      model: match[3].toUpperCase(),
    };
  }
  return { year: null, make: null, model: null };
}

/**
 * Extract location from text
 */
function extractLocation(text) {
  if (!text) return null;
  
  const patterns = [
    /\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Darwin|Hobart)\b/i,
    /\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// ============ STUB MODE ============
if (mode === 'stub') {
  const discoveryUrls = [
    'https://slatteryauctions.com.au/auctions?categoryGroups=Motor+Vehicles',
    'https://slatteryauctions.com.au/categories/motor-vehicles',
  ];

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages * 2,
    headless: true,
    requestHandlerTimeoutSecs: 60,
    
    async requestHandler({ page, request, log }) {
      log.info(`Processing: ${request.url}`);
      
      // Wait for content to load
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      
      // Extract all asset links
      const assetLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a[href*="/assets/"]').forEach(a => {
          const href = a.getAttribute('href');
          const text = a.textContent || a.closest('div')?.textContent || '';
          if (href) {
            links.push({ href, text: text.trim().slice(0, 200) });
          }
        });
        return links;
      });

      log.info(`Found ${assetLinks.length} asset links`);

      for (const { href, text } of assetLinks) {
        const fullUrl = href.startsWith('http') ? href : `https://slatteryauctions.com.au${href}`;
        const consignmentId = extractConsignmentId(fullUrl);
        
        if (!consignmentId) continue;

        const { year, make, model } = parseVehicleInfo(text);
        const location = extractLocation(text);

        collectedItems.push({
          source_stock_id: consignmentId,
          detail_url: fullUrl,
          year,
          make,
          model,
          location,
          raw_text: text,
        });
      }

      // Post batch if enough items collected
      if (collectedItems.length >= batchSize) {
        await postBatch('slattery-stub-ingest-webhook', collectedItems);
        collectedItems = [];
      }
    },

    failedRequestHandler({ request, log }) {
      log.error(`Request failed: ${request.url}`);
    },
  });

  await crawler.run(discoveryUrls);

  // Post remaining items
  if (collectedItems.length > 0) {
    await postBatch('slattery-stub-ingest-webhook', collectedItems);
  }

  console.log(`Stub mode complete. Total items: ${collectedItems.length}`);
}

// ============ DETAIL MODE ============
else if (mode === 'detail') {
  // Use provided URLs or would need to fetch from queue
  const urlsToProcess = detailUrls.length > 0 ? detailUrls : [];

  if (urlsToProcess.length === 0) {
    console.log('No detail URLs provided. Pass detailUrls in input or implement queue reading.');
    await Actor.exit();
  }

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: urlsToProcess.length,
    headless: true,
    requestHandlerTimeoutSecs: 60,

    async requestHandler({ page, request, log }) {
      log.info(`Processing detail: ${request.url}`);
      
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      const consignmentId = extractConsignmentId(request.url);
      if (!consignmentId) {
        log.error('Could not extract consignment ID');
        return;
      }

      // Extract vehicle data from page
      const data = await page.evaluate(() => {
        const result = {
          variant_raw: null,
          year: null,
          make: null,
          model: null,
          km: null,
          asking_price: null,
          guide_price: null,
          current_bid: null,
          fuel: null,
          transmission: null,
          drivetrain: null,
          location: null,
          state: null,
          auction_datetime: null,
          wovr_indicator: false,
          damage_noted: false,
          keys_present: null,
          starts_drives: null,
          sold: false,
        };

        // Get title
        const title = document.querySelector('h1')?.textContent || document.title;
        result.variant_raw = title?.trim();

        // Parse year/make/model from title
        const ymmMatch = title?.match(/\b(19[89]\d|20[0-2]\d)\s+([A-Z][a-z]+)\s+([A-Za-z0-9]+)/i);
        if (ymmMatch) {
          result.year = parseInt(ymmMatch[1], 10);
          result.make = ymmMatch[2].toUpperCase();
          result.model = ymmMatch[3].toUpperCase();
        }

        // Get all text content for parsing
        const bodyText = document.body.innerText;

        // Odometer
        const kmMatch = bodyText.match(/(?:odometer|kms?|kilometres?)[:\s]*([0-9,]+)/i) ||
                       bodyText.match(/([0-9,]+)\s*(?:kms?|kilometres?)\b/i);
        if (kmMatch) {
          const km = parseInt(kmMatch[1].replace(/,/g, ''), 10);
          if (km > 50 && km < 900000) result.km = km;
        }

        // Prices
        const bidMatch = bodyText.match(/(?:current\s*bid|highest\s*bid)[:\s]*\$?([0-9,]+)/i);
        if (bidMatch) result.current_bid = parseInt(bidMatch[1].replace(/,/g, ''), 10);

        const startMatch = bodyText.match(/(?:starting\s*bid|start\s*price)[:\s]*\$?([0-9,]+)/i);
        if (startMatch) result.asking_price = parseInt(startMatch[1].replace(/,/g, ''), 10);

        const guideMatch = bodyText.match(/(?:guide|estimate)[:\s]*\$?([0-9,]+)/i);
        if (guideMatch) result.guide_price = parseInt(guideMatch[1].replace(/,/g, ''), 10);

        // Sold status
        if (/\b(sold|sold\s*for|hammer|won)\b/i.test(bodyText)) {
          result.sold = true;
          const soldMatch = bodyText.match(/(?:sold\s*for|hammer)[:\s]*\$?([0-9,]+)/i);
          if (soldMatch) result.asking_price = parseInt(soldMatch[1].replace(/,/g, ''), 10);
        }

        // Fuel
        if (/\bdiesel\b/i.test(bodyText)) result.fuel = 'diesel';
        else if (/\b(petrol|gasoline)\b/i.test(bodyText)) result.fuel = 'petrol';
        else if (/\bhybrid\b/i.test(bodyText)) result.fuel = 'hybrid';
        else if (/\b(electric|ev)\b/i.test(bodyText)) result.fuel = 'electric';

        // Transmission
        if (/\b(automatic|auto)\b/i.test(bodyText)) result.transmission = 'automatic';
        else if (/\bmanual\b/i.test(bodyText)) result.transmission = 'manual';

        // Drivetrain
        if (/\b(4x4|4wd|awd)\b/i.test(bodyText)) result.drivetrain = '4x4';
        else if (/\b(2wd|rwd|fwd)\b/i.test(bodyText)) result.drivetrain = '2wd';

        // Location
        const locMatch = bodyText.match(/(?:location|yard|pickup)[:\s]*([^\n]+)/i);
        if (locMatch) {
          result.location = locMatch[1].trim().slice(0, 100);
          const stateMatch = result.location.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/);
          if (stateMatch) result.state = stateMatch[1];
        }

        // Condition flags
        if (/\b(wovr|written?\s*off|write[\s-]*off)\b/i.test(bodyText)) result.wovr_indicator = true;
        if (/\b(damage|damaged|accident|hail)\b/i.test(bodyText)) result.damage_noted = true;
        if (/\b(no\s*keys?|keys?\s*missing)\b/i.test(bodyText)) result.keys_present = false;
        else if (/\b(keys?\s*present|keys?\s*available)\b/i.test(bodyText)) result.keys_present = true;
        if (/\b(starts?\s*and\s*drives?|runs?\s*and\s*drives?)\b/i.test(bodyText)) result.starts_drives = true;
        else if (/\b(does\s*not\s*start|non[\s-]*runner)\b/i.test(bodyText)) result.starts_drives = false;

        return result;
      });

      collectedItems.push({
        source_stock_id: consignmentId,
        detail_url: request.url,
        ...data,
      });

      // Post batch if enough items collected
      if (collectedItems.length >= batchSize) {
        await postBatch('slattery-detail-ingest-webhook', collectedItems);
        collectedItems = [];
      }
    },

    failedRequestHandler({ request, log }) {
      log.error(`Request failed: ${request.url}`);
    },
  });

  await crawler.run(urlsToProcess.map(u => u.detail_url || u));

  // Post remaining items
  if (collectedItems.length > 0) {
    await postBatch('slattery-detail-ingest-webhook', collectedItems);
  }

  console.log(`Detail mode complete. Total items: ${collectedItems.length}`);
}

await Actor.exit();
