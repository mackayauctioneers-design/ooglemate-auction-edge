/**
 * GRAYS AUCTION HARVESTER - Apify Playwright Actor
 * 
 * Two modes:
 * 1. STUB mode (hourly): Crawl search pages, extract lot URLs, POST to grays-stub-ingest-webhook
 * 2. DETAIL mode (every 10 mins): Fetch individual lot pages, extract vehicle data, POST to grays-detail-ingest-webhook
 * 
 * Bypasses Cloudflare using Playwright with residential proxies.
 */

import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

const EDGE_FUNCTION_BASE = 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1';

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
  mode = 'stub', // 'stub' or 'detail'
  maxPages = 10,
  startPage = 1,
  detailUrls = [], // For detail mode: array of { source_stock_id, detail_url }
  ingestKey = '', // GRAYS_INGEST_KEY
  batchSize = 50,
  dryRun = false,
} = input;

log.info(`Starting Grays Harvester in ${mode.toUpperCase()} mode`);

const collectedItems = [];

if (mode === 'stub') {
  // ========== STUB HARVESTER MODE ==========
  
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages,
    headless: true,
    
    async requestHandler({ page, request, enqueueLinks }) {
      const pageNum = request.userData.pageNum || 1;
      log.info(`Processing search page ${pageNum}: ${request.url}`);
      
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      
      // Extract lot links from the page
      const lotLinks = await page.evaluate(() => {
        const links = [];
        const anchors = document.querySelectorAll('a[href*="/lot/"]');
        
        anchors.forEach(a => {
          const href = a.getAttribute('href');
          if (!href) return;
          
          // Match pattern: /lot/{lot-number}/{category}/{slug}
          const match = href.match(/\/lot\/([0-9-]+)\/([^\/]+)\/(.+)/);
          if (!match) return;
          
          const lotId = match[1];
          const category = match[2];
          const slug = match[3];
          
          // Only motor vehicles
          if (!category.includes('motor-vehicle') && !href.includes('motor-vehicle')) return;
          
          // Parse year/make/model from slug: {year}-{make}-{model}-...
          const slugMatch = slug.match(/^(\d{4})-([a-z]+)-([a-z0-9]+)/i);
          let year = null, make = null, model = null;
          
          if (slugMatch) {
            year = parseInt(slugMatch[1]);
            make = slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1).toLowerCase();
            model = slugMatch[3].charAt(0).toUpperCase() + slugMatch[3].slice(1).toLowerCase();
          }
          
          // Get surrounding text for context
          const card = a.closest('.lot-card, .item-card, .search-result, [class*="lot"], [class*="card"]');
          const rawText = card ? card.textContent?.substring(0, 500) : '';
          
          // Extract location from card text
          const locationMatch = rawText?.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
          const location = locationMatch ? locationMatch[1].toUpperCase() : null;
          
          links.push({
            source_stock_id: lotId,
            detail_url: href.startsWith('http') ? href : `https://www.grays.com${href}`,
            year,
            make,
            model,
            location,
            raw_text: rawText?.trim().substring(0, 500),
          });
        });
        
        return links;
      });
      
      log.info(`Page ${pageNum}: Found ${lotLinks.length} lot links`);
      
      // Dedupe by source_stock_id
      const seen = new Set(collectedItems.map(i => i.source_stock_id));
      for (const item of lotLinks) {
        if (!seen.has(item.source_stock_id)) {
          seen.add(item.source_stock_id);
          collectedItems.push(item);
        }
      }
      
      // Enqueue next page if we found items
      if (lotLinks.length > 0 && pageNum < maxPages) {
        const nextPage = pageNum + 1;
        await enqueueLinks({
          urls: [`https://www.grays.com/search/automotive-trucks-and-marine/motor-vehiclesmotor-cycles?page=${nextPage}`],
          userData: { pageNum: nextPage },
        });
      }
    },
    
    failedRequestHandler({ request }) {
      log.error(`Request failed: ${request.url}`);
    },
  });
  
  // Start crawl from page 1
  await crawler.run([{
    url: `https://www.grays.com/search/automotive-trucks-and-marine/motor-vehiclesmotor-cycles?page=${startPage}`,
    userData: { pageNum: startPage },
  }]);
  
  log.info(`Stub harvesting complete. Total items: ${collectedItems.length}`);
  
} else if (mode === 'detail') {
  // ========== DETAIL HARVESTER MODE ==========
  
  if (detailUrls.length === 0) {
    log.warning('No detail URLs provided. Exiting.');
    await Actor.exit();
  }
  
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: detailUrls.length,
    headless: true,
    
    async requestHandler({ page, request }) {
      const { source_stock_id, detail_url } = request.userData;
      log.info(`Processing detail page: ${source_stock_id}`);
      
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      
      const extracted = await page.evaluate(() => {
        const getText = (selector) => {
          const el = document.querySelector(selector);
          return el?.textContent?.trim() || null;
        };
        
        const getByLabel = (label) => {
          const rows = document.querySelectorAll('tr, .detail-row, .spec-row, [class*="detail"], [class*="spec"]');
          for (const row of rows) {
            if (row.textContent?.toLowerCase().includes(label.toLowerCase())) {
              const valueEl = row.querySelector('td:last-child, .value, span:last-child');
              return valueEl?.textContent?.trim() || null;
            }
          }
          return null;
        };
        
        // Title parsing
        const title = document.querySelector('h1, .lot-title, .vehicle-title')?.textContent?.trim() || '';
        const titleMatch = title.match(/(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9]+)/);
        
        // Odometer
        let km = null;
        const odometerText = getByLabel('odometer') || getByLabel('kilometres') || getByLabel('km');
        if (odometerText) {
          const kmMatch = odometerText.replace(/,/g, '').match(/(\d+)/);
          if (kmMatch) km = parseInt(kmMatch[1]);
        }
        
        // Prices
        const priceText = (getText('.price, .current-bid, .asking-price') || '').replace(/[$,]/g, '');
        const askingPrice = priceText ? parseInt(priceText.match(/\d+/)?.[0]) : null;
        
        const guideText = (getByLabel('guide') || getByLabel('estimate') || '').replace(/[$,]/g, '');
        const guidePrice = guideText ? parseInt(guideText.match(/\d+/)?.[0]) : null;
        
        // Vehicle specs
        const fuel = getByLabel('fuel') || getByLabel('fuel type');
        const transmission = getByLabel('transmission') || getByLabel('trans');
        const drivetrain = getByLabel('drive') || getByLabel('drivetrain');
        
        // Location
        const locationText = getByLabel('location') || getText('.location');
        const locationMatch = locationText?.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
        
        // Auction date
        const auctionText = getText('.auction-date, .closing-date, .ends');
        
        // Condition flags
        const pageText = document.body.textContent?.toLowerCase() || '';
        const wovr = pageText.includes('wovr') || pageText.includes('written off');
        const damage = pageText.includes('damage') || pageText.includes('hail');
        const keys = pageText.includes('keys present') || pageText.includes('with keys');
        const starts = pageText.includes('starts') || pageText.includes('drives');
        
        // Reserve status
        let reserveStatus = null;
        if (pageText.includes('no reserve')) reserveStatus = 'no_reserve';
        else if (pageText.includes('reserve met')) reserveStatus = 'reserve_met';
        else if (pageText.includes('reserve not met')) reserveStatus = 'reserve_not_met';
        
        // Variant from title (strip year/make/model)
        let variant = title;
        if (titleMatch) {
          variant = title.replace(new RegExp(`${titleMatch[1]}\\s+${titleMatch[2]}\\s+${titleMatch[3]}`, 'i'), '').trim();
        }
        
        return {
          year: titleMatch ? parseInt(titleMatch[1]) : null,
          make: titleMatch ? titleMatch[2] : null,
          model: titleMatch ? titleMatch[3] : null,
          variant_raw: variant || null,
          km,
          asking_price: askingPrice,
          guide_price: guidePrice,
          fuel,
          transmission,
          drivetrain,
          location: locationMatch ? locationMatch[1].toUpperCase() : null,
          auction_datetime: auctionText,
          reserve_status: reserveStatus,
          wovr_indicator: wovr,
          damage_noted: damage,
          keys_present: keys,
          starts_drives: starts,
        };
      });
      
      collectedItems.push({
        source_stock_id,
        detail_url,
        ...extracted,
      });
      
      log.info(`Extracted data for ${source_stock_id}: km=${extracted.km}, price=${extracted.asking_price}`);
    },
    
    failedRequestHandler({ request }) {
      log.error(`Detail page failed: ${request.url}`);
    },
  });
  
  // Run crawler on provided detail URLs
  await crawler.run(
    detailUrls.map(item => ({
      url: item.detail_url,
      userData: item,
    }))
  );
  
  log.info(`Detail harvesting complete. Total items: ${collectedItems.length}`);
}

// ========== POST TO EDGE FUNCTION ==========

if (!dryRun && collectedItems.length > 0 && ingestKey) {
  const endpoint = mode === 'stub' 
    ? `${EDGE_FUNCTION_BASE}/grays-stub-ingest-webhook`
    : `${EDGE_FUNCTION_BASE}/grays-detail-ingest-webhook`;
  
  // Send in batches
  for (let i = 0; i < collectedItems.length; i += batchSize) {
    const batch = collectedItems.slice(i, i + batchSize);
    
    log.info(`Posting batch ${Math.floor(i / batchSize) + 1} with ${batch.length} items to ${endpoint}`);
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ingestKey}`,
        },
        body: JSON.stringify({ items: batch }),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        log.info(`Batch posted successfully:`, result);
      } else {
        log.error(`Batch post failed: ${response.status}`, result);
      }
    } catch (err) {
      log.error(`Failed to post batch:`, err);
    }
  }
} else if (dryRun) {
  log.info('Dry run - not posting to Edge function');
}

// Save to dataset for debugging
await Dataset.pushData(collectedItems);

log.info(`Grays Harvester complete. Mode: ${mode}, Items: ${collectedItems.length}`);

await Actor.exit();
