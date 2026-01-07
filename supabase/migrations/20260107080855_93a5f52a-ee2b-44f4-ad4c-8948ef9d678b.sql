-- =============================================================================
-- FINGERPRINT OUTCOMES TABLE - Daily materialized fingerprint records
-- Key: make, model, variant_family, year_band, km_band, fuel, transmission, region
-- =============================================================================

CREATE TABLE public.fingerprint_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Fingerprint key dimensions
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_family TEXT,
  year_min INTEGER NOT NULL,
  year_max INTEGER NOT NULL,
  km_band_min INTEGER,         -- e.g., 0
  km_band_max INTEGER,         -- e.g., 50000
  fuel TEXT,                   -- petrol, diesel, hybrid, electric
  transmission TEXT,           -- automatic, manual
  region_id TEXT NOT NULL,     -- e.g., CENTRAL_COAST_NSW
  
  -- Aggregated counts (materialized daily)
  listing_count INTEGER NOT NULL DEFAULT 0,
  clearance_count INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  passed_in_count INTEGER NOT NULL DEFAULT 0,
  withdrawn_count INTEGER NOT NULL DEFAULT 0,
  
  -- Timing metrics (raw, no interpretation)
  avg_days_to_clear NUMERIC(6,1),
  min_days_to_clear INTEGER,
  max_days_to_clear INTEGER,
  
  -- Price metrics (raw, no interpretation)
  avg_price NUMERIC(10,0),
  min_price NUMERIC(10,0),
  max_price NUMERIC(10,0),
  
  -- Sample listing IDs (for drill-down, max 50)
  sample_listing_ids TEXT[] DEFAULT '{}',
  
  -- Metadata
  asof_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint on fingerprint key + date
  CONSTRAINT fingerprint_outcomes_unique_key UNIQUE (
    make, model, variant_family, year_min, year_max, 
    km_band_min, km_band_max, fuel, transmission, region_id, asof_date
  )
);

-- Enable RLS (read-only for internal use)
ALTER TABLE public.fingerprint_outcomes ENABLE ROW LEVEL SECURITY;

-- Create read policy for authenticated users
CREATE POLICY "Fingerprint outcomes are readable by authenticated users"
  ON public.fingerprint_outcomes
  FOR SELECT
  USING (true);

-- Indexes for common queries
CREATE INDEX idx_fingerprint_outcomes_region_date 
  ON public.fingerprint_outcomes(region_id, asof_date DESC);

CREATE INDEX idx_fingerprint_outcomes_make_model 
  ON public.fingerprint_outcomes(make, model);

CREATE INDEX idx_fingerprint_outcomes_asof_date 
  ON public.fingerprint_outcomes(asof_date DESC);

-- Trigger for updated_at
CREATE TRIGGER update_fingerprint_outcomes_updated_at
  BEFORE UPDATE ON public.fingerprint_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- HELPER FUNCTION: Derive km_band from odometer reading
-- =============================================================================

CREATE OR REPLACE FUNCTION public.km_to_band(p_km INTEGER)
RETURNS TABLE(km_band_min INTEGER, km_band_max INTEGER)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_km IS NULL THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER;
  ELSIF p_km < 25000 THEN
    RETURN QUERY SELECT 0, 25000;
  ELSIF p_km < 50000 THEN
    RETURN QUERY SELECT 25000, 50000;
  ELSIF p_km < 75000 THEN
    RETURN QUERY SELECT 50000, 75000;
  ELSIF p_km < 100000 THEN
    RETURN QUERY SELECT 75000, 100000;
  ELSIF p_km < 150000 THEN
    RETURN QUERY SELECT 100000, 150000;
  ELSE
    RETURN QUERY SELECT 150000, 999999;
  END IF;
END;
$$;

-- =============================================================================
-- HELPER FUNCTION: Derive year_band from year
-- =============================================================================

CREATE OR REPLACE FUNCTION public.year_to_band(p_year INTEGER)
RETURNS TABLE(year_min INTEGER, year_max INTEGER)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_year IS NULL THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER;
  ELSIF p_year >= 2023 THEN
    RETURN QUERY SELECT 2023, 2026;  -- Near-new
  ELSIF p_year >= 2020 THEN
    RETURN QUERY SELECT 2020, 2022;  -- Late model
  ELSIF p_year >= 2017 THEN
    RETURN QUERY SELECT 2017, 2019;  -- Mid-age
  ELSE
    RETURN QUERY SELECT 2014, 2016;  -- Older dealer-grade
  END IF;
END;
$$;

-- =============================================================================
-- MATERIALIZE FUNCTION: Daily fingerprint outcome rollup
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
  -- Upsert aggregated fingerprint outcomes from vehicle_listings + clearance_events
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
      COUNT(DISTINCT lb.id) AS listing_count,
      COUNT(DISTINCT c.listing_id) AS clearance_count,
      COUNT(DISTINCT CASE WHEN c.clearance_type = 'sold' THEN c.listing_id END) AS sold_count,
      COUNT(DISTINCT CASE WHEN c.clearance_type = 'passed_in' THEN c.listing_id END) AS passed_in_count,
      COUNT(DISTINCT CASE WHEN c.clearance_type = 'withdrawn' THEN c.listing_id END) AS withdrawn_count,
      ROUND(AVG(c.days_to_clear)::numeric, 1) AS avg_days_to_clear,
      MIN(c.days_to_clear) AS min_days_to_clear,
      MAX(c.days_to_clear) AS max_days_to_clear,
      ROUND(AVG(COALESCE(lb.asking_price, lb.reserve))) AS avg_price,
      MIN(COALESCE(lb.asking_price, lb.reserve)) AS min_price,
      MAX(COALESCE(lb.asking_price, lb.reserve)) AS max_price,
      ARRAY_AGG(DISTINCT lb.id) FILTER (WHERE lb.id IS NOT NULL) AS all_listing_ids
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
      listing_count, clearance_count,
      sold_count, passed_in_count, withdrawn_count,
      avg_days_to_clear, min_days_to_clear, max_days_to_clear,
      avg_price, min_price, max_price,
      sample_listing_ids,
      asof_date
    )
    SELECT
      make, model, variant_family,
      year_min, year_max,
      km_band_min, km_band_max,
      fuel, transmission, region_id,
      listing_count, clearance_count,
      sold_count, passed_in_count, withdrawn_count,
      avg_days_to_clear, min_days_to_clear, max_days_to_clear,
      avg_price, min_price, max_price,
      all_listing_ids[1:50],  -- Limit to 50 sample IDs
      p_asof
    FROM aggregated
    ON CONFLICT ON CONSTRAINT fingerprint_outcomes_unique_key
    DO UPDATE SET
      listing_count = EXCLUDED.listing_count,
      clearance_count = EXCLUDED.clearance_count,
      sold_count = EXCLUDED.sold_count,
      passed_in_count = EXCLUDED.passed_in_count,
      withdrawn_count = EXCLUDED.withdrawn_count,
      avg_days_to_clear = EXCLUDED.avg_days_to_clear,
      min_days_to_clear = EXCLUDED.min_days_to_clear,
      max_days_to_clear = EXCLUDED.max_days_to_clear,
      avg_price = EXCLUDED.avg_price,
      min_price = EXCLUDED.min_price,
      max_price = EXCLUDED.max_price,
      sample_listing_ids = EXCLUDED.sample_listing_ids,
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