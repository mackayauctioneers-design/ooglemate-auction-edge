-- Remove 14-day staleness filter from market_listings view
-- Filtering should happen at query time, not in the view, to preserve historical data

DROP VIEW IF EXISTS public.market_listings CASCADE;

CREATE VIEW public.market_listings WITH (security_invoker = true) AS
SELECT
  vl.id, vl.source,
  COALESCE(vl.source_class, 'auction') AS source_class,
  vl.listing_id AS source_listing_id, vl.listing_url,
  UPPER(TRIM(vl.make)) AS make, UPPER(TRIM(vl.model)) AS model,
  vl.variant_raw, vl.variant_family,
  COALESCE(vl.variant_used, vl.variant_family) AS variant_resolved,
  vl.year,
  vl.km,
  vl.asking_price,
  vl.km AS kilometres,
  vl.asking_price AS price,
  vl.fuel AS fuel_type, vl.transmission, vl.drivetrain,
  NULL::text AS body_type, NULL::text AS colour,
  vl.state, vl.postcode, vl.suburb,
  vl.location,
  vl.location AS region_raw,
  vl.seller_type, vl.dealer_name AS seller_name,
  vl.auction_house, vl.auction_datetime, vl.guide_price, vl.sold_price,
  vl.status,
  COALESCE(vl.lifecycle_state, vl.status) AS lifecycle_status,
  COALESCE(vl.source_class, CASE WHEN vl.auction_house IS NOT NULL THEN 'auction' ELSE 'wholesale' END) AS listing_type,
  vl.is_dealer_grade, vl.fingerprint, vl.fingerprint_confidence,
  NULL::text AS price_badge, NULL::integer AS market_price,
  NULL::integer AS price_difference, NULL::numeric AS price_difference_percent,
  NULL::text AS market_price_source,
  vl.first_seen_at, vl.last_seen_at, vl.created_at,
  vl.fingerprint_hash, vl.watch_status, vl.risk_flags, vl.exclude_from_alerts
FROM public.vehicle_listings vl
WHERE vl.make IS NOT NULL AND vl.model IS NOT NULL

UNION ALL

SELECT
  rl.id, rl.source, 'retail' AS source_class,
  rl.source_listing_id, rl.listing_url,
  UPPER(TRIM(rl.make)) AS make, UPPER(TRIM(rl.model)) AS model,
  rl.variant_raw, rl.variant_family,
  COALESCE(rl.badge, rl.variant_family) AS variant_resolved,
  rl.year,
  rl.km,
  rl.asking_price,
  rl.km AS kilometres,
  rl.asking_price AS price,
  rl.fuel_type, rl.transmission, rl.drivetrain,
  rl.body_type, rl.colour,
  rl.state, rl.postcode, rl.suburb,
  COALESCE(rl.region_raw, rl.state) AS location,
  rl.region_raw,
  rl.seller_type, rl.seller_name_raw AS seller_name,
  NULL::text AS auction_house, NULL::timestamptz AS auction_datetime,
  NULL::integer AS guide_price, NULL::integer AS sold_price,
  rl.lifecycle_status AS status,
  COALESCE(rl.lifecycle_status, 'ACTIVE') AS lifecycle_status,
  'retail'::text AS listing_type,
  false AS is_dealer_grade, NULL::text AS fingerprint,
  NULL::smallint AS fingerprint_confidence,
  rl.price_badge, rl.market_price, rl.price_difference,
  rl.price_difference_percent, rl.market_price_source,
  rl.first_seen_at, rl.last_seen_at, rl.created_at,
  rl.fingerprint_hash, NULL::text AS watch_status,
  rl.risk_flags, rl.exclude_from_alerts
FROM public.retail_listings rl
WHERE rl.make IS NOT NULL AND rl.model IS NOT NULL;