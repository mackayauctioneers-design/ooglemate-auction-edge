-- ============================================================
-- VIEW 1: trap_inventory_current
-- Latest snapshot data per classifieds listing
-- ============================================================
CREATE OR REPLACE VIEW trap_inventory_current AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (listing_id)
    listing_id,
    asking_price as current_price,
    seen_at as last_snapshot_at
  FROM listing_snapshots
  ORDER BY listing_id, seen_at DESC
),
first_snapshot AS (
  SELECT DISTINCT ON (listing_id)
    listing_id,
    asking_price as first_price,
    seen_at as first_snapshot_at
  FROM listing_snapshots
  WHERE asking_price IS NOT NULL
  ORDER BY listing_id, seen_at ASC
),
price_changes AS (
  SELECT 
    s1.listing_id,
    MAX(s2.seen_at) as last_price_change_at
  FROM listing_snapshots s1
  JOIN listing_snapshots s2 ON s1.listing_id = s2.listing_id
  WHERE s1.asking_price IS DISTINCT FROM s2.asking_price
    AND s2.seen_at < s1.seen_at
  GROUP BY s1.listing_id
)
SELECT
  vl.id,
  vl.listing_id,
  vl.make,
  vl.model,
  vl.variant_family,
  vl.year,
  vl.km,
  vl.source,
  vl.status,
  vl.listing_url,
  vl.location,
  vl.first_seen_at,
  vl.last_seen_at,
  COALESCE(ls.current_price, vl.asking_price) as asking_price,
  fs.first_price,
  EXTRACT(DAY FROM (now() - vl.first_seen_at))::integer as days_on_market,
  pc.last_price_change_at,
  location_to_region(vl.location) as region_id,
  (year_to_band(vl.year)).year_min as year_band_min,
  (year_to_band(vl.year)).year_max as year_band_max,
  (km_to_band(vl.km)).km_band_min as km_band_min,
  (km_to_band(vl.km)).km_band_max as km_band_max
FROM vehicle_listings vl
LEFT JOIN latest_snapshot ls ON ls.listing_id = vl.id
LEFT JOIN first_snapshot fs ON fs.listing_id = vl.id
LEFT JOIN price_changes pc ON pc.listing_id = vl.id
WHERE vl.source_class = 'classifieds'
  AND vl.status NOT IN ('cleared', 'sold');

-- ============================================================
-- VIEW 2: trap_deals
-- Joins trap inventory with fingerprint benchmarks
-- Computes delta_pct and delta_dollars
-- ============================================================
CREATE OR REPLACE VIEW trap_deals AS
SELECT
  ti.id,
  ti.listing_id,
  ti.make,
  ti.model,
  ti.variant_family,
  ti.year,
  ti.km,
  ti.source,
  ti.status,
  ti.listing_url,
  ti.location,
  ti.region_id,
  ti.first_seen_at,
  ti.last_seen_at,
  ti.asking_price,
  ti.first_price,
  ti.days_on_market,
  ti.last_price_change_at,
  -- Benchmark data
  fo.avg_price as benchmark_price,
  fo.cleared_total as benchmark_sample,
  fo.avg_days_to_clear as benchmark_days_to_clear,
  -- Delta calculations (negative = under benchmark = good deal)
  CASE 
    WHEN fo.avg_price IS NOT NULL AND fo.cleared_total >= 10 AND ti.asking_price IS NOT NULL
    THEN ti.asking_price - fo.avg_price
    ELSE NULL
  END as delta_dollars,
  CASE 
    WHEN fo.avg_price IS NOT NULL AND fo.cleared_total >= 10 AND ti.asking_price IS NOT NULL AND fo.avg_price > 0
    THEN ROUND(((ti.asking_price - fo.avg_price)::numeric / fo.avg_price * 100), 1)
    ELSE NULL
  END as delta_pct,
  -- Price change from first seen
  CASE 
    WHEN ti.first_price IS NOT NULL AND ti.asking_price IS NOT NULL
    THEN ti.asking_price - ti.first_price
    ELSE NULL
  END as price_change_dollars,
  CASE 
    WHEN ti.first_price IS NOT NULL AND ti.asking_price IS NOT NULL AND ti.first_price > 0
    THEN ROUND(((ti.asking_price - ti.first_price)::numeric / ti.first_price * 100), 1)
    ELSE NULL
  END as price_change_pct,
  -- Flag for no benchmark
  CASE 
    WHEN fo.id IS NULL THEN true
    WHEN fo.cleared_total < 10 THEN true
    ELSE false
  END as no_benchmark
FROM trap_inventory_current ti
LEFT JOIN fingerprint_outcomes fo 
  ON upper(fo.make) = upper(ti.make)
  AND upper(fo.model) = upper(ti.model)
  AND (fo.variant_family IS NULL OR fo.variant_family = 'ALL' OR upper(fo.variant_family) = upper(COALESCE(ti.variant_family, '')))
  AND fo.region_id = ti.region_id
  AND fo.year_min = ti.year_band_min
  AND fo.year_max = ti.year_band_max
  AND (fo.km_band_min IS NULL OR fo.km_band_min = ti.km_band_min)
  AND fo.asof_date = (SELECT MAX(asof_date) FROM fingerprint_outcomes);

-- Grant access
GRANT SELECT ON trap_inventory_current TO authenticated, anon;
GRANT SELECT ON trap_deals TO authenticated, anon;