-- =============================================================================
-- FINGERPRINT OUTCOMES v2 - Correctness + Scale Hardening
-- =============================================================================

-- 1) Drop old constraints and columns
ALTER TABLE public.fingerprint_outcomes 
  DROP CONSTRAINT IF EXISTS fingerprint_outcomes_unique_key;

-- 2) Rename/replace columns for semantic accuracy
ALTER TABLE public.fingerprint_outcomes 
  DROP COLUMN IF EXISTS sold_count,
  DROP COLUMN IF EXISTS withdrawn_count,
  DROP COLUMN IF EXISTS sample_listing_ids;

-- 3) Add corrected columns with _total suffix (cumulative to asof_date)
ALTER TABLE public.fingerprint_outcomes 
  ADD COLUMN IF NOT EXISTS listing_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleared_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relisted_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passed_in_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS example_listing_id UUID;

-- 4) Migrate existing data if any
UPDATE public.fingerprint_outcomes 
SET 
  listing_total = listing_count,
  cleared_total = clearance_count,
  relisted_total = 0,
  passed_in_total = passed_in_count
WHERE listing_total = 0;

-- 5) Drop old columns
ALTER TABLE public.fingerprint_outcomes 
  DROP COLUMN IF EXISTS listing_count,
  DROP COLUMN IF EXISTS clearance_count,
  DROP COLUMN IF EXISTS passed_in_count;

-- 6) Recreate unique constraint
ALTER TABLE public.fingerprint_outcomes 
  ADD CONSTRAINT fingerprint_outcomes_unique_key UNIQUE (
    make, model, variant_family, year_min, year_max, 
    km_band_min, km_band_max, fuel, transmission, region_id, asof_date
  );

-- =============================================================================
-- REPLACE MATERIALIZE FUNCTION - v2
-- =============================================================================

CREATE OR REPLACE FUNCTION public.materialize_fingerprint_outcomes(p_asof DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(records_upserted INTEGER, regions_processed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_records_upserted INTEGER := 0;
  v_regions_processed INTEGER := 0;
BEGIN
  -- Upsert aggregated fingerprint outcomes (CUMULATIVE to p_asof)
  WITH listings_with_bands AS (
    SELECT
      vl.id,
      vl.make,
      vl.model,
      vl.variant_family,
      (year_to_band(vl.year)).year_min AS year_min,
      (year_to_band(vl.year)).year_max AS year_max,
      (km_to_band(vl.km)).km_band_min AS km_band_min,
      (km_to_band(vl.km)).km_band_max AS km_band_max,
      LOWER(COALESCE(vl.fuel, 'unknown')) AS fuel,
      LOWER(COALESCE(vl.transmission, 'unknown')) AS transmission,
      location_to_region(vl.location) AS region_id,
      vl.status,
      vl.relist_count,
      vl.pass_count,
      vl.asking_price,
      vl.reserve,
      vl.first_seen_at
    FROM vehicle_listings vl
    WHERE vl.is_dealer_grade = true
      AND vl.first_seen_at <= p_asof + INTERVAL '1 day'
  ),
  
  clearances AS (
    SELECT
      ce.listing_id,
      ce.clearance_type,
      ce.days_to_clear
    FROM clearance_events ce
    WHERE ce.cleared_at <= p_asof + INTERVAL '1 day'
  ),
  
  -- Get one example listing per fingerprint (avoids heavy ARRAY_AGG)
  example_listings AS (
    SELECT DISTINCT ON (
      lb.make, lb.model, lb.variant_family,
      lb.year_min, lb.year_max,
      lb.km_band_min, lb.km_band_max,
      lb.fuel, lb.transmission, lb.region_id
    )
      lb.id AS example_id,
      lb.make, lb.model, lb.variant_family,
      lb.year_min, lb.year_max,
      lb.km_band_min, lb.km_band_max,
      lb.fuel, lb.transmission, lb.region_id
    FROM listings_with_bands lb
    WHERE lb.region_id IS NOT NULL AND lb.year_min IS NOT NULL
    ORDER BY 
      lb.make, lb.model, lb.variant_family,
      lb.year_min, lb.year_max,
      lb.km_band_min, lb.km_band_max,
      lb.fuel, lb.transmission, lb.region_id,
      lb.first_seen_at DESC  -- Most recent as example
  ),
  
  aggregated AS (
    SELECT
      lb.make,
      lb.model,
      lb.variant_family,
      lb.year_min,
      lb.year_max,
      lb.km_band_min,
      lb.km_band_max,
      lb.fuel,
      lb.transmission,
      lb.region_id,
      -- Cumulative counts (_total)
      COUNT(DISTINCT lb.id) AS listing_total,
      COUNT(DISTINCT c.listing_id) AS cleared_total,
      COUNT(DISTINCT CASE WHEN lb.relist_count > 0 THEN lb.id END) AS relisted_total,
      COUNT(DISTINCT CASE WHEN c.clearance_type = 'passed_in' THEN c.listing_id END) AS passed_in_total,
      -- Timing metrics
      ROUND(AVG(c.days_to_clear)::numeric, 1) AS avg_days_to_clear,
      MIN(c.days_to_clear)::INTEGER AS min_days_to_clear,
      MAX(c.days_to_clear)::INTEGER AS max_days_to_clear,
      -- Price metrics
      ROUND(AVG(COALESCE(lb.asking_price, lb.reserve))) AS avg_price,
      MIN(COALESCE(lb.asking_price, lb.reserve)) AS min_price,
      MAX(COALESCE(lb.asking_price, lb.reserve)) AS max_price
    FROM listings_with_bands lb
    LEFT JOIN clearances c ON c.listing_id = lb.id
    WHERE lb.region_id IS NOT NULL
      AND lb.year_min IS NOT NULL
    GROUP BY
      lb.make, lb.model, lb.variant_family,
      lb.year_min, lb.year_max,
      lb.km_band_min, lb.km_band_max,
      lb.fuel, lb.transmission, lb.region_id
    HAVING COUNT(DISTINCT lb.id) >= 1
  ),
  
  upserted AS (
    INSERT INTO fingerprint_outcomes (
      make, model, variant_family,
      year_min, year_max,
      km_band_min, km_band_max,
      fuel, transmission, region_id,
      listing_total, cleared_total, relisted_total, passed_in_total,
      avg_days_to_clear, min_days_to_clear, max_days_to_clear,
      avg_price, min_price, max_price,
      example_listing_id,
      asof_date
    )
    SELECT
      a.make, a.model, a.variant_family,
      a.year_min, a.year_max,
      a.km_band_min, a.km_band_max,
      a.fuel, a.transmission, a.region_id,
      a.listing_total, a.cleared_total, a.relisted_total, a.passed_in_total,
      a.avg_days_to_clear, a.min_days_to_clear, a.max_days_to_clear,
      a.avg_price, a.min_price, a.max_price,
      e.example_id,
      p_asof
    FROM aggregated a
    LEFT JOIN example_listings e ON (
      e.make = a.make AND e.model = a.model 
      AND e.variant_family IS NOT DISTINCT FROM a.variant_family
      AND e.year_min = a.year_min AND e.year_max = a.year_max
      AND e.km_band_min IS NOT DISTINCT FROM a.km_band_min 
      AND e.km_band_max IS NOT DISTINCT FROM a.km_band_max
      AND e.fuel = a.fuel AND e.transmission = a.transmission
      AND e.region_id = a.region_id
    )
    ON CONFLICT ON CONSTRAINT fingerprint_outcomes_unique_key
    DO UPDATE SET
      listing_total = EXCLUDED.listing_total,
      cleared_total = EXCLUDED.cleared_total,
      relisted_total = EXCLUDED.relisted_total,
      passed_in_total = EXCLUDED.passed_in_total,
      avg_days_to_clear = EXCLUDED.avg_days_to_clear,
      min_days_to_clear = EXCLUDED.min_days_to_clear,
      max_days_to_clear = EXCLUDED.max_days_to_clear,
      avg_price = EXCLUDED.avg_price,
      min_price = EXCLUDED.min_price,
      max_price = EXCLUDED.max_price,
      example_listing_id = EXCLUDED.example_listing_id,
      updated_at = now()
    RETURNING region_id
  )
  
  SELECT 
    COUNT(*)::INTEGER,
    COUNT(DISTINCT region_id)::INTEGER
  INTO v_records_upserted, v_regions_processed
  FROM upserted;
  
  RETURN QUERY SELECT v_records_upserted, v_regions_processed;
END;
$$;