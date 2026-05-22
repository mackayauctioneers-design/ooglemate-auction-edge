# OpenClaw → Carbitrage Intelligence Layer

Make Carbitrage (Supabase + Lovable) the permanent memory & UI. OpenClaw stays as the automation/execution layer that writes structured data back on every meaningful event.

## 1. Database (migration)

Create 4 new tables in `public`, all with RLS:

**`dealer_sales_truth`** — confirmed/likely sold vehicles
- `dealer_id` (uuid → dealer_profiles), `stock_number`, `vin`, `make`, `model`, `variant`, `year`, `km`, `colour`, `listed_price`, `first_seen`, `last_seen`, `sold_date`, `days_online`, `sale_confidence` (0-1), `source`, `raw_snapshot` (jsonb)
- Unique: (dealer_id, stock_number) where stock_number not null; else (dealer_id, vin); else (dealer_id, make, model, variant, year, listed_price)
- Indexes on dealer_id, sold_date desc

**`dealer_replacement_fingerprints_v2`** — auto-built from sold behaviour (we already have `dealer_replacement_fingerprints`; add a derived/rolled-up table or add columns. **Decision**: extend existing table with new columns rather than create v2, to keep the working alert pipeline intact.)
- ADD: `avg_sell_price`, `avg_days_to_sell`, `sales_velocity`, `confidence_score`, `preferred_sources` (text[]), `freight_tolerance`, `auto_built` (bool), `last_rebuilt_at`

**`dealer_live_opportunities`** — ranked live replacement stock
- `dealer_id`, `source`, `listing_id`, `make`, `model`, `variant`, `year`, `km`, `price`, `estimated_margin`, `freight_cost`, `fingerprint_id`, `fingerprint_match_score`, `confidence`, `auction_date`, `listing_url`, `status` (new/seen/dismissed/won/lost), `why_json` (jsonb — reasons), `created_at`
- Unique: (dealer_id, source, listing_id)

**`dealer_daily_snapshots`** — morning intelligence rollups
- `dealer_id`, `snapshot_date`, `sold_count`, `fast_movers` (jsonb), `aged_stock_cleared` (jsonb), `replacement_targets` (jsonb), `opportunities_found`, `notes`
- Unique: (dealer_id, snapshot_date)

RLS: dealers read their own (via `dealer_profiles.account_id` → `accounts` membership); operators read all; service role writes.

## 2. Secure ingestion endpoint for OpenClaw

New edge function `openclaw-intelligence-write` (auth: Bearer `OPENCLAW_WRITE_TOKEN` — already exists). Single endpoint, op-based:

- `op: "record_sold"` → upsert into `dealer_sales_truth`, recompute `days_online`
- `op: "record_opportunity"` → upsert into `dealer_live_opportunities` (rejects rows without price, margin, fingerprint_match_score ≥ threshold)
- `op: "rebuild_fingerprints"` → triggers fingerprint rollup for a dealer from last N sales
- `op: "write_daily_snapshot"` → upsert into `dealer_daily_snapshots`

Hard validation gates (matches the "alert rules" section):
- Price > 0 required for opportunities
- `fingerprint_match_score ≥ 50` required
- `estimated_margin ≥ $1,000` required
- Else → 400 with reason; logged in `pulse_audit`

## 3. Fingerprint auto-build (DB function)

`rebuild_dealer_fingerprints(p_dealer_id uuid)` — aggregates `dealer_sales_truth` rows by (make, model, variant, year_range, km_band) and upserts into `dealer_replacement_fingerprints` with computed `avg_sell_price`, `avg_days_to_sell`, `sales_velocity`, `confidence_score` (based on sample size + recency). Sets `auto_built=true`. Called by OpenClaw post-ingest.

## 4. Daily snapshot RPC

`get_dealer_intelligence(p_dealer_id uuid)` returns JSON with: sold yesterday, sold this week, fast movers, aged cleared, replacement targets, opportunities, fingerprints summary. Used by UI.

## 5. UI — Dealer Intelligence page

New page `src/pages/operator/DealerIntelligencePage.tsx` at route `/operator/dealers/:dealerId/intelligence`. Tabs:
- Sold Yesterday
- Sold This Week
- Fast Movers
- Aged Stock Cleared
- Current Opportunities (ranked by margin × confidence)
- Fingerprints (auto-built + manual)
- Auction Targets (subset of opportunities where source ∈ pickles/manheim/grays/etc.)
- Live Alerts (recent `dealer_replacement_alerts`)

Add entry from `DealerManagementPage` ("Intelligence" button per dealer row).

## 6. Wire existing `dealer-replacement-match` to new layer

- Read fingerprints (already does, keep `status='confirmed'` filter)
- On match → also upsert into `dealer_live_opportunities` (not just alert_logs)
- Apply the same gates (price/margin/score) before alerting

## 7. Docs

Update `mem://architecture/carbitrage/` with new memory: `openclaw-execution-carbitrage-memory-split-v1` documenting the boundary.

## Out of scope (handled by OpenClaw side, not Lovable)

- Building the actual scrapers / monitors
- The OpenClaw task scheduler
- Outward-search workers themselves

Lovable delivers: the database, the secure write endpoint, the UI, and the matching pipeline gates. OpenClaw is told to call `openclaw-intelligence-write` on every sold/opportunity event.

## Technical notes

- All new tables: `created_at`, `updated_at` with trigger using existing `update_updated_at_column()`
- RLS uses existing `has_role()` + dealer/account membership helpers
- Edge function follows `openclaw-write` pattern (Bearer auth, audit logging, idempotency via `x-request-id`)
- No changes to working `dealer-replacement-match` alert format — only adds an extra write to `dealer_live_opportunities`

Approve and I'll execute in this order: migration → edge function → match-pipeline wiring → UI page → memory doc.