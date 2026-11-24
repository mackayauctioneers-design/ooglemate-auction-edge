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

## Changes in this check

No application code, prices, sales records, permissions, schedules or screens changed. Nothing deployed or published. The product relationship and audit findings were recorded only.