# Grays Auction Harvester

Apify Playwright actor for harvesting vehicle listings from Grays.com auctions.

## Why Apify?

Grays.com uses Cloudflare protection that blocks direct HTTP requests from Supabase Edge Functions (403 errors). This actor uses Playwright with residential proxies to bypass the protection.

## Modes

### Stub Mode (hourly)

Crawls Grays search result pages and extracts lot URLs.

```json
{
  "mode": "stub",
  "maxPages": 10,
  "startPage": 1,
  "ingestKey": "your-grays-ingest-key",
  "batchSize": 50
}
```

Extracts:
- `source_stock_id` - Lot ID from URL (e.g., "0001-10352288")
- `detail_url` - Full lot page URL
- `year`, `make`, `model` - Parsed from URL slug
- `location` - State (NSW, VIC, etc.)
- `raw_text` - Card context for debugging

Posts to: `grays-stub-ingest-webhook`

### Detail Mode (every 10 minutes)

Fetches individual lot pages and extracts full vehicle data.

```json
{
  "mode": "detail",
  "detailUrls": [
    { "source_stock_id": "0001-10352288", "detail_url": "https://www.grays.com/lot/0001-10352288/..." }
  ],
  "ingestKey": "your-grays-ingest-key"
}
```

Extracts:
- `variant_raw` - Full variant from title
- `km` - Odometer reading
- `asking_price`, `guide_price` - Prices
- `fuel`, `transmission`, `drivetrain` - Specs
- `location` - State
- `auction_datetime` - Auction close time
- `reserve_status` - no_reserve, reserve_met, reserve_not_met
- `wovr_indicator`, `damage_noted`, `keys_present`, `starts_drives` - Condition flags

Posts to: `grays-detail-ingest-webhook`

## Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     APIFY (Playwright)                          │
├─────────────────────────────────────────────────────────────────┤
│  STUB HARVESTER (hourly)                                        │
│  1. Crawl grays.com/search/...?page=N                          │
│  2. Extract /lot/{id}/... URLs                                  │
│  3. POST to grays-stub-ingest-webhook                          │
├─────────────────────────────────────────────────────────────────┤
│  DETAIL HARVESTER (every 10 mins)                               │
│  1. Receive pending URLs from orchestrator                      │
│  2. Open each lot page, extract vehicle data                    │
│  3. POST to grays-detail-ingest-webhook                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SUPABASE EDGE FUNCTIONS                       │
├─────────────────────────────────────────────────────────────────┤
│  grays-stub-ingest-webhook                                      │
│  → upsert_stub_anchor_batch(source='grays')                    │
│  → stub_anchors table                                           │
├─────────────────────────────────────────────────────────────────┤
│  grays-stub-match (cron every 15 mins)                          │
│  → Match stub_anchors to dealer_specs                           │
│  → Queue to pickles_detail_queue                                │
├─────────────────────────────────────────────────────────────────┤
│  grays-detail-ingest-webhook                                    │
│  → Upsert vehicle_listings (grays:{id})                        │
│  → Upsert dealer_spec_matches                                   │
│  → Mark queue row done                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Scheduling

| Component | Schedule | Platform |
|-----------|----------|----------|
| Stub Harvester | Hourly | Apify |
| grays-stub-match | */15 * * * * | Supabase cron |
| Detail Harvester | Every 10 mins | Apify |

## Authentication

Both webhook endpoints require `GRAYS_INGEST_KEY` as Bearer token:

```
Authorization: Bearer <GRAYS_INGEST_KEY>
```

Set this in Apify actor input as `ingestKey`.

## Proxy Configuration

For best results, configure the actor with residential proxies:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```
