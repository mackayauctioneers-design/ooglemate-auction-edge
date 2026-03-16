

## Plan: Build Out OogleBot Background Runner

### Current State
- **Create Job form** saves to `ooglebot_jobs` table (dealer name, make/model/year/km/budget/urgency, 7-day expiry)
- **`ooglebot-scan` edge function** already exists and works: queries `vehicle_listings` + `retail_listings`, calculates effective cost, stores cheapest 3 as `ooglebot_matches`
- **Missing**: No cron schedule — the scan function is never called automatically. No UI to see job results.

### What Needs to Happen

**1. Schedule `ooglebot-scan` via pg_cron**
- Run every 30 minutes (frequent enough for urgency, light enough to not overload)
- Uses existing `pg_cron` + `pg_net` pattern already in the project
- SQL: `cron.schedule('ooglebot-scan-30min', '*/30 * * * *', ...)` calling the edge function URL

**2. Add urgency-based scan frequency**
- Enhance `ooglebot-scan` to run urgent jobs more aggressively:
  - `urgent` jobs: always scanned
  - `high` jobs: scanned every run
  - `normal` jobs: scanned if `last_match_at` is older than 2 hours (skip if recently scanned)

**3. Show Active Jobs + Matches on OogleBot page**
- Restore a compact job list below the Create Job form showing active jobs with status badges
- Each job row shows: make/model, dealer, urgency, last match time, match count
- Expandable detail: top 3 matches with price, source, location, link, star button
- Jobs can be paused/resumed/fulfilled from the list

**4. Wire star button into match results**
- Match results use the existing `useStarVehicle` hook so starred matches flow to Trading Desk

### Technical Details

- **Cron SQL** (non-migration, uses project-specific URL + anon key):
  ```sql
  SELECT cron.schedule(
    'ooglebot-scan-30min',
    '*/30 * * * *',
    $$
    SELECT net.http_post(
      url:='https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/ooglebot-scan',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer <anon_key>"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
    $$
  );
  ```

- **Edge function updates** (`ooglebot-scan/index.ts`):
  - Add urgency-based skip logic
  - Add `market_listings` as a third source table (auction inventory)
  - Log scan telemetry (jobs scanned, matches found, duration)

- **New component** `OogleBotJobList.tsx`:
  - Compact card list of active jobs
  - Expandable match detail per job
  - Status toggle buttons (pause/resume/fulfill)
  - Star button on each match result

- **Page layout** (`OogleBotPage.tsx`):
  - Left column: Create Job form + Job List (full width)
  - Right column: Search panel

### Files Changed
1. `supabase/functions/ooglebot-scan/index.ts` — urgency logic, market_listings source, telemetry
2. `src/components/ooglebot/OogleBotJobList.tsx` — new component for job list + matches
3. `src/pages/operator/OogleBotPage.tsx` — restore job list in layout
4. Database: pg_cron schedule (via insert tool, not migration)

