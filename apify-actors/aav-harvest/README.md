# AAV Harvest Actor

Phase-1 harvester for Auto Auctions (AAV). Bypasses WAF/403 blocks by running in Playwright on Apify with residential proxies.

## What it does

1. Opens AAV search results in Playwright (headless Chrome) via residential proxy
2. Extracts vehicle listings with MTA IDs, year, make, model, km etc.
3. Posts items to the `auto-auctions-ingest` edge function

## Setup in Apify

1. Create a new Actor from this source
2. Set memory to 1024MB minimum
3. Use Residential proxy group

### Input Example

```json
{
  "searchUrl": "https://www.auto-auctions.com.au/search_results.aspx?sitekey=AAV&make=All%20Makes&model=All%20Models&fromyear=2016&toklm=100,000",
  "maxPages": 5,
  "INGEST_URL": "https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/auto-auctions-ingest",
  "INGEST_KEY": "your-aav-ingest-key"
}
```

## Platform

Same BidsOnline platform as VMA and F3 — uses `MTA=` IDs and `result-item` card HTML blocks.