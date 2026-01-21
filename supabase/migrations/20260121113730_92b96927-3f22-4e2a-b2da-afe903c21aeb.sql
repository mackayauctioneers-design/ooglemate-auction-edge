-- Update fn_mark_retail_disappeared to include dealer_site:* sources
CREATE OR REPLACE FUNCTION fn_mark_retail_disappeared(p_grace_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE vehicle_listings vl
  SET delisted_at = vl.last_seen_at,
      lifecycle_state = 'OFF_MARKET',
      updated_at = now()
  WHERE vl.delisted_at IS NULL
    AND vl.last_seen_at IS NOT NULL
    AND vl.last_seen_at < now() - (p_grace_days || ' days')::interval
    AND (
      vl.source LIKE 'dealer_site:%'
      OR vl.source IN ('gumtree_dealer','gumtree_private','autotrader','carsales','drive')
    )
    AND vl.source NOT IN ('manheim','auto_auctions_aav','f3');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Update fn_build_retail_geo_heat_sa2_daily to include dealer_site:* sources
CREATE OR REPLACE FUNCTION fn_build_retail_geo_heat_sa2_daily(p_date date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  -- Build raw metrics into a temp table
  CREATE TEMPORARY TABLE tmp_heat_raw ON COMMIT DROP AS
  WITH listing_base AS (
    SELECT
      vl.sa2_code,
      COALESCE(vl.state, gs.state) AS state,
      vl.make,
      vl.model_family,
      vl.first_seen_at,
      vl.delisted_at,
      vl.last_seen_at,
      vl.geo_confidence
    FROM vehicle_listings vl
    LEFT JOIN geo_sa2 gs ON gs.sa2_code = vl.sa2_code
    WHERE vl.sa2_code IS NOT NULL
      AND (
        vl.source LIKE 'dealer_site:%'
        OR vl.source IN ('gumtree_dealer','gumtree_private','autotrader','carsales','drive')
      )
      AND vl.source NOT IN ('manheim','auto_auctions_aav','f3')
  ),
  new_14d AS (
    SELECT sa2_code, state, make, model_family, count(*) AS new_listings_14d
    FROM listing_base
    WHERE first_seen_at >= (p_date::timestamptz - interval '14 days')
      AND first_seen_at < (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),
  disappeared_14d AS (
    SELECT sa2_code, state, make, model_family, count(*) AS disappeared_14d
    FROM listing_base
    WHERE delisted_at >= (p_date::timestamptz - interval '14 days')
      AND delisted_at < (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),
  active_now AS (
    SELECT sa2_code, state, make, model_family, count(*) AS active_listings
    FROM listing_base
    WHERE delisted_at IS NULL
      AND last_seen_at >= (p_date::timestamptz - interval '7 days')
      AND last_seen_at < (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),
  med_days AS (
    SELECT
      sa2_code, state, make, model_family,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (delisted_at - first_seen_at)) / 86400.0) AS median_days_to_disappear
    FROM listing_base
    WHERE delisted_at IS NOT NULL
      AND first_seen_at IS NOT NULL
      AND delisted_at >= (p_date::timestamptz - interval '14 days')
      AND delisted_at < (p_date::timestamptz + interval '1 day')
    GROUP BY 1,2,3,4
  ),
  -- Proportion-based confidence gate per SA2
  conf_rates AS (
    SELECT
      sa2_code,
      avg(CASE WHEN geo_confidence = 'LOW' THEN 1 ELSE 0 END) AS low_rate,
      count(*) AS n
    FROM listing_base
    WHERE last_seen_at >= (p_date::timestamptz - interval '14 days')
    GROUP BY sa2_code
  )
  SELECT
    COALESCE(n.sa2_code, d.sa2_code, a.sa2_code) AS sa2_code,
    COALESCE(n.state, d.state, a.state) AS state,
    COALESCE(n.make, d.make, a.make) AS make,
    COALESCE(n.model_family, d.model_family, a.model_family) AS model_family,
    COALESCE(n.new_listings_14d, 0) AS new_listings_14d,
    COALESCE(d.disappeared_14d, 0) AS disappeared_14d,
    COALESCE(a.active_listings, 0) AS active_listings,
    m.median_days_to_disappear,
    c.low_rate
  FROM new_14d n
  FULL OUTER JOIN disappeared_14d d USING (sa2_code, state, make, model_family)
  FULL OUTER JOIN active_now a USING (sa2_code, state, make, model_family)
  LEFT JOIN med_days m USING (sa2_code, state, make, model_family)
  LEFT JOIN conf_rates c ON c.sa2_code = COALESCE(n.sa2_code, d.sa2_code, a.sa2_code);

  -- Compute raw components
  ALTER TABLE tmp_heat_raw ADD COLUMN absorption double precision;
  ALTER TABLE tmp_heat_raw ADD COLUMN velocity double precision;
  ALTER TABLE tmp_heat_raw ADD COLUMN pressure double precision;

  UPDATE tmp_heat_raw
  SET absorption = CASE WHEN new_listings_14d > 0 THEN disappeared_14d::double precision / new_listings_14d ELSE 0 END,
      velocity   = CASE WHEN median_days_to_disappear IS NOT NULL AND median_days_to_disappear > 0 THEN 1.0 / median_days_to_disappear::double precision ELSE 0 END,
      pressure   = CASE WHEN active_listings > 0 THEN disappeared_14d::double precision / active_listings ELSE 0 END;

  -- Min/max for normalisation per make+model_family (per-model normalization)
  CREATE TEMPORARY TABLE tmp_minmax ON COMMIT DROP AS
  SELECT
    make,
    model_family,
    min(absorption) AS min_abs, max(absorption) AS max_abs,
    min(velocity)   AS min_vel, max(velocity)   AS max_vel,
    min(pressure)   AS min_pre, max(pressure)   AS max_pre
  FROM tmp_heat_raw
  GROUP BY make, model_family;

  -- Insert/Upsert into daily table with quality gating
  INSERT INTO retail_geo_heat_sa2_daily (
    date, sa2_code, state, make, model_family,
    new_listings_14d, disappeared_14d, active_listings,
    median_days_to_disappear, heat_score, data_quality
  )
  SELECT
    p_date AS date,
    r.sa2_code,
    r.state,
    r.make,
    r.model_family,
    r.new_listings_14d,
    r.disappeared_14d,
    r.active_listings,
    r.median_days_to_disappear,
    (
      0.45 * (CASE WHEN (mm.max_abs - mm.min_abs) > 0 THEN (r.absorption - mm.min_abs) / (mm.max_abs - mm.min_abs) ELSE 0 END) +
      0.35 * (CASE WHEN (mm.max_vel - mm.min_vel) > 0 THEN (r.velocity   - mm.min_vel) / (mm.max_vel - mm.min_vel) ELSE 0 END) +
      0.20 * (CASE WHEN (mm.max_pre - mm.min_pre) > 0 THEN (r.pressure   - mm.min_pre) / (mm.max_pre - mm.min_pre) ELSE 0 END)
    )::numeric AS heat_score,
    CASE
      WHEN r.new_listings_14d < 10 THEN 'LOW_SAMPLE'
      WHEN COALESCE(r.low_rate, 1) > 0.30 THEN 'LOW_CONF'
      ELSE 'OK'
    END AS data_quality
  FROM tmp_heat_raw r
  LEFT JOIN tmp_minmax mm ON mm.make = r.make AND mm.model_family = r.model_family
  ON CONFLICT (date, sa2_code, make, model_family) DO UPDATE SET
    new_listings_14d = EXCLUDED.new_listings_14d,
    disappeared_14d = EXCLUDED.disappeared_14d,
    active_listings = EXCLUDED.active_listings,
    median_days_to_disappear = EXCLUDED.median_days_to_disappear,
    heat_score = EXCLUDED.heat_score,
    data_quality = EXCLUDED.data_quality;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated;
END;
$$;