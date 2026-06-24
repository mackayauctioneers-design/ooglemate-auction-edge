# Unified Ingestion Funnel — VPS Canonical, Supabase Mirror

> **Primary decision:** VPS is canonical. Supabase is a mirror. Agents must never depend on Supabase. Data flows one way: Apify → VPS raw → VPS normalised → VPS market_listings → VPS agents → optional mirror → Lovable UI. Never the reverse.
>
> **Scope of this document:** specification only. Lovable does not execute this plan. Hermes/VPS team implements. Lovable produces and maintains code/SQL artefacts, then validates via the Supabase mirror once it exists.

## 0. Standing rules (apply to every phase)

- No new features. No new dashboards. No new shortcuts. No second source of truth.
- All changes additive. **Forbidden drops**: `market_listings`, `opportunities`, `fingerprints`, `mandates`, `retail_listings`, `candidate_pool`, any existing source table.
- Agents read **only** from `market_listings` or `vw_wbm_clean`. Direct queries against `scanned_deals`, `external_listings`, `carsales_wbm.db`, `caroogle.db`, legacy source tables, or any Supabase sourcing table are prohibited.
- Lovable does not run destructive migrations. SQLite remains operational throughout. Postgres is introduced beside it.

## 1. VPS architecture map

```text
                         ┌─────────────────────────────────┐
                         │  Apify  memo23/carsales-cheerio │
                         └─────────────┬───────────────────┘
                                       │ pull (15-min loop)
                                       ▼
                       ┌──────────────────────────────┐
                       │  worker:memo23_ingest (VPS)  │
                       └─────────────┬────────────────┘
                                     │ INSERT
                                     ▼
                       ┌──────────────────────────────┐
                       │  pg.raw_ingest_events        │   append-only audit
                       └─────────────┬────────────────┘
                                     │ trigger → pg_notify
                                     ▼
                       ┌──────────────────────────────┐
                       │  fn.normalise_market_listing │
                       └─────────────┬────────────────┘
                                     │ UPSERT
                                     ▼
                       ┌──────────────────────────────┐
                       │  pg.market_listings          │  ◀── single canonical
                       └─────┬────────────────┬───────┘
                             │                │
                             │                ├─► pg.vw_wbm_clean
                             │                ├─► pg.ingestion_health
                             │                └─► pg.vw_memo23_pipeline_status
                             ▼
              ┌───────────────────────────────────────┐
              │  agents (read-only)                   │
              │  Hermes · fingerprints · mandates ·   │
              │  opportunities · WBM dispatcher · Bob │
              └─────────────────┬─────────────────────┘
                                │
                                ▼
                  worker:supabase_mirror (one-way)
                                │
                                ▼
                  Supabase mirror tables → Lovable UI
```

## 2. Source ownership map (target end-state)

| Source                  | Raw table            | Normaliser                       | Canonical             | Consumed by              | Owner | Status |
|-------------------------|----------------------|----------------------------------|-----------------------|--------------------------|-------|--------|
| memo23/carsales-cheerio | pg.raw_ingest_events | fn.normalise_market_listing      | pg.market_listings    | all agents + mirror      | VPS   | **Phase 1 reference** |
| Apify other actors      | pg.raw_ingest_events | fn.normalise_market_listing      | pg.market_listings    | all agents + mirror      | VPS   | deferred |
| Manheim                 | pg.raw_ingest_events | fn.normalise_market_listing      | pg.market_listings    | all agents + mirror      | VPS   | deferred |
| Pickles                 | pg.raw_ingest_events | fn.normalise_market_listing      | pg.market_listings    | all agents + mirror      | VPS   | deferred |
| EasyAuto123             | pg.raw_ingest_events | fn.normalise_market_listing      | pg.market_listings    | all agents + mirror      | VPS   | deferred |
| Dealer websites         | pg.raw_ingest_events | fn.normalise_market_listing      | pg.market_listings    | all agents + mirror      | VPS   | deferred |
| Supabase sourcing tables| n/a                  | n/a                              | n/a                   | **none** (agents banned) | Lovable | inert scaffold |

Deferred sources continue running on SQLite until Phase 1 passes its sign-off gate. None are migrated implicitly.

## 3. Memo23 migration plan (Phase 1 reference)

1. **Provision Postgres 16** on VPS (or adjacent box on private network). Roles: `app` (RW), `agent` (R on canonical views), `mirror` (R on `vw_*`). No public exposure.
2. **Apply DDL** from §§ 5–8 as one idempotent migration. Empty database; nothing to back up yet.
3. **Implement `worker:memo23_ingest`** (Python or Node — match Hermes runtime):
   - Loop every 15 min.
   - `GET /v2/acts/memo23~carsales-cheerio/runs/last?status=SUCCEEDED` with `APIFY_TOKEN` from VPS env. Skip if `finishedAt` > 6 h old. Start a new run when none in-flight (preserve current behaviour).
   - Idempotency: skip if `worker_runs` already has this `source_run_id`.
   - Paginate dataset in 500-item pages, 110 s shard budget.
   - Per item: map → `payload`; derive `source_record_id` from URL (`(SSE|OAG)-AD-\d+`); `INSERT … ON CONFLICT (source, source_record_id) DO UPDATE` into `raw_ingest_events`, reset `ingestion_status='pending'`.
   - Trigger on raw insert fires `pg_notify`; normaliser worker (or AFTER INSERT FOR EACH ROW trigger calling `normalise_market_listing`) upserts `market_listings`.
   - Audit each iteration into `worker_runs(source, source_run_id, dataset_id, items_fetched, raw_inserted, normalised, wbm_seen, started_at, finished_at, status, error)`. Heartbeat into `cron_heartbeat`.
4. **Backfill** the last 30 days of memo23 datasets through the new worker. No SQLite touched.
5. **Parity check**: confirm `vw_wbm_clean` count is within 5 % of the existing SQLite/Supabase WBM count for the same window.
6. **Agent cutover** (per § 9) flips agents to Postgres reads one at a time.
7. **Sign-off gate** before any other source migrates: `ingestion_health.source = 'memo23'` shows `live` for 7 consecutive days, zero `failed` raw events for 24 h, agent parity diff < 0.5 %.

## 4. Postgres rollout plan (zero big-bang)

| Step | Action | Reversibility |
|------|--------|---------------|
| 1 | Install Postgres 16, roles, private networking | stop service — no data movement |
| 2 | Apply DDL (raw_ingest_events, market_listings, views, function, worker_runs, cron_heartbeat) | `DROP SCHEMA carbitrage_pg CASCADE` — empty schema |
| 3 | Deploy memo23 worker writing to Postgres only | `systemctl stop`; SQLite memo23 path untouched |
| 4 | 30-day memo23 backfill | re-run; raw events upsert is idempotent |
| 5 | Per-agent read-path flag flips to Postgres | flag back to SQLite; both DBs still fresh |
| 6 | Stand up one-way Supabase mirror | pause cron; Lovable UI keeps last-mirrored snapshot |
| 7 | Sign-off + migrate next source (Pickles or Manheim) | repeat per-source |

Backups before every step boundary: `pg_dump -Fc` + SQLite file snapshot, both off-box, 14-day retention.

## 5. `raw_ingest_events` (Postgres, additive)

```sql
CREATE TABLE raw_ingest_events (
  id               bigserial PRIMARY KEY,
  source           text        NOT NULL,
  source_run_id    text,
  source_record_id text,
  listing_url      text,
  raw_payload      jsonb       NOT NULL,
  scraped_at       timestamptz,
  received_at      timestamptz NOT NULL DEFAULT now(),
  ingestion_status text        NOT NULL DEFAULT 'pending'
                   CHECK (ingestion_status IN ('pending','normalised','failed','skipped')),
  normalised_at    timestamptz,
  error_message    text,
  UNIQUE (source, source_record_id)
);
CREATE INDEX ON raw_ingest_events (source, received_at DESC);
CREATE INDEX ON raw_ingest_events (ingestion_status, received_at DESC);
```

Append-only. Re-runs upsert and reset `ingestion_status='pending'` for re-normalisation. 90-day retention sweep moves cold rows to `raw_ingest_events_archive` (same shape).

## 6. Canonical `market_listings` (Postgres)

`market_listings` on VPS is a **table** populated by the normaliser, not a union view.

```sql
CREATE TABLE market_listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text        NOT NULL,
  source_listing_id text        NOT NULL,
  listing_url       text        NOT NULL,
  make              text,
  model             text,
  badge             text,
  variant_raw       text,
  variant_family    text,
  year              int,
  km                int,
  price             int,
  market_price      int,
  price_difference  int,
  price_badge       text,
  market_indicator  text,
  state             text,
  location          text,
  seller_type       text,
  seller_name       text,
  image_url         text,
  status            text NOT NULL DEFAULT 'ACTIVE',
  lifecycle_status  text NOT NULL DEFAULT 'ACTIVE',
  fingerprint_hash  text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  raw_event_id      bigint REFERENCES raw_ingest_events(id),
  UNIQUE (source, source_listing_id)
);
CREATE INDEX ON market_listings (last_seen_at DESC);
CREATE INDEX ON market_listings (make, model, year);
CREATE INDEX ON market_listings (price_badge) WHERE price_badge IS NOT NULL;
CREATE INDEX ON market_listings (fingerprint_hash);
```

`fn.normalise_market_listing(_raw_event_id bigint) RETURNS jsonb` routes by `source`, performs upsert, stamps `raw_event_id`, sets `ingestion_status='normalised'` or `'failed'` with `SQLERRM`. Never throws to caller. Lifecycle sweep (hourly cron): `STALE` after 7 d unseen, `DEAD` after 14 d, `REVIVED` when seen again.

**WBM badge field path** in memo23 payload: `item.marketIndicator`. Values are case-insensitive (`"Well below market price"`, `"Below market price"`, `"Around market price"`, `"Above market price"`). Fallbacks: `priceAssessment` → `priceBadge` → `priceAssessmentText` → any `badges[]` element matching `/market price|special offer|great price/i`.

## 7. `vw_wbm_clean`

```sql
CREATE OR REPLACE VIEW vw_wbm_clean AS
SELECT
  source, source_listing_id, listing_url,
  make, model, badge, variant_raw,
  year, km, price, market_price, price_difference,
  state, location, seller_type, seller_name, image_url,
  price_badge, last_seen_at,
  jsonb_build_object(
    'market_price', market_price,
    'price_difference', price_difference,
    'last_seen_at', last_seen_at
  ) AS raw_payload
FROM market_listings
WHERE price_badge ~* '(well\s+below|^\s*below)\s+market'
  AND year >= 2015
  AND price > 0
  AND make IS NOT NULL
  AND model IS NOT NULL
  AND listing_url IS NOT NULL
  AND lifecycle_status = 'ACTIVE';
```

## 8. `ingestion_health` + `vw_memo23_pipeline_status`

```sql
CREATE OR REPLACE VIEW ingestion_health AS
WITH r AS (
  SELECT source,
         max(scraped_at)  AS latest_scraped_at,
         max(received_at) AS latest_received_at,
         count(*) FILTER (WHERE received_at > now() - interval '1 hour')   AS records_last_1h,
         count(*) FILTER (WHERE received_at > now() - interval '24 hours') AS records_last_24h,
         count(*) FILTER (WHERE ingestion_status='normalised'
                          AND normalised_at > now() - interval '24 hours') AS normalised_last_24h,
         count(*) FILTER (WHERE ingestion_status='failed'
                          AND received_at  > now() - interval '24 hours')  AS failed_last_24h
  FROM raw_ingest_events GROUP BY source
)
SELECT r.*,
       CASE
         WHEN latest_received_at > now() - interval '2 hours'  THEN 'live'
         WHEN latest_received_at > now() - interval '24 hours' THEN 'stale'
         ELSE 'dead'
       END AS status
FROM r;
```

`vw_memo23_pipeline_status` joins the latest `worker_runs` row for memo23 with raw/normalised/WBM counts and explicit diagnostic columns (`badge_present`, `mapping_failed`, `filter_excluded`) so the WBM-zero question always has a one-row answer.

## 9. Agent read-path plan

Today: mixed reads across SQLite, Supabase, per-source helpers. Cause of "no data" false reports.

Target: every agent reads exclusively `market_listings` or `vw_wbm_clean`.

1. Introduce `repos/market_listings.{py,ts}` exposing `find_wbm()`, `find_by_fingerprint()`, `find_active_for_mandate()`, etc.
2. Single connection factory keyed off `CANONICAL_DB={sqlite|postgres}` env.
3. Per-agent feature flag `AGENT_READS_POSTGRES`, default false.
4. Parity harness diffs SQLite vs Postgres result sets per agent for 24 h. Drift > 0.5 % blocks cutover.
5. Cutover order: WBM dispatcher → fingerprint matcher → mandates runner → opportunity scorer → Hermes orchestrator → Bob lookups.
6. Agents never read Supabase under any flag combination.

## 10. One-way Supabase mirror plan

- `worker:supabase_mirror` (VPS), every 5 min.
- Reads `market_listings` where `last_seen_at > mirror_state.last_cursor`.
- Upserts into a Supabase mirror table (`market_listings_mirror`) using the service-role key stored in VPS env only.
- Mirror is lossy on purpose: UI-facing fields only. No fingerprints, no raw payloads, no agent state.
- Failures never block ingestion. Mirror is a sink, never a gate.
- The Supabase `raw_ingest_events`, `normalise_market_listing`, `ingestion_health` that Lovable created earlier remain as **inert scaffolding** for future Lovable-side dashboards. The mirror does not write to them.

## 11. Rollback plan

| Phase | Rollback action | Data safety |
|-------|----------------|-------------|
| Postgres install | `systemctl stop postgresql` | SQLite untouched |
| Schema bootstrap | `DROP SCHEMA carbitrage_pg CASCADE` | empty schema |
| memo23 worker live | `systemctl stop memo23_worker` | SQLite memo23 path resumes; no divergence |
| Agent flag flipped | `AGENT_READS_POSTGRES=false`, restart agent | SQLite still fresh — dual-write never stopped |
| Mirror push | pause mirror cron | Lovable UI shows last snapshot |
| Full cutover | flip every agent flag back; re-enable SQLite writers | restore from latest `pg_dump` + replay last 24 h Apify datasets via worker |

Per-phase backups: `pg_dump -Fc` + SQLite snapshot, off-box, 14-day retention.

## 12. Validation report (Phase 1 sign-off)

After Hermes implements Phase 1, the report must include:

- latest Apify run ID
- dataset ID
- raw records count (last run)
- normalised records count (last run)
- `market_listings` count (memo23 source)
- `vw_wbm_clean` count
- `ingestion_health.status` for memo23
- WBM badge field path used (expected: `marketIndicator`)
- failed record count (last 24 h)
- oldest unprocessed record (`min(received_at)` where `ingestion_status='pending'`)
- agent visibility confirmation: a known memo23 `source_listing_id` returns true from `repos.market_listings.find_by_id()` under `AGENT_READS_POSTGRES=true` for fingerprints, mandates, opportunities, WBM dispatcher and Bob

Only when every field passes does Phase 2 (next source) begin.

## 13. What Lovable does in the meantime

- Maintains this plan.
- Holds the inert Supabase scaffolding (`raw_ingest_events`, `normalise_market_listing`, `ingestion_health`) in place — no changes, no removal.
- When the VPS mirror lands, points the existing Lovable UI surfaces at the mirror table read-only.
- Does **not** add new dashboards, alerts, or shortcuts.
