-- Carbitrage canonical schema.
-- Executed by server/carbitrage/rls.integration.test.ts against a disposable
-- local Postgres on 127.0.0.1 only.
-- Do not apply this file to the linked Supabase project. Do not copy it into
-- supabase/migrations. It creates only carbitrage_* objects plus a local
-- auth.uid() compatible with Supabase's JWT sub claim.

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'carbitrage_ingest') then
    create role carbitrage_ingest nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'carbitrage_app') then
    create role carbitrage_app nologin nosuperuser nobypassrls noinherit;
  end if;
end $$;

grant authenticated to carbitrage_app;
grant carbitrage_ingest to carbitrage_app;
grant anon to carbitrage_app;
grant usage on schema auth to authenticated, carbitrage_ingest, anon, carbitrage_app;
grant execute on function auth.uid() to authenticated, carbitrage_ingest, anon, carbitrage_app;

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

create table if not exists carbitrage_profiles (
  user_id uuid primary key,
  email text not null unique,
  display_name text not null,
  password_hash text,
  password_salt text
);

create table if not exists carbitrage_api_keys (
  id text primary key,
  user_id uuid not null,
  token_hash text not null unique,
  label text not null,
  created_at timestamptz not null
);

create table if not exists carbitrage_ingest_principals (
  id text primary key,
  name text not null,
  token_hash text not null unique
);

create table if not exists carbitrage_ingest_grants (
  principal_id text not null references carbitrage_ingest_principals (id),
  yard_id text not null references carbitrage_yards (id),
  primary key (principal_id, yard_id)
);

create table if not exists carbitrage_public_facts (
  id text primary key,
  document jsonb not null
);

create table if not exists carbitrage_opportunities (
  id text primary key,
  document jsonb not null,
  dedupe_key text generated always as (document ->> 'dedupeKey') stored,
  yard_id text generated always as (document ->> 'yardId') stored references carbitrage_yards (id),
  unique (dedupe_key)
);

create table if not exists carbitrage_sales (
  id text primary key,
  document jsonb not null,
  dedupe_key text generated always as (document ->> 'dedupeKey') stored,
  yard_id text generated always as (document ->> 'yardId') stored references carbitrage_yards (id),
  unique (yard_id, dedupe_key)
);

create table if not exists carbitrage_mandates (
  id text primary key,
  document jsonb not null,
  yard_id text generated always as (document ->> 'yardId') stored references carbitrage_yards (id)
);

create table if not exists carbitrage_alerts (
  id text primary key,
  document jsonb not null,
  yard_id text generated always as (document ->> 'yardId') stored references carbitrage_yards (id),
  opportunity_id text generated always as (document ->> 'opportunityId') stored,
  kind text generated always as (document ->> 'kind') stored,
  unique (opportunity_id, kind)
);

create table if not exists carbitrage_ingest_receipts (
  dedupe_key text primary key,
  document jsonb not null,
  yard_id text generated always as (document ->> 'yardId') stored references carbitrage_yards (id)
);

create or replace function carbitrage_workflow_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    if (new.document - 'status' - 'watchlisted') is distinct from (old.document - 'status' - 'watchlisted') then
      raise exception 'workflow_columns_only' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists carbitrage_opportunities_workflow on carbitrage_opportunities;
create trigger carbitrage_opportunities_workflow
  before update on carbitrage_opportunities
  for each row execute function carbitrage_workflow_guard();

alter table carbitrage_yards enable row level security;
alter table carbitrage_memberships enable row level security;
alter table carbitrage_profiles enable row level security;
alter table carbitrage_api_keys enable row level security;
alter table carbitrage_ingest_principals enable row level security;
alter table carbitrage_ingest_grants enable row level security;
alter table carbitrage_public_facts enable row level security;
alter table carbitrage_opportunities enable row level security;
alter table carbitrage_sales enable row level security;
alter table carbitrage_mandates enable row level security;
alter table carbitrage_alerts enable row level security;
alter table carbitrage_ingest_receipts enable row level security;

alter table carbitrage_yards force row level security;
alter table carbitrage_memberships force row level security;
alter table carbitrage_profiles force row level security;
alter table carbitrage_api_keys force row level security;
alter table carbitrage_ingest_principals force row level security;
alter table carbitrage_ingest_grants force row level security;
alter table carbitrage_public_facts force row level security;
alter table carbitrage_opportunities force row level security;
alter table carbitrage_sales force row level security;
alter table carbitrage_mandates force row level security;
alter table carbitrage_alerts force row level security;
alter table carbitrage_ingest_receipts force row level security;

revoke all on table carbitrage_yards from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_memberships from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_profiles from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_api_keys from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_ingest_principals from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_ingest_grants from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_public_facts from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_opportunities from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_sales from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_mandates from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_alerts from public, anon, authenticated, carbitrage_ingest;
revoke all on table carbitrage_ingest_receipts from public, anon, authenticated, carbitrage_ingest;

grant select on table carbitrage_yards to authenticated, carbitrage_ingest;
grant select on table carbitrage_memberships to authenticated;
grant select (user_id, email, display_name) on table carbitrage_profiles to authenticated;
grant select, insert, update on table carbitrage_opportunities to carbitrage_ingest;
grant select, update on table carbitrage_opportunities to authenticated;
grant select, insert, update on table carbitrage_sales to authenticated;
grant select, insert, update on table carbitrage_mandates to authenticated;
grant select on table carbitrage_mandates to carbitrage_ingest;
grant select, update on table carbitrage_alerts to authenticated;
grant select, insert on table carbitrage_alerts to carbitrage_ingest;
grant select, insert, update on table carbitrage_ingest_receipts to carbitrage_ingest;
grant select on table carbitrage_ingest_grants to carbitrage_ingest;
grant select on table carbitrage_public_facts to authenticated;
grant insert on table carbitrage_api_keys to authenticated;

drop policy if exists carbitrage_yards_select on carbitrage_yards;
create policy carbitrage_yards_select on carbitrage_yards
  for select to authenticated
  using (id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_yards_ingest on carbitrage_yards;
create policy carbitrage_yards_ingest on carbitrage_yards
  for select to carbitrage_ingest
  using (id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_memberships_select on carbitrage_memberships;
create policy carbitrage_memberships_select on carbitrage_memberships
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists carbitrage_profiles_select on carbitrage_profiles;
create policy carbitrage_profiles_select on carbitrage_profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists carbitrage_opportunities_select on carbitrage_opportunities;
create policy carbitrage_opportunities_select on carbitrage_opportunities
  for select to authenticated
  using (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_opportunities_update on carbitrage_opportunities;
create policy carbitrage_opportunities_update on carbitrage_opportunities
  for update to authenticated
  using (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()))
  with check (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_opportunities_ingest_select on carbitrage_opportunities;
create policy carbitrage_opportunities_ingest_select on carbitrage_opportunities
  for select to carbitrage_ingest
  using (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_opportunities_ingest_write on carbitrage_opportunities;
create policy carbitrage_opportunities_ingest_write on carbitrage_opportunities
  for insert to carbitrage_ingest
  with check (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_opportunities_ingest_update on carbitrage_opportunities;
create policy carbitrage_opportunities_ingest_update on carbitrage_opportunities
  for update to carbitrage_ingest
  using (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ))
  with check (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_sales_all on carbitrage_sales;
create policy carbitrage_sales_all on carbitrage_sales
  for all to authenticated
  using (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()))
  with check (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_mandates_user on carbitrage_mandates;
create policy carbitrage_mandates_user on carbitrage_mandates
  for all to authenticated
  using (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()))
  with check (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_mandates_ingest on carbitrage_mandates;
create policy carbitrage_mandates_ingest on carbitrage_mandates
  for select to carbitrage_ingest
  using (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_alerts_user on carbitrage_alerts;
create policy carbitrage_alerts_user on carbitrage_alerts
  for select to authenticated
  using (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_alerts_user_update on carbitrage_alerts;
create policy carbitrage_alerts_user_update on carbitrage_alerts
  for update to authenticated
  using (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()))
  with check (yard_id in (select m.yard_id from carbitrage_memberships m where m.user_id = auth.uid()));

drop policy if exists carbitrage_alerts_ingest on carbitrage_alerts;
create policy carbitrage_alerts_ingest on carbitrage_alerts
  for select to carbitrage_ingest
  using (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_alerts_ingest_insert on carbitrage_alerts;
create policy carbitrage_alerts_ingest_insert on carbitrage_alerts
  for insert to carbitrage_ingest
  with check (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_receipts_ingest on carbitrage_ingest_receipts;
create policy carbitrage_receipts_ingest on carbitrage_ingest_receipts
  for all to carbitrage_ingest
  using (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ))
  with check (yard_id in (
    select g.yard_id from carbitrage_ingest_grants g
    where g.principal_id = current_setting('carbitrage.principal_id', true)
  ));

drop policy if exists carbitrage_grants_ingest on carbitrage_ingest_grants;
create policy carbitrage_grants_ingest on carbitrage_ingest_grants
  for select to carbitrage_ingest
  using (principal_id = current_setting('carbitrage.principal_id', true));

drop policy if exists carbitrage_facts_read on carbitrage_public_facts;
create policy carbitrage_facts_read on carbitrage_public_facts
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists carbitrage_keys_insert on carbitrage_api_keys;
create policy carbitrage_keys_insert on carbitrage_api_keys
  for insert to authenticated
  with check (user_id = auth.uid());

create or replace function carbitrage_demo_password(p_email text)
returns table(user_id uuid, password_hash text, password_salt text, display_name text)
language sql
security definer
set search_path = public
as $$
  select user_id, password_hash, password_salt, display_name
  from carbitrage_profiles
  where lower(email) = lower(p_email)
$$;

create or replace function carbitrage_lookup_api_key(p_hash text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select user_id from carbitrage_api_keys where token_hash = p_hash
$$;

create or replace function carbitrage_lookup_ingest(p_hash text)
returns table(principal_id text, yard_id text)
language sql
security definer
set search_path = public
as $$
  select p.id, g.yard_id
  from carbitrage_ingest_principals p
  join carbitrage_ingest_grants g on g.principal_id = p.id
  where p.token_hash = p_hash
$$;

revoke all on function carbitrage_demo_password(text) from public;
revoke all on function carbitrage_lookup_api_key(text) from public;
revoke all on function carbitrage_lookup_ingest(text) from public;
grant execute on function carbitrage_demo_password(text) to carbitrage_app;
grant execute on function carbitrage_lookup_api_key(text) to carbitrage_app;
grant execute on function carbitrage_lookup_ingest(text) to carbitrage_app;
