-- PREVIEW ONLY. Applied by server/carbitrage/main.ts to the box's disposable local Postgres, never to Supabase.
-- Mirrors the production column names, types, defaults and checks of public.wholesale_tenders, wholesale_bids and
-- wholesale_buyers (read from production, schema only, 20 Nov 2026). Foreign keys to other production tables are left out.
-- Seed rows are clearly labelled test data. No real dealership, buyer contact or car is created here.

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

-- Same rule as production's wholesale-floor-guard: a new live request must carry a Carbitrage floor.
create or replace function wholesale_require_floor() returns trigger language plpgsql as $$
begin
  if new.status = 'live' and (new.value_car_floor_cents is null or new.value_car_floor_cents <= 0) then
    raise exception 'live wholesale request requires a Carbitrage floor';
  end if;
  return new;
end $$;
drop trigger if exists wholesale_require_floor on wholesale_tenders;
create trigger wholesale_require_floor before insert on wholesale_tenders for each row execute function wholesale_require_floor();

-- Preview-only tables. These do not exist in production.
create table if not exists preview_wholesale_dealers (
  id uuid primary key,
  name text not null,
  state text not null,
  person text not null,
  phone text not null,
  email text not null,
  address text not null
);

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

insert into preview_wholesale_dealers (id, name, state, person, phone, email, address) values
  ('00000000-0000-4000-8000-00000000fa01', 'Preview Test Dealer (not a real dealership)', 'NSW', 'Test Person', '0400 000 000', 'test@dealer.example.invalid', '1 Example St, Example NSW 2000')
on conflict (id) do nothing;

insert into wholesale_buyers (id, status, business_name, abn, licence_number, licence_state, contact_name, contact_email, contact_phone, approved, active, approved_at, notes) values
  ('00000000-0000-4000-8000-00000000b001', 'approved', 'Preview buyer: Macka', '', '', '', 'Macka', 'macka@buyer.example.invalid', '0400 000 001', true, true, now(), 'Preview test buyer, not a real contact'),
  ('00000000-0000-4000-8000-00000000b002', 'approved', 'Preview buyer: Alex', '', '', '', 'Alex', 'alex@buyer.example.invalid', '0400 000 002', true, true, now(), 'Preview test buyer, not a real contact'),
  ('00000000-0000-4000-8000-00000000b003', 'approved', 'Preview buyer: Griefy', '', '', '', 'Griefy', 'griefy@buyer.example.invalid', '0400 000 003', true, true, now(), 'Preview test buyer, not a real contact'),
  ('00000000-0000-4000-8000-00000000b004', 'approved', 'Preview buyer: Cam', '', '', '', 'Cam', 'cam@buyer.example.invalid', '0400 000 004', true, true, now(), 'Preview test buyer, not a real contact')
on conflict (id) do nothing;

insert into preview_wholesale_test_cars (rego, state, year, make, model, badge, body, colour, transmission, vin_masked, odometer_km, notes, fixture) values
  ('TEST01', 'NSW', 2022, 'Porsche', 'Macan', 'S', 'Wagon', 'Grey', 'Auto', 'WP1•••••••••0001', 88833, 'Service book, two keys.', 'macan-recorded'),
  ('TEST02', 'NSW', 2021, 'Toyota', 'RAV4', 'GX Hybrid 2WD', 'Wagon', 'Glacier White', 'CVT auto', 'JTM•••••••••0002', 58400, 'Service books, two keys, small chip in windscreen.', 'rav4-sample'),
  ('TEST03', 'NSW', 2016, 'Holden', 'Captiva', 'LTZ AWD', 'Wagon', 'Silver', 'Auto', 'KL1•••••••••0003', 141200, 'One owner.', 'captiva-held')
on conflict (rego) do nothing;
