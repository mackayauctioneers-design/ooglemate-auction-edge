# Slattery Auctions Harvester

Playwright-based Apify actor for harvesting vehicle listings from slatteryauctions.com.au.

## Overview

This actor supports two modes:
- **stub**: Crawls discovery pages to find all asset URLs
- **detail**: Fetches individual asset pages and extracts full vehicle data

## Architecture

Follows the standard Carbitrage auction ingestion pattern:
1. Actor crawls Slattery pages using Playwright (JS rendering required)
2. POSTs extracted data to Supabase Edge Function webhooks
3. Webhooks upsert data into `stub_anchors` and `vehicle_listings`

## Authentication

**CRITICAL**: All webhook calls require the `VMA_INGEST_KEY` as a Bearer token:
```
Authorization: Bearer <VMA_INGEST_KEY>
```

Without this key, all requests return **401 Unauthorized**.

This is the same key used by VMA, Pickles, Manheim, and Grays harvesters.

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| mode | string | "stub" | "stub" or "detail" |
| maxPages | integer | 10 | Max pages to crawl in stub mode |
| detailUrls | array | [] | URLs to process in detail mode (auto-reads from queue if empty) |
| ingestKey | string | **REQUIRED** | VMA_INGEST_KEY for webhook auth |
| batchSize | integer | 50 | Items per POST batch |
| proxyCountry | string | "AU" | Country code for residential proxy |
| dryRun | boolean | false | Extract without POSTing |

## First-Time Activation (Day 1)

**The queue is NOT auto-populated by the actor.** You must run these in order:

```
1. Run stub mode once     → populates stub_anchors
2. Trigger slattery-stub-match manually → creates queue items from matching specs
3. Run detail mode once   → processes queue, creates vehicle_listings
```

After this, set up schedules:
- **Stub mode**: Hourly
- **slattery-stub-match**: Every 15 minutes (cron/manual)
- **Detail mode**: Every 10 minutes

## Sample Input JSON

**Stub mode (hourly):**
```json
{
  "mode": "stub",
  "maxPages": 10,
  "ingestKey": "<YOUR_VMA_INGEST_KEY>",
  "batchSize": 50,
  "proxyCountry": "AU",
  "dryRun": false
}
```

**Detail mode (every 10 mins):**
```json
{
  "mode": "detail",
  "ingestKey": "<YOUR_VMA_INGEST_KEY>",
  "batchSize": 50,
  "proxyCountry": "AU",
  "dryRun": false
}
```

## Stub Mode

Crawls Slattery discovery pages:
- https://slatteryauctions.com.au/auctions?categoryGroups=Motor+Vehicles
- https://slatteryauctions.com.au/categories/motor-vehicles

Extracts all `/assets/{consignmentNo}` links and POSTs to `slattery-stub-ingest-webhook`.

## Detail Mode

If `detailUrls` is empty, automatically fetches pending items from `pickles_detail_queue` where `source='slattery'`.

Extracts from each asset page:
- Vehicle title/variant
- Year, make, model
- Kilometers
- Price fields (starting bid, current bid, guide, sold price)
- Location and state
- Condition flags (WOVR, damage, keys, starts/drives)
- Auction datetime

POSTs to `slattery-detail-ingest-webhook`.

## Expected Results After First Run

With matching dealer_specs (e.g., Hilux/Kluger/RAV4):
- `stub_anchors(source='slattery')` > 0 after stub run
- `pickles_detail_queue(source='slattery')` > 0 after stub-match
- `vehicle_listings(source='slattery')` > 0 after detail run
- `dealer_spec_matches` > 0 after detail run

## Webhooks

| Endpoint | Purpose |
|----------|---------|
| slattery-stub-ingest-webhook | Receives stub discovery data |
| slattery-detail-ingest-webhook | Receives enriched vehicle data |

## Queue Integration

Detail mode reads from and updates the shared `pickles_detail_queue` table:
- Reads: `source='slattery' AND crawl_status='pending'`
- Marks items as `processing` before crawling
- Webhook marks items as `done` after successful upsert

## Proxy Configuration

Use residential proxies for Australia:
```javascript
proxyConfiguration: {
  useApifyProxy: true,
  groups: ['RESIDENTIAL'],
  countryCode: 'AU'
}
```

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

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| All 401 errors | Missing ingestKey | Set VMA_INGEST_KEY in input |
| Stubs increase, queue stays 0 | No matching dealer_specs | Add specs for common makes (Hilux, Ranger, Prado) |
| Queue pending, never done | Detail mode not running | Run detail mode after stub-match |

## Example Consignment IDs

- `1-4-1-018879`
- `1-4-1-018880`
- `1-4-1-018456`
