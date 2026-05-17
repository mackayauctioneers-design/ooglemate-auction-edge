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
create index star_watch_jobs_status_created_idx on public.star_watch_jobs (status, created_at);
create index star_watch_jobs_listing_idx on public.star_watch_jobs (listing_id);

alter table public.star_watch_jobs enable row level security;

create policy "star_watch_jobs service role all"
  on public.star_watch_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.claim_next_star_watch_jobs(
  _limit int default 5,
  _locked_by text default 'star-watch-runner'
)
returns setof public.star_watch_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select id
      from public.star_watch_jobs
     where status = 'queued'
        or (status = 'running' and locked_at < now() - interval '5 minutes')
     order by created_at
     for update skip locked
     limit _limit
  )
  update public.star_watch_jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = _locked_by,
         attempt_count = j.attempt_count + 1,
         started_at = coalesce(j.started_at, now())
    from picked
   where j.id = picked.id
   returning j.*;
end;
$$;