-- PREVIEW ONLY. Applied by server/carbitrage/main.ts to the box's disposable local Postgres, never to Supabase.
-- Mirrors the production column names, types, defaults and checks of public.wholesale_tenders, wholesale_bids and
-- wholesale_buyers (read from production, schema only, 20 Nov 2026). Foreign keys to other production tables are left out.
-- Seed rows are clearly labelled test data. No real dealership, buyer contact or car is created here.
-- It also stubs the few other production tables the franchise functions touch (dealerships, dealership_members,
-- dealership_features, wholesale_buyer_alerts, wholesale_notification_log, wholesale_bid_events) so the pending
-- migrations in supabase/pending/ run unchanged here. main.ts applies this file, then those migrations, in preview only.

create schema if not exists private;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create table if not exists wholesale_buyers (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  business_name text not null,
  abn text not null,
  licence_number text not null,
  licence_state text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  makes text[] not null default '{}',
  price_min_cents integer,
  price_max_cents integer,
  min_profit_cents integer,
  min_sell_through_percent integer,
  hide_new_dealers boolean not null default false,
  payment_reliability text not null default 'unmarked',
  pickup_reliability text not null default 'unmarked',
  access_token text,
  notes text,
  ip_hash text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved boolean not null default false,
  active boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  user_id uuid,
  is_placeholder boolean not null default false,
  alert_dealership_id uuid
);

create table if not exists wholesale_tenders (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null,
  vehicle_id uuid,
  public_code text not null unique,
  status text not null check (status in ('pending_dark_web','fast_lane','live','closed','accepted','declined','cancelled')),
  rego text,
  vin text,
  year integer,
  make text,
  model text,
  badge text,
  km integer,
  colour text,
  state text,
  condition jsonb not null default '{}'::jsonb,
  photo_paths text[] not null default '{}',
  reserve_cents integer,
  listed_price_cents integer,
  retail_floor_cents integer,
  valuation_snapshot jsonb,
  duration_minutes integer not null default 120,
  fast_lane_minutes integer,
  dark_web_status text not null default 'not_requested' check (dark_web_status in ('not_requested','pending','approved','rejected')),
  seller_notes text,
  opens_at timestamptz,
  fast_lane_ends_at timestamptz,
  closes_at timestamptz,
  created_by uuid,
  accepted_bid_id uuid,
  buyer_of_record text,
  sale_id uuid,
  customer_id uuid,
  freight_offered boolean not null default false,
  outcome text check (outcome is null or outcome in ('completed','backed_out')),
  best_bid_cents integer,
  final_sale_cents integer,
  gap_bps integer,
  held_up boolean,
  accuracy_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  value_car_floor_cents integer,
  value_car_snapshot jsonb,
  sold_channel text,
  sold_cents integer,
  sold_at timestamptz,
  sold_sale_id uuid,
  trade_figure_cents integer
);

create table if not exists wholesale_bids (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references wholesale_tenders(id),
  bidder_kind text not null check (bidder_kind in ('wholesale_buyer','first_look_yard')),
  buyer_id uuid,
  bidder_dealership_id uuid,
  amount_cents integer not null check (amount_cents > 0),
  kind text not null default 'bid' check (kind in ('bid','offer','buy_now')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((bidder_kind = 'wholesale_buyer' and buyer_id is not null and bidder_dealership_id is null)
      or (bidder_kind = 'first_look_yard' and bidder_dealership_id is not null and buyer_id is null))
);

-- Production's floor guard, copied as read from production.
create or replace function wholesale_require_floor_when_going_live() returns trigger language plpgsql as $$
begin
  if new.status = 'live' and coalesce(new.value_car_floor_cents, 0) <= 0 then
    if tg_op = 'INSERT' or old.status is distinct from 'live' then
      raise exception 'live wholesale request requires a Carbitrage floor';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists wholesale_require_floor_when_going_live on wholesale_tenders;
create trigger wholesale_require_floor_when_going_live before insert or update on wholesale_tenders for each row execute function wholesale_require_floor_when_going_live();

-- One price per buyer per car, as in production.
create unique index if not exists wholesale_bids_one_buyer on wholesale_bids (tender_id, buyer_id) where buyer_id is not null;
create unique index if not exists wholesale_bids_one_yard on wholesale_bids (tender_id, bidder_dealership_id) where bidder_dealership_id is not null;

create table if not exists wholesale_bid_events (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null,
  bid_id uuid not null,
  buyer_id uuid,
  amount_cents integer not null,
  note text,
  created_at timestamptz default now(),
  changed_by uuid
);
create or replace function private.wholesale_bid_events_record() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and new.amount_cents is not distinct from old.amount_cents then return new; end if;
  insert into public.wholesale_bid_events (tender_id, bid_id, buyer_id, amount_cents, note, created_at, changed_by)
  values (new.tender_id, new.id, new.buyer_id, new.amount_cents, new.note, clock_timestamp(), null);
  return new;
end $$;
drop trigger if exists wholesale_bid_events_record on wholesale_bids;
create trigger wholesale_bid_events_record after insert or update on wholesale_bids for each row execute function private.wholesale_bid_events_record();
create or replace function private.wholesale_bids_price_lock() returns trigger language plpgsql as $$
declare picked uuid; tender_status text;
begin
  select t.accepted_bid_id, t.status into picked, tender_status from public.wholesale_tenders t where t.id = new.tender_id;
  if not found or picked is not null or (tender_status is distinct from 'fast_lane' and tender_status is distinct from 'live') then
    raise exception 'Prices are locked on this car. The dealer has picked a buyer, or the request is not open.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists wholesale_bids_price_lock on wholesale_bids;
create trigger wholesale_bids_price_lock before insert or update on wholesale_bids for each row execute function private.wholesale_bids_price_lock();

-- Stubs of other production tables (only the columns the franchise functions use).
create table if not exists dealerships (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, address text, phone text, email text);
create table if not exists dealership_members (dealership_id uuid not null, user_id uuid not null, role text not null default 'member', invited_by uuid, joined_at timestamptz default now(), primary key (dealership_id, user_id));
create table if not exists dealership_features (id uuid primary key default gen_random_uuid(), dealership_id uuid not null, feature_key text not null, enabled boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists wholesale_buyer_alerts (
  id uuid primary key default gen_random_uuid(), buyer_id uuid not null, tender_id uuid not null, phase text not null,
  estimated_profit_cents integer not null, price_cents integer not null, retail_floor_cents integer not null,
  created_at timestamptz default now(), read_at timestamptz, priority boolean default false,
  unique (buyer_id, tender_id)
);
create unique index if not exists wholesale_buyer_alerts_buyer_tender_req_uidx on wholesale_buyer_alerts (buyer_id, tender_id) where phase = 'tender';
create table if not exists wholesale_notification_log (
  id uuid primary key default gen_random_uuid(), channel text, kind text not null, body text not null,
  tender_id uuid, buyer_id uuid, dealership_id uuid, created_at timestamptz default now()
);
create or replace function wholesale_yard_commitment_v1(_dealership_id uuid) returns table(requests integer, sold_to_buyer integer)
language sql stable as $$ select count(*)::int, 0 from wholesale_tenders t where t.dealership_id = _dealership_id and t.status <> 'cancelled' $$;
-- Production has the alert trigger live today. Mirror it so the migration's replacement has something to replace.
create or replace function wholesale_alert_buyers_on_request() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare c record; prio boolean := false;
begin
  if new.status <> 'live' then return new; end if;
  if coalesce(new.value_car_floor_cents, 0) <= 0 then return new; end if;
  select * into c from public.wholesale_yard_commitment_v1(new.dealership_id);
  if c.requests - 1 >= 3 and c.sold_to_buyer::numeric / (c.requests - 1) >= 0.6 then prio := true; end if;
  insert into public.wholesale_buyer_alerts (buyer_id, tender_id, phase, estimated_profit_cents, price_cents, retail_floor_cents, priority)
  select b.id, new.id, 'tender', 0, 0, coalesce(new.value_car_floor_cents, new.retail_floor_cents, 0), prio
    from public.wholesale_buyers b
   where b.approved and b.active and b.status = 'approved' and not b.is_placeholder
  on conflict (buyer_id, tender_id) where phase = 'tender' do nothing;
  return new;
end $$;
drop trigger if exists wholesale_alert_buyers_on_request on wholesale_tenders;
create trigger wholesale_alert_buyers_on_request after insert on wholesale_tenders for each row execute function wholesale_alert_buyers_on_request();

-- Preview-only tables. These do not exist in production.
create table if not exists preview_wholesale_test_cars (
  rego text primary key,
  state text not null,
  year integer not null,
  make text not null,
  model text not null,
  badge text not null,
  body text,
  colour text,
  transmission text,
  vin_masked text,
  odometer_km integer not null,
  notes text,
  fixture text not null
);

create table if not exists preview_wholesale_held (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null,
  rego text not null,
  km integer not null,
  badge text,
  reason text,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);

insert into dealerships (id, name, slug, address, phone, email) values
  ('00000000-0000-4000-8000-00000000fa01', 'Preview Test Dealer (not a real dealership)', 'preview-test-dealer', '1 Example St, Example NSW 2000', '0400 000 000', 'test@dealer.example.invalid')
on conflict (id) do nothing;
insert into dealership_features (dealership_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000fa01', 'carbitrage_franchise_wholesale', true);
-- Preview sign-ins map to these fixed ids. They are not Supabase users.
insert into dealership_members (dealership_id, user_id, role) values ('00000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-0000000d0001', 'owner') on conflict do nothing;

insert into wholesale_buyers (id, status, business_name, abn, licence_number, licence_state, contact_name, contact_email, contact_phone, approved, active, approved_at, notes, user_id) values
  ('00000000-0000-4000-8000-00000000b001', 'approved', 'Preview buyer: Macka', '', '', '', 'Macka', 'macka@buyer.example.invalid', '0400 000 001', true, true, now(), 'Preview test buyer, not a real contact', '00000000-0000-4000-8000-0000000b0a01'),
  ('00000000-0000-4000-8000-00000000b002', 'approved', 'Preview buyer: Alex', '', '', '', 'Alex', 'alex@buyer.example.invalid', '0400 000 002', true, true, now(), 'Preview test buyer, not a real contact', '00000000-0000-4000-8000-0000000b0a02'),
  ('00000000-0000-4000-8000-00000000b003', 'approved', 'Preview buyer: Griefy', '', '', '', 'Griefy', 'griefy@buyer.example.invalid', '0400 000 003', true, true, now(), 'Preview test buyer, not a real contact', '00000000-0000-4000-8000-0000000b0a03'),
  ('00000000-0000-4000-8000-00000000b004', 'approved', 'Preview buyer: Cam', '', '', '', 'Cam', 'cam@buyer.example.invalid', '0400 000 004', true, true, now(), 'Preview test buyer, not a real contact', '00000000-0000-4000-8000-0000000b0a04')
on conflict (id) do nothing;

insert into preview_wholesale_test_cars (rego, state, year, make, model, badge, body, colour, transmission, vin_masked, odometer_km, notes, fixture) values
  ('TEST01', 'NSW', 2022, 'Porsche', 'Macan', 'S', 'Wagon', 'Grey', 'Auto', 'WP1•••••••••0001', 88833, 'Service book, two keys.', 'macan-recorded'),
  ('TEST02', 'NSW', 2021, 'Toyota', 'RAV4', 'GX Hybrid 2WD', 'Wagon', 'Glacier White', 'CVT auto', 'JTM•••••••••0002', 58400, 'Service books, two keys, small chip in windscreen.', 'rav4-sample'),
  ('TEST03', 'NSW', 2016, 'Holden', 'Captiva', 'LTZ AWD', 'Wagon', 'Silver', 'Auto', 'KL1•••••••••0003', 141200, 'One owner.', 'captiva-held')
on conflict (rego) do nothing;

-- Test sign-in accounts for the private preview's stand-in sign-in server (server/carbitrage/test-auth.ts). Not Supabase users.
-- Passwords are written at start-up from a private file on the preview host; no password is stored in this repository.
create table if not exists preview_test_accounts (
  user_id uuid primary key,
  email text not null unique,
  label text not null,
  password_salt text,
  password_hash text
);
-- A second dealership that does NOT have the franchise feature (stands in for an ordinary Ooglecars yard's staff): must be refused.
insert into dealerships (id, name, slug, address, phone, email) values
  ('00000000-0000-4000-8000-00000000fa02', 'Preview ordinary yard (not a real dealership)', 'preview-ordinary-yard', '2 Example St, Example NSW 2000', '0400 000 099', 'yard@yard.example.invalid')
on conflict (id) do nothing;
insert into dealership_features (dealership_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000fa02', 'wholesale_pricing', true);
insert into dealership_members (dealership_id, user_id, role) values ('00000000-0000-4000-8000-00000000fa02', '00000000-0000-4000-8000-0000000c0002', 'owner') on conflict do nothing;
insert into preview_test_accounts (user_id, email, label) values
  ('00000000-0000-4000-8000-0000000d0001', 'patrick@test.carbitrage.invalid', 'Patrick Auto (test franchise dealer)'),
  ('00000000-0000-4000-8000-0000000b0a01', 'macka@buyer.example.invalid', 'Buyer Macka (test)'),
  ('00000000-0000-4000-8000-0000000b0a02', 'alex@buyer.example.invalid', 'Buyer Alex (test)'),
  ('00000000-0000-4000-8000-0000000b0a03', 'griefy@buyer.example.invalid', 'Buyer Griefy (test)'),
  ('00000000-0000-4000-8000-0000000b0a04', 'cam@buyer.example.invalid', 'Buyer Cam (test)'),
  ('00000000-0000-4000-8000-0000000c0001', 'nobody@test.carbitrage.invalid', 'Account with no wholesale role (test)'),
  ('00000000-0000-4000-8000-0000000c0002', 'yard@test.carbitrage.invalid', 'Ordinary yard staff, no franchise feature (test)')
on conflict (user_id) do nothing;
