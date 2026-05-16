create extension if not exists pgcrypto;

create table if not exists public.tasks (
  task_id uuid primary key default gen_random_uuid(),
  task_type text not null,
  title text not null,
  source text not null,
  priority text not null check (priority in ('P0','P1','P2','P3')),
  assigned_worker text,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (
    status in ('pending','assigned','running','waiting','succeeded','failed','retrying','needs_human','cancelled')
  ) default 'pending',
  dedupe_key text,
  merge_key text,
  created_at timestamptz not null default now(),
  scheduled_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count int not null default 0,
  max_retries int not null default 3,
  retry_delay_seconds int not null default 300,
  escalation_rule text,
  human_review_condition text,
  error_message text,
  result_summary text,
  logs_url text,
  log_reference text,
  parent_task_id uuid references public.tasks(task_id),
  related_entity_type text,
  related_entity_id text,
  last_heartbeat_at timestamptz,
  last_log_message text
);

create index if not exists idx_tasks_status_priority_sched on public.tasks(status, priority, scheduled_at);
create index if not exists idx_tasks_type_status on public.tasks(task_type, status);
create unique index if not exists idx_tasks_dedupe_active
  on public.tasks(dedupe_key)
  where dedupe_key is not null
    and status in ('pending','assigned','running','waiting','retrying');

create table if not exists public.task_runs (
  run_id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(task_id) on delete cascade,
  worker_name text not null,
  worker_category text not null,
  attempt_no int not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null,
  duration_ms bigint,
  error_message text,
  result_summary text,
  logs_ref text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists idx_task_runs_task_id on public.task_runs(task_id);

create table if not exists public.task_logs (
  log_id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(task_id) on delete cascade,
  run_id uuid references public.task_runs(run_id) on delete cascade,
  ts timestamptz not null default now(),
  level text not null check (level in ('debug','info','warn','error')),
  message text not null,
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_task_logs_task_ts on public.task_logs(task_id, ts desc);

create table if not exists public.workers (
  worker_name text primary key,
  worker_category text not null check (
    worker_category in ('watcher','browser','data','reasoning','exception','human')
  ),
  enabled boolean not null default true,
  concurrency_limit int not null,
  heartbeat_timeout_seconds int not null default 300,
  last_heartbeat_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  avg_run_ms bigint default 0,
  status text not null default 'idle',
  capabilities jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb
);

create table if not exists public.worker_locks (
  lock_key text primary key,
  worker_name text not null,
  task_id uuid references public.tasks(task_id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  task_type text not null,
  cron_expr text,
  interval_seconds int,
  next_run_at timestamptz,
  enabled boolean not null default true,
  payload_template jsonb not null default '{}'::jsonb,
  priority text not null default 'P2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.human_reviews (
  review_id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(task_id) on delete cascade,
  reason text not null,
  review_payload jsonb not null default '{}'::jsonb,
  decision text,
  decided_by text,
  decided_at timestamptz,
  notes text
);

insert into public.workers (worker_name, worker_category, concurrency_limit, capabilities, config)
values
  ('worker-heartbeat-check', 'watcher', 10, '["heartbeat","cron","freshness","polling"]'::jsonb, '{}'::jsonb),
  ('worker-browser-generic', 'browser', 2, '["upload","login","portal","browser"]'::jsonb, '{}'::jsonb),
  ('worker-data-generic', 'data', 5, '["parse","merge","dedupe","vin","rego","database_update"]'::jsonb, '{}'::jsonb),
  ('agent-reasoning-generic', 'reasoning', 1, '["ambiguity","analysis","decision"]'::jsonb, '{"allow_opencore": true}'::jsonb),
  ('agent-exception-diagnosis-placeholder', 'exception', 1, '["exception_diagnosis"]'::jsonb, '{"allow_opencore": true}'::jsonb),
  ('human-review-gate', 'human', 1, '["human_review"]'::jsonb, '{}'::jsonb)
on conflict (worker_name) do update set
  worker_category = excluded.worker_category,
  concurrency_limit = excluded.concurrency_limit,
  capabilities = excluded.capabilities,
  config = excluded.config;

create or replace view public.ops_active_tasks as
select t.task_id, t.task_type, t.title, t.priority, t.assigned_worker, t.status,
  t.created_at, t.started_at, t.last_heartbeat_at, t.last_log_message,
  extract(epoch from (now() - coalesce(t.started_at, t.created_at)))::bigint as age_seconds
from public.tasks t
where t.status in ('pending','assigned','running','waiting','retrying');

create or replace view public.ops_worker_health as
select w.worker_name, w.worker_category, w.enabled, w.status, w.concurrency_limit,
  w.last_heartbeat_at, w.last_success_at, w.last_failure_at, w.avg_run_ms,
  coalesce(rt.running_count, 0) as running_count,
  coalesce(qt.queued_count, 0) as queued_count
from public.workers w
left join (
  select assigned_worker, count(*) as running_count from public.tasks
  where status = 'running' group by assigned_worker
) rt on rt.assigned_worker = w.worker_name
left join (
  select assigned_worker, count(*) as queued_count from public.tasks
  where status in ('pending','assigned','retrying','waiting') group by assigned_worker
) qt on qt.assigned_worker = w.worker_name;

-- Lock everything down: RLS enabled with NO policies = only service_role can access.
-- Edge functions use service role; dashboard reads will go through an operator-gated edge function later.
alter table public.tasks enable row level security;
alter table public.task_runs enable row level security;
alter table public.task_logs enable row level security;
alter table public.workers enable row level security;
alter table public.worker_locks enable row level security;
alter table public.schedules enable row level security;
alter table public.human_reviews enable row level security;