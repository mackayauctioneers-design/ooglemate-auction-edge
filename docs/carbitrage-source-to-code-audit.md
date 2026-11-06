# Source-to-code audit

Draft branch only. No portal valuation change, no deploy, no preview URL.

Project birth in the connector is `2025-12-30T07:52:08Z`. That is **18:52 Sydney** on 30 Dec 2025 (AEDT, UTC+11), not 07:52 Sydney. The first edit is `2025-12-30T08:01:26Z` (19:01 Sydney): “Set up OogleMate UI scaffolding”.

## Coverage

Lovable collection is exhausted for both streams: 72 message pages, about 7,100 messages, back to that birth timestamp; 36 edit pages, about 1,762 titles, through the same day. High-signal user instructions and 241 full briefs were the review set. Assistant scaffolding was not read line by line. Edit titles are not full diffs. Extract 3’s long snippets were 4k stubs; the full briefs supersede them. Knowledge and workspace skills were empty.

Git on this clone has 4,474 commits. That graph was used to date functions. It was not read commit by commit. `dave-full-brief-2026-05-14.md` was reported 404. `.env` was not read.

Current owner rules still govern the preview and are not replaced by older percentages: price basis excluding government charges; sales older than six months as trend only, with no specific old price or date; no AutoGrab links; no PPSR or clearance claim; yard isolation. The May 12% floor target is recorded below as history. It is not adopted here.

## Status of each decision

| Decision | Provenance | What the code does now | Portal |
| --- | --- | --- | --- |
| Frank renamed to Bob | User 2026-01-03T06:36:22Z in `REVIEW_frank_to_bob_valo_jan3.md` | Later Bob pages and `bob-chat` use Bob. Frank is the same assistant line. | Preserved only in the old app. Portal has no Bob. |
| Firm VALO price at **≥2** own comps, else ask for photos | Same review, 2026-01-03T20:48:44Z. “Query `dealer_sales_history` first.” | `computeMarketRange` in `supabase/functions/_shared/valo/scoreValoComps.ts` returns null when `prices.length < 3`. That line arrived with the file on **2026-03-02** (`122ba8f6`). No later owner sentence in the briefs says “change 2 to 3”. | Missing. A synthetic run of the March function refuses two comps and, for three prices 48000/50000/52000, median 50000 then trade-in mid **47500** (allowance 1000 + recon 1500). The portal one-sale median is **52000**. Those are not the same result. |
| May market floor | `REVIEW_market_floor.md`, 2026-05-10. Weights 1.0 / 0.8 / 0.5. `ODOMETER_RATE` 0.04 per km. `MARGIN_TARGET` 0.12. Freight and auction-fee maps. Round to $100. | `compute()` in `supabase/functions/compute-market-floor/index.ts` (last touched `31bc4f54`, 2026-06-06) matches that arithmetic: `floor_raw = weighted_avg + odo_adjustment − freight − auction_fee − 12%`. Comps are the dealer’s own `sold_vehicles` for 180 days, widened if fewer than 5. QLD freight in this file is a flat **$1,000**, not the January note’s $1,000–$1,500 range. Not executed here: the module reads `Deno.env` and Supabase. | Missing. Not wired, and not adopted as the preview rule. |
| Nearest winning sale, not a median | Scoring memory and `score-operator-opportunities` | `scoreListingAgainstAccounts` keeps sales that match platform, trim ladder, year ±1, km within 20%, and drivetrain, then sorts by km closeness and profit. `under_buy = that sale’s buy_price − asking`. `expected_margin` is that sale’s own profit. Caps in the same file: 3000 listings, 300 priced opps, 150 auction-watch, top 3 per fingerprint. `scorer_cursors` delta. Guarded upsert skips terminal rows. Year ≥2020 and km ≤120,000. Last touched `fab65b91`, 2026-05-27. | Missing. Portal median is make/model/variant over six months. It does not pick one anchor sale. |
| Full sold history → mandates | `REVIEW_mandate_full_history.md`, 2026-05-23. Explicitly not only the top one or two models. Do not replace `active_mandates`. | `MandateFeedPage` and `get-active-mandates` still exist. Portal import creates a make/model mandate only after two imported rows and does not scan live listings. | Missing the continuous match. The May 23 text supersedes any earlier “top models only” packaging. |
| Core vs outcome | Memory dual-type note, and `build-sales-targets` (`62131eda`, 2026-02-12) | Outcome type forces confidence `low`. High confidence needs ≥5 sales and ≥4 spec fields. `outcome_verified` is “any profitable row”. The function loads all `vehicle_sales_truth` for one `account_id`. | Missing. Portal DNA is a mandate list, not this split. |
| Eligibility versus confidence | Same builder, and Bob constitution | Profit can mark an outcome as verified while confidence stays low. | Missing. |
| Liquidity floors | Memory: HIGH ≥5 flips, floor $1,000; MED $2,000; LOW $3,000 | `rebuild-liquidity-profiles`: fewer than 3 flips is `INVALID` and dropped. Then &lt;5 LOW, &lt;10 MEDIUM, else HIGH. Floor is `max(500, 5% of median sell)`, not those fixed dollars. `marginCalc` only compares margin with whatever `min_viable_profit_floor` is stored. | Missing. Dropping n&lt;3 **conflicts** with “one sale is valid”. No brief was found that says to drop one-offs from liquidity profiles. |
| Forgotten winners | Memory: `max(median × 1.3, $2500)` and both buy and sell known | `src/hooks/useUnexpectedWinners.ts` (`0114d825`, 2026-02-08): 1–2 sales, not a top-5 volume shape, and at least one of sale-price ≥1.3× median, profit ≥ **$5,000**, or clearance ≤60% of median days. The file does not contain 2500. | Missing. The note and the hook are both still present. Not resolved. |
| Buy-again tolerances | Memory: profit ≥ $4,000, year ±2, km ±10,000, exact or one-step trim | `useBuyAgainTargets.ts` (`a5a7ab70`, 2026-03-29): year ±1, km ±7,500, asking below median sell, drivetrain hard filter, trim exact or one rank up on `trim_ladder`. | Missing. Tolerances disagree with the note. |
| Star research | May 17 brief: replace Lindy, keep research | `star-watch-dispatch/index.ts` (`b904a32c`, 2026-05-17) says it is the internal replacement and writes `outward_jobs` / `star_watch_jobs`. `lindy-star-watch` is still in the tree. A 27 May report that stars were not firing is a breakage report, not an instruction to return to Lindy. | Missing. |
| Series / identity | Jan briefs and `extractSeries` | LandCruiser 300 and 200 are different series. Unknown generation returns null, and VALO rejects a comp only when both sides have a detected series and they differ. `derivePlatform` still groups LandCruiser together. | Missing on portal cards. |
| Yard isolation | Jan dealer-id hardening; floor comps filtered by `dealer_id` | Portal derives yards from membership. A caller yard id is not enough. That part is reused as an isolation idea, not as the old Supabase policies. | Reused as a rule. The old tables are untouched. |
| Off-road asking price | `price-normalisation.ts` | Drive-away ÷ (1 + state rate). Unknown is not guessed. Synthetic test: QLD drive-away 100000 → 95238. Portal fixture text is unknown, so 46990 stays 46990. | Not called. |
| VPS canonical, Lovable consumer | `.lovable/plan.md`, locked 2026-06-26, Phase 1 on hold | Mirror tables were not the portal design. Edge functions remain. | Preserved only. |
| Carsales as a capped signal | Full brief 2026-03-19 | `carsales-micro-cron` exists. Not a portal concern. | Preserved only. |

## Supersession versus still-open

Superseded, do not treat as two live products:

- Frank and Bob are one rename.
- “Top one or two models” was replaced on 23 May 2026 by full sold-stock mandates.
- Starred research was aimed at the native dispatcher. The later silence report does not restore Lindy.
- Carsales moved toward one capped micro-cron and a signal role.

Still open, no owner sentence picks a winner:

- January “firm price at ≥2 comps” versus the March function’s null under 3 comps.
- May weighted floor (odo $0.04/km, freight map, fees, 12%) versus nearest-sale `under_buy` versus the portal’s six-month own-sale median.
- Forgotten-winner note versus `useUnexpectedWinners`.
- Buy-again note versus `useBuyAgainTargets`.
- Liquidity memory dollar floors versus `rebuild-liquidity-profiles` dropping groups under 3 flips and using 5% of median sell.
- January freight ranges versus the May floor’s single dollar per state.

## What the portal reuses

Membership-scoped reads, idempotent ingest, source URL retention, six-month redaction of specific old sale prices, illustrative photo labels, and a refusal of AutoGrab URLs. The green “% under floor” is only the own-sale median described above.

## Preservation order, for a later decision

1. Leave every function named above in the tree.
2. Owner picks which price the dealer may see: nearest-sale anchor, May floor, VALO range, or the labelled own-sale median.
3. Only after that, call the chosen function from the portal. Do not treat 12%, the $1,000 QLD freight constant, or the three-comp gate as already chosen.
4. Private preview hosting stays the separate package in `docs/carbitrage-private-preview.md`. No URL exists.

Earlier notes that say to use AutoGrab, claim a clean title, or run PPSR are not current instructions.
