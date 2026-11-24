# Ooglecars → Carbitrage connection check

## The intended relationship

**Ooglecars** handles stock, sales, paperwork and accounts. **Carbitrage** uses each dealership’s actual sales outcomes to recognise its winners and find suitable cars to buy again. Asking prices are market evidence, not proof of a completed sale.

## Confirmed today — 24 November 2026

- Carbitrage contains **477 sales labelled as the Ooglecars feed**, across three accounts. Records arrived today; the latest received timestamp checked was 04:54 UTC (15:54 Sydney).
- All 477 have a buy price. 459 also have a recorded time to sell.
- The receiving sales feed restricts accounts and fields, rejects registration/VIN/customer fields and ignores duplicate IDs rather than replacing existing sales.
- The Ooglecars code contains a sold-sales sender, per-dealership identification and retry handling. Its sender goes to a VPS purchase-ingestion address, not directly to Carbitrage’s new sales receiver. The middle VPS mapping still needs confirmation.

## Gaps to resolve before calling the whole buying loop healthy

- The saved buying-pattern records checked for two connected accounts were last updated in March and May. The third has no active records in that set.
- Two accounts have active saved buying targets; their latest recorded runs were on 21 November. The third has no active targets in that set.
- The older Carbitrage 15-minute buying-search schedule is disabled. This may be intentional if the VPS has taken over; do not switch it on blindly.
- The current sales table has validation/profit triggers, but no trigger that refreshes those saved buying patterns on receipt of a new sale.
- The function named `recompute-fingerprint-performance` reads deal outcome ledgers and updates performance metrics; it does not itself turn the new sales feed into `dealer_fingerprints`.

These observations identify a downstream freshness gap, not proof that every VPS process is stopped. The VPS queue/DNA may use a different current read path; that path has not been verified here.

## What to ask the VPS agent for

Provide a **redacted status report**, with no tokens, passwords, customer details, registration numbers or VINs:

1. The active Ooglecars → VPS → Carbitrage route, including how the dealership identifier maps to the correct Carbitrage account and how duplicate/overlapping sales are handled.
2. The existing worker that refreshes dealer buying patterns from received actual sales: its input/output names, latest successful run and any errors.
3. The existing worker that searches for matching cars and supplies dealer DNA, queue and alerts: latest successful runs and whether it replaces the disabled Carbitrage schedule.
4. One anonymised trace from a received sale to a refreshed buying pattern, buying target and dealer-visible result. If the dealer does not yet meet qualification rules, report that instead of inventing a target.

The repair should reconnect the existing shared pipeline, not introduce another dealer-specific matcher or schedule.

## VPS report received — 24 November 2026

The following is supplied by the VPS agent, not independently checked against the running VPS:

- Signed sales arrive at `/ingest/oogle-sales`; the existing push forwards allowed fields to `sales-ingest` every five minutes and on change. The report gives 477 sent, zero failures and zero dead letters, with the last push at 19:09 Sydney.
- The three reported account mappings match the receiver's existing allow-list. ACM and Car Boutique are intentionally skipped; other unmapped dealerships are held. Stable IDs and overlap checks prevent duplicates; edits are held rather than overwriting sales.
- `profile_builder` refreshes `dealer_winner_cells` after new sales. The report gives 707 Mackay, 252 AJH and 115 Shed cells, with successful runs today. None are written back to the site's `dealer_fingerprints`.
- Three legacy fingerprint jobs still consume a JSON file dated 25 June. Successful exits therefore do not prove fresh site patterns.
- VPS hunting, finder and dispatch workers are running, but their results remain in VPS stores or Carby's chat. Do not restart the site's old schedule and duplicate them.
- The anonymised Grand Cherokee trace is not a proven winner: the reported four-sale history includes two losses and negative average gross. A single profitable sale or a REPEAT label must not bypass existing winner qualification.

### Safe next boundary

The proposed write-back can reconnect the existing fingerprint stage without another matcher or schedule, but its payload contract must be checked first. The checked-in fingerprint shape uses `dealer_profile_id` and `fingerprint_id`, not `account_id` and `cell_key`. Obtain a redacted winner-cell row, stable key definition and account-to-profile mapping; verify the live unique constraint before choosing an upsert conflict target. Preserve the existing sales insert-only path, tenant isolation, qualification and site-owned settings. Do not blindly mark every winner cell active or enable alerts.

The current `sales-ingest` has no fingerprints action. No receiver changes are made until this mapping is settled. Redirecting or retiring the legacy jobs belongs to the VPS agent and must use the same canonical pipeline. Delivery of finder results to dealers is a separate decision; refreshing patterns alone will not make those results appear on the site.

## Winner-cell sample received and live identity checks — 24 November 2026

The supplied sample is a group-level Toyota Hilux cell, with blank badge/platform/km band, years 2006–2026 and km maximum 400,000. It reports 23 all-time sales, 16 recent sales, a recent gross mean of 1243.78 and median days of 4.5. Its timestamp is 2026-11-24T17:53:38+11:00.

Read-only live checks confirm:

- Mackay account `d24da4ea-f500-47fd-9b66-d2c9aa2d3f51` resolves to dealer profile `ffdbbf25-1d9c-4402-ba49-fc4da4b77cb6`.
- AJH account `8140eae1-2c36-40b6-a358-4f5ed05bbbcf` resolves to dealer profile `1fb22da9-37b9-4d95-a3a6-c50e07a4877e`.
- No dealer profile resolves for Shed account `a2aec451-3b68-47f1-aaa8-ce7ef470b30d`; a name search for Shed also returns none. Do not invent a profile or borrow another dealer's identity.
- The existing fingerprint uniqueness constraint is global `UNIQUE (fingerprint_id)`, not account plus cell key. An exported identity must therefore be tenant-scoped and distinguish levels and km bands; confirm the VPS's actual uniqueness definition before encoding it.
- Mackay's existing Hilux fingerprint is an `owner_buy` SR5 target, not this broad group cell. Do not overwrite it based on make/model alone.

### Proposed mapping, not implemented

- Resolve an authenticated, allowed account to exactly one existing dealer profile on the receiver; do not trust `dealer_key` as permission or accept an arbitrary profile ID.
- Map `n_sales_120` to recent `sales_count` and `avg_gross_120` to recent `avg_profit` only as an explicit export contract. Never substitute all-time means, ranking weight, shrinkage or adjusted median for the recent mean.
- Keep `med_days` out of `avg_days_to_sell`: a median is not an average. Omit an unavailable average rather than inventing it. `score`, `weight` and `feedback_factor` are not interchangeable with site priority, profit score or recency weight.
- Identity/make/model/year bounds/km maximum can be carried through with validated types. Blank group-level badge means no badge-specific claim. Do not treat this cell as an SR5 fingerprint.
- Exclude `top_sources`, `top_buyers` and `example_sales` entirely, even when redacted; the actual export must not carry those private details. Use a strict allow-list.
- The checked-in canonical mandate generator requires at least two sales, an active fingerprint and average profit at least 1500. This sample's recent mean of 1243.78 does not qualify; `adj_med_gross = 1500` must not be substituted to cross that gate. Do not change these existing rules as part of linkage.

Remaining: confirm whether VPS uniqueness includes dealer, level, cell key and km band; provision Shed through an approved existing dealer workflow before importing its patterns. No pattern receiver, write-back, deployment, scheduler change or dealer-result delivery has been implemented.

## Changes in this check

No application code, prices, sales records, permissions, schedules or screens changed. Nothing deployed or published. The product relationship and audit findings were recorded only.