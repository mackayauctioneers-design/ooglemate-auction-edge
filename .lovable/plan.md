# Dynamic Mandate Generation from Sold-Stock Fingerprints

## Goal
Stop hand-creating one mandate per model. Instead, every dealer's `dealer_fingerprints` rows automatically become `active_mandates` whenever they meet a profitability/repeatability threshold. `run-mandates` (already scheduled) then continuously scans market supply against them.

No new tables. No Patrick-specific logic. No parallel matcher. Reuses the existing pipeline:

```
vehicle_sales_truth
  → recompute-fingerprint-performance (existing daily cron)
  → dealer_fingerprints (avg_profit, sales_count, fingerprint_priority)
  → generate-dealer-mandates  ← NEW (daily)
  → active_mandates
  → run-mandates  (existing, every 15 min)
  → mandate_feed_items / mandate_alerts
  → dealer dashboard (existing)
```

## Changes

### 1. New edge function: `generate-dealer-mandates`
For every dealer with rows in `dealer_fingerprints`:
- Select fingerprints where `is_active = true`, `sales_count >= 2`, `avg_profit >= 1500`.
- For each, upsert into `active_mandates` keyed on `(dealer_id, make, model, variant_family)`:
  - `make`, `model`, `variant_family` from the fingerprint
  - `year_min/max` from fingerprint `year_min/year_max` (widen ±1 year)
  - `km_min/km_max` from fingerprint `min_km/max_km` (widen +20k upper)
  - `min_expected_gp = max(1500, round(avg_profit * 0.5))`
  - `high_priority_gp = round(avg_profit * 0.8)`
  - `priority` ← map from `fingerprint_priority` (HIGH=1, MEDIUM=2, LOW=3)
  - `source_mask` / `source_priority` ← project defaults (pickles, manheim, grays, bidsonline, carsales, autotrader, dealer_sites)
  - `alert_channels = ['push','email']`
  - `created_from_fingerprint_id` ← fingerprint id
  - `is_active = true`, `run_frequency_minutes = 60`
- For mandates previously auto-generated whose source fingerprint no longer qualifies (sales_count dropped, marked is_active=false), set `is_active = false`. Never delete — preserves history.
- Returns `{ dealers_processed, mandates_created, mandates_updated, mandates_deactivated }`.

Time-budgeted (110 s cap), batched per dealer.

### 2. Schedule
Add `pg_cron` job `generate-dealer-mandates-daily` at `15 3 * * *` (15 min after the existing `recompute-fingerprint-performance-daily` at `0 3 * * *`).

### 3. Manual trigger
Wire a "Refresh mandates from sales history" button into the existing operator mandates page (no new page). Calls the same function.

### 4. Dashboard
No code change — dealer dashboard already reads `mandate_feed_items` filtered by `mandate_id → active_mandates.dealer_id`. New mandates flow through automatically.

## Out of scope
- Building new dashboards or alert channels.
- Adapter changes — `run-mandates` already handles all sources.
- Backfilling Patrick's sales data — that's a separate sold-stock upload task (blocker: 0 rows in `vehicle_sales_truth` for Patrick's account).

## Patrick blocker (will not be resolved by this change)
Patrick's account `d8ed6d5c-3284-4b76-a17e-f1f000afe827` has 0 rows in `vehicle_sales_truth` and 0 `dealer_fingerprints`. Until his sold-stock CSV/invoices are ingested via the existing `dealer-sales-upload` flow, generation will produce 0 mandates for him. The two hardcoded Isuzu mandates from the previous step remain as placeholders and will keep running every 15 min via the cron we already added.

Once his sales data lands, the next 03:15 run auto-generates mandates for every profitable model in his history (Amarok, Silverado, Santa Fe, CX-5, Vitara, etc.) without any per-dealer code.

## Files
- `supabase/functions/generate-dealer-mandates/index.ts` (new, ~250 lines)
- Insert call: `cron.schedule('generate-dealer-mandates-daily', ...)`
