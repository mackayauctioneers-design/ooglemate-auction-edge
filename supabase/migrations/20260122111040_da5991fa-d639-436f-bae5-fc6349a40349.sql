-- Fix fn_build_retail_geo_heat_sa2_daily with proper model_key derivation
CREATE OR REPLACE FUNCTION fn_build_retail_geo_heat_sa2_daily(p_date date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_upserted integer := 0;
  v_window_start date := p_date - interval '14 days';
BEGIN
  -- Build daily heat rollup for SA2 regions
  WITH listing_base AS (
    SELECT
      v.sa2_code,
      v.state,
      v.make,
      coalesce(v.model_family, v.model) as model_key,
      v.first_seen_at,
      v.delisted_at,
      v.last_seen_at,
      v.geo_confidence
    FROM vehicle_listings v
    WHERE v.state = 'NSW'
      AND v.sa2_code IS NOT NULL
      AND v.source LIKE 'dealer_site:%'
  ),
  
  metrics AS (
    SELECT
      sa2_code,
      state,
      make,
      model_key,
      -- New listings in window
      count(*) FILTER (WHERE first_seen_at >= v_window_start) as new_14d,
      -- Disappeared in window
      count(*) FILTER (WHERE delisted_at >= v_window_start AND delisted_at <= p_date) as disappeared_14d,
      -- Active listings
      count(*) FILTER (WHERE delisted_at IS NULL OR delisted_at > p_date) as active_count,
      -- Median days to disappear (for cleared listings)
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (delisted_at - first_seen_at)) / 86400
      ) FILTER (WHERE delisted_at IS NOT NULL AND delisted_at >= v_window_start) as median_days_to_disappear,
      -- Confidence check: proportion of low-confidence geo
      count(*) FILTER (WHERE geo_confidence = 'LOW')::numeric / NULLIF(count(*), 0) as low_conf_ratio
    FROM listing_base
    GROUP BY sa2_code, state, make, model_key
    HAVING count(*) >= 3  -- Minimum sample threshold
  ),
  
  scored AS (
    SELECT
      sa2_code,
      state,
      make,
      model_key,
      new_14d,
      disappeared_14d,
      active_count,
      median_days_to_disappear,
      low_conf_ratio,
      -- Absorption: disappeared / new (capped at 1)
      LEAST(1.0, disappeared_14d::numeric / NULLIF(new_14d, 0)) as absorption,
      -- Velocity: inverse of median days (faster = higher)
      CASE 
        WHEN median_days_to_disappear > 0 THEN 1.0 / median_days_to_disappear
        ELSE 0
      END as velocity,
      -- Pressure: disappeared / active
      LEAST(1.0, disappeared_14d::numeric / NULLIF(active_count, 0)) as pressure
    FROM metrics
  ),
  
  normalized AS (
    SELECT
      sa2_code,
      state,
      make,
      model_key,
      new_14d,
      disappeared_14d,
      active_count,
      median_days_to_disappear,
      low_conf_ratio,
      -- Normalize within (make, model_key) partition
      COALESCE(
        (absorption - MIN(absorption) OVER w) / NULLIF(MAX(absorption) OVER w - MIN(absorption) OVER w, 0),
        0.5
      ) as norm_absorption,
      COALESCE(
        (velocity - MIN(velocity) OVER w) / NULLIF(MAX(velocity) OVER w - MIN(velocity) OVER w, 0),
        0.5
      ) as norm_velocity,
      COALESCE(
        (pressure - MIN(pressure) OVER w) / NULLIF(MAX(pressure) OVER w - MIN(pressure) OVER w, 0),
        0.5
      ) as norm_pressure
    FROM scored
    WINDOW w AS (PARTITION BY make, model_key)
  ),
  
  final_scores AS (
    SELECT
      sa2_code,
      state,
      make,
      model_key as model_family,
      new_14d as new_listings_14d,
      disappeared_14d,
      active_count as active_listings,
      ROUND(median_days_to_disappear::numeric, 1) as median_days_to_disappear,
      -- Composite heat score (weighted average)
      ROUND((norm_absorption * 0.4 + norm_velocity * 0.35 + norm_pressure * 0.25)::numeric, 3) as heat_score,
      -- Data quality flag
      CASE
        WHEN low_conf_ratio > 0.3 THEN 'LOW_CONF'
        WHEN new_14d < 10 THEN 'LOW_SAMPLE'
        ELSE 'OK'
      END as data_quality
    FROM normalized
  )
  
  INSERT INTO retail_geo_heat_sa2_daily (
    date,
    sa2_code,
    state,
    make,
    model_family,
    new_listings_14d,
    disappeared_14d,
    active_listings,
    median_days_to_disappear,
    heat_score,
    data_quality
  )
  SELECT
    p_date,
    sa2_code,
    state,
    make,
    model_family,
    new_listings_14d,
    disappeared_14d,
    active_listings,
    median_days_to_disappear,
    heat_score,
    data_quality
  FROM final_scores
  ON CONFLICT (date, sa2_code, make, model_family) 
  DO UPDATE SET
    new_listings_14d = EXCLUDED.new_listings_14d,
    disappeared_14d = EXCLUDED.disappeared_14d,
    active_listings = EXCLUDED.active_listings,
    median_days_to_disappear = EXCLUDED.median_days_to_disappear,
    heat_score = EXCLUDED.heat_score,
    data_quality = EXCLUDED.data_quality;
  
  GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;
  
  RETURN v_rows_upserted;
END;
$$;