-- DRAFT. NOT APPLIED.
-- Do not copy this file into supabase/migrations and do not run it against the
-- linked Supabase project. It is the proposed canonical schema for a future
-- non-production database. Runtime isolation in this draft is the server
-- membership check, covered by server/carbitrage/isolation.test.ts.
-- This script only creates carbitrage_* tables. It does not alter existing tables.

create table if not exists carbitrage_yards (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('standalone_franchise', 'group_store', 'ooglecars_addon')),
  group_id text,
  ooglecars_yard_id text,
  region text not null,
  franchise text
);

create table if not exists carbitrage_memberships (
  user_id uuid not null,
  yard_id text not null references carbitrage_yards (id),
  role text not null check (role in ('dealer', 'group_admin')),
  primary key (user_id, yard_id)
);

create table if not exists carbitrage_opportunities (
  id text primary key,
  yard_id text not null references carbitrage_yards (id),
  dedupe_key text not null unique,
  synthetic boolean not null default true,
  source_channel text not null,
  source_url text not null,
  asking_price numeric,
  floor_ex_gov numeric,
  floor_source text,
  floor_as_of date,
  government_charges_excluded boolean not null default true,
  variant_match text not null,
  status text not null,
  watchlisted boolean not null default false,
  source_envelope jsonb not null,
  payload jsonb not null
);

create table if not exists carbitrage_sales (
  id text primary key,
  yard_id text not null references carbitrage_yards (id),
  dedupe_key text not null,
  sold_at timestamptz not null,
  price numeric not null,
  payload jsonb not null,
  unique (yard_id, dedupe_key)
);

create table if not exists carbitrage_mandates (
  id text primary key,
  yard_id text not null references carbitrage_yards (id),
  make text not null,
  model text not null,
  active boolean not null default true,
  derived_from text not null
);

create table if not exists carbitrage_alerts (
  id text primary key,
  yard_id text not null references carbitrage_yards (id),
  opportunity_id text not null references carbitrage_opportunities (id),
  read boolean not null default false,
  payload jsonb not null
);

create table if not exists carbitrage_ingest_receipts (
  dedupe_key text primary key,
  opportunity_id text not null references carbitrage_opportunities (id),
  yard_id text not null references carbitrage_yards (id),
  attempts integer not null
);

alter table carbitrage_yards enable row level security;
alter table carbitrage_memberships enable row level security;
alter table carbitrage_opportunities enable row level security;
alter table carbitrage_sales enable row level security;
alter table carbitrage_mandates enable row level security;
alter table carbitrage_alerts enable row level security;
alter table carbitrage_ingest_receipts enable row level security;

revoke all on table carbitrage_yards from anon;
revoke all on table carbitrage_memberships from anon;
revoke all on table carbitrage_opportunities from anon;
revoke all on table carbitrage_sales from anon;
revoke all on table carbitrage_mandates from anon;
revoke all on table carbitrage_alerts from anon;
revoke all on table carbitrage_ingest_receipts from anon;

-- Membership is the only grant. A group title without a row does not widen access.
create policy carbitrage_yards_select on carbitrage_yards
  for select to authenticated
  using (
    id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

create policy carbitrage_memberships_select on carbitrage_memberships
  for select to authenticated
  using (user_id = auth.uid());

create policy carbitrage_opportunities_select on carbitrage_opportunities
  for select to authenticated
  using (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

create policy carbitrage_opportunities_update on carbitrage_opportunities
  for update to authenticated
  using (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  )
  with check (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

create policy carbitrage_sales_select on carbitrage_sales
  for select to authenticated
  using (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

create policy carbitrage_mandates_select on carbitrage_mandates
  for select to authenticated
  using (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

create policy carbitrage_alerts_select on carbitrage_alerts
  for select to authenticated
  using (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

create policy carbitrage_alerts_update on carbitrage_alerts
  for update to authenticated
  using (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  )
  with check (
    yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid())
  );

-- No authenticated insert/select on ingest receipts.
-- Ingest is a server identity, not a browser role.
