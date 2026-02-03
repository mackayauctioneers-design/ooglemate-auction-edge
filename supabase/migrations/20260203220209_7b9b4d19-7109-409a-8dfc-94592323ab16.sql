-- -------------------------------------------------------------------
-- LISTING DETAILS RAW (forensic snapshot from Jess Walker)
-- -------------------------------------------------------------------
create table if not exists public.listing_details_raw (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null,
  ingest_queue_id uuid not null references public.detail_ingest_queue(id) on delete cascade,

  url_canonical text not null,
  domain text not null,
  dealer_slug text not null,

  http_status int null,
  fetched_at timestamptz not null default now(),

  raw_html text null,
  raw_text text null,
  raw_json jsonb null,

  parse_status text not null default 'fetched'
    check (parse_status in ('fetched','parsed','failed')),

  error text null,

  unique (ingest_queue_id)
);

-- Indexes
create index if not exists listing_details_raw_account_idx
  on public.listing_details_raw(account_id, fetched_at desc);

create index if not exists listing_details_raw_parse_status_idx
  on public.listing_details_raw(parse_status);

-- RLS
alter table public.listing_details_raw enable row level security;

drop policy if exists "listing_details_raw_auth_all" on public.listing_details_raw;
create policy "listing_details_raw_auth_all" on public.listing_details_raw
for all to authenticated
using (true)
with check (true);