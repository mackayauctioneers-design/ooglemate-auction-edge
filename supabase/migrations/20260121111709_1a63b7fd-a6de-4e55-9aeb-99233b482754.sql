-- Add missing delisted_at column to vehicle_listings
ALTER TABLE vehicle_listings 
  ADD COLUMN IF NOT EXISTS delisted_at TIMESTAMPTZ;

-- Add composite index for heat rollup query performance
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_heat
ON vehicle_listings (source, sa2_code, first_seen_at, last_seen_at, delisted_at);

-- Update the upsert function to use delisted_at
CREATE OR REPLACE FUNCTION fn_upsert_retail_listing_and_sighting(
  p_listing_id TEXT,
  p_source TEXT,
  p_url TEXT,
  p_make TEXT,
  p_model TEXT,
  p_model_family TEXT,
  p_price INTEGER,
  p_km INTEGER,
  p_state TEXT,
  p_suburb TEXT,
  p_postcode TEXT,
  p_location_raw TEXT,
  p_seen_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_sa2_code TEXT;
  v_conf TEXT;
  v_sa2_name TEXT;
  v_uuid UUID;
BEGIN
  -- Resolve SA2 if possible
  IF p_state IS NOT NULL AND p_postcode IS NOT NULL THEN
    SELECT r.sa2_code, r.confidence INTO v_sa2_code, v_conf
    FROM fn_resolve_sa2_from_postcode(p_state, p_postcode) r;
  END IF;

  IF v_sa2_code IS NOT NULL THEN
    SELECT geo_sa2.sa2_name INTO v_sa2_name FROM geo_sa2 WHERE geo_sa2.sa2_code = v_sa2_code;
  END IF;

  -- Upsert listing master into vehicle_listings
  INSERT INTO vehicle_listings (
    source_listing_id, source, listing_url, make, model, variant_family, price, km,
    state, suburb, postcode, location,
    sa2_code, sa2_name, geo_confidence, geo_source,
    first_seen_at, last_seen_at, updated_at
  )
  VALUES (
    p_listing_id, p_source, p_url, p_make, p_model, p_model_family, p_price, p_km,
    p_state, p_suburb, p_postcode, p_location_raw,
    v_sa2_code, v_sa2_name, v_conf, 'listing_location',
    p_seen_at, p_seen_at, NOW()
  )
  ON CONFLICT (source, source_listing_id) DO UPDATE SET
    listing_url = EXCLUDED.listing_url,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    variant_family = EXCLUDED.variant_family,
    price = EXCLUDED.price,
    km = EXCLUDED.km,
    state = EXCLUDED.state,
    suburb = EXCLUDED.suburb,
    postcode = EXCLUDED.postcode,
    location = EXCLUDED.location,
    sa2_code = COALESCE(EXCLUDED.sa2_code, vehicle_listings.sa2_code),
    sa2_name = COALESCE(EXCLUDED.sa2_name, vehicle_listings.sa2_name),
    geo_confidence = COALESCE(EXCLUDED.geo_confidence, vehicle_listings.geo_confidence),
    geo_source = 'listing_location',
    last_seen_at = EXCLUDED.last_seen_at,
    reappeared = CASE WHEN vehicle_listings.delisted_at IS NOT NULL THEN TRUE ELSE vehicle_listings.reappeared END,
    delisted_at = NULL,
    updated_at = NOW()
  RETURNING id INTO v_uuid;

  -- Insert sighting event
  INSERT INTO retail_listing_sightings (listing_id, seen_at, price, km, sa2_code, source)
  VALUES (v_uuid, p_seen_at, p_price, p_km, v_sa2_code, p_source)
  ON CONFLICT DO NOTHING;

  RETURN v_uuid;
END;
$$;

-- Fix: Update heat rollup function with proper LOW_CONF gate (proportion-based) 
-- and per-model normalization
CREATE OR REPLACE FUNCTION fn_build_retail_geo_heat_sa2_daily(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Build raw metrics into a temp table
  CREATE TEMPORARY TABLE tmp_heat_raw ON COMMIT DROP AS
  WITH listing_base AS (
    SELECT
      vl.sa2_code,
      COALESCE(vl.state, gs.state) AS state,
      vl.make,
      vl.variant_family AS model_family,
      vl.first_seen_at,
      vl.delisted_at AS disappeared_at,
      vl.last_seen_at,
      vl.geo_confidence
    FROM vehicle_listings vl
    LEFT JOIN geo_sa2 gs ON gs.sa2_code = vl.sa2_code
    WHERE vl.sa2_code IS NOT NULL
      AND vl.source IN ('gumtree_dealer', 'gumtree_private', 'autotrader', 'carsales', 'drive')
  ),
  new_14d AS (
    SELECT sa2_code, state, make, model_family, COUNT(*) AS new_listings_14d
    FROM listing_base
    WHERE first_seen_at >= (p_date::TIMESTAMPTZ - INTERVAL '14 days')
      AND first_seen_at < (p_date::TIMESTAMPTZ + INTERVAL '1 day')
    GROUP BY 1,2,3,4
  ),
  disappeared_14d AS (
    SELECT sa2_code, state, make, model_family, COUNT(*) AS disappeared_14d
    FROM listing_base
    WHERE disappeared_at >= (p_date::TIMESTAMPTZ - INTERVAL '14 days')
      AND disappeared_at < (p_date::TIMESTAMPTZ + INTERVAL '1 day')
    GROUP BY 1,2,3,4
  ),
  active_now AS (
    SELECT sa2_code, state, make, model_family, COUNT(*) AS active_listings
    FROM listing_base
    WHERE disappeared_at IS NULL
      AND last_seen_at >= (p_date::TIMESTAMPTZ - INTERVAL '7 days')
      AND last_seen_at < (p_date::TIMESTAMPTZ + INTERVAL '1 day')
    GROUP BY 1,2,3,4
  ),
  med_days AS (
    SELECT
      sa2_code, state, make, model_family,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (disappeared_at - first_seen_at)) / 86400.0) AS median_days_to_disappear
    FROM listing_base
    WHERE disappeared_at IS NOT NULL
      AND first_seen_at IS NOT NULL
      AND disappeared_at >= (p_date::TIMESTAMPTZ - INTERVAL '14 days')
      AND disappeared_at < (p_date::TIMESTAMPTZ + INTERVAL '1 day')
    GROUP BY 1,2,3,4
  ),
  -- FIX: Proper LOW_CONF gate using proportions per SA2
  conf_rates AS (
    SELECT
      sa2_code,
      AVG(CASE WHEN geo_confidence = 'LOW' THEN 1 ELSE 0 END) AS low_rate,
      COUNT(*) AS n
    FROM listing_base
    WHERE last_seen_at >= (p_date::TIMESTAMPTZ - INTERVAL '14 days')
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
    COALESCE(cr.low_rate, 1) AS low_rate
  FROM new_14d n
  FULL OUTER JOIN disappeared_14d d USING (sa2_code, state, make, model_family)
  FULL OUTER JOIN active_now a USING (sa2_code, state, make, model_family)
  LEFT JOIN med_days m USING (sa2_code, state, make, model_family)
  LEFT JOIN conf_rates cr ON cr.sa2_code = COALESCE(n.sa2_code, d.sa2_code, a.sa2_code);

  -- Compute raw components
  ALTER TABLE tmp_heat_raw ADD COLUMN absorption DOUBLE PRECISION;
  ALTER TABLE tmp_heat_raw ADD COLUMN velocity DOUBLE PRECISION;
  ALTER TABLE tmp_heat_raw ADD COLUMN pressure DOUBLE PRECISION;

  UPDATE tmp_heat_raw
  SET absorption = CASE WHEN new_listings_14d > 0 THEN disappeared_14d::DOUBLE PRECISION / new_listings_14d ELSE 0 END,
      velocity   = CASE WHEN median_days_to_disappear IS NOT NULL AND median_days_to_disappear > 0 THEN 1.0 / median_days_to_disappear::DOUBLE PRECISION ELSE 0 END,
      pressure   = CASE WHEN active_listings > 0 THEN disappeared_14d::DOUBLE PRECISION / active_listings ELSE 0 END;

  -- FIX: Min/max for normalisation PARTITIONED BY make+model_family (per-model normalization)
  CREATE TEMPORARY TABLE tmp_minmax ON COMMIT DROP AS
  SELECT
    make,
    model_family,
    MIN(absorption) AS min_abs, MAX(absorption) AS max_abs,
    MIN(velocity)   AS min_vel, MAX(velocity)   AS max_vel,
    MIN(pressure)   AS min_pre, MAX(pressure)   AS max_pre
  FROM tmp_heat_raw
  GROUP BY make, model_family;

  -- Insert/Upsert into daily table
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
    )::NUMERIC AS heat_score,
    -- FIX: Use proportion-based LOW_CONF gate (>30% low confidence = LOW_CONF)
    CASE
      WHEN r.new_listings_14d < 10 THEN 'LOW_SAMPLE'
      WHEN r.low_rate > 0.30 THEN 'LOW_CONF'
      ELSE 'OK'
    END AS data_quality
  FROM tmp_heat_raw r
  LEFT JOIN tmp_minmax mm ON mm.make = r.make AND mm.model_family = r.model_family
  WHERE r.sa2_code IS NOT NULL
  ON CONFLICT (date, sa2_code, make, model_family) DO UPDATE SET
    new_listings_14d = EXCLUDED.new_listings_14d,
    disappeared_14d = EXCLUDED.disappeared_14d,
    active_listings = EXCLUDED.active_listings,
    median_days_to_disappear = EXCLUDED.median_days_to_disappear,
    heat_score = EXCLUDED.heat_score,
    data_quality = EXCLUDED.data_quality;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;