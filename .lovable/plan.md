## Always-On Dealer Mandate Engine

Most tables you listed already exist. The gap is **dealer ownership, automatic matching after every ingestion run, scoring against proven sales fingerprints, alerts, and a dealer-facing radar UI**. I'll extend, not duplicate.

### What already exists (reuse as-is)
- `active_mandates`, `mandate_feed_items`, `mandate_runs`, `mandate_alerts`
- `dealer_fingerprints`, `dealer_sales_fingerprints`, `dealer_liquidity_profiles`
- `demand_opportunities`, `dealer_demands`, `dealer_live_opportunities`
- `ingestion_runs`, `ingestion_source_health`
- `dealer_profiles` (Patrick Auto Group: `79ee6123-0065-4201-8150-2ccb247e5a85`)

### What's missing → what I'll build

**1. Schema additions (single migration)**

Extend `active_mandates` with the dealer-ownership + rule columns you listed:
- `dealer_id uuid` (FK → dealer_profiles), `account_id uuid`
- `target_variants text[]`, `km_min int`, `buy_price_min int`
- `preferred_body_types text[]`, `preferred_fuel text[]`, `preferred_transmission text[]`
- `min_expected_gp int default 1500`, `high_priority_gp int default 3000`
- `confidence_threshold text default 'medium'` (low|medium|high)
- `excluded_makes text[]`, `excluded_models text[]`, `excluded_conditions text[]`
- `source_priority text[]`, `alert_channels text[] default '{push,email}'`
- `created_from_fingerprint_id uuid`

Add `dealer_mandate_rules` (optional per-mandate rule overrides: condition exclusions, freight caps, manual approval flags).

Extend `mandate_feed_items` with scoring columns if absent:
- `dealer_fit_score numeric`, `confidence text`, `max_buy_price int`
- `freight_estimate int`, `recommendation text` (BUY|WATCH|AVOID), `match_reason text`

Add `alert_events` (unified channel-agnostic event log: dealer_id, mandate_id, feed_item_id, severity, payload, dispatched_at, channels[]).
Add `alert_subscriptions` (dealer_id, channel, address, quiet_hours, severity_min).

RLS: dealers see only rows where `dealer_id = their dealer_profile.id`; operators see all.

**2. Post-ingestion matcher edge function: `match-mandates-on-ingest`**

Trigger sources:
- Fires automatically at the tail of every ingestion run (Pickles, Manheim, Grays, BidsOnline, Carsales, Autotrader, dealer-site, wholesale, AutoGrab) via an `after_ingest` hook — each ingestion edge function POSTs `{run_id, source, listing_ids[]}` to it.
- Also runnable manually + on a 10-min safety cron.

Per listing, per active mandate:
1. Normalise via existing `normalizeVehicleIdentity` + `extractSeries`.
2. Structural gate: make/model/variant/year/km/body/fuel/transmission/exclusions.
3. Score: `dealer_fit_score` = make/model match (40) + variant (15) + year band (15) + km band (15) + body/fuel/trans (15).
4. Anchor to dealer fingerprint: pull `dealer_sales_fingerprints` for that dealer+model → use proven historical buy price + avg GP. If no fingerprint → fall back to market median from `market_listings`.
5. `expected_gp = anchor_retail - asking_price - recon_buffer - freight_estimate`.
6. `max_buy_price = anchor_retail - desired_gp - recon - freight`.
7. `confidence` = function of (fingerprint sample size, identity confidence, source trust).
8. `recommendation`:
   - BUY if `expected_gp >= high_priority_gp` AND `confidence >= medium` AND price ≤ max_buy.
   - WATCH if `expected_gp >= min_expected_gp` OR auction closing >48h.
   - AVOID if excluded condition / negative GP / confidence low.
9. Upsert into `mandate_feed_items` (existing dedup on mandate_id+source+listing_id).
10. If BUY or (WATCH + auction <48h) → insert `alert_events`; dispatcher fans out to push/email/Slack/WhatsApp via existing `notifier-default-logic`.

Time-budgeted (110s), capped per run (3k listings, 300 alerts), cursor-tracked in `scorer_cursors`.

**3. Patrick Isuzu Acquisition Radar mandate (data)**

Update the two mandates created earlier with the new columns: dealer_id, km_min=60000, min_expected_gp=1500, high_priority_gp=3000, confidence_threshold='medium', source_priority=[pickles,manheim,grays,bidsonline,carsales,autotrader,dealer_sites], alert_channels=[push,email,whatsapp], preferred_body_types=[ute,wagon,cab_chassis], preferred_fuel=[diesel], excluded_conditions=[damaged,statutory_writeoff].

**4. Dealer Radar UI: `/dealer/radar`**

New page (`src/pages/dealer/DealerRadarPage.tsx`) gated by dealer auth:
- Header: active mandate chips with last-scan timestamp + "Pause/Resume".
- Three columns / tabs:
  - **High Confidence (BUY)** — top 20 by `expected_gp DESC`.
  - **Auction Closing <48h** — sorted by closing_at.
  - **Watch / New Today** — first_seen_at within 24h.
- Each row: year/make/model/variant, km, location + freight badge, asking price, max buy price, expected GP, confidence pill, source badge, "View listing" link, recommendation pill.
- Filters: source, model, recommendation.
- "Why matched" tooltip: anchor fingerprint id + sample size + comparison.

**5. Daily radar digest: `daily-dealer-radar-digest`**

Cron 07:00 AEST per active dealer:
- Best 5 opportunities (expected_gp DESC, last 24h).
- New listings since yesterday count + top 10.
- Urgent auction lots (closing 24-72h, BUY only).
- Avoided list (exclusion-triggered) with reason.
- Supply gaps: active mandates with zero matches in 7d → flagged for sourcing.
- Sent via email (Resend) + Slack to dealer-configured channels.

**6. Manual search preserved**

Existing `/mandate-feed` page stays. Patrick's radar at `/dealer/radar` is the always-on view; manual hunts route into the same `mandate_feed_items` table.

### Out of scope (explicitly deferred)
- Wiring brand-new ingestion adapters (BidsOnline, Valley Auctions, Drive) — mandate engine is source-agnostic; those adapters land in a separate task.
- Per-mandate AI commentary (can be enriched later via Bob).

### Order of execution
1. Migration (schema additions + RLS + indexes).
2. `match-mandates-on-ingest` edge function + cron.
3. Hook into existing ingestion functions (single shared helper call).
4. Patrick mandate update (data backfill via insert tool).
5. `/dealer/radar` page + route.
6. `daily-dealer-radar-digest` edge function + cron.
7. Smoke test end-to-end: trigger a Pickles ingest → confirm feed_items + alert_events appear for Patrick.

Approve and I'll start with the migration.