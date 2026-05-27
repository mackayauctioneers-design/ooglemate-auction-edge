# Dealer Master Intelligence Profile

Each dealer gets a persistent "profile sheet" the scorer reads on every run. It has a human-written master brief on the left, and an auto-generated sales-truth summary on the right. Together they emit make/model **weights** that multiply margin in `score-operator-opportunities`.

## 1. Schema — `dealer_intelligence_profiles`

One row per `account_id` (the canonical dealer entity).

| column | purpose |
|---|---|
| `account_id` (PK, FK accounts.id) | dealer |
| `master_brief_md` (text) | the manual deep-research doc (paste your Patrick Auto write-up here) |
| `auto_summary` (jsonb) | rebuilt from `vehicle_sales_truth`: `{winners:[…], avoid:[…], niches:[…], avg_days_to_clear, avg_margin, total_sales}` |
| `weights` (jsonb) | `{ "MAKE":{"TOYOTA":1.3}, "MAKE_MODEL":{"TOYOTA|HILUX":1.6, "HOLDEN|COMMODORE":0.4} }` — values 0.0–2.0; 1.0 = neutral |
| `weights_source` (text) | `manual` \| `auto` \| `blended` |
| `last_rebuilt_at`, `updated_at` |

RLS: operator-only writes; dealers read own.

## 2. Auto-summary edge function — `rebuild-dealer-intelligence`

- Inputs: `account_id` (or all)
- Pulls last 24mo of `vehicle_sales_truth` for that account
- Buckets by `make` and `make|model`:
  - **Winners**: ≥3 sales, avg margin ≥ $2k, avg days_to_clear ≤ 45 → weight 1.3–1.8 (scaled by margin & velocity)
  - **Avoid**: ≥2 sales, avg margin ≤ $500 OR days_to_clear ≥ 90 → weight 0.3–0.7
  - **Neutral**: everything else stays 1.0
- Writes `auto_summary` + (if `weights_source = 'auto'`) `weights`
- Triggered: (a) on every successful sales upload (existing `dealer-sales-merge` hook), (b) nightly cron, (c) operator "Rebuild" button

## 3. Scorer integration — `score-operator-opportunities`

- Load `dealer_intelligence_profiles.weights` per account at run start (cached per run)
- For each candidate listing, after computing base `expected_margin`:
  ```
  weight = weights.MAKE_MODEL["MAKE|MODEL"] ?? weights.MAKE["MAKE"] ?? 1.0
  weighted_margin = expected_margin * weight
  ```
- Use `weighted_margin` for tiering and ranking (CODE_RED/HIGH/BUY/WATCH thresholds unchanged)
- Persist `applied_weight` + `weighted_margin` columns on `operator_opportunities` for transparency
- Avoid-list (weight < 0.5) does **not** hard-exclude — it just demotes (per your "weight multiplier" choice)

## 4. UI — operator dealer management

New page: **/operator/dealer-intelligence/:accountId** (also linkable from DealerManagementPage and Trading Desk dealer row).

Two-column layout:
- **Left**: Markdown editor for `master_brief_md` (paste your Patrick Auto doc here). Save button.
- **Right**: Auto-summary card — Winners list, Avoid list, niches, KPIs. "Rebuild now" button.
- **Bottom**: Weights table — editable; toggle `weights_source` between Manual / Auto / Blended (blended = max of auto vs manual per key).

On Trading Desk opportunity rows, show a small chip when `applied_weight ≠ 1.0` (e.g. "×1.6 winner" green / "×0.4 avoid" amber).

## 5. Patrick Auto seed

After deploy, you can paste the doc you mentioned into Patrick's profile via the new UI — nothing hardcoded in code.

## Technical notes

- All operator-only writes; uses existing `OperatorGuard`
- Weights JSON shape kept tiny so per-run lookup is O(1)
- Backwards compatible: missing profile = weight 1.0 everywhere, scoring unchanged
- Memory: will add `mem://features/operator/dealer-intelligence-profiles-v1` so this remains the canonical pattern (no parallel dealer-weighting systems)

## Files

- migration: create `dealer_intelligence_profiles` + 2 cols on `operator_opportunities`
- `supabase/functions/rebuild-dealer-intelligence/index.ts` (new)
- `supabase/functions/score-operator-opportunities/index.ts` (weight integration)
- `supabase/functions/dealer-sales-merge/index.ts` (trigger rebuild after merge)
- `src/pages/operator/DealerIntelligenceProfilePage.tsx` (new)
- `src/components/operator/DealerWeightsEditor.tsx` (new)
- route + link from DealerManagementPage and Trading Desk
