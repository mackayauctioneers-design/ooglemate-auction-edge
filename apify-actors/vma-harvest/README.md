# VMA Harvest Actor

Phase-1 harvester for Valley Motor Auctions (VMA). Bypasses 403 blocks by running in Playwright on Apify.

## What it does

1. Opens VMA search results in Playwright (headless Chrome)
2. Extracts all `MTA` IDs from inspection report links
3. Upserts to `pickles_detail_queue` via the `upsert_harvest_batch` RPC with `source='vma'`

## Setup in Apify

### Environment Variables (Secrets)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (e.g., `https://xznchxsbuwngfmwvsvhq.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key with RPC access |

### Input Example

```json
{
  "searchUrl": "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models&fromyear=2016",
  "maxPages": 1,
  "runId": null
}
```

## Expected Output

In Apify logs:
```
[VMA] Page 1: Found X raw links
[VMA] Found Y unique MTAs. Calling RPC...
[VMA] RPC OK: {"inserted":Z,"updated":W}
```

In Supabase `pickles_detail_queue`:
- Rows with `source='vma'`, `crawl_status='pending'`

## Next Steps

After first successful run, report:
1. Count of links found
2. Whether page has visible pager (Next button, page numbers)

Then we'll add pagination support.
