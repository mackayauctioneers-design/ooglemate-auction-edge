
# Replace Lindy with internal Star Watch worker

## Goal
Keep every downstream behaviour (`operator_opportunities`, `outward_jobs`, `outward_search_results`, `scoreListingsForDealer`, Hunts, Trading Desk, alerts) — but cut Lindy + Gmail SMTP out of the starred-vehicle path.

## Architecture (after change)

```text
useStarVehicle.ts
        │  (fresh insert only)
        ▼
star-watch-dispatch  (NEW edge fn)
   ├─ load listing from vehicle_listings
   ├─ insert outward_jobs row (source_key='star_watch', status='dispatched')
   └─ insert star_watch_jobs row (status='queued')

star-watch-runner    (NEW cron edge fn, every 1 min)
   └─ claims N queued jobs (FOR UPDATE SKIP LOCKED via RPC)
        └─ invokes worker-star-watch-browser per job

worker-star-watch-browser  (NEW edge fn)
   ├─ fetch listing URL (source-aware parser)
   ├─ detect status: active | sold | removed | blocked
   ├─ extract: title, price, km, year, state, seller, source_id, notes
   └─ POST normalized payload → ingestStarWatchResult() (shared helper)

_shared/star-watch/ingest.ts  (NEW, extracted from lindy-results-webhook)
   ├─ validateListings()
   ├─ filterDeadListings()
   ├─ write outward_search_results
   ├─ update outward_jobs (complete / failed / blocked / removed)
   └─ scoreListingsForDealer()  ← unchanged downstream
```

`lindy-results-webhook` stays mounted for backward compatibility but its body becomes a thin wrapper around the new `ingestStarWatchResult` helper.

## Files

### Create
- `supabase/functions/star-watch-dispatch/index.ts`
- `supabase/functions/star-watch-runner/index.ts` (cron-driven dispatcher)
- `supabase/functions/worker-star-watch-browser/index.ts`
- `supabase/functions/_shared/star-watch/ingest.ts` (shared helper)
- `supabase/functions/_shared/star-watch/parsers.ts` (per-source extractors: carsales, autotrader, gumtree, pickles, grays, generic dealer)
- SQL migration: `star_watch_jobs` table + `claim_next_star_watch_jobs(_limit int)` RPC + cron schedule

### Edit
- `src/hooks/useStarVehicle.ts` → invoke `star-watch-dispatch` instead of `lindy-star-watch`
- `supabase/functions/lindy-results-webhook/index.ts` → delegate to shared `ingestStarWatchResult` (no behaviour change for existing Lindy posts during cutover)

### Leave untouched
- `lindy-star-watch` function (kept deployed for one release as fallback, deleted in follow-up)
- `watch-scan`, `refresh-watch-statuses`, `scoreListingsForDealer`, `outward_jobs`, `outward_search_results`, `operator_opportunities`

## SQL migration

```sql
create table public.star_watch_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique,
  listing_id text not null,
  listing_url text not null,
  source text,
  status text not null default 'queued'
    check (status in ('queued','running','complete','failed','blocked','removed')),
  attempt_count int not null default 0,
  last_error text,
  debug_artifact text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  locked_at timestamptz,
  locked_by text
);
create index on public.star_watch_jobs (status, created_at);

alter table public.star_watch_jobs enable row level security;
create policy "service role only" on public.star_watch_jobs for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create or replace function public.claim_next_star_watch_jobs(_limit int default 5, _locked_by text default 'star-watch-runner')
returns setof public.star_watch_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select id from public.star_watch_jobs
    where status = 'queued'
       or (status = 'running' and locked_at < now() - interval '5 minutes')
    order by created_at
    for update skip locked
    limit _limit
  )
  update public.star_watch_jobs j
     set status='running', locked_at=now(), locked_by=_locked_by,
         attempt_count=j.attempt_count+1, started_at=coalesce(j.started_at, now())
   from picked where j.id = picked.id
   returning j.*;
end $$;

-- pg_cron
select cron.schedule('star-watch-runner','*/1 * * * *',
  $$ select net.http_post(
    url := 'https://xznchxsbuwngfmwvsvhq.functions.supabase.co/star-watch-runner',
    headers := '{"Content-Type":"application/json"}'::jsonb
  ) $$);
```

## Worker implementation notes

- Uses `fetch()` with realistic UA — no headless Chrome needed for Day-1 (Carsales/Autotrader/Gumtree all expose enough HTML/JSON-LD for status + price + km).
- Status decision tree: HTTP 404/410 → `removed`; body matches `REMOVED_PATTERNS` (already in webhook) → `removed`; body contains "SOLD"/"under offer" markers → `sold`; Cloudflare/captcha markers → `blocked` (capture body snippet to `debug_artifact`); else `active`.
- Source detection by URL hostname. Each parser returns `{ title, price_aud, odometer_km, year, state, seller_name, source_id, condition_notes }`. Parsers extract from `<script type="application/ld+json">` first, fall back to regex.
- Respects 110 s `TIME_BUDGET_MS`: runner processes max ~8 jobs per tick, worker has 25 s per fetch.
- Retries: `failed` jobs with `attempt_count < 3` are re-claimed by the cron after 5 min; `blocked` jobs retry up to 5×; `removed`/`complete` are terminal.

## Frontend change

```ts
// useStarVehicle.ts — only the dispatch call changes
supabase.functions.invoke('star-watch-dispatch', { body: { listing_id: lid } })
```

Star toggle on/off and "fresh insert only" semantics preserved. Documented quirk: re-starring an existing un-starred row currently does NOT re-dispatch (fresh insert only). Keep behaviour, add a code comment so it isn't mistaken for a bug.

## Failure handling
- Worker never throws to UI — all errors land in `star_watch_jobs.last_error` and mirrored in `outward_jobs.status`.
- Dealer-facing surfaces continue reading from `outward_search_results` / fingerprint matches only — they never see `star_watch_jobs` directly.
- Operator debug: new operator route can be added later (out of scope) to inspect `star_watch_jobs`.

## Compatibility notes
- `lindy-results-webhook` stays callable; any in-flight Lindy emails after deploy still land cleanly.
- `outward_jobs.source_key = 'star_watch'` unchanged — Trading Desk/My Hunts/Hunt Matches queries untouched.
- `scoreListingsForDealer` invoked with the same payload shape as today.

## Risks / assumptions
- **Risk:** Some sources (Pickles auctions, dealer JS-rendered sites) won't yield clean data from pure `fetch`. Mitigation: parsers return `status='active'` + partial fields; downstream scoring already tolerates nulls.
- **Risk:** Cloudflare on Carsales may return `blocked` more often than Lindy did. Mitigation: retry budget + UA rotation; if persistent, follow-up ticket to route blocked jobs to an external headless browser (Browserless/Apify) using the same worker contract.
- **Assumption:** `pg_cron` + `pg_net` already enabled (other crons in repo prove this).
- **Assumption:** No RLS read needed on `star_watch_jobs` from the client.

## Unclear in current code (flagged, not changed)
- `useStarVehicle.ts` dispatches Lindy only on **insert**, not on un-star→re-star. Intentional but undocumented. Will add comment.
- `lindy-results-webhook` does a constant-time compare against a static secret rather than HMAC. Keeping same model for `worker-star-watch-browser` → ingest path (internal-only invoke, service role).

## Deliverables order
1. Migration (star_watch_jobs + RPC + cron)
2. `_shared/star-watch/ingest.ts` + `parsers.ts`
3. `star-watch-dispatch`, `star-watch-runner`, `worker-star-watch-browser`
4. `useStarVehicle.ts` switch
5. Refactor `lindy-results-webhook` to delegate to shared helper
