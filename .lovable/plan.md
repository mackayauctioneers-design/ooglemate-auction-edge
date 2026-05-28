## Goal

Carbitrage today only matches a listing to a dealer when their **sales history** supports it (Sales-Truth lane). This misses obvious natural buyers — e.g. a well-below-market Subaru Outback should ping Patrick Automotive (a Subaru franchise dealer) even with zero Outback sales history.

We add a second lane — **Strategic Dealer Fit** — driven by dealer identity (franchise, brands, location, specialty), and fuse both lanes into one composite score.

## What changes

### 1. Dealer identity profile (schema)

Extend `dealer_profiles` with the natural-buyer fields:

- `franchise_brand` text — e.g. "Subaru", null for independents
- `preferred_brands` text[] — brands they consistently retail
- `dealership_category` text — `franchise | used_specialist | prestige | wholesale | independent`
- `specialist_categories` text[] — e.g. `["4x4", "european_prestige", "family_suv"]`
- `location_state` text, `location_suburb` text, `location_postcode` text
- `natural_buyer_notes` text — operator-editable
- `strategic_profile_updated_at` timestamptz

New table `dealer_stock_mix` (rolled up from live inventory + sales): `dealer_id, make, model_count, share_pct, last_computed_at`.

### 2. Strategic fit scorer

New SQL function `compute_strategic_fit(dealer_id uuid, make text, model text, body text)` → returns `{score 0-100, reason text, signals jsonb}`.

Signal weights:
- Franchise brand match (Subaru dealer + Subaru car) → +40, reason "Franchise dealer for this brand"
- Preferred brand match → +25
- Specialist category match (e.g. Outback → family_suv) → +15
- Same state → +10, same metro → +15
- Existing stock mix concentration in this make ≥ 15% → +15
- Active mandate covering this make/model → +20
- Penalty: dealership_category = wholesale and car is retail-only → -20

Cap at 100. Score ≥ 60 = HIGH, 35–59 = MEDIUM, <35 = LOW (no lane).

### 3. Opportunity record changes

Add to `operator_opportunities`:

- `strategic_fit_score` int
- `strategic_fit_reason` text
- `strategic_fit_signals` jsonb
- `match_lane` text — `sales_truth | strategic_fit | both`
- `recommended_dealer_id` uuid (FK accounts) — best dealer across BOTH lanes
- `recommended_dealer_reason` text
- `composite_score` numeric — fused score used for ranking

### 4. Composite scoring

Rewrite ranking inside `score-operator-opportunities`:

```
composite =
   0.30 * market_value_gap_score    (existing under_buy / retail_vs_ask)
 + 0.20 * realistic_net_margin_score
 + 0.20 * sales_truth_fit_score     (existing fingerprint match)
 + 0.15 * strategic_fit_score
 + 0.10 * source_confidence
 + 0.05 * turnability_confidence    (days-to-sell from sales truth or median)
```

If `sales_truth_fit_score == 0` but `strategic_fit_score >= 60` and market gap is strong → still emit opportunity with `match_lane='strategic_fit'`, tier capped at HIGH (not BUY) until a human confirms.

`recommended_dealer_id` = argmax(composite) across all dealers in the network for that listing. `match_lane='both'` when the same dealer wins on both lanes.

### 5. Operator UI

- Trading Desk row: add a small **lane chip** (`SALES TRUTH` / `STRATEGIC FIT` / `BOTH`) and a tooltip showing `strategic_fit_reason`.
- Dealer Master Profile (Patrick page): new **Strategic Profile** card — edit franchise_brand, preferred_brands, dealership_category, specialist_categories, location. This is what teaches the system who the natural buyer is.

### 6. Patrick backfill

Seed Patrick Auto Group with `franchise_brand='Subaru'`, `dealership_category='franchise'`, `preferred_brands=['Subaru']`, `location_state='NSW'`, `location_suburb='Port Macquarie'` so the Outback example fires immediately.

## Out of scope (explicit)

- No hardcoding of any dealer in code — Patrick is seeded via data only.
- No change to Sales-Truth fingerprint engine itself.
- No change to alert dispatch pipeline (alerts will naturally pick up the new lane via the same `operator_opportunities` table).

## Technical notes

- Pure additive migration; existing rows get `strategic_fit_score = 0`, `match_lane='sales_truth'` so current behaviour is preserved.
- Scorer change is a single edge function edit (`score-operator-opportunities`) — adds a second pass that computes strategic fit per (listing × dealer) and merges into the existing per-listing best-account selection.
- `compute_strategic_fit` lives in SQL so the scorer, dealer dashboard, and any future Bob tool can all call it.

## Deliverables

1. Migration: new dealer_profiles columns, `dealer_stock_mix`, opportunity columns, `compute_strategic_fit` function.
2. Patrick data seed.
3. `score-operator-opportunities` rewrite for composite + strategic lane.
4. Operator UI: lane chip on Trading Desk; Strategic Profile editor on Dealer Master Profile.
