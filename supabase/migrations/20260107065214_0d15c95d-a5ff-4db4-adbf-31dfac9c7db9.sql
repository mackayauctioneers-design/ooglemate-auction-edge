-- =============================================================================
-- 1. Add source_class column to distinguish auction vs classifieds semantics
-- =============================================================================
ALTER TABLE vehicle_listings 
ADD COLUMN IF NOT EXISTS source_class text NOT NULL DEFAULT 'auction';

-- Backfill: classify existing sources
UPDATE vehicle_listings
SET source_class = CASE 
  WHEN source IN ('pickles', 'pickles_crawl', 'manheim', 'grays') THEN 'auction'
  WHEN source IN ('gumtree', 'gumtree_test', 'carsales', 'facebook_marketplace', 'autotrader') THEN 'classifieds'
  ELSE 'classifieds'  -- Default new sources to classifieds
END;

-- Add index for filtering by source class
CREATE INDEX IF NOT EXISTS idx_listings_source_class ON vehicle_listings(source_class);

-- =============================================================================
-- 2. Update compute_dealer_grade to use configurable price band (defaults: 3k-150k)
-- =============================================================================
CREATE OR REPLACE FUNCTION compute_dealer_grade(
  p_year integer,
  p_asking_price integer,
  p_reserve integer,
  p_excluded_keyword text,
  p_excluded_reason text,
  p_price_min integer DEFAULT 3000,
  p_price_max integer DEFAULT 150000
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 
    -- Year gate: 2016+
    coalesce(p_year, 0) >= 2016
    -- Price band: configurable (default $3k - $150k)
    AND (
      (coalesce(p_asking_price, 0) BETWEEN p_price_min AND p_price_max)
      OR (coalesce(p_reserve, 0) BETWEEN p_price_min AND p_price_max)
      OR (p_asking_price IS NULL AND p_reserve IS NULL)  -- Allow if no price yet
    )
    -- No exclusion keywords
    AND p_excluded_keyword IS NULL
    AND p_excluded_reason IS NULL;
$$;

-- Update trigger to use new defaults
CREATE OR REPLACE FUNCTION set_dealer_grade()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_dealer_grade := compute_dealer_grade(
    NEW.year,
    NEW.asking_price,
    NEW.reserve,
    NEW.excluded_keyword,
    NEW.excluded_reason,
    3000,   -- price_min default
    150000  -- price_max default
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path TO 'public';

-- Re-backfill with new price band
UPDATE vehicle_listings
SET is_dealer_grade = compute_dealer_grade(
  year, asking_price, reserve, excluded_keyword, excluded_reason, 3000, 150000
);

-- =============================================================================
-- 3. Update rollup_geo_model_metrics_daily to filter on is_dealer_grade = true
-- =============================================================================
CREATE OR REPLACE FUNCTION rollup_geo_model_metrics_daily(p_day date DEFAULT CURRENT_DATE)
RETURNS TABLE(regions_updated integer, records_upserted integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_regions int := 0;
  v_records int := 0;
BEGIN
  INSERT INTO geo_model_metrics_daily (
    metric_date, region_id, make, model, variant_bucket,
    w_avg_days_to_clear, w_relist_rate, w_clear_count, w_listing_count, w_dealer_share
  )
  WITH base AS (
    SELECT
      p_day as metric_date,
      location_to_region(l.location) as region_id,
      coalesce(upper(l.make), 'UNKNOWN') as make,
      coalesce(upper(l.model), 'UNKNOWN') as model,
      coalesce(l.variant_family, 'ALL') as variant_bucket,
      seller_weight(l.seller_type) as w,
      l.seller_type,
      l.relist_count > 0 as relisted,
      ce.days_to_clear,
      CASE WHEN ce.id IS NOT NULL THEN 1 ELSE 0 END as cleared_flag,
      1 as listing_flag
    FROM vehicle_listings l
    LEFT JOIN clearance_events ce
      ON ce.listing_id = l.id
     AND ce.cleared_at::date = p_day
    WHERE l.is_dealer_grade = true  -- STRICT: only dealer-grade listings
      AND location_to_region(l.location) != 'UNKNOWN'
      AND l.make IS NOT NULL
      AND l.model IS NOT NULL
  ),
  agg AS (
    SELECT
      metric_date, region_id, make, model, variant_bucket,
      CASE WHEN sum(w * cleared_flag) > 0
        THEN sum(w * cleared_flag * coalesce(days_to_clear, 0)) / nullif(sum(w * cleared_flag), 0)
        ELSE NULL END as w_avg_days_to_clear,
      CASE WHEN sum(w * cleared_flag) > 0
        THEN sum(w * cleared_flag * (CASE WHEN relisted THEN 1 ELSE 0 END)) / nullif(sum(w * cleared_flag), 0)
        ELSE NULL END as w_relist_rate,
      sum(w * cleared_flag) as w_clear_count,
      sum(w * listing_flag) as w_listing_count,
      sum((CASE WHEN lower(coalesce(seller_type, '')) = 'dealer' THEN w ELSE 0 END)) / nullif(sum(w), 0) as w_dealer_share
    FROM base
    GROUP BY 1, 2, 3, 4, 5
  )
  SELECT * FROM agg
  ON CONFLICT (metric_date, region_id, make, model, variant_bucket) DO UPDATE
  SET
    w_avg_days_to_clear = excluded.w_avg_days_to_clear,
    w_relist_rate = excluded.w_relist_rate,
    w_clear_count = excluded.w_clear_count,
    w_listing_count = excluded.w_listing_count,
    w_dealer_share = excluded.w_dealer_share,
    created_at = now();

  GET DIAGNOSTICS v_records = ROW_COUNT;
  
  SELECT count(DISTINCT region_id) INTO v_regions 
  FROM geo_model_metrics_daily 
  WHERE metric_date = p_day;

  RETURN QUERY SELECT v_regions, v_records;
END;
$$;

-- =============================================================================
-- 4. Update detect_geo_heat_alerts (no change needed - uses rollup output)
--    But add comment for clarity that it only sees dealer-grade data
-- =============================================================================
COMMENT ON FUNCTION detect_geo_heat_alerts IS 
  'Detects geo heat alerts from geo_model_metrics_daily. 
   Only sees dealer-grade listings as rollup filters on is_dealer_grade=true.';

-- =============================================================================
-- 5. Update derive_clearance_events to also filter on is_dealer_grade
-- =============================================================================
CREATE OR REPLACE FUNCTION derive_clearance_events(p_stale_hours integer DEFAULT 36)
RETURNS TABLE(listings_processed integer, events_created integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_processed int := 0;
  v_created int := 0;
BEGIN
  -- Find stale active listings and create clearance events
  -- Only process dealer-grade listings for geo-liquidity pipeline
  WITH stale AS (
    SELECT l.id, l.last_seen_at, l.first_seen_at, l.status,
           CASE 
             WHEN l.relist_count > 0 THEN 'relisted'
             WHEN l.pass_count > 0 THEN 'passed_in'
             ELSE 'removed'
           END as derived_type
    FROM vehicle_listings l
    WHERE l.status IN ('catalogue', 'listed', 'active')
      AND l.last_seen_at < now() - make_interval(hours => p_stale_hours)
      AND l.is_dealer_grade = true  -- Only dealer-grade for clearance metrics
  ),
  ins AS (
    INSERT INTO clearance_events (listing_id, cleared_at, clearance_type, days_to_clear)
    SELECT
      s.id,
      s.last_seen_at,
      s.derived_type,
      GREATEST(0.1, extract(epoch from (s.last_seen_at - s.first_seen_at)) / 86400.0)
    FROM stale s
    ON CONFLICT (listing_id, clearance_type, cleared_at) DO NOTHING
    RETURNING listing_id
  )
  SELECT count(*) INTO v_created FROM ins;

  -- Update status for processed listings (all stale, not just dealer-grade)
  UPDATE vehicle_listings
  SET status = 'cleared', updated_at = now()
  WHERE id IN (
    SELECT id FROM vehicle_listings
    WHERE status IN ('catalogue', 'listed', 'active')
      AND last_seen_at < now() - make_interval(hours => p_stale_hours)
  );
  
  GET DIAGNOSTICS v_processed = ROW_COUNT;

  RETURN QUERY SELECT v_processed, v_created;
END;
$$;