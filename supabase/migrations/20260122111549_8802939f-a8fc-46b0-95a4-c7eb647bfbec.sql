-- Final production-ready heat function with percent_rank
CREATE OR REPLACE FUNCTION fn_build_retail_geo_heat_sa2_daily(
  p_date date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- Safety: clear existing rows for this date (idempotent)
  DELETE FROM retail_geo_heat_sa2_daily
  WHERE date = p_date;

  -- Base listing window with a single model key
  -- Note: vehicle_listings has 'model' not 'model_family', so we use model directly
  WITH listing_base AS (
    SELECT
      v.sa2_code,
      v.state,
      v.make,
      v.model AS model_key,
      v.first_seen_at,
      v.delisted_at,
      v.last_seen_at,
      v.geo_confidence
    FROM vehicle_listings v
    WHERE v.state = 'NSW'
      AND v.sa2_code IS NOT NULL
  ),

  -- New listings in last 14 days
  new_14d AS (
    SELECT
      sa2_code, state, make, model_key,
      count(*) AS new_listings_14d
    FROM listing_base
    WHERE first_seen_at >= (p_date::timestamptz - interval '14 days')
      AND first_seen_at <  (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),

  -- Disappeared (sold proxy) in last 14 days
  disappeared_14d AS (
    SELECT
      sa2_code, state, make, model_key,
      count(*) AS disappeared_14d
    FROM listing_base
    WHERE delisted_at >= (p_date::timestamptz - interval '14 days')
      AND delisted_at <  (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),

  -- Active now (seen in last 7 days and not delisted)
  active_now AS (
    SELECT
      sa2_code, state, make, model_key,
      count(*) AS active_listings
    FROM listing_base
    WHERE delisted_at IS NULL
      AND last_seen_at >= (p_date::timestamptz - interval '7 days')
      AND last_seen_at <  (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),

  -- Median days to disappear
  med_days AS (
    SELECT
      sa2_code, state, make, model_key,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (delisted_at - first_seen_at)) / 86400.0
      ) AS median_days_to_disappear
    FROM listing_base
    WHERE delisted_at IS NOT NULL
      AND first_seen_at IS NOT NULL
      AND delisted_at >= (p_date::timestamptz - interval '14 days')
      AND delisted_at <  (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),

  -- Geo confidence rates per SA2
  conf_rates AS (
    SELECT
      sa2_code,
      avg(CASE WHEN geo_confidence = 'LOW' THEN 1 ELSE 0 END) AS low_rate
    FROM listing_base
    WHERE last_seen_at >= (p_date::timestamptz - interval '14 days')
    GROUP BY sa2_code
  ),

  -- Combine metrics
  combined AS (
    SELECT
      coalesce(n.sa2_code, d.sa2_code, a.sa2_code) AS sa2_code,
      coalesce(n.state, d.state, a.state) AS state,
      coalesce(n.make, d.make, a.make) AS make,
      coalesce(n.model_key, d.model_key, a.model_key) AS model_key,
      coalesce(n.new_listings_14d, 0) AS new_listings_14d,
      coalesce(d.disappeared_14d, 0) AS disappeared_14d,
      coalesce(a.active_listings, 0) AS active_listings,
      m.median_days_to_disappear,
      coalesce(c.low_rate, 0) AS low_rate
    FROM new_14d n
    FULL OUTER JOIN disappeared_14d d USING (sa2_code, state, make, model_key)
    FULL OUTER JOIN active_now a USING (sa2_code, state, make, model_key)
    LEFT JOIN med_days m USING (sa2_code, state, make, model_key)
    LEFT JOIN conf_rates c ON c.sa2_code = coalesce(n.sa2_code, d.sa2_code, a.sa2_code)
  )

  -- Insert heat rows
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
    p_date AS date,
    sa2_code,
    state,
    make,
    model_key AS model_family,
    new_listings_14d,
    disappeared_14d,
    active_listings,
    median_days_to_disappear,

    -- Heat score: percent rank within make+model
    CASE
      WHEN new_listings_14d < 5 THEN NULL
      ELSE percent_rank() OVER (
        PARTITION BY make, model_key
        ORDER BY
          (CASE WHEN new_listings_14d > 0
                THEN disappeared_14d::float / new_listings_14d
                ELSE 0 END)
        + (CASE WHEN median_days_to_disappear > 0
                THEN 1.0 / median_days_to_disappear
                ELSE 0 END)
      )
    END AS heat_score,

    -- Data quality
    CASE
      WHEN new_listings_14d < 10 THEN 'LOW_SAMPLE'
      WHEN low_rate > 0.30 THEN 'LOW_CONF'
      ELSE 'OK'
    END AS data_quality
  FROM combined
  WHERE sa2_code IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;