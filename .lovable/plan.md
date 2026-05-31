# Goal

Onboard a dealer once → fingerprints, strategic profile, mandates, sourcing, and feed items all light up automatically, with no operator intervention and no silent failures.

Right now the Dealer Activation page already shows 9 gates per dealer. The pipeline *exists* — what's missing is **automatic remediation** when a gate doesn't flip green within its expected SLA. Illawarra Toyota only got fixed because a human (you) noticed and pinged Arby.

## What to build

### 1. `dealer-onboard-dispatch` — sanitize the URL before sending

Today we pass whatever `dealer_website` is stored, which is how the `/search/pre-owned?query=Wollongong` URL reached Arby. Add a normalization step that:

- Strips query strings and search/listing paths
- Reduces to the bare origin (`https://www.illawarratoyota.com.au`)
- Logs the original + normalized URL to `worker_runs` for traceability

Arby's registry then takes over and picks the right sitemap. No more "search page sent to auto_detect".

### 2. Persist every dispatch as a `worker_runs` row

Currently dispatch fires and we only know it worked if the callback eventually arrives. Change `dealer-onboard-dispatch` to:

- Insert a `worker_runs` row with `status='dispatched'`, `started_at=now()`, `dealer_id`, `kind='dealer_profile_intake'`, payload
- Update that row to `status='completed'` from `arby-dealer-profile-intake` when the callback lands (match by `dealer_profile_id`)
- Update to `status='failed'` when Arby returns non-2xx or callback reports `status='failed'`

This gives the Activation page real progress data and lets the watchdog (below) detect stuck jobs.

### 3. New cron: `dealer-onboarding-watchdog` (every 15 min)

For each dealer in `dealer_profiles`, check the 9 gates and **automatically take the next action** when a gate has been stuck > its SLA:

| Gate stuck | SLA | Auto-action |
|---|---|---|
| Profile created but no `worker_runs` ever | 5 min | Call `dealer-onboard-dispatch` |
| Dispatched but no callback | 45 min | Re-dispatch (max 3 attempts, then alert) |
| Fingerprints present but no strategic profile | 30 min | Invoke `build-dealer-intelligence-profile` |
| Strategic done but no mandates | 30 min | Invoke `generate-dealer-mandates` |
| Mandates exist but `last_run_at` is null | 60 min | Invoke `run-mandate` for each |
| Sourcing running but 0 feed items in 7d | logged only | Surface on activation page (likely a real-world issue, not a bug) |

After 3 failed dispatch attempts, write a row to a new `onboarding_alerts` table and surface it on the Activation page in red — that's the only point a human gets pulled in.

### 4. Dispatch trigger on profile insert

So Step 3's "Profile created but no `worker_runs`" path basically never fires:

- Add a Postgres trigger on `dealer_profiles` INSERT that calls `pg_net` → `dealer-onboard-dispatch` whenever `dealer_website` is non-null
- This way every new dealer is dispatched within seconds of insertion, no matter how they got created (UI, manual SQL, Westside flow, etc.)

### 5. Activation page — show live progress, not just gates

Small UI addition: each expanded dealer row gets a "Pipeline activity" timeline pulled from `worker_runs` for that `dealer_id`, ordered desc. So you can see at a glance: "dispatched 14:02 → callback received 14:08 → strategic built 14:12 → 4 mandates created 14:13 → 2 feed items 14:21".

When stuck, the timeline tells you exactly where, and the auto-remediation tells you what the watchdog is doing about it.

## Technical notes

**Cron**: `pg_cron` + `pg_net` calling `dealer-onboarding-watchdog` every 15 min. Function uses `TIME_BUDGET_MS=110000` and processes dealers in priority order (ERROR → IN_PROGRESS → NOT_STARTED), skipping ACTIVE ones.

**Idempotency**: Watchdog uses `worker_runs` row count + `started_at` to decide whether to (re)dispatch. Never fires if a `dispatched` row exists < SLA old.

**Retry caps**: Each gate has a max attempt count stored in a new column `worker_runs.attempt_n`. Past the cap, we stop trying and write to `onboarding_alerts` for human review.

**Auth keys**: The Illawarra token mismatch (`arbydealer2026` vs `arbyingest`) is already fixed on Arby's side. We'll add a startup sanity check in `dealer-onboard-dispatch` that pings Arby's health endpoint once per cold start and logs a warning if auth fails — so the next token rotation produces a loud error instead of silent 401s.

## Files to add / change

- `supabase/functions/dealer-onboard-dispatch/index.ts` — URL normalization, worker_runs insert, health-check warning
- `supabase/functions/arby-dealer-profile-intake/index.ts` — update worker_runs to completed/failed
- `supabase/functions/dealer-onboarding-watchdog/index.ts` — **new**, the auto-remediation loop
- `supabase/migrations/...` — `onboarding_alerts` table, `worker_runs.attempt_n` column, profile-insert trigger, pg_cron schedule
- `src/pages/operator/DealerActivationPage.tsx` — add pipeline-activity timeline + `onboarding_alerts` banner

## Out of scope

- Changing Arby's registry / sitemap logic (lives on Arby's side, already fixed)
- Manual operator overrides (the current "redispatch" button stays as a fallback)
- Webhook integration with @Carbitragebot1bot for onboarding events (separate request)
