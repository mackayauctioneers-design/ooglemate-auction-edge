
create table if not exists outward_browse_queue (
  id              uuid        primary key default gen_random_uuid(),
  search_run_id   uuid        not null,
  job_id          uuid        not null,
  source          text        not null,
  page            int         not null default 1,
  url             text        not null,
  prompt          text        not null,
  status          text        not null default 'pending',
  attempt_count   int         not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  dispatched_at   timestamptz,
  completed_at    timestamptz
);

-- Claim query index — most critical
create index idx_browse_queue_status_created
  on outward_browse_queue (status, created_at)
  where status = 'pending';

-- Observability indexes
create index idx_browse_queue_search_run
  on outward_browse_queue (search_run_id);

create index idx_browse_queue_source
  on outward_browse_queue (source, status);

create index idx_browse_queue_job
  on outward_browse_queue (job_id);

-- Sweeper index — find stale dispatched rows
create index idx_browse_queue_dispatched_at
  on outward_browse_queue (dispatched_at)
  where status = 'dispatched';

-- RLS
alter table outward_browse_queue enable row level security;

-- Service role full access (edge functions)
create policy "Service role full access on outward_browse_queue"
  on outward_browse_queue for all
  using (true)
  with check (true);

comment on table outward_browse_queue is
  'Page-level browse tasks. Engine inserts, Lindy agent claims and processes, webhook finalises.';
