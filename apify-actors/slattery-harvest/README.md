# Slattery Auctions Harvester

Playwright-based harvester for slatteryauctions.com.au, bypassing their JavaScript-rendered frontend.

## Architecture

Slattery is a React/Next.js site that requires JavaScript execution to render content. This actor uses Playwright to:
1. **Stub mode**: Crawl Motor Vehicles category pages and extract asset links
2. **Detail mode**: Fetch individual asset pages and extract vehicle data

Results are POSTed to Supabase Edge webhook functions.

## URL Patterns

- **Discovery**: `https://slatteryauctions.com.au/auctions?categoryGroups=Motor+Vehicles`
- **Category**: `https://slatteryauctions.com.au/categories/motor-vehicles`
- **Detail**: `https://slatteryauctions.com.au/assets/{consignmentNo}?auctionNum={auctionNo}`

## Modes

### Stub Mode (hourly)

Crawls discovery/category pages and extracts:
- `source_stock_id` (consignment number from URL)
- `detail_url`
- `year`, `make`, `model` (from title/text)
- `location`

POSTs to: `slattery-stub-ingest-webhook`

### Detail Mode (every 10 mins)

**Auto-reads from pickles_detail_queue** where `source='slattery'` and `crawl_status='pending'`.

For each item, extracts:
- `variant_raw` (full title)
- `km` (odometer)
- `asking_price`, `guide_price`, `current_bid`
- `fuel`, `transmission`, `drivetrain`
- `location`, `state`
- `auction_datetime`
- Condition flags: `wovr`, `damage_noted`, `keys_present`, `starts_drives`

POSTs to: `slattery-detail-ingest-webhook` (which marks queue rows as `done`)

## Input Schema

```json
{
  "mode": "stub",          // "stub" or "detail"
  "maxPages": 10,          // Max pages to crawl (stub mode)
  "detailUrls": [],        // Optional: override queue auto-read (detail mode)
  "ingestKey": "...",      // VMA_INGEST_KEY for auth
  "batchSize": 50,         // Items per POST (also used as queue fetch limit in detail mode)
  "dryRun": false          // Extract but don't POST
}
```

**Detail mode auto-reads**: If `detailUrls` is empty, the actor automatically fetches pending items from `pickles_detail_queue` where `source='slattery'`.
```

## Authentication

Both webhook endpoints require `VMA_INGEST_KEY` as Bearer token (shared with VMA/Pickles/Manheim/Grays):

```
Authorization: Bearer <VMA_INGEST_KEY>
```

Set this in Apify actor input as `ingestKey` (use the same key value as other harvesters).

## Webhook Endpoints

- **Stub**: `https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/slattery-stub-ingest-webhook`
- **Detail**: `https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/slattery-detail-ingest-webhook`

## Proxy Configuration

Use residential proxies for Australia to avoid detection:

```javascript
proxyConfiguration: {
  useApifyProxy: true,
  groups: ['RESIDENTIAL'],
  countryCode: 'AU'
}
```

## Scheduling

- **Stub harvester**: hourly
- **slattery-stub-match** (Edge/cron): every 15 minutes (DB-only)
- **Detail harvester**: every 10 minutes

## Data Flow

```
Apify Actor (stub mode)
    ↓ POST /slattery-stub-ingest-webhook
stub_anchors (source='slattery')
    ↓ slattery-stub-match (cron, every 15 min)
pickles_detail_queue (source='slattery', status='pending')
    ↓ Apify reads queue OR receives list
Apify Actor (detail mode)
    ↓ POST /slattery-detail-ingest-webhook
vehicle_listings + dealer_spec_matches
```

## Example Consignment IDs

- `1-4-1-018879`
- `1-4-1-018880`
- `1-4-1-018456`
