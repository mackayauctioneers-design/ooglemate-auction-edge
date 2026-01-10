
-- Drop and recreate trap_deals view with cross-region fallback
DROP VIEW IF EXISTS trap_deals_90_plus;
DROP VIEW IF EXISTS trap_deals;

CREATE VIEW trap_deals AS
WITH fp AS (
  SELECT 
    region_id,
    UPPER(make) as make,
    UPPER(model) as model,
    COALESCE(UPPER(variant_family), 'ALL') as variant_family,
    year_min,
    year_max,
    km_band_min,
    km_band_max,
    listing_total,
    cleared_total,
    relisted_total,
    avg_days_to_clear,
    avg_price AS fingerprint_price
  FROM fingerprint_outcomes_latest
  WHERE cleared_total >= 1  -- Lowered to 1 during early ramp-up
    AND avg_price IS NOT NULL 
    AND avg_price > 0
),
-- Aggregate cross-region fingerprints by make/model/year for T5 fallback
fp_national AS (
  SELECT 
    UPPER(make) as make,
    UPPER(model) as model,
    year_min,
    year_max,
    SUM(cleared_total) as cleared_total,
    AVG(avg_price) as fingerprint_price,
    AVG(avg_days_to_clear) as avg_days_to_clear
  FROM fingerprint_outcomes_latest
  WHERE cleared_total >= 1
    AND avg_price IS NOT NULL 
    AND avg_price > 0
  GROUP BY UPPER(make), UPPER(model), year_min, year_max
)
SELECT 
  ti.id,
  ti.listing_id,
  ti.source,
  ti.trap_slug,
  ti.make,
  ti.model,
  ti.variant_family,
  ti.year,
  ti.km,
  ti.location,
  ti.region_id,
  ti.listing_url,
  ti.status,
  ti.asking_price,
  ti.first_seen_at,
  ti.first_price,
  ti.days_on_market,
  ti.price_change_count,
  ti.last_price_change_at,
  -- Tiered fingerprint matching: T1-T4 same region, T5 national fallback
  COALESCE(
    fp_t1.fingerprint_price, 
    fp_t2.fingerprint_price, 
    fp_t3.fingerprint_price,
    fp_t4.fingerprint_price,
    fp_t5.fingerprint_price
  ) AS fingerprint_price,
  COALESCE(
    fp_t1.cleared_total, 
    fp_t2.cleared_total, 
    fp_t3.cleared_total,
    fp_t4.cleared_total,
    fp_t5.cleared_total
  )::integer AS fingerprint_sample,
  COALESCE(
    fp_t1.avg_days_to_clear, 
    fp_t2.avg_days_to_clear, 
    fp_t3.avg_days_to_clear,
    fp_t4.avg_days_to_clear,
    fp_t5.avg_days_to_clear
  ) AS fingerprint_ttd,
  ti.asking_price::numeric - COALESCE(
    fp_t1.fingerprint_price, 
    fp_t2.fingerprint_price, 
    fp_t3.fingerprint_price,
    fp_t4.fingerprint_price,
    fp_t5.fingerprint_price
  ) AS delta_dollars,
  CASE
    WHEN COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) IS NULL THEN NULL
    ELSE round(
      (ti.asking_price::numeric - COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price)) 
      / COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) * 100, 1
    )
  END AS delta_pct,
  COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) IS NULL AS no_benchmark,
  CASE
    WHEN COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) IS NULL THEN 'NO_BENCHMARK'
    WHEN (ti.asking_price::numeric - COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price)) 
         / COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) <= -0.25 THEN 'MISPRICED'
    WHEN (ti.asking_price::numeric - COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price)) 
         / COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) <= -0.15 THEN 'STRONG_BUY'
    WHEN (ti.asking_price::numeric - COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price)) 
         / COALESCE(fp_t1.fingerprint_price, fp_t2.fingerprint_price, fp_t3.fingerprint_price, fp_t4.fingerprint_price, fp_t5.fingerprint_price) <= -0.10 THEN 'WATCH'
    ELSE 'NORMAL'
  END AS deal_label
FROM trap_inventory_current ti
-- T1: Exact match (region + make + model + variant + year_band + km_band)
LEFT JOIN fp fp_t1 ON 
  fp_t1.region_id = ti.region_id 
  AND fp_t1.make = UPPER(ti.make) 
  AND fp_t1.model = UPPER(ti.model) 
  AND fp_t1.variant_family = COALESCE(UPPER(ti.variant_family), 'ALL')
  AND fp_t1.year_min = ti.year_band_min 
  AND fp_t1.year_max = ti.year_band_max
  AND fp_t1.km_band_min = ti.km_band_min 
  AND fp_t1.km_band_max = ti.km_band_max
-- T2: Variant fallback to ALL (same region + km constraints)
LEFT JOIN fp fp_t2 ON 
  fp_t2.region_id = ti.region_id 
  AND fp_t2.make = UPPER(ti.make) 
  AND fp_t2.model = UPPER(ti.model) 
  AND fp_t2.variant_family = 'ALL'
  AND fp_t2.year_min = ti.year_band_min 
  AND fp_t2.year_max = ti.year_band_max
  AND fp_t2.km_band_min = ti.km_band_min 
  AND fp_t2.km_band_max = ti.km_band_max
  AND fp_t1.fingerprint_price IS NULL
-- T3: Ignore km_band (same region)
LEFT JOIN fp fp_t3 ON 
  fp_t3.region_id = ti.region_id 
  AND fp_t3.make = UPPER(ti.make) 
  AND fp_t3.model = UPPER(ti.model) 
  AND fp_t3.year_min = ti.year_band_min 
  AND fp_t3.year_max = ti.year_band_max
  AND fp_t1.fingerprint_price IS NULL
  AND fp_t2.fingerprint_price IS NULL
-- T4: Same region, just make + model + year_band
LEFT JOIN fp fp_t4 ON 
  fp_t4.region_id = ti.region_id 
  AND fp_t4.make = UPPER(ti.make) 
  AND fp_t4.model = UPPER(ti.model) 
  AND fp_t4.year_min = ti.year_band_min 
  AND fp_t4.year_max = ti.year_band_max
  AND fp_t1.fingerprint_price IS NULL
  AND fp_t2.fingerprint_price IS NULL
  AND fp_t3.fingerprint_price IS NULL
-- T5: NATIONAL fallback - cross-region aggregated by make + model + year_band
LEFT JOIN fp_national fp_t5 ON 
  fp_t5.make = UPPER(ti.make) 
  AND fp_t5.model = UPPER(ti.model) 
  AND fp_t5.year_min = ti.year_band_min 
  AND fp_t5.year_max = ti.year_band_max
  AND fp_t1.fingerprint_price IS NULL
  AND fp_t2.fingerprint_price IS NULL
  AND fp_t3.fingerprint_price IS NULL
  AND fp_t4.fingerprint_price IS NULL;

-- Recreate dependent view
CREATE VIEW trap_deals_90_plus AS
SELECT * FROM trap_deals WHERE days_on_market >= 90;

COMMENT ON VIEW trap_deals IS 'Dealer retail inventory with tiered fingerprint matching. T1-T4=same region with decreasing specificity. T5=national fallback (cross-region avg). Threshold: cleared_total >= 1 during early ramp-up.';
