
-- ============================================================
-- PATTERN RECOGNITION FUNCTIONS
-- Core intelligence for wholesale manager decision-making
-- ============================================================

-- 1. VELOCITY SCORE
CREATE OR REPLACE FUNCTION public.calculate_velocity_score(
  p_account_id uuid,
  p_make text,
  p_model text,
  p_year_min integer DEFAULT NULL,
  p_year_max integer DEFAULT NULL,
  p_km_min integer DEFAULT NULL,
  p_km_max integer DEFAULT NULL
)
RETURNS TABLE (
  units_sold integer,
  median_hold_days numeric,
  pct_sold_under_15 numeric,
  pct_sold_under_30 numeric,
  pct_sold_under_45 numeric,
  velocity_score integer,
  velocity_label text
)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_median numeric;
  v_count integer;
  v_under_15 integer;
  v_under_30 integer;
  v_under_45 integer;
  v_score integer;
BEGIN
  SELECT COUNT(*), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_clear)
    INTO v_count, v_median
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make)
    AND model = UPPER(p_model)
    AND (p_year_min IS NULL OR year >= p_year_min)
    AND (p_year_max IS NULL OR year <= p_year_max)
    AND (p_km_min IS NULL OR km >= p_km_min)
    AND (p_km_max IS NULL OR km <= p_km_max)
    AND days_to_clear IS NOT NULL AND days_to_clear > 0;

  IF v_count IS NULL OR v_count < 3 THEN
    RETURN QUERY SELECT 0, NULL::numeric, 0::numeric, 0::numeric, 0::numeric, 0, 'INSUFFICIENT_DATA'::text;
    RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE days_to_clear <= 15),
         COUNT(*) FILTER (WHERE days_to_clear <= 30),
         COUNT(*) FILTER (WHERE days_to_clear <= 45)
    INTO v_under_15, v_under_30, v_under_45
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make)
    AND model = UPPER(p_model)
    AND (p_year_min IS NULL OR year >= p_year_min)
    AND (p_year_max IS NULL OR year <= p_year_max)
    AND (p_km_min IS NULL OR km >= p_km_min)
    AND (p_km_max IS NULL OR km <= p_km_max)
    AND days_to_clear IS NOT NULL AND days_to_clear > 0;

  IF v_under_30::numeric / v_count > 0.7 THEN v_score := 95;
  ELSIF v_under_30::numeric / v_count > 0.5 THEN v_score := 80;
  ELSIF v_under_30::numeric / v_count > 0.3 THEN v_score := 60;
  ELSIF v_under_45::numeric / v_count > 0.5 THEN v_score := 40;
  ELSE v_score := 20;
  END IF;

  RETURN QUERY SELECT
    v_count,
    ROUND(v_median, 1),
    ROUND(v_under_15::numeric / v_count * 100, 1),
    ROUND(v_under_30::numeric / v_count * 100, 1),
    ROUND(v_under_45::numeric / v_count * 100, 1),
    v_score,
    CASE WHEN v_score >= 80 THEN 'FAST'
         WHEN v_score >= 60 THEN 'MODERATE'
         WHEN v_score >= 40 THEN 'SLOW'
         ELSE 'VERY_SLOW' END;
END;
$$;

-- 2. MARGIN TREND
CREATE OR REPLACE FUNCTION public.calculate_margin_trend(
  p_account_id uuid,
  p_make text,
  p_model text,
  p_months integer DEFAULT 12
)
RETURNS TABLE (
  current_avg_gp numeric,
  previous_avg_gp numeric,
  trend_pct numeric,
  trend_label text,
  months_analyzed integer
)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_current numeric;
  v_previous numeric;
  v_trend numeric;
BEGIN
  SELECT AVG(sale_price - COALESCE(buy_price, 0)) INTO v_current
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make) AND model = UPPER(p_model)
    AND sold_at >= now() - interval '1 month' * (p_months / 2.0)
    AND buy_price IS NOT NULL AND sale_price IS NOT NULL;

  SELECT AVG(sale_price - COALESCE(buy_price, 0)) INTO v_previous
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make) AND model = UPPER(p_model)
    AND sold_at >= now() - interval '1 month' * p_months
    AND sold_at < now() - interval '1 month' * (p_months / 2.0)
    AND buy_price IS NOT NULL AND sale_price IS NOT NULL;

  IF v_previous IS NULL OR v_previous = 0 THEN
    RETURN QUERY SELECT v_current, v_previous, 0::numeric, 'INSUFFICIENT_DATA'::text, p_months;
    RETURN;
  END IF;

  v_trend := ROUND(((v_current - v_previous) / v_previous) * 100, 1);

  RETURN QUERY SELECT
    ROUND(v_current, 0),
    ROUND(v_previous, 0),
    v_trend,
    CASE WHEN v_trend > 10 THEN 'EXPANDING'
         WHEN v_trend > -5 THEN 'STABLE'
         WHEN v_trend > -15 THEN 'COMPRESSING'
         ELSE 'SHRINKING' END,
    p_months;
END;
$$;

-- 3. SEASONAL MULTIPLIER
CREATE OR REPLACE FUNCTION public.calculate_seasonal_multiplier(
  p_account_id uuid,
  p_make text,
  p_model text
)
RETURNS TABLE (
  current_month_avg_gp numeric,
  annual_avg_gp numeric,
  seasonal_multiplier numeric,
  current_month_units integer,
  peak_month text,
  peak_month_units integer
)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_current_month integer := EXTRACT(MONTH FROM now());
  v_current_avg numeric;
  v_annual_avg numeric;
  v_current_units integer;
  v_peak_month text;
  v_peak_units integer;
BEGIN
  SELECT AVG(sale_price - COALESCE(buy_price, 0)), COUNT(*)
    INTO v_current_avg, v_current_units
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make) AND model = UPPER(p_model)
    AND EXTRACT(MONTH FROM sold_at) = v_current_month
    AND buy_price IS NOT NULL;

  SELECT AVG(sale_price - COALESCE(buy_price, 0)) INTO v_annual_avg
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make) AND model = UPPER(p_model)
    AND sold_at >= now() - interval '12 months'
    AND buy_price IS NOT NULL;

  SELECT TO_CHAR(TO_DATE(month::text, 'MM'), 'Month'), units
    INTO v_peak_month, v_peak_units
  FROM (
    SELECT EXTRACT(MONTH FROM sold_at) AS month, COUNT(*) AS units
    FROM public.vehicle_sales_truth
    WHERE account_id = p_account_id
      AND make = UPPER(p_make) AND model = UPPER(p_model)
      AND sold_at >= now() - interval '24 months'
    GROUP BY EXTRACT(MONTH FROM sold_at)
    ORDER BY units DESC LIMIT 1
  ) sub;

  IF v_annual_avg IS NULL OR v_annual_avg = 0 THEN
    RETURN QUERY SELECT v_current_avg, v_annual_avg, 1.0::numeric, v_current_units, v_peak_month, v_peak_units;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    ROUND(v_current_avg, 0),
    ROUND(v_annual_avg, 0),
    ROUND(v_current_avg / v_annual_avg, 2),
    v_current_units,
    TRIM(v_peak_month),
    v_peak_units;
END;
$$;

-- 4. BUYER DEMAND SCORE
CREATE OR REPLACE FUNCTION public.calculate_buyer_demand_score(
  p_account_id uuid,
  p_make text,
  p_model text
)
RETURNS TABLE (
  total_units integer,
  retail_units integer,
  retail_pct numeric,
  wholesale_out_units integer,
  wholesale_out_pct numeric,
  demand_label text,
  demand_score integer
)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_retail integer;
  v_wholesale integer;
  v_score integer;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE source = 'retail'),
         COUNT(*) FILTER (WHERE source = 'wholesale_out')
    INTO v_total, v_retail, v_wholesale
  FROM public.vehicle_sales_truth
  WHERE account_id = p_account_id
    AND make = UPPER(p_make) AND model = UPPER(p_model);

  IF v_total IS NULL OR v_total = 0 THEN
    RETURN QUERY SELECT 0, 0, 0::numeric, 0, 0::numeric, 'UNKNOWN'::text, 0;
    RETURN;
  END IF;

  v_score := ROUND((v_retail::numeric / v_total) * 100)::integer;

  RETURN QUERY SELECT
    v_total,
    v_retail,
    ROUND(v_retail::numeric / v_total * 100, 1),
    v_wholesale,
    ROUND(v_wholesale::numeric / v_total * 100, 1),
    CASE WHEN v_retail::numeric / v_total > 0.75 THEN 'STRONG_RETAIL'
         WHEN v_retail::numeric / v_total > 0.5 THEN 'MIXED'
         ELSE 'WHOLESALE_HEAVY' END,
    v_score;
END;
$$;

-- 5. COMPOSITE CONFIDENCE SCORE
CREATE OR REPLACE FUNCTION public.calculate_composite_confidence(
  p_account_id uuid,
  p_make text,
  p_model text,
  p_year integer DEFAULT NULL,
  p_km integer DEFAULT NULL
)
RETURNS TABLE (
  confidence_score integer,
  tier integer,
  tier_label text,
  velocity_score integer,
  margin_trend_label text,
  margin_trend_pct numeric,
  seasonal_multiplier numeric,
  demand_label text,
  demand_score integer,
  pattern_flags text[]
)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_vel RECORD;
  v_margin RECORD;
  v_season RECORD;
  v_demand RECORD;
  v_flags text[] := ARRAY[]::text[];
  v_confidence integer;
  v_tier integer;
  v_year_min integer;
  v_year_max integer;
  v_km_min integer;
  v_km_max integer;
BEGIN
  v_year_min := CASE WHEN p_year IS NOT NULL THEN p_year - 1 ELSE NULL END;
  v_year_max := CASE WHEN p_year IS NOT NULL THEN p_year + 1 ELSE NULL END;
  v_km_min   := CASE WHEN p_km   IS NOT NULL THEN GREATEST(p_km - 30000, 0) ELSE NULL END;
  v_km_max   := CASE WHEN p_km   IS NOT NULL THEN p_km + 30000 ELSE NULL END;

  SELECT * INTO v_vel
    FROM public.calculate_velocity_score(p_account_id, p_make, p_model, v_year_min, v_year_max, v_km_min, v_km_max);

  SELECT * INTO v_margin
    FROM public.calculate_margin_trend(p_account_id, p_make, p_model, 12);

  SELECT * INTO v_season
    FROM public.calculate_seasonal_multiplier(p_account_id, p_make, p_model);

  SELECT * INTO v_demand
    FROM public.calculate_buyer_demand_score(p_account_id, p_make, p_model);

  -- Pattern flags
  IF v_vel.velocity_score >= 80 THEN v_flags := array_append(v_flags, 'fast_mover');
  ELSIF v_vel.velocity_score > 0 AND v_vel.velocity_score < 40 THEN v_flags := array_append(v_flags, 'slow_mover');
  END IF;

  IF v_margin.trend_label = 'EXPANDING' THEN v_flags := array_append(v_flags, 'margin_expanding');
  ELSIF v_margin.trend_label IN ('COMPRESSING', 'SHRINKING') THEN v_flags := array_append(v_flags, 'margin_compressing');
  END IF;

  IF v_season.seasonal_multiplier > 1.2 THEN v_flags := array_append(v_flags, 'seasonal_peak');
  ELSIF v_season.seasonal_multiplier < 0.8 THEN v_flags := array_append(v_flags, 'seasonal_trough');
  END IF;

  IF v_demand.demand_label = 'STRONG_RETAIL' THEN v_flags := array_append(v_flags, 'high_retail_demand');
  ELSIF v_demand.demand_label = 'WHOLESALE_HEAVY' THEN v_flags := array_append(v_flags, 'wholesale_dependent');
  END IF;

  -- Composite confidence: velocity 30%, margin 25%, demand 25%, seasonal 20%
  v_confidence := ROUND(
    v_vel.velocity_score * 0.30 +
    CASE v_margin.trend_label
      WHEN 'EXPANDING' THEN 90
      WHEN 'STABLE' THEN 70
      WHEN 'COMPRESSING' THEN 50
      WHEN 'SHRINKING' THEN 30
      ELSE 50
    END * 0.25 +
    v_demand.demand_score * 0.25 +
    LEAST(v_season.seasonal_multiplier * 50, 100) * 0.20
  )::integer;

  -- Tier
  IF v_vel.units_sold >= 5 AND v_vel.velocity_score >= 60 AND v_margin.trend_label NOT IN ('SHRINKING') THEN
    v_tier := 1;
  ELSIF v_vel.units_sold >= 3 AND v_vel.velocity_score >= 40 THEN
    v_tier := 2;
  ELSIF v_demand.demand_score > 50 THEN
    v_tier := 3;
  ELSE
    v_tier := 4;
  END IF;

  RETURN QUERY SELECT
    v_confidence,
    v_tier,
    CASE v_tier
      WHEN 1 THEN 'PROVEN'
      WHEN 2 THEN 'STRONG'
      WHEN 3 THEN 'EXTENSION'
      WHEN 4 THEN 'SPECULATIVE'
    END,
    v_vel.velocity_score,
    v_margin.trend_label,
    v_margin.trend_pct,
    v_season.seasonal_multiplier,
    v_demand.demand_label,
    v_demand.demand_score,
    v_flags;
END;
$$;
