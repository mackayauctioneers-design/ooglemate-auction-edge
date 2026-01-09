-- Drop existing views if they exist (in dependency order)
DROP VIEW IF EXISTS public.trap_deals_90_plus;
DROP VIEW IF EXISTS public.trap_deals;
DROP VIEW IF EXISTS public.trap_inventory_current;
DROP VIEW IF EXISTS public.fingerprint_outcomes_latest;

-- A) View: current trap inventory with latest price
CREATE OR REPLACE VIEW public.trap_inventory_current AS
WITH latest_snap AS (
  SELECT
    ls.listing_id,
    ls.seen_at,
    ls.asking_price,
    ROW_NUMBER() OVER (PARTITION BY ls.listing_id ORDER BY ls.seen_at DESC) AS rn
  FROM public.listing_snapshots ls
  WHERE ls.asking_price IS NOT NULL AND ls.asking_price > 0
),
first_snap AS (
  SELECT
    ls.listing_id,
    MIN(ls.seen_at) AS first_seen_at,
    MIN(ls.asking_price) FILTER (WHERE ls.asking_price IS NOT NULL AND ls.asking_price > 0) AS first_price
  FROM public.listing_snapshots ls
  GROUP BY ls.listing_id
),
price_changes AS (
  SELECT 
    listing_id,
    COUNT(*) - 1 AS price_change_count,
    MAX(seen_at) AS last_price_change_at
  FROM (
    SELECT 
      listing_id,
      seen_at,
      asking_price,
      LAG(asking_price) OVER (PARTITION BY listing_id ORDER BY seen_at) AS prev_price
    FROM public.listing_snapshots
    WHERE asking_price IS NOT NULL AND asking_price > 0
  ) sub
  WHERE asking_price IS DISTINCT FROM prev_price
  GROUP BY listing_id
)
SELECT
  vl.id,
  vl.listing_id,
  vl.source,
  vl.source_class,
  vl.listing_url,
  vl.status,
  -- trap identity
  REGEXP_REPLACE(vl.source, '^trap_', '') AS trap_slug,
  -- core vehicle
  UPPER(COALESCE(vl.make, 'UNKNOWN')) AS make,
  UPPER(COALESCE(vl.model, 'UNKNOWN')) AS model,
  COALESCE(vl.variant_family, 'ALL') AS variant_family,
  vl.year,
  vl.km,
  vl.location,
  public.location_to_region(vl.location) AS region_id,
  -- year/km bands for fingerprint join
  (public.year_to_band(vl.year)).year_min AS year_band_min,
  (public.year_to_band(vl.year)).year_max AS year_band_max,
  (public.km_to_band(vl.km)).km_band_min AS km_band_min,
  (public.km_to_band(vl.km)).km_band_max AS km_band_max,
  -- pricing + time
  ls.asking_price,
  fs.first_seen_at,
  fs.first_price,
  (CURRENT_DATE - fs.first_seen_at::date) AS days_on_market,
  pc.last_price_change_at,
  COALESCE(pc.price_change_count, 0) AS price_change_count
FROM public.vehicle_listings vl
JOIN latest_snap ls ON ls.listing_id = vl.id AND ls.rn = 1
LEFT JOIN first_snap fs ON fs.listing_id = vl.id
LEFT JOIN price_changes pc ON pc.listing_id = vl.id
WHERE vl.source_class = 'classifieds'
  AND vl.source LIKE 'trap_%'
  AND vl.is_dealer_grade = true
  AND vl.status IN ('listed', 'active');

-- B) View: pick the latest fingerprint snapshot per key
CREATE OR REPLACE VIEW public.fingerprint_outcomes_latest AS
SELECT fo.*
FROM public.fingerprint_outcomes fo
JOIN (
  SELECT
    region_id, make, model, variant_family,
    year_min, year_max, km_band_min, km_band_max,
    fuel, transmission,
    MAX(asof_date) AS max_asof_date
  FROM public.fingerprint_outcomes
  GROUP BY 1,2,3,4,5,6,7,8,9,10
) x
ON x.region_id = fo.region_id
AND x.make = fo.make
AND x.model = fo.model
AND x.variant_family = fo.variant_family
AND x.year_min = fo.year_min
AND x.year_max = fo.year_max
AND COALESCE(x.km_band_min, 0) = COALESCE(fo.km_band_min, 0)
AND COALESCE(x.km_band_max, 0) = COALESCE(fo.km_band_max, 0)
AND COALESCE(x.fuel, 'unknown') = COALESCE(fo.fuel, 'unknown')
AND COALESCE(x.transmission, 'unknown') = COALESCE(fo.transmission, 'unknown')
AND x.max_asof_date = fo.asof_date;

-- C) View: Trap Deals (Under %)
CREATE OR REPLACE VIEW public.trap_deals AS
WITH ti AS (
  SELECT * FROM public.trap_inventory_current
),
fp AS (
  SELECT
    region_id, make, model, variant_family,
    year_min, year_max, km_band_min, km_band_max,
    listing_total, cleared_total, relisted_total,
    avg_days_to_clear,
    avg_price AS fingerprint_price
  FROM public.fingerprint_outcomes_latest
  WHERE cleared_total >= 10
    AND avg_price IS NOT NULL
    AND avg_price > 0
)
SELECT
  ti.id,
  ti.listing_id,
  ti.source,
  ti.listing_url,
  ti.status,
  ti.trap_slug,
  ti.make,
  ti.model,
  ti.variant_family,
  ti.year,
  ti.km,
  ti.location,
  ti.region_id,
  ti.asking_price,
  ti.first_seen_at,
  ti.first_price,
  ti.days_on_market,
  ti.last_price_change_at,
  ti.price_change_count,
  
  -- Prefer exact variant match, fallback to ALL
  COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) AS fingerprint_price,
  COALESCE(fp_exact.cleared_total, fp_all.cleared_total) AS fingerprint_sample,
  COALESCE(fp_exact.avg_days_to_clear, fp_all.avg_days_to_clear) AS fingerprint_ttd,
  
  -- No benchmark flag
  (fp_exact.fingerprint_price IS NULL AND fp_all.fingerprint_price IS NULL) AS no_benchmark,
  
  -- Delta dollars & percent
  (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price)) AS delta_dollars,
  CASE
    WHEN COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) IS NULL THEN NULL
    ELSE ROUND(((ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric 
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) * 100), 1)
  END AS delta_pct,
  
  -- Deal label
  CASE
    WHEN COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) IS NULL THEN 'NO_BENCHMARK'
    WHEN (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) <= -0.25 THEN 'MISPRICED'
    WHEN (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) <= -0.15 THEN 'STRONG_BUY'
    WHEN (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) <= -0.10 THEN 'WATCH'
    ELSE 'NORMAL'
  END AS deal_label

FROM ti
LEFT JOIN fp fp_exact
  ON fp_exact.region_id = ti.region_id
 AND fp_exact.make = ti.make
 AND fp_exact.model = ti.model
 AND fp_exact.variant_family = ti.variant_family
 AND fp_exact.year_min = ti.year_band_min
 AND fp_exact.year_max = ti.year_band_max
 AND COALESCE(fp_exact.km_band_min, 0) = COALESCE(ti.km_band_min, 0)
 AND COALESCE(fp_exact.km_band_max, 0) = COALESCE(ti.km_band_max, 0)
LEFT JOIN fp fp_all
  ON fp_all.region_id = ti.region_id
 AND fp_all.make = ti.make
 AND fp_all.model = ti.model
 AND fp_all.variant_family = 'ALL'
 AND fp_all.year_min = ti.year_band_min
 AND fp_all.year_max = ti.year_band_max
 AND COALESCE(fp_all.km_band_min, 0) = COALESCE(ti.km_band_min, 0)
 AND COALESCE(fp_all.km_band_max, 0) = COALESCE(ti.km_band_max, 0);

-- D) View: 90+ days convenience view
CREATE OR REPLACE VIEW public.trap_deals_90_plus AS
SELECT *
FROM public.trap_deals
WHERE days_on_market >= 90
ORDER BY delta_pct ASC NULLS LAST, days_on_market DESC;