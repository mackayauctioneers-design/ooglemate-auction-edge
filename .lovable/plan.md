
# Patrick Auto Group — Dealer Activation Pipeline

Goal: turn Patrick from "manual demo script" into a live, self-running acquisition engine using the canonical pipeline:

```
sales upload → vehicle_sales_truth → dealer_fingerprints
   → active_mandates → run-mandates (cron) → mandate_feed_items
   → mandate_alerts → Dealer Radar UI + daily digest
```

No new pipeline. No Patrick-specific code. Patrick is row #1 of the multi-tenant flow; every step must work identically for dealer #2..#N.

---

## 1. Required tables (all already exist — reuse, do not recreate)

| Table | Role |
|---|---|
| `vehicle_sales_truth` | Patrick's full sold-stock history (append-only) |
| `dealer_fingerprints` | Profitable repeat patterns per dealer |
| `active_mandates` | Buying lanes generated from fingerprints |
| `mandate_runs` | Audit log of each `run-mandates` execution |
| `mandate_feed_items` | Scored live matches per mandate |
| `mandate_alerts` | Dispatched alerts (push/email/whatsapp) |
| `market_listings` (view) | Unified live supply across all sources |
| `dealer_profiles`, `accounts` | Tenant identity |

**New columns only (additive, multi-tenant):**
- `active_mandates.lane` (`core` \| `shortage`) — already proposed in prior turn
- `mandate_feed_items.final_score`, `lane`, `alert_tier`, `rejection_reason` — already proposed

No new tables.

---

## 2. Existing functions/scripts to reuse or modify

| Edge function | Change |
|---|---|
| `dealer-sales-upload` | None. Use as-is to ingest Patrick's full XLSX/CSV. |
| `recompute-fingerprint-performance` | None. Already daily 03:00 UTC. |
| `generate-dealer-mandates` | Emit `core` + `shortage` rows per qualifying fingerprint. |
| `run-mandates` | Already scheduled every 15 min. Confirm `dealer_id` filter works; add `final_score` write-through. |
| `notifier` (existing alert dispatcher) | Reuse. Confirm Patrick `alert_channels` populated. |
| **NEW (only one):** `dealer-daily-digest` | Pure aggregator: reads `mandate_feed_items` from last 24h per dealer, emits one email/Slack/WhatsApp digest. Generic, dealer-agnostic. |

No new matcher. No Patrick-only function.

---

## 3. Cron / service design

All in `pg_cron`, all generic (no dealer filter):

| Job | Schedule (UTC) | Function |
|---|---|---|
| `recompute-fingerprint-performance-daily` | 03:00 | existing |
| `generate-dealer-mandates-daily` | 03:15 | existing (jobid 68) |
| `run-mandates-15min` | `*/15 * * * *` | existing |
| `dealer-daily-digest` | 22:00 (08:00 AEST) | **NEW, generic** |
| `recompute-dealer-inventory-position` | 04:00 | proposed prior turn |

Patrick activates simply by having rows in `vehicle_sales_truth` — no scheduler change required.

---

## 4. Scoring logic (already specified, just enforce)

Inside `run-mandates`, 5 weighted components → `final_score` / 100:

| Component | Weight |
|---|---|
| `dealer_shortage_weight` | 25 |
| `model_fit_score` (fingerprint match strength) | 25 |
| `price_opportunity_score` (vs sales-truth buy price) | 25 |
| `age_km_fit_score` | 15 |
| `sales_confidence_score` (sales_count, recency) | 10 |

Tier mapping:
- `A+` ≥ 80 → instant alert
- `A` 70–79 → digest
- `Watch` 60–69 → feed only
- `Reject` < 60 → store with `rejection_reason`, no alert

---

## 5. Alert thresholds

| Channel | Trigger |
|---|---|
| Push + WhatsApp | `final_score ≥ 80` AND not previously alerted for `(mandate_id, listing_id)` |
| Email | included in daily digest if `final_score ≥ 70` |
| Suppression | dedupe on `(dealer_id, listing_id)` for 7 days; respect dealer quiet hours |

No new alerts table — `mandate_alerts` already handles this.

---

## 6. Dashboard / feed output

**Generic route:** `/dealer/:dealerId/radar` (works for all dealers).

Sections, all reading existing tables filtered by Patrick's `dealer_id`:
1. **Activation status banner** — sales rows / fingerprints / active mandates / last `run-mandates` run.
2. **Today's Top 10** — `mandate_feed_items` last 24h, `final_score` desc.
3. **By model lane** — grouped by fingerprint make/model.
4. **Shortage radar** — mandates where dealer inventory < threshold.
5. **Rejected with reason** — debugging visibility for operator.
6. **Alert history** — last 7 days from `mandate_alerts`.

---

## 7. Activation steps for Patrick (one-time, reusable for every dealer)

1. Upload Patrick's full sales XLSX via existing `/operator/dealer-sales-upload` (account pre-filled, all rows, not one).
2. Confirm `vehicle_sales_truth` row count > 0 for Patrick `account_id`.
3. Trigger `recompute-fingerprint-performance` once manually (don't wait for 03:00).
4. Trigger `generate-dealer-mandates` once manually — auto-creates `core` + `shortage` mandates for every qualifying fingerprint (Isuzu, Amarok, Mazda, Hyundai, Suzuki, etc. — whichever pass `sales_count ≥ 2`, `avg_profit ≥ 1500`).
5. Trigger `run-mandates` once manually — populates `mandate_feed_items`.
6. Open `/dealer/79ee6123…/radar` — verify Top 10 renders.
7. Verify next `dealer-daily-digest` (22:00 UTC) emits one digest email to Patrick's contact.

Steps 3–5 are buttons that already exist on operator pages. No scripts to write.

---

## 8. Rollback plan

Every step is reversible because nothing is destructive:

| If broken | Action |
|---|---|
| Bad fingerprints | `UPDATE dealer_fingerprints SET is_active = false WHERE dealer_profile_id = $patrick` |
| Bad mandates | `UPDATE active_mandates SET is_active = false WHERE dealer_id = $patrick` — stops scoring + alerts within 15 min |
| Bad alerts | Disable `dealer-daily-digest` cron; flush `mandate_alerts` queue |
| Bad sales data | Re-upload via `dealer-sales-upload` (idempotent on stock_no) — fingerprints will recompute next 03:00 |
| Whole activation | Toggle `dealer_profiles.is_active = false` — Radar hides, crons skip dealer |

No schema changes to revert. No code paths forked off the canonical pipeline.

---

## What this plan deliberately does NOT do

- No new matcher, scorer, or alert table.
- No Patrick-specific cron, function, route, or branch.
- No restructuring of existing services.
- No renaming.
- No directory cleanup.

The only new code is one generic `dealer-daily-digest` edge function. Everything else is wiring + data + a generic Radar page.
