
# Lovable → Consumer-of-VPS Migration Plan

## 1. New Contract (non-negotiable)

- **VPS `carbitrage_pipeline.db`** is the only source of truth for: listings, identity, valuation, opportunities, fingerprints, agent execution, dealer notifications.
- **Lovable Cloud (Supabase)** is now a *read replica + UI state store*. It owns: auth, dealer settings, billing, CRM notes, approvals, UI preferences, historical analytics snapshots.
- **Data direction:** VPS → Mirror → Lovable UI. The only reverse direction allowed is *user actions* (settings, approvals, configuration writes) which the VPS pulls or which proxy through a thin write API.
- **No new ingestion, scoring, valuation, fingerprint, or opportunity logic is built in Lovable.** Existing logic is frozen, then mirrored away, then removed.

## 2. Component Classification

| # | Component | Current Purpose | KEEP | MIRROR | REMOVE | Reason |
|---|---|---|---|---|---|---|
| **Ingestion edge functions** |
| 1 | `receive-listings` | Open POST endpoint for memo23/Apify | | | ✅ | VPS will receive direct |
| 2 | `receive-deals` | Bearer-auth deal ingest → `scanned_deals` | | | ✅ | Dead-end table, replaced by VPS |
| 3 | `apify-carsales-ingest` | Pulls Apify datasets → `raw_ingest_events` → `retail_listings` | | | ✅ | Move to VPS worker (per `.lovable/plan.md` §6) |
| 4 | `pickles-crawl`, `f3-crawl`, `autotrader-*`, `gumtree-*`, `toyota-*`, `easyauto123-*`, `caroogle-*` ingest functions | Source pulls | | | ✅ | VPS workers only |
| 5 | `run-daily-pipeline` | Orchestrates ingestion + presence + velocity + Slack | | | ✅ | VPS cron owns this |
| 6 | `normalise_market_listing` Postgres fn + `raw_ingest_events` table | Supabase normaliser scaffold | | | ✅ | Inert; delete after cutover |
| 7 | `well-below-market-alert`, `trap-health-alerts`, `buy-window-slack` | Alert dispatch | | | ✅ | Replaced by VPS notifier |
| **Opportunity / scoring / valuation** |
| 8 | `score-operator-opportunities` + `operator_opportunities` table | Cross-account scoring | | ✅ | | Display only; VPS produces, Lovable shows |
| 9 | `run-mandates`, `mandate_runs`, `mandate_alerts` | Mandate matching engine | | | ✅ | VPS owns matching |
| 10 | `fingerprint-materialize`, `fingerprint_*` tables | Fingerprint generation | | ✅ | | Generated on VPS, mirrored for UI editing |
| 11 | `valo-*` functions, `valo_runs`, `valo_requests` | Valuation engine | | | ✅ | VPS valuation only |
| 12 | `refresh-watch-statuses`, `winners_watchlist` logic | Watch status compute | | ✅ | | VPS computes, Lovable reads |
| 13 | `vw_wbm_clean`, `market_listings` view, `retail_listings` table | Canonical listing surface | | ✅ | | Replaced by mirror table populated from VPS |
| **Agent / sourcing logic** |
| 14 | `run-dealer-scoring`, `sync-opportunities`, `hermes-bridge` proxies | VPS proxies (already correct shape) | ✅ | | | Already pass-through to VPS Worker |
| 15 | `hermes_locks`, `hermes_evaluations`, `hermes_raw_listings`, `hermes_agent_heartbeats` | Agent state | | ✅ | | VPS writes via `hermes-bridge`, UI reads |
| 16 | `caroogleAI` / OogleBot / Arby orchestrators in edge functions | Discovery agents | | | ✅ | VPS workers |
| 17 | `hermey-webhook` (Telegram Hermes) | Operator chat | ✅ | | | UI/operator surface; queries VPS via bridge |
| 18 | `bob-chat` + `bob_*` tables | Embedded buying assistant | ✅ | | | UI surface; its tools call VPS read API instead of Supabase tables |
| **Dealer-facing UI / admin** |
| 19 | Dealer dashboard, Trading Desk, Opportunities, Today, Alerts, Hunts, Mandates pages | UI | ✅ | | | Repointed to mirror tables |
| 20 | `OperatorLayout`, `IngestionHealthPage`, `CronAuditPage`, `PipelineHealthPage` | Operator monitoring | ✅ | | | Reads VPS health endpoint |
| 21 | `DataSourcesPage` tabs (Upload, Manual Intake, Traps, Preflight, Dealer URLs, VA) | Operator data entry | ✅ | | | These are *writes from humans* — allowed; forward to VPS write API |
| 22 | Sales upload (`sales-upload/*`, `dealer_sales`, `vehicle_sales_truth`) | Dealer sales ingestion via UI | ✅ | ✅ | | KEEP the upload UI; MIRROR the truth table (VPS becomes authoritative store after upload is forwarded) |
| 23 | Auth, `profiles`, `user_roles`, `dealer_profiles`, `dealer_entitlements`, billing/Stripe | Identity, access, billing | ✅ | | | Lovable-native domain |
| 24 | `dealer_settings`, `dealer_notification_settings`, `dealer_specs`, `bob_watch_profiles` | Dealer configuration | ✅ | | | Settings live in Lovable; VPS subscribes |
| 25 | CRM-ish tables: `deal_flags`, `deal_truth_*`, `human_reviews`, `va_tasks` | Human workflow | ✅ | | | UI/CRM concern |
| 26 | Reporting pages: Sales Insights, Regional Dashboard, Westside, AJH report | Analytics | ✅ | ✅ | | UI keeps, data sourced from mirror snapshots |
| **Dead / duplicate tables** |
| 27 | `scanned_deals`, `external_listings`, `vehicle_listings_shadow`, `retail_listings`, `vw_wbm_clean`, `raw_ingest_events`, `market_listing_history`, `retail_listing_*`, `apify_runs_queue`, `firecrawl_*`, `outward_*`, `manus_*`, `hunt_external_candidates`, `hunt_unified_candidates` | Parallel ingestion/staging | | | ✅ | Collapsed into VPS pipeline |
| 28 | Pipeline plumbing: `pipeline_runs`, `pipeline_steps`, `cron_audit_log`, `cron_heartbeat`, `source_runs`, `ingestion_runs` | Lovable-side orchestration audit | | | ✅ | VPS owns orchestration |

## 3. Mirror Architecture

VPS publishes clean snapshots to a small set of **read-only mirror tables** in Supabase. These are the *only* tables UI components read for operational data.

```text
mv_market_listings      ← canonical active listings
mv_opportunities        ← scored + tiered, per dealer
mv_fingerprints         ← per dealer
mv_valuations           ← per vehicle / per dealer
mv_agent_evaluations    ← agent decisions + reasons
mv_ingestion_health     ← source freshness + counts
mv_dealer_snapshots     ← daily KPIs for reporting
```

Rules:
- Mirror tables are **owned by VPS**: `service_role` writes only, RLS read for `authenticated` scoped by dealer.
- Naming prefix `mv_` (mirror view) so nothing in code accidentally writes to them.
- Refresh cadence: streaming where possible (VPS → Supabase REST with `service_role`), batch (5 min) for analytics.
- Old tables remain readable for 14 days behind a feature flag `useMirror=true`, then dropped.

Writes from Lovable → VPS allowed only via a **thin write API** (`vps-write` edge function) for: dealer settings, approvals, sales uploads, manual intake, trap edits, URL submissions, user actions. Every write is forwarded synchronously to VPS; mirror table only updates after VPS confirms and re-publishes.

## 4. Migration Phases

**Phase 0 — Freeze (day 0)**
- Disable cron triggers on every ingestion/score/valuation/mandate edge function listed in §2 (rows 1–13, 16).
- Banner in operator UI: "Ingestion is now VPS-owned. Lovable pipelines are frozen."
- Tag current Supabase schema as `pre_mirror_baseline`.

**Phase 1 — Mirror tables + feature flag (week 1)**
- Create `mv_*` tables + RLS + GRANTs.
- Add `useMirror` flag in `useFeatureFlags`. All operational reads gated.
- VPS team starts publishing into `mv_market_listings` + `mv_opportunities` first.

**Phase 2 — Repoint reads (week 2)**
Switch these UIs to mirror:
- Trading Desk, Opportunities, Today, Alerts, Hunts, Mandate Feed, Dealer Radar, Bob tool `search_vehicles`, Ingestion Health page.
- Verify dealer parity on `mackay-traders`, `patrick-auto`, `ajh-wholesale` before flipping flag default to `true`.

**Phase 3 — Write API (week 3)**
- Stand up `vps-write` edge function with the action set above.
- Migrate Sales Upload, Manual Intake, Trap edits, Dealer URL submissions, Approvals to forward through it.
- `bob-chat` tool calls (`create_watch`, etc.) routed through it.

**Phase 4 — Remove duplicates (week 4)**
- Delete REMOVE-classified edge functions (§2).
- Drop REMOVE-classified tables after 14-day read-only grace.
- Delete `.lovable/plan.md` Supabase-side normaliser scaffolding; replace with mirror spec.

**Phase 5 — Lock-in (week 5)**
- CI check: PR touching any REMOVE-classified path is blocked.
- Lint rule: no edge function may write to `mv_*` tables.
- Memory rule added: "Lovable is a consumer of the VPS. No ingestion, scoring, valuation, fingerprint, opportunity, or agent logic may be added to Lovable."

## 5. Non-Breaking Guarantees

- Dealer-facing routes (`/dealer/*`, `/today`, `/alerts`, `/opportunities`, `/trading-desk`) keep working through every phase because the feature flag flips per-page.
- Auth, billing, settings, sales upload, Bob, Hermey are untouched in behaviour from the dealer's perspective.
- Operator monitoring keeps working — `IngestionHealthPage` simply reads `mv_ingestion_health` instead of `ingestion_health` view.
- No destructive drops until parity has been demonstrated on the three reference dealers for 7 days.

## 6. Contract (locked by operator, 2026-06-26)

**Status: Phase 1 ON HOLD. No mirror tables built yet.**

1. **Direction:** PUSH only. VPS → Supabase. Lovable never pulls from VPS. Agents never depend on Supabase.
2. **Refresh SLA (UI-only, non-operational):**
   - `mv_active_vehicles`, `mv_opportunities` — 5 min
   - `mv_source_health`, `mv_dealer_metrics`, `mv_agent_status` — hourly
   - No streaming.
3. **Mirror table set (final):** `mv_active_vehicles`, `mv_opportunities`, `mv_source_health`, `mv_dealer_metrics`, `mv_agent_status`. VPS owns the schemas; Lovable mirrors exactly what VPS exposes.
4. **Auth:** Bearer token, stored as Supabase edge secret (`VPS_MIRROR_WRITE_KEY`). HMAC later if needed. No service-role key exposed to Lovable prompts, frontend, or VPS env.
5. **Backfill:** Fresh start. No 90-day replay. Mirror holds current operational state only; history stays on VPS.

**Invariants:**
- Supabase mirror is disposable.
- VPS is canonical.
- Mirror failure does not stop agents.
- Lovable UI may show stale/unavailable; dealer flows must not break.
- VPS crons are NOT frozen for mirror work.
- No operational agent reads are repointed to Supabase.

## 7. Deliverable Order

1. This plan approved.
2. Mirror table DDL + RLS migration.
3. `useMirror` feature flag.
4. `vps-write` edge function skeleton.
5. Per-page read repoint PRs (Trading Desk → Today → Alerts → Bob tools → Operator pages).
6. REMOVE sweep.
