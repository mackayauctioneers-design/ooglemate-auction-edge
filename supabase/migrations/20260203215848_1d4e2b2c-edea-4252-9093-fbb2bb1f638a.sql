-- -------------------------------------------------------------------
-- DETAIL INGEST QUEUE (downstream from human review)
-- -------------------------------------------------------------------
create table if not exists public.detail_ingest_queue (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null,
  source_queue_id uuid not null references public.dealer_url_queue(id) on delete cascade,

  url_canonical text not null,
  domain text not null,
  dealer_slug text not null,

  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),

  priority text not null default 'normal',
  promoted_by text not null default 'auto',

  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,

  unique (source_queue_id)
);

-- Indexes for worker polling
create index if not exists detail_ingest_queue_status_idx
  on public.detail_ingest_queue(status, created_at);

create index if not exists detail_ingest_queue_account_idx
  on public.detail_ingest_queue(account_id, status);

-- -------------------------------------------------------------------
-- PROMOTION TRIGGER FUNCTION
-- -------------------------------------------------------------------
create or replace function public.promote_validated_url()
returns trigger as $$
begin
  -- Only promote on transition to 'validated'
  if new.status = 'validated' and old.status is distinct from 'validated' then
    insert into public.detail_ingest_queue (
      account_id,
      source_queue_id,
      url_canonical,
      domain,
      dealer_slug,
      priority,
      promoted_by
    )
    values (
      new.account_id,
      new.id,
      new.url_canonical,
      new.domain,
      new.dealer_slug,
      new.priority,
      'auto'
    )
    on conflict (source_queue_id) do nothing;
  end if;

  return new;
end;
$$ language plpgsql;

-- -------------------------------------------------------------------
-- ATTACH TRIGGER
-- -------------------------------------------------------------------
drop trigger if exists trg_promote_validated_url on public.dealer_url_queue;

create trigger trg_promote_validated_url
after update of status
on public.dealer_url_queue
for each row
execute function public.promote_validated_url();

-- -------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------
alter table public.detail_ingest_queue enable row level security;

drop policy if exists "detail_ingest_queue_auth_all" on public.detail_ingest_queue;
create policy "detail_ingest_queue_auth_all" on public.detail_ingest_queue
for all to authenticated
using (true)
with check (true);