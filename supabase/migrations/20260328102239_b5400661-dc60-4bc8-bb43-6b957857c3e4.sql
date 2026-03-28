CREATE OR REPLACE VIEW public.auction_watch_pickles_sydney_gov AS
SELECT
  id,
  auction_datetime,
  auction_lot_number,
  lot_id,
  make,
  model,
  variant_raw AS variant,
  year,
  km AS odometer_km,
  location,
  asking_price AS ask_price,
  expected_gross_margin,
  days_to_sell_est,
  risk_multiplier,
  profit_per_day,
  lifecycle_state,
  listing_url
FROM public.vehicle_listings
WHERE
  auction_house = 'Pickles'
  AND auction_location = 'Sydney'
  AND auction_segment = 'Government'
  AND lifecycle_state IN ('NEW', 'WATCH', 'BUY')
  AND auction_datetime >= now()
ORDER BY auction_datetime, profit_per_day DESC NULLS LAST;