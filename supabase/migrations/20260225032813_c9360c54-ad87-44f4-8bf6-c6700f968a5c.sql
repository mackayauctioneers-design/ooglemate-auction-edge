
-- compute_retail_median: Exact badge matching, strict comparable bands, outlier trimming
-- Returns: median_price, sample_size, confidence_tier, comparable details

CREATE OR REPLACE FUNCTION public.compute_retail_median(
  p_make TEXT,
  p_model TEXT,
  p_badge TEXT,
  p_year INT,
  p_km INT,
  p_fuel_type TEXT DEFAULT NULL,
  p_drivetrain TEXT DEFAULT NULL,
  p_body_type TEXT DEFAULT NULL,
  p_window_days INT DEFAULT 30,
  p_year_band INT DEFAULT 1,
  p_km_band_pct NUMERIC DEFAULT 0.20
)
RETURNS TABLE(
  median_price INT,
  sample_size INT,
  confidence TEXT,
  p25_price INT,
  p75_price INT,
  min_price INT,
  max_price INT,
  comps_before_trim INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km_low INT;
  v_km_high INT;
  v_year_low INT;
  v_year_high INT;
  v_prices INT[];
  v_trimmed INT[];
  v_len INT;
  v_trim_count INT;
  v_low_idx INT;
  v_high_idx INT;
BEGIN
  -- Compute bands
  v_year_low := p_year - p_year_band;
  v_year_high := p_year + p_year_band;

  IF p_km IS NOT NULL AND p_km > 0 THEN
    v_km_low := GREATEST(0, (p_km * (1.0 - p_km_band_pct))::INT);
    v_km_high := (p_km * (1.0 + p_km_band_pct))::INT;
  ELSE
    -- If no KM provided, use wide band but still require KM on comps
    v_km_low := 0;
    v_km_high := 999999;
  END IF;

  -- Collect comparable prices with exact badge match
  SELECT ARRAY_AGG(rl.asking_price ORDER BY rl.asking_price)
  INTO v_prices
  FROM retail_listings rl
  WHERE rl.make = UPPER(p_make)
    AND rl.model = UPPER(p_model)
    AND rl.badge = UPPER(p_badge)
    AND rl.year BETWEEN v_year_low AND v_year_high
    AND rl.km IS NOT NULL
    AND rl.km BETWEEN v_km_low AND v_km_high
    AND rl.asking_price IS NOT NULL
    AND rl.asking_price > 1000
    AND rl.asking_price < 500000
    AND rl.last_seen_at >= (now() - (p_window_days || ' days')::INTERVAL)
    AND rl.lifecycle_status IN ('ACTIVE', 'RELISTED')
    -- Fuel type: exact match if provided, skip if NULL
    AND (p_fuel_type IS NULL OR rl.fuel_type = UPPER(p_fuel_type))
    -- Drivetrain: exact match if provided, skip if NULL
    AND (p_drivetrain IS NULL OR rl.drivetrain = UPPER(p_drivetrain))
    -- Body type: exact match if provided, skip if NULL
    AND (p_body_type IS NULL OR rl.body_type = UPPER(p_body_type));

  -- Check if we have enough samples
  IF v_prices IS NULL OR array_length(v_prices, 1) IS NULL THEN
    RETURN QUERY SELECT NULL::INT, 0, 'NONE'::TEXT, NULL::INT, NULL::INT, NULL::INT, NULL::INT, 0;
    RETURN;
  END IF;

  comps_before_trim := array_length(v_prices, 1);

  -- If < 3, no median
  IF comps_before_trim < 3 THEN
    RETURN QUERY SELECT NULL::INT, comps_before_trim, 'INSUFFICIENT'::TEXT, NULL::INT, NULL::INT, 
      v_prices[1], v_prices[comps_before_trim], comps_before_trim;
    RETURN;
  END IF;

  -- Trim outliers: remove bottom 5% and top 5%
  v_len := comps_before_trim;
  v_trim_count := GREATEST(1, (v_len * 0.05)::INT);
  v_low_idx := v_trim_count + 1;
  v_high_idx := v_len - v_trim_count;

  -- Ensure valid range after trimming
  IF v_low_idx > v_high_idx THEN
    v_low_idx := 1;
    v_high_idx := v_len;
  END IF;

  v_trimmed := v_prices[v_low_idx:v_high_idx];
  v_len := array_length(v_trimmed, 1);

  IF v_len IS NULL OR v_len = 0 THEN
    RETURN QUERY SELECT NULL::INT, comps_before_trim, 'INSUFFICIENT'::TEXT, NULL::INT, NULL::INT,
      v_prices[1], v_prices[comps_before_trim], comps_before_trim;
    RETURN;
  END IF;

  -- Compute P25, P50 (median), P75
  RETURN QUERY SELECT
    v_trimmed[(v_len + 1) / 2]::INT AS median_price,
    v_len AS sample_size,
    CASE
      WHEN v_len >= 10 THEN 'HIGH'
      WHEN v_len >= 6 THEN 'MEDIUM'
      WHEN v_len >= 3 THEN 'LOW'
      ELSE 'INSUFFICIENT'
    END::TEXT AS confidence,
    v_trimmed[GREATEST(1, (v_len * 0.25)::INT)]::INT AS p25_price,
    v_trimmed[LEAST(v_len, (v_len * 0.75)::INT + 1)]::INT AS p75_price,
    v_trimmed[1]::INT AS min_price,
    v_trimmed[v_len]::INT AS max_price,
    comps_before_trim;

  RETURN;
END;
$$;

-- Also create a wider fallback version for when exact badge has < 5 comps
-- Same badge but wider KM (±30%) and year (±2)
CREATE OR REPLACE FUNCTION public.compute_retail_median_wide(
  p_make TEXT,
  p_model TEXT,
  p_badge TEXT,
  p_year INT,
  p_km INT,
  p_fuel_type TEXT DEFAULT NULL,
  p_drivetrain TEXT DEFAULT NULL,
  p_body_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  median_price INT,
  sample_size INT,
  confidence TEXT,
  p25_price INT,
  p75_price INT,
  min_price INT,
  max_price INT,
  comps_before_trim INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM compute_retail_median(
    p_make, p_model, p_badge, p_year, p_km,
    p_fuel_type, p_drivetrain, p_body_type,
    45,   -- 45-day window
    2,    -- ±2 years
    0.30  -- ±30% KM
  );
$$;
