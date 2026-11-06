# Valuation recommendations for Macka

Proposed. Not applied. Portal code is unchanged. Hosting is separate. Production is untouched.

Rules already set by you are marked **governing**. Items still worth a yes or no are marked **choice**. The 12% market-floor target, the QLD 5% on-road guess, and the old $1,000 / $2,000 / $3,000 liquidity floors are not treated as current policy.

## Already governing

**Retail market floor** is the cheapest credible retail listing of the same badge, series, and spec, priced excluding government charges. It needs at least 3 such comps. Fewer than 3 means no floor. A sold-price average, an own-sale median, and a wholesale offer are not this floor.

`compute-market-floor` (`supabase/functions/compute-market-floor/index.ts`) is a different sum: weighted sold prices, $0.04 per km, a flat state freight number, an auction fee, and 12%. Keep the function. Do not show its result as the retail floor.

**Year.** Same generation only. Adjacent model year ±1. An older car of that same shape may set a cheaper floor (your 25 Oct rule). Do not widen badge or series to find a cheaper car.

**Government charges.** If the listing is already ex-gov, use it. If charges are unknown, say unknown. Do not apply the old QLD 5% in `normaliseToOffroad` as if it were the current tax.

**Buy view.** A guide beside the floor, not a fixed $5k, 12%, or $10k deduction. Unknown prep and condition stay unknown. No profit promise. The examples you gave (about $9–10k under a $14,990 floor, about $24–25k under a $29,990 floor, about $41–42k wholesale on a $49,990 drive-away / $48k ex-gov) are illustrations of that flexibility.

**Own sales.** Use the full history to say a shape is worth watching. A sale older than six months is a trend or count only: no single old price and no single old date. One profitable own sale is eligible at low confidence. Do not drop it only because the count is under 3. Yard figures stay inside that yard’s membership. Public market comps are not another yard’s sales.

**Scope.** Alerts may stop at 120,000 km. Valuations do not inherit the old 2020-or-newer alert filter. WA supply for this product is franchise dealers; other sources are not limited to private sellers. A public car meaningfully under the retail floor can be shown to you before it is scored as a fit for one yard.

**Do not show.** AutoGrab links, PPSR, REVS, stolen, or written-off flags. InfoAgent stays registration-only, and only when asked.

## Recommendations

### 1. Two-comp VALO quote versus three-comp retail floor

**Governing.** Retail floor stays at 3 credible retail comps.

**Versions.** On 3 Jan 2026 the VALO brief said a firm price needs at least 2 comps from the dealer’s own sales, otherwise downgrade and ask for photos (`REVIEW_frank_to_bob_valo_jan3.md`). On 2 Mar 2026 `computeMarketRange` in `supabase/functions/_shared/valo/scoreValoComps.ts` started returning no range under 3 prices. Nobody wrote down “change 2 to 3.”

**Proposed.** Keep both, with different names. A firm wholesale quote from the dealer’s own comps can be given at 2 comps (January VALO). A retail floor still needs 3 retail listings. A percentile band (P25/P75) also stays at 3, because two points are not a band.

**Synthetic.** Two own Hilux sales, $20,000 and $22,000, and only two retail ads. VALO may quote a wholesale range. The retail floor stays blank.

### 2. Three benchmarks, three labels

**Versions.** Retail floor: cheapest same-spec retail ex-gov (`compute-market-floor` does not do this). Dealer nearest win: one past purchase in `scoreListingAgainstAccounts` (`supabase/functions/score-operator-opportunities/index.ts`), where under-buy is that buy price minus the asking price. Own-sale median: what `/portal` shows today in `displayedFloor`.

**Proposed.** Show retail floor, nearest own purchase, and own-sale median as three labeled lines. The green “% under” uses only the retail floor. If that floor is missing, show no green percent. Do not delete the other two functions.

**Synthetic.** Three matching retail ads at $14,990, $15,500, and $16,000 ex-gov. Floor is $14,990. A nearest own purchase at $11,000 and a recent own-sale median of $18,000 stay on the card as yard context. An asking price of $14,500 is under the retail floor only.

### 3. Buy-again year and kilometres

**Governing.** Same generation. Year ±1. Older same shape may set the cheaper retail floor. Exact badge, or one trim step up only, as `useBuyAgainTargets.ts` already does with `trim_ladder`.

**Versions.** The buy-again note says year ±2 and km ±10,000. The hook uses year ±1 and km ±7,500.

**Proposed.** Use the hook’s year ±1. For kilometres, keep ±7,500 until you say otherwise. That is the one numeric choice below.

**Synthetic.** A car sold at 80,000 km. A listing at 88,000 km is inside ±10,000 and outside ±7,500, so it would be a buy-again match only if you pick the wider band.

### 4. One profitable sale, and the liquidity discard

**Governing.** One profitable own sale is eligible at low confidence. Confidence may still rise at 3–4 and at 5 or more, which is what `build-sales-targets` already does for core versus outcome. Full history may form the profile. Quotes of price and date stay inside six months; older sales are counts and trends.

**Versions.** `rebuild-liquidity-profiles` drops a group with fewer than 3 sales and sets a viable-profit floor at `max($500, 5% of median sell)`. The liquidity note instead used $1,000 / $2,000 / $3,000. `useUnexpectedWinners.ts` keeps a one-off only if the sale price is at least 1.3× the median, or profit is at least $5,000, or it sold fast. The forgotten-winner note used `max(median × 1.3, $2500)`.

**Proposed.** Do not drop a profitable one-off. Show it as low confidence. Use 1.3× and the dollar tests only as reasons, not as a gate. Do not enforce $1,000 / $2,000 / $3,000 or the 5% floor as a reject. `marginCalc` can keep reading a stored floor later; do not invent a new one now.

**Synthetic.** One sale, bought at $12,000, sold at $15,000. Eligible, low confidence, no old date quoted if it is older than six months. Today’s liquidity rebuild would discard it.

## The only yes/no that still changes a match

Buy-again kilometres: **±7,500** (what the hook does) or **±10,000** (what the note says). Year ±1 and the retail floor at 3 comps are not in that question.

If you also want wholesale quotes turned off below 3 own comps, say so. Otherwise the recommendation is to keep January’s 2-comp firm wholesale quote, labeled as wholesale, and never as the retail floor.

## After you decide

1. Point the portal’s green percent at the retail-floor definition only. Leave `displayedFloor` in the file as the own-sale median, renamed in the UI.
2. Call `scoreListingAgainstAccounts` logic for the nearest own purchase, and stop calling that number a floor.
3. Leave `compute-market-floor` in the tree. Do not feed it to the green percent.
4. Split VALO: firm wholesale quote at 2 own comps; percentile band and retail floor at 3.
5. Stop `rebuild-liquidity-profiles` from deleting groups under 3. Keep confidence labels.
6. Tests on synthetic rows only: 2 comps versus 3, the $14,990 example, the 88,000 km boundary, and the single $3,000-profit sale.
7. Hosting stays the separate note in `docs/carbitrage-private-preview.md`. No deploy in that step.
