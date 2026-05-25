## Goal

Make `accounts.id` the only dealer identity used by scrape workers. Every scrape result, snapshot, sold/disappeared event, and worker run must carry the canonical `account_id`. No scraper may invent dealers, and any unmapped scrape source must fail loudly into an alert queue — never into logs.

## What already exists (reuse — do not duplicate)

Audit of `public.*` confirms the canonical schema is already in place. The fix is **linkage**, not new tables.

| Spec name                     | Canonical table (reuse)        | Status                                                            |
|-------------------------------|--------------------------------|-------------------------------------------------------------------|
| `dealers`                     | `accounts` + `dealer_profiles` | ✓ identity source of truth (`accounts.id`)                        |
| Scrape target registry        | `dealer_outbound_sources`      | ✗ missing `account_id` link to `accounts`                         |
| `scrape_runs`                 | `dealer_crawl_runs`            | ✗ keys on `trap_slug`/`dealer_name` only, no `account_id`         |
| `dealer_inventory_snapshots`  | `sold_vehicles`                | ✓ has `dealer_id`, `stock_number`, `first/last_seen`, `sold_date` |
| `dealer_sold_events`          | `sold_vehicles` + `vehicle_sales_truth` | ✓ confirmed sales already flow into `vehicle_sales_truth` |
| `dealer_fingerprints`         | `dealer_fingerprints`          | ✓                                                                 |
| `active_mandates`             | `active_mandates`              | ✓                                                                 |
| `mandate_feed_items`          | `mandate_feed_items`           | ✓                                                                 |
| Worker dispatch audit         | `worker_runs` (built last turn)| ✓                                                                 |

Existing edge functions that touch scrape: `dealer-outbound-crawl`, `dealer-site-crawl`, `dealer-site-ingest`, `process-dealer-crawl-jobs`, `enqueue-dealer-crawl`, `easyauto-direct-scrape`, `arby-dealer-profile-intake`, `openclaw-write` / `openclaw-intelligence-write`. All of these currently key on `dealer_slug` / `dealer_name` strings, not `account_id`.

## Migration (one pass)

```sql
-- 1. Link scrape targets to canonical dealer identity
ALTER TABLE dealer_outbound_sources
  ADD COLUMN account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN scrape_enabled boolean NOT NULL DEFAULT enabled,
  ADD COLUMN scrape_frequency text NOT NULL DEFAULT 'daily',
  ADD COLUMN last_successful_scrape_at timestamptz,
  ADD COLUMN scrape_health_status text NOT NULL DEFAULT 'unknown';
CREATE INDEX idx_dos_account_enabled
  ON dealer_outbound_sources (account_id) WHERE scrape_enabled;

-- 2. Backfill: match dealer_slug to accounts.slug (idempotent, no insert)
UPDATE dealer_outbound_sources d
   SET account_id = a.id
  FROM accounts a
 WHERE d.account_id IS NULL AND lower(d.dealer_slug) = lower(a.slug);

-- 3. Per-run dealer scoping
ALTER TABLE dealer_crawl_runs
  ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN worker_name text,
  ADD COLUMN new_listings int,
  ADD COLUMN disappeared_listings int;
CREATE INDEX idx_dcr_account_started
  ON dealer_crawl_runs (account_id, run_started_at DESC);

-- 4. Loud failure queue — never write a scrape result without a dealer_id
CREATE TABLE dealer_unmapped_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug text NOT NULL,
  source_name text,
  source_domain text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  occurrences int NOT NULL DEFAULT 1,
  sample_payload jsonb,
  status text NOT NULL DEFAULT 'open', -- open | mapped | ignored
  resolved_account_id uuid REFERENCES accounts(id),
  UNIQUE (source_slug)
);
ALTER TABLE dealer_unmapped_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read unmapped" ON dealer_unmapped_sources
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));

-- 5. Dealer profile metrics (cheap view, no recompute table)
CREATE OR REPLACE VIEW dealer_scrape_health AS
SELECT a.id AS account_id,
       a.display_name,
       dos.dealer_domain,
       dos.scrape_enabled,
       dos.last_crawl_at  AS last_scraped_at,
       dos.last_successful_scrape_at,
       dos.scrape_health_status,
       dos.consecutive_failures,
       (SELECT count(*) FROM sold_vehicles sv
          WHERE sv.dealer_id = a.id AND sv.sold_date IS NULL) AS current_inventory_count,
       (SELECT count(*) FROM sold_vehicles sv
          WHERE sv.dealer_id = a.id AND sv.sold_date IS NOT NULL
            AND sv.sold_date >= now() - interval '30 days') AS observed_sold_30d,
       (SELECT count(*) FROM active_mandates m
          WHERE m.account_id = a.id) AS active_mandates_count
FROM accounts a
LEFT JOIN dealer_outbound_sources dos ON dos.account_id = a.id;
```

No data is deleted. Existing rows with no `accounts.slug` match stay `account_id = NULL` and are surfaced to operators (see Hub section).

## Worker contract (binding)

Codified inside `worker-api/app/main.py` and the existing crawl edge functions. The VPS Worker API owns the loop; Lovable proxies remain thin.

```text
1. GET active targets:
     SELECT id, account_id, dealer_domain, inventory_path, adapter_type
       FROM dealer_outbound_sources
      WHERE scrape_enabled = TRUE AND account_id IS NOT NULL;
2. For each target (must have account_id; if NULL → upsert dealer_unmapped_sources, skip):
   a. INSERT dealer_crawl_runs (account_id, worker_name, run_started_at, status='running')
   b. Scrape site; normalize fields
   c. UPSERT each active listing into sold_vehicles
        (dealer_id=account_id, stock_number, vin, make/model/variant/year/km/listed_price,
         first_seen=COALESCE(existing.first_seen, now()), last_seen=now(),
         sold_date=NULL, raw_snapshot=...)
   d. Diff vs previous active set (sold_date IS NULL AND last_seen < run_started_at):
        - missing → UPDATE sold_date=today, sale_confidence=0.7
                    (event_type implied by sold_date IS NOT NULL)
        - missing then reappears next run → reset sold_date=NULL,
                                            sale_confidence=0,
                                            flag raw_snapshot.returned=true
   e. UPDATE dealer_crawl_runs SET status='ok|failed', listings_found,
                                   new_listings, disappeared_listings,
                                   run_completed_at, error.
   f. UPDATE dealer_outbound_sources SET last_crawl_at=now(),
        last_successful_scrape_at = CASE WHEN ok THEN now() ELSE prior END,
        scrape_health_status, consecutive_failures.
3. After the run, if disappeared_listings >= threshold for an account_id:
     a. INSERT inferred rows into vehicle_sales_truth (source='dealer_site_scrape',
        confidence=0.7, account_id=dealer_id, vehicle fields).
     b. Enqueue recompute-fingerprint-performance(account_id).
     c. Enqueue generate-dealer-mandates(account_id) if fingerprints changed.
     d. Enqueue run-mandates(account_id) → refreshes mandate_feed_items.
```

Rules enforced in code:
- Every write to `sold_vehicles`, `dealer_crawl_runs`, `vehicle_sales_truth` MUST include `account_id`. The Worker API rejects payloads missing it.
- No dealer is ever inserted into `accounts` by a worker. Unmapped slugs go to `dealer_unmapped_sources`.
- No string-name fallbacks. `KTGM`, `Patrick Auto`, `Illawarra Toyota` are resolved only via `accounts.slug` → `account_id`.
- The recompute/mandate/match steps are existing canonical edge functions — no parallel scoring.

## Lovable Hub additions (UI only)

New components, scoped behind `OperatorGuard` where they expose cross-dealer data:

1. **Dealer Profile → Scrape & Identity panel** (`src/components/dealer/DealerScrapePanel.tsx`)
   - Reads `dealer_scrape_health` view filtered by selected `account_id`.
   - Shows: website, scrape enabled toggle, last scrape, scrape health, current inventory count, sold/disappeared count (30d), recent sold events (latest 10 from `sold_vehicles`), fingerprint count, active mandates count, latest radar opportunities (top 5 from `mandate_feed_items`).
   - Action buttons (already wired via `useDealerWorker`):
     - Run scrape now → `enqueue-dealer-crawl` scoped to `account_id`
     - Refresh fingerprints → `activate-dealer`
     - Regenerate mandates → `activate-dealer`
     - Run dealer scoring → `run-dealer-scoring`
     - Pause / resume scraping → updates `dealer_outbound_sources.scrape_enabled`

2. **Operator → Unmapped Scrape Sources** (`src/pages/operator/UnmappedScrapeSourcesPage.tsx`)
   - Lists `dealer_unmapped_sources WHERE status='open'`.
   - One-click "Map to dealer" → opens `accounts` picker, writes `account_id` into `dealer_outbound_sources` (creating a row if absent) and marks the unmapped record `mapped`.
   - "Ignore" marks `status='ignored'` so it stops re-surfacing.

3. **Dealer Radar / Trading Desk** — no changes. They already filter `mandate_feed_items` / `matched_opportunities_v1` by selected `dealer_id`. Once the worker writes through `account_id`, their feeds populate automatically.

## Worker API changes (`worker-api/app/main.py`)

Add three handlers that the existing 4 endpoints can call internally; no public contract change:

- `_load_active_targets(sb)` → enforces `account_id IS NOT NULL`, raises per-source errors into `dealer_unmapped_sources`.
- `_run_dealer_scrape(sb, target)` → executes the workflow above. The actual HTML fetch + parse lives in `app/pipelines/dealer_site.py` (port of the existing Python script). Storage uses canonical tables only.
- `_promote_to_sales_truth(sb, account_id)` → moves high-confidence disappearance rows into `vehicle_sales_truth`, then calls `recompute-fingerprint-performance` → `generate-dealer-mandates` → `run-mandates` via the existing service-role edge function invocations.

Existing `/activate-dealer` and `/run-dealer-scoring` endpoints stay unchanged in contract.

## Audit response for KTGM / Patrick Auto / Illawarra Toyota

After the migration runs, the AI will emit a short audit report per dealer using:

```sql
SELECT a.display_name,
       dos.dealer_slug, dos.account_id IS NOT NULL AS mapped,
       dos.last_crawl_at,
       (SELECT count(*) FROM sold_vehicles WHERE dealer_id = a.id) AS inventory_rows,
       (SELECT count(*) FROM vehicle_sales_truth WHERE account_id = a.id) AS truth_rows,
       (SELECT count(*) FROM dealer_fingerprints WHERE dealer_profile_id = a.id) AS fps,
       (SELECT count(*) FROM active_mandates WHERE account_id = a.id) AS mandates,
       (SELECT count(*) FROM mandate_feed_items WHERE dealer_id = a.id) AS feed
  FROM accounts a
  LEFT JOIN dealer_outbound_sources dos ON dos.account_id = a.id
 WHERE a.slug IN ('ktgm','patrick-auto-group','illawarra-toyota');
```

The report names: current scraper, current storage, whether `account_id` is populated, whether disappeared events exist, whether fingerprints reflect them, and what patch (if any) is needed beyond the migration.

## Success criteria

- `dealer_outbound_sources.account_id IS NULL` count = 0 for any actively-scraped slug.
- New `sold_vehicles` rows always carry a valid `dealer_id = accounts.id`.
- `dealer_crawl_runs` always carries `account_id`.
- Disappeared-vehicle inference produces `vehicle_sales_truth` rows that show in Dealer Radar within one mandate cycle.
- Unmapped scrape sources surface in the operator queue, never silently dropped.

## Rollback

- Migration is additive only (new nullable columns, one new table, one view). To revert: drop `dealer_unmapped_sources`, drop the new columns on `dealer_outbound_sources` and `dealer_crawl_runs`, drop `dealer_scrape_health` view. No existing reads break because nothing currently consumes these columns.
- Worker API change is gated by reading `account_id IS NOT NULL`; if disabled, behaviour reverts to current (slug-based) writes for legacy callers — but those writes will no longer reach the new dealer profile panel until re-enabled.

## Non-negotiables (carried from platform contract)

- No new dealer table parallel to `accounts`.
- No dealer hardcoding. KTGM / Patrick / Illawarra are configuration, not code.
- Browser never receives `WORKER_TOKEN`. Lovable never receives `SUPABASE_SERVICE_ROLE_KEY`.
- All scoring uses the canonical `recompute-fingerprint-performance` → `generate-dealer-mandates` → `run-mandates` chain.