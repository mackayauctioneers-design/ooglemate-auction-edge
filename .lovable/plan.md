## Goal
Aaron logs in and sees the same Trading Desk the operator sees — colored KPI tiles (CODE_RED / HIGH / BUY / WATCH), tier badges, anchor-sale expand rows, auction calendar, Deal/Star/Dismiss actions — but locked to his own dealership's data only.

## Approach
Reuse the existing `src/pages/operator/TradingDeskPage.tsx` (the full-featured one) instead of forking it. Add a small `mode` prop so the same component can render in two contexts:

- `mode="operator"` (current behaviour, admin-only, OperatorLayout, multi-dealer selector visible)
- `mode="dealer"` (new, DealerLayout, account filter locked to `currentUser.account_id`, operator-only controls hidden)

Then point the dealer routes at it.

## Changes

1. **`src/pages/operator/TradingDeskPage.tsx`**
   - Accept optional props: `mode?: 'operator' | 'dealer'` (default `'operator'`), `lockedAccountId?: string | null`.
   - When `mode === 'dealer'`:
     - Wrap in `DealerLayout` instead of `OperatorLayout`.
     - Initialise and force `filterAccount = lockedAccountId`; ignore localStorage; hide the Account `<Select>` in the filter bar.
     - Hide operator-only UI: "Assign to dealer" submenu (keep a simple "Mark as mine"), bulk re-score / scoring trigger buttons, Master Profile link only if admin, CaroogleAI Finds drawer trigger (operator workflow).
     - Keep everything else: KPI tiles, tier filter chips, source filter, status filter, min margin, table with tier badge, anchor-sale collapsible, auction badge, Star, Deal, Dismiss.
   - All data queries already filter on `best_account_id` when `filterAccount !== 'all'`, so no query rewrites needed.

2. **New thin wrapper `src/pages/DealerTradingDeskPage.tsx`**
   - Reads `currentUser.account_id` from `useAuth()`.
   - If no `account_id`: show a friendly "Your dealership isn't linked yet — contact your account manager" empty state.
   - Otherwise renders `<TradingDeskPage mode="dealer" lockedAccountId={currentUser.account_id} />`.

3. **`src/App.tsx`**
   - Replace the three dealer routes that currently point at the old simple `TradingDeskPage`:
     - `/` → `DealerTradingDeskPage`
     - `/dealer-home` → `DealerTradingDeskPage`
     - `/trading-desk` → `DealerTradingDeskPage`
   - Leave `/operator/trading-desk` untouched (still admin-only via `OperatorGuard`).
   - Remove the now-unused `src/pages/TradingDeskPage.tsx` import (and delete the file).

## RLS / data access
`operator_opportunities` is currently admin-read-only. To let Aaron read his own rows we add a dealer-scoped policy:

```sql
CREATE POLICY "Dealers read own opportunities"
ON public.operator_opportunities
FOR SELECT TO authenticated
USING (
  best_account_id IN (
    SELECT account_id FROM public.dealer_profiles
    WHERE user_id = auth.uid()
  )
);
```

And a matching UPDATE policy limited to the status / starred / reminder / dismissed_anchor_ids columns the dealer UI writes, scoped the same way. GRANTs already exist on the table for `authenticated`; no new GRANTs needed.

## Out of scope
- No changes to scoring, anchor logic, or `score-operator-opportunities` edge function.
- Operator dashboard, sidebar, and `/operator/*` routes unchanged.
- No new tier definitions or styling — dealers see the exact same tiles and colors as operators.
