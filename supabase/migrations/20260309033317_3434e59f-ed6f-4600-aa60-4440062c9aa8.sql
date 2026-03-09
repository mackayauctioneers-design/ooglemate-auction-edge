create or replace view public.market_listings as

-- Auction & dealer inventory (vehicle_listings)
select
  id,
  source,
  source_class,
  auction_house,
  make,
  model,
  variant_raw,
  year,
  km,
  asking_price,
  state as location,
  listing_url,
  last_seen_at,
  transmission,
  fuel,
  drivetrain,
  'inventory'::text as listing_type
from public.vehicle_listings
where status in ('listed', 'catalogue')

union all

-- Retail classifieds (retail_listings)
select
  id,
  source,
  null::text as source_class,
  null::text as auction_house,
  make,
  model,
  variant_raw,
  year,
  km,
  asking_price,
  state as location,
  listing_url,
  last_seen_at,
  transmission,
  fuel_type as fuel,
  drivetrain,
  'retail'::text as listing_type
from public.retail_listings
where delisted_at is null;