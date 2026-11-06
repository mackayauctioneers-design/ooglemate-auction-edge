# Original Carbitrage product review

The later source-to-code pass is `docs/carbitrage-source-to-code-audit.md`. This file is the earlier pass. It does not by itself close the audit.

Reviewed from this repository at `45afe8e8` plus the uncommitted preview-gate work. Git history on this clone runs from `bebc3a20` (2025-01-01, template) through `45afe8e8` (2026-11-06): **4474 commits**. Volume is concentrated in Dec 2025–Jun 2026 (about 66 + 1265 + 762 + 1579 + 102 + 483 + 187 commits). Jul–Oct 2026 is sparse (9, 2, 12, 3). That is the “eight months” in the commit graph. This note does **not** claim every commit was read. Lovable project chat history was not available in this worker. The published project id `92b962ba-8cbd-4e77-b734-dd01c5a9be50` was not queried for database content.

The new `/portal` is a tenant-isolated synthetic desk. It is not a completed salvage of the original product.

## What was executed

`server/carbitrage/original-engines.parity.test.ts` imports the original modules and runs them on synthetic numbers:

- `normaliseToOffroad` (`supabase/functions/_shared/price-normalisation.ts`): a drive-away $100,000 in QLD becomes `round(100000/1.05)`. An unknown or already excl-govt price is unchanged. The Hilux fixture text “Synthetic auction catalogue” is `unknown`, so the original rule leaves $46,990 alone.
- `computeMarketRange` (`supabase/functions/_shared/valo/scoreValoComps.ts`): two prices return null. Three prices 48000/50000/52000 return median 50000. `computeTradeInOffer` then subtracts allowance $1,000 and the “good” recon buffer $1,500, so mid is $47,500.
- The preview’s `displayedFloor` on one own Hilux E sale is $52,000. That is not the VALO offer. The test asserts they differ.

Fingerprint `marginCalc` is not exported. `scoreListingsForDealer` needs a live Supabase client, so it was not executed. `fingerprint-match-run` (v5, `supabase/functions/fingerprint-match-run/index.ts`) is a Deno function with a different score (make/model +40, km IQR, rebased anchor, threshold 60). It calls `normaliseToOffroad` before matching. The portal does not call it.

## Implemented engines (code, with callers)

| Piece | Path | Behaviour | Portal |
| --- | --- | --- | --- |
| Off-road price | `_shared/price-normalisation.ts` | Drive-away divided by `1 + state %`. Unknown is not guessed. Sales-truth exit values are not stripped. Callers: `fingerprint-match-run`, `run-hunt-scan`. `detectPriceType` also used by `dealer-outbound-crawl`. | Not called on the card. Asking price is shown raw. Tested beside the preview median so the two are not confused. |
| VALO comps | `_shared/valo/scoreValoComps.ts` | Exact variant +20, engine, year, km. Market P25/P50/P75 only at 3+ prices. Trim 10% at 10+ prices. Trade-in = median − allowance (default $1,000) − recon ($500–$5,000). Confidence HIGH at 15 comps. UI: `src/pages/ValoPage.tsx`. | Not called. |
| Fingerprint margin | `_shared/fingerprint/matchListingToFingerprint.ts` | `margin = median_sell_price − asking`. Viable when margin ≥ `min_viable_profit_floor`. Bands are median and p75 profit, not a universal percent. | Not called. |
| Rebased fingerprint match | `fingerprint-match-run/index.ts` | Historical margin percent kept, buy anchor recomputed from current market median. Expiry at 12/24 months. | Not called. |
| Buy-again replication | `memory/features/buy-again/replication-engine-logic-v1` and `src/pages/BuyAgainTargetsPage.tsx` | Top individual sales with profit ≥ $4,000, exact make/model, year ±2, km ±10,000, no drivetrain downgrade. Profit = that sale’s sell price minus asking. Not a median. | Not called. Page still exists for the old app. |
| Sales truth margin | `_shared/sales-truth/writeSoldVehicle.ts` | `sale_price − purchase_price_inc_gst` when buy price is present. | Import stores a sale price only. It does not compute that margin. |
| Dealer auth | `src/contexts/AuthContext.tsx`, `user_roles`, `get_dealer_profile_by_user` | Supabase user id, role from `user_roles`, dealer from profile links. | Preview JWT path uses the same `sub` idea. Demo personas are local and gated. The published Supabase project is not contacted. |

There are **287** edge-function directories and **121** pages. Most ingestion, alert, hunt, and operator functions are outside the portal. `.lovable/plan.md` (updated through 2026-06-26) says valuation and scoring should live on the VPS, Lovable should mirror, and **Phase 1 mirror tables were on hold**. That plan is a proposal. The edge functions are still in the tree. The portal did not delete them.

## Rules that disagree, left as written

- Bob constitution (`memory/logic/carbitrage/bob-constitution-v1`): only the dealer’s own sales count; one profitable sale is valid; do not say “market value”.
- Hunt rules (`memory/rules/carbitrage-hunt-rules-v1` and `carbitrage-core-logic-lock-in-v1`, Jan 2026): margin after freight and recon; freight is a cost, not a reject; off-road price; human confirms Buy/Watch/Reject. Freight figures are ranges ($0–$3,000), not one formula in code.
- Forgotten winners (`memory/logic/carbitrage/forgotten-winners-treatment-v1`): one-off profit is a hypothesis, not noise. Needs buy and sell price.
- VALO: external comps, needs three prices, then a recon buffer. That is a market range. Bob forbids calling it market value.
- Preview `displayedFloor`: median of recent own ex-gov sales of the same variant. Older than six months stay count/median only. No freight, no recon buffer, no fingerprint floor. The card now says it is not VALO and not fingerprint margin. The number was not switched to another engine.

No trading rule was rewritten to make these agree.

## Preview versus the original desk

Wired and tested: membership-scoped finds, source URL retention, idempotent ingest, watchlist/status, DNA mandates from sales import, six-month sale redaction, illustrative photo label, own-sale median with the scope sentence above.

Left untouched on purpose: Bob, VALO page, fingerprint match, buy-again replication, freight tables, scoring-engine caps, operator trading desk, 287 edge functions, billing, and the published database.

## Lovable extract checked against code (2026-11-06 file)

The extract covers project `92b962ba-8cbd-4e77-b734-dd01c5a9be50`, created 2025-12-30. Knowledge and workspace skills were empty. Chat pages in that extract run about 9 Jun–4 Nov 2026 with `has_more` still true. Edit pages sampled May–Nov 2026, also with older pages unread. So this is not a full eight-month chat review. Git commit dates on this clone are the code chronology.

Checked ideas, and what the code actually does:

- **Core vs outcome fingerprints.** `build-sales-targets` sets `fingerprint_type` to `core` or `outcome` and `outcome_verified` when any row was profitable (`supabase/functions/build-sales-targets/index.ts`). The portal DNA page does not split mandates that way.
- **Forgotten-winner threshold.** The memory note says profit at least `max(median × 1.3, $2500)` with buy and sell both known. The shipped hook `src/hooks/useUnexpectedWinners.ts` instead keeps a 1–2 sale shape when sale price is at least 1.3× the median sale price, or profit is at least $5,000, or it cleared in 60% of the median days. A test reads both files and records that they are not the same rule. Neither runs in the portal.
- **Nearest winning trade, not a median.** `score-operator-opportunities` ranks matching sales by km closeness and profit, then sets `under_buy` to that one sale’s buy price minus asking, and `expected_margin` to that sale’s own profit. Memory calls the tiers CODE_RED / HIGH / BUY. Telegram alerts read those tiers. The portal median is a different number.
- **May 2026 market floor.** `compute-market-floor` builds a max-pay from a recency-weighted average of the dealer’s own sold prices, then subtracts a state freight map (QLD $1,000, not the Jan note’s $1,000–$1,500 range), an auction fee, and 12% of the average (`MARGIN_TARGET`). It needs `sold_vehicles` and was not executed here because the module reads `Deno.env` and Supabase. The portal does not call it.
- **Buy-again / trim.** `src/hooks/useBuyAgainTargets.ts` enforces make, model, year ±1, km ±7,500, asking below median sell, drivetrain, and trim exact or one rank up via `trim_ladder`. The Jan memory note says year ±2, km ±10,000, and profit ≥ $4,000 on the source sale. The hook and the note disagree. Both need live listings. The portal matches make/model only for the own-sale median.
- **VALO series gate.** `extractSeries` returns `LC300` and `LC200` as different series, and null when the generation is absent. `runValoScoring` drops a comp only when both series are detected and they differ. A synthetic call in the parity test checks LC300 ≠ LC200.
- **B-mode mandates.** `MandateFeedPage` reads `active_mandates` and stores structural matches. The portal import creates a make/model mandate after two sales. It does not keep a price-delta feed.
- **June architecture.** `.lovable/plan.md` says Phase 1 mirror tables were on hold as of 26 Jun 2026, VPS pushes, Lovable does not pull. That plan is not what `/portal` implements. The portal’s canonical store is the disposable Postgres schema in this branch.

Old notes that mention AutoGrab as a market source, or clean-title defaults, were not turned into preview behaviour. The preview still rejects AutoGrab URLs and does not do a clearance or PPSR lookup.

## Gaps before anyone calls this the original engine

- Asking prices are not passed through `normaliseToOffroad`.
- No freight line, no recon buffer, no `$/km`, no geo score.
- No fingerprint or buy-again match against a live listing.
- Sales import does not require a buy price, so forgotten-winner profit cannot be computed.
- VALO and fingerprint code still expect the published Supabase project or a VPS. They were not pointed at the disposable Postgres.
