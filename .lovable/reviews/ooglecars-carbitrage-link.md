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

## Changes in this check

No application code, prices, sales records, permissions, schedules or screens changed. Nothing deployed or published. The product relationship and audit findings were recorded only.