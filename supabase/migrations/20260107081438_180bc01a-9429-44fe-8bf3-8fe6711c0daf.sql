-- =============================================================================
-- SIMPLIFIED MATERIALIZE FUNCTION - Debug version
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
  -- Insert aggregated fingerprint outcomes (CUMULATIVE to p_asof)
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
      COUNT(DISTINCT lb.id) AS listing_total,
      COUNT(DISTINCT c.listing_id) AS cleared_total,
      COUNT(DISTINCT CASE WHEN lb.relist_count > 0 THEN lb.id END) AS relisted_total,
      COUNT(DISTINCT CASE WHEN c.clearance_type = 'passed_in' THEN c.listing_id END) AS passed_in_total,
      ROUND(AVG(c.days_to_clear)::numeric, 1) AS avg_days_to_clear,
      MIN(c.days_to_clear)::INTEGER AS min_days_to_clear,
      MAX(c.days_to_clear)::INTEGER AS max_days_to_clear,
      ROUND(AVG(COALESCE(lb.asking_price, lb.reserve))) AS avg_price,
      MIN(COALESCE(lb.asking_price, lb.reserve)) AS min_price,
      MAX(COALESCE(lb.asking_price, lb.reserve)) AS max_price,
      (ARRAY_AGG(lb.id ORDER BY lb.first_seen_at DESC))[1] AS example_listing_id
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
  )
  
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
    make, model, variant_family,
    year_min, year_max,
    km_band_min, km_band_max,
    fuel, transmission, region_id,
    listing_total, cleared_total, relisted_total, passed_in_total,
    avg_days_to_clear, min_days_to_clear, max_days_to_clear,
    avg_price, min_price, max_price,
    example_listing_id,
    p_asof
  FROM aggregated
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
    updated_at = now();

  GET DIAGNOSTICS v_records_upserted = ROW_COUNT;
  
  SELECT COUNT(DISTINCT region_id)::INTEGER INTO v_regions_processed
  FROM fingerprint_outcomes
  WHERE asof_date = p_asof;

  RETURN QUERY SELECT v_records_upserted, v_regions_processed;
END;
$$;