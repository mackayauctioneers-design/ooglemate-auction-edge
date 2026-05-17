
create table if not exists public.outward_search_decisions (
  id uuid primary key default gen_random_uuid(),
  search_run_id uuid,
  source text not null,
  layer text not null check (layer in ('internal','shadow','outward')),
  raw jsonb not null,
  normalized jsonb,
  bucket text not null check (bucket in ('exact_match','near_match','ambiguous','rejected')),
  confidence_score numeric,
  rules_fired text[] not null default '{}',
  rejection_reason text,
  ai_assisted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_osd_run on public.outward_search_decisions(search_run_id);
create index if not exists idx_osd_bucket on public.outward_search_decisions(bucket);
create index if not exists idx_osd_created on public.outward_search_decisions(created_at desc);

alter table public.outward_search_decisions enable row level security;

drop policy if exists "operators read decisions" on public.outward_search_decisions;
create policy "operators read decisions"
  on public.outward_search_decisions
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "service writes decisions" on public.outward_search_decisions;
create policy "service writes decisions"
  on public.outward_search_decisions
  for insert
  to service_role
  with check (true);
