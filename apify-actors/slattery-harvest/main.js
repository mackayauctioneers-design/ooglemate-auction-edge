/**
 * Slattery Auctions Harvester
 * 
 * Playwright-based actor for slatteryauctions.com.au
 * Two modes: stub (discovery) and detail (extraction)
 * 
 * Detail mode uses atomic claim RPC (claim_slattery_queue_batch) for concurrency-safe processing
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const SUPABASE_URL = 'https://xznchxsbuwngfmwvsvhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM';

// Default webhook URLs (can be overridden via input)
const DEFAULT_STUB_WEBHOOK = `${SUPABASE_URL}/functions/v1/slattery-stub-ingest-webhook`;
const DEFAULT_DETAIL_WEBHOOK = `${SUPABASE_URL}/functions/v1/slattery-detail-ingest-webhook`;

/**
 * Post batch to webhook with proper error handling
 */
async function postBatch(webhookUrl, items, ingestKey, dryRun) {
  if (dryRun) {
    console.log(`[DRY RUN] Would POST ${items.length} items to ${webhookUrl}`);
    return { success: true, posted: items.length };
  }
  
  if (items.length === 0) {
    return { success: true, posted: 0 };
  }

  console.log(`POSTing ${items.length} items to ${webhookUrl}`);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ingestKey}`,
      },
      body: JSON.stringify({ items }),
    });

    const result = await response.json();
    console.log(`POST response (${response.status}):`, JSON.stringify(result).slice(0, 500));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    }
    
    return { success: true, posted: items.length, result };
  } catch (error) {
    console.error('POST failed:', error.message);
    return { success: false, posted: 0, error: error.message };
  }
}

/**
 * Claim queue batch using atomic RPC (FOR UPDATE SKIP LOCKED)
 */
async function claimQueueBatch(batchSize, ingestKey) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/claim_slattery_queue_batch`;
  
  console.log(`Claiming batch of ${batchSize} items via RPC...`);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${ingestKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        p_batch_size: batchSize,
        p_max_retries: 3 
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const items = await response.json();
    console.log(`Claimed ${items.length} queue items`);
    return items;
  } catch (error) {
    console.error('Failed to claim queue batch:', error.message);
    return [];
  }
}

/**
 * Mark queue item as done
 */
async function markQueueDone(id) {
  const url = `${SUPABASE_URL}/rest/v1/pickles_detail_queue?id=eq.${id}`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ 
        crawl_status: 'done',
        updated_at: new Date().toISOString()
      }),
    });
  } catch (error) {
    console.error(`Failed to mark ${id} as done:`, error.message);
  }
}

/**
 * Mark queue item as error
 */
async function markQueueError(id, errorMsg) {
  const url = `${SUPABASE_URL}/rest/v1/pickles_detail_queue?id=eq.${id}`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ 
        crawl_status: 'error',
        last_error: (errorMsg || 'Unknown error').slice(0, 500),
        updated_at: new Date().toISOString()
      }),
    });
  } catch (error) {
    console.error(`Failed to mark ${id} as error:`, error.message);
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
 * Extract location/state from text
 */
function extractLocation(text) {
  if (!text) return { location: null, state: null };
  
  const stateMatch = text.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/);
  const cityMatch = text.match(/\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Darwin|Hobart)\b/i);
  
  return {
    location: cityMatch ? cityMatch[0] : null,
    state: stateMatch ? stateMatch[1] : null,
  };
}

/**
 * Build paginated discovery URLs based on maxPages
 */
function buildDiscoveryUrls(maxPages) {
  const urls = [];
  // Slattery uses category-based browsing, build paginated URLs
  for (let page = 1; page <= maxPages; page++) {
    urls.push(`https://slatteryauctions.com.au/auctions?categoryGroups=Motor+Vehicles&page=${page}`);
    urls.push(`https://slatteryauctions.com.au/categories/motor-vehicles?page=${page}`);
  }
  return urls;
}

/**
 * Configure proxy based on input
 */
async function configureProxy(proxyGroup, proxyCountry) {
  if (proxyGroup === 'NONE') {
    console.log('Proxy disabled');
    return undefined;
  }
  
  const groups = proxyGroup === 'RESIDENTIAL' ? ['RESIDENTIAL'] : undefined;
  
  console.log(`Configuring proxy: group=${proxyGroup}, country=${proxyCountry}`);
  
  return Actor.createProxyConfiguration({
    groups,
    countryCode: proxyCountry,
  });
}

/**
 * Run stub mode - discover vehicle listings
 */
async function runStubMode(config) {
  const { maxPages, ingestKey, batchSize, dryRun, proxyConfiguration, stubWebhookUrl } = config;
  
  const discoveryUrls = buildDiscoveryUrls(maxPages);
  console.log(`Built ${discoveryUrls.length} discovery URLs for ${maxPages} pages`);

  let collectedItems = [];
  let totalPushed = 0;
  let totalDiscovered = 0;
  let totalSkipped = 0;
  let pagesVisited = 0;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: discoveryUrls.length,
    headless: true,
    requestHandlerTimeoutSecs: 60,
    proxyConfiguration,
    
    async requestHandler({ page, request, log }) {
      pagesVisited++;
      log.info(`[${pagesVisited}/${discoveryUrls.length}] Processing: ${request.url}`);
      
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      
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

      log.info(`Found ${assetLinks.length} asset links on page`);
      totalDiscovered += assetLinks.length;

      for (const { href, text } of assetLinks) {
        const fullUrl = href.startsWith('http') ? href : `https://slatteryauctions.com.au${href}`;
        const consignmentId = extractConsignmentId(fullUrl);
        
        if (!consignmentId) {
          totalSkipped++;
          log.warning(`Skipped link with missing consignment ID: ${fullUrl.slice(0, 100)}`);
          continue;
        }

        const { year, make, model } = parseVehicleInfo(text);
        const { location, state } = extractLocation(text);

        collectedItems.push({
          source_stock_id: consignmentId,
          detail_url: fullUrl,
          year,
          make,
          model,
          location,
          state,
          raw_text: text,
        });
      }

      // Batch post when threshold reached
      if (collectedItems.length >= batchSize) {
        const batch = collectedItems.splice(0, batchSize);
        const result = await postBatch(stubWebhookUrl, batch, ingestKey, dryRun);
        if (result.success) {
          totalPushed += result.posted;
        }
      }
    },

    failedRequestHandler({ request, log }) {
      log.error(`Request failed: ${request.url}`);
    },
  });

  await crawler.run(discoveryUrls);

  // Post remaining items
  if (collectedItems.length > 0) {
    const result = await postBatch(stubWebhookUrl, collectedItems, ingestKey, dryRun);
    if (result.success) {
      totalPushed += result.posted;
    }
  }

  // Final summary with real numbers
  console.log('=== STUB MODE SUMMARY ===');
  console.log(`Pages visited: ${pagesVisited}`);
  console.log(`Links discovered: ${totalDiscovered}`);
  console.log(`Valid IDs pushed: ${totalPushed}`);
  console.log(`Skipped (missing ID): ${totalSkipped}`);
  console.log('=========================');
  
  return { pagesVisited, totalDiscovered, totalPushed, totalSkipped };
}

/**
 * Run detail mode - extract vehicle details using atomic queue claiming
 */
async function runDetailMode(config) {
  const { ingestKey, batchSize, dryRun, proxyConfiguration, detailWebhookUrl } = config;

  // Claim batch using atomic RPC
  const claimedItems = await claimQueueBatch(batchSize, ingestKey);
  
  if (claimedItems.length === 0) {
    console.log('No pending queue items to process for source=slattery');
    console.log('=== DETAIL MODE SUMMARY ===');
    console.log('Claimed: 0, Fetched OK: 0, Errors: 0');
    console.log('===========================');
    return { claimed: 0, fetched: 0, errors: 0, pushed: 0 };
  }

  console.log(`Processing ${claimedItems.length} claimed items`);

  let collectedResults = [];
  let totalPushed = 0;
  let fetchedOk = 0;
  let errorCount = 0;
  
  // Map queue_id -> item for status updates
  const queueMap = new Map(claimedItems.map(item => [item.detail_url, item]));

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: claimedItems.length,
    headless: true,
    requestHandlerTimeoutSecs: 60,
    proxyConfiguration,

    async requestHandler({ page, request, log }) {
      log.info(`Processing detail: ${request.url}`);
      
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      const queueItem = queueMap.get(request.url);
      const consignmentId = request.userData?.source_stock_id || extractConsignmentId(request.url);
      
      if (!consignmentId) {
        log.error('Could not extract consignment ID - marking as error');
        if (queueItem) await markQueueError(queueItem.id, 'Missing consignment ID');
        errorCount++;
        return;
      }

      const data = await page.evaluate(() => {
        const result = {
          variant_raw: null,
          year: null,
          make: null,
          model: null,
          km: null,
          // Separate price fields (no mixing semantics)
          starting_bid: null,
          current_bid: null,
          guide_price: null,
          sold_price: null,
          buy_now: null,
          // Other fields
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

        const title = document.querySelector('h1')?.textContent || document.title;
        result.variant_raw = title?.trim();

        const ymmMatch = title?.match(/\b(19[89]\d|20[0-2]\d)\s+([A-Z][a-z]+)\s+([A-Za-z0-9]+)/i);
        if (ymmMatch) {
          result.year = parseInt(ymmMatch[1], 10);
          result.make = ymmMatch[2].toUpperCase();
          result.model = ymmMatch[3].toUpperCase();
        }

        const bodyText = document.body.innerText;

        // Odometer
        const kmMatch = bodyText.match(/(?:odometer|kms?|kilometres?)[:\s]*([0-9,]+)/i) ||
                       bodyText.match(/([0-9,]+)\s*(?:kms?|kilometres?)\b/i);
        if (kmMatch) {
          const km = parseInt(kmMatch[1].replace(/,/g, ''), 10);
          if (km > 50 && km < 900000) result.km = km;
        }

        // Current bid
        const bidMatch = bodyText.match(/(?:current\s*bid|highest\s*bid)[:\s]*\$?([0-9,]+)/i);
        if (bidMatch) result.current_bid = parseInt(bidMatch[1].replace(/,/g, ''), 10);

        // Starting bid
        const startMatch = bodyText.match(/(?:starting\s*bid|start\s*price|opening\s*bid)[:\s]*\$?([0-9,]+)/i);
        if (startMatch) result.starting_bid = parseInt(startMatch[1].replace(/,/g, ''), 10);

        // Guide price
        const guideMatch = bodyText.match(/(?:guide|estimate)[:\s]*\$?([0-9,]+)/i);
        if (guideMatch) result.guide_price = parseInt(guideMatch[1].replace(/,/g, ''), 10);

        // Sold price (separate from asking price!)
        if (/\b(sold|sold\s*for|hammer|won)\b/i.test(bodyText)) {
          result.sold = true;
          const soldMatch = bodyText.match(/(?:sold\s*for|hammer\s*price|final\s*price)[:\s]*\$?([0-9,]+)/i);
          if (soldMatch) result.sold_price = parseInt(soldMatch[1].replace(/,/g, ''), 10);
        }

        // Fuel type
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

      collectedResults.push({
        source_stock_id: consignmentId,
        queue_id: queueItem?.id,
        stub_anchor_id: queueItem?.stub_anchor_id,
        detail_url: request.url,
        ...data,
      });
      
      fetchedOk++;

      // Batch post when threshold reached
      if (collectedResults.length >= batchSize) {
        const batch = collectedResults.splice(0, batchSize);
        const result = await postBatch(detailWebhookUrl, batch, ingestKey, dryRun);
        if (result.success) {
          totalPushed += result.posted;
          // Mark all as done
          for (const item of batch) {
            if (item.queue_id) await markQueueDone(item.queue_id);
          }
        }
      }
    },

    async failedRequestHandler({ request, log }) {
      log.error(`Request failed: ${request.url}`);
      const queueItem = queueMap.get(request.url);
      if (queueItem) {
        await markQueueError(queueItem.id, 'Playwright request failed');
      }
      errorCount++;
    },
  });

  // Build request list
  const requests = claimedItems.map(item => ({
    url: item.detail_url,
    userData: { 
      source_stock_id: item.source_listing_id,
      queue_id: item.id 
    },
  }));

  await crawler.run(requests);

  // Post remaining results
  if (collectedResults.length > 0) {
    const result = await postBatch(detailWebhookUrl, collectedResults, ingestKey, dryRun);
    if (result.success) {
      totalPushed += result.posted;
      for (const item of collectedResults) {
        if (item.queue_id) await markQueueDone(item.queue_id);
      }
    }
  }

  // Final summary
  console.log('=== DETAIL MODE SUMMARY ===');
  console.log(`Claimed: ${claimedItems.length}`);
  console.log(`Fetched OK: ${fetchedOk}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Pushed to webhook: ${totalPushed}`);
  console.log(`Queue done: ${fetchedOk}, error: ${errorCount}`);
  console.log('===========================');
  
  return { claimed: claimedItems.length, fetched: fetchedOk, errors: errorCount, pushed: totalPushed };
}

// ============ MAIN ENTRY POINT ============
Actor.main(async () => {
  const input = await Actor.getInput() || {};
  const {
    mode = 'stub',
    maxPages = 10,
    ingestKey = '',
    batchSize = 50,
    proxyCountry = 'AU',
    proxyGroup = 'AUTO', // AUTO | DATACENTER | RESIDENTIAL | NONE
    dryRun = false,
    // Webhook URL overrides (for testing)
    stubWebhookUrl = DEFAULT_STUB_WEBHOOK,
    detailWebhookUrl = DEFAULT_DETAIL_WEBHOOK,
  } = input;

  // HARD FAIL: ingestKey is required (unless dryRun)
  if (!ingestKey && !dryRun) {
    console.error('FATAL: ingestKey (VMA_INGEST_KEY) is required. Cannot proceed without authentication.');
    throw new Error('ingestKey is required');
  }

  console.log('=== SLATTERY HARVESTER CONFIG ===');
  console.log(`Mode: ${mode}`);
  console.log(`Proxy: ${proxyGroup} (country=${proxyCountry})`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Stub webhook: ${stubWebhookUrl}`);
  console.log(`Detail webhook: ${detailWebhookUrl}`);
  console.log('=================================');

  // Configure proxy
  const proxyConfiguration = await configureProxy(proxyGroup, proxyCountry);

  const config = {
    maxPages,
    ingestKey,
    batchSize,
    dryRun,
    proxyConfiguration,
    stubWebhookUrl,
    detailWebhookUrl,
  };

  let result;
  if (mode === 'stub') {
    result = await runStubMode(config);
  } else if (mode === 'detail') {
    result = await runDetailMode(config);
  } else {
    throw new Error(`Unknown mode: ${mode}. Use 'stub' or 'detail'.`);
  }

  // Store output for Apify dataset
  await Actor.pushData(result);
});
