-- ============================================================================
-- PRICE MEMORY + BUY RANGE INTELLIGENCE
-- Create new RPCs (band functions already exist with correct signatures)
-- ============================================================================

-- 1) Create indexes on sales_normalised if not exist
CREATE INDEX IF NOT EXISTS idx_sales_norm_mmy ON public.sales_normalised (make, model, year);
CREATE INDEX IF NOT EXISTS idx_sales_norm_variant ON public.sales_normalised (variant_used);
CREATE INDEX IF NOT EXISTS idx_sales_norm_sale_date ON public.sales_normalised (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_norm_region ON public.sales_normalised (region_id);

-- 2) Core RPC: get_price_memory()
DROP FUNCTION IF EXISTS public.get_price_memory(text, text, text, int, int, text);

CREATE OR REPLACE FUNCTION public.get_price_memory(
  p_make text,
  p_model text,
  p_variant_used text,
  p_year int,
  p_km int,
  p_region_id text
)
RETURNS TABLE(
  match_scope text,
  sample_count int,
  last_sale_date date,
  last_sale_price numeric,
  last_days_in_stock int,
  median_price numeric,
  q1_price numeric,
  q3_price numeric,
  avg_days_in_stock numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_year_min int;
  v_year_max int;
  v_km_min int;
  v_km_max int;
BEGIN
  -- Year band calculation inline
  v_year_min := CASE
    WHEN p_year IS NULL THEN NULL
    WHEN p_year >= 2023 THEN 2023
    WHEN p_year >= 2020 THEN 2020
    WHEN p_year >= 2017 THEN 2017
    WHEN p_year >= 2014 THEN 2014
    ELSE 2010
  END;
  v_year_max := CASE
    WHEN p_year IS NULL THEN NULL
    WHEN p_year >= 2023 THEN 2026
    WHEN p_year >= 2020 THEN 2022
    WHEN p_year >= 2017 THEN 2019
    WHEN p_year >= 2014 THEN 2016
    ELSE 2013
  END;
  
  -- KM band calculation inline
  v_km_min := CASE
    WHEN p_km IS NULL THEN NULL
    WHEN p_km < 60000 THEN 0
    WHEN p_km < 120000 THEN 60000
    WHEN p_km < 200000 THEN 120000
    ELSE 200000
  END;
  v_km_max := CASE
    WHEN p_km IS NULL THEN NULL
    WHEN p_km < 60000 THEN 59999
    WHEN p_km < 120000 THEN 119999
    WHEN p_km < 200000 THEN 199999
    ELSE 999999
  END;

  -- 1) REGION_STRICT
  IF COALESCE(TRIM(p_region_id),'') <> '' THEN
    RETURN QUERY
    WITH base AS (
      SELECT s.*
      FROM public.sales_normalised s
      WHERE upper(s.make) = upper(p_make)
        AND upper(s.model) = upper(p_model)
        AND upper(coalesce(s.variant_used,'')) = upper(coalesce(p_variant_used,''))
        AND (v_year_min IS NULL OR s.year BETWEEN v_year_min AND v_year_max)
        AND (v_km_min IS NULL OR s.km BETWEEN v_km_min AND v_km_max)
        AND upper(coalesce(s.region_id,'')) = upper(p_region_id)
        AND s.sale_price IS NOT NULL AND s.sale_price > 0
    ),
    stats AS (
      SELECT
        COUNT(*)::int AS sample_count,
        percentile_disc(0.5) WITHIN GROUP (ORDER BY sale_price) AS median_price,
        percentile_disc(0.25) WITHIN GROUP (ORDER BY sale_price) AS q1_price,
        percentile_disc(0.75) WITHIN GROUP (ORDER BY sale_price) AS q3_price,
        AVG(days_in_stock)::numeric AS avg_days_in_stock
      FROM base
    ),
    last_sale AS (
      SELECT sale_date AS last_sale_date, sale_price AS last_sale_price, days_in_stock AS last_days_in_stock
      FROM base
      ORDER BY sale_date DESC NULLS LAST
      LIMIT 1
    )
    SELECT
      'REGION_STRICT'::text,
      st.sample_count,
      ls.last_sale_date,
      ls.last_sale_price,
      ls.last_days_in_stock,
      st.median_price,
      st.q1_price,
      st.q3_price,
      st.avg_days_in_stock
    FROM stats st
    LEFT JOIN last_sale ls ON true
    WHERE st.sample_count > 0;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- 2) NATIONAL (variant matched)
  RETURN QUERY
  WITH base AS (
    SELECT s.*
    FROM public.sales_normalised s
    WHERE upper(s.make) = upper(p_make)
      AND upper(s.model) = upper(p_model)
      AND upper(coalesce(s.variant_used,'')) = upper(coalesce(p_variant_used,''))
      AND (v_year_min IS NULL OR s.year BETWEEN v_year_min AND v_year_max)
      AND (v_km_min IS NULL OR s.km BETWEEN v_km_min AND v_km_max)
      AND s.sale_price IS NOT NULL AND s.sale_price > 0
  ),
  stats AS (
    SELECT
      COUNT(*)::int AS sample_count,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY sale_price) AS median_price,
      percentile_disc(0.25) WITHIN GROUP (ORDER BY sale_price) AS q1_price,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY sale_price) AS q3_price,
      AVG(days_in_stock)::numeric AS avg_days_in_stock
    FROM base
  ),
  last_sale AS (
    SELECT sale_date AS last_sale_date, sale_price AS last_sale_price, days_in_stock AS last_days_in_stock
    FROM base
    ORDER BY sale_date DESC NULLS LAST
    LIMIT 1
  )
  SELECT
    'NATIONAL'::text,
    st.sample_count,
    ls.last_sale_date,
    ls.last_sale_price,
    ls.last_days_in_stock,
    st.median_price,
    st.q1_price,
    st.q3_price,
    st.avg_days_in_stock
  FROM stats st
  LEFT JOIN last_sale ls ON true
  WHERE st.sample_count > 0;

  IF FOUND THEN
    RETURN;
  END IF;

  -- 3) NO_VARIANT (ignore variant_used)
  RETURN QUERY
  WITH base AS (
    SELECT s.*
    FROM public.sales_normalised s
    WHERE upper(s.make) = upper(p_make)
      AND upper(s.model) = upper(p_model)
      AND (v_year_min IS NULL OR s.year BETWEEN v_year_min AND v_year_max)
      AND (v_km_min IS NULL OR s.km BETWEEN v_km_min AND v_km_max)
      AND s.sale_price IS NOT NULL AND s.sale_price > 0
  ),
  stats AS (
    SELECT
      COUNT(*)::int AS sample_count,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY sale_price) AS median_price,
      percentile_disc(0.25) WITHIN GROUP (ORDER BY sale_price) AS q1_price,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY sale_price) AS q3_price,
      AVG(days_in_stock)::numeric AS avg_days_in_stock
    FROM base
  ),
  last_sale AS (
    SELECT sale_date AS last_sale_date, sale_price AS last_sale_price, days_in_stock AS last_days_in_stock
    FROM base
    ORDER BY sale_date DESC NULLS LAST
    LIMIT 1
  )
  SELECT
    'NO_VARIANT'::text,
    st.sample_count,
    ls.last_sale_date,
    ls.last_sale_price,
    ls.last_days_in_stock,
    st.median_price,
    st.q1_price,
    st.q3_price,
    st.avg_days_in_stock
  FROM stats st
  LEFT JOIN last_sale ls ON true
  WHERE st.sample_count > 0;

END;
$$;

-- 3) RPC: get_buy_range()
DROP FUNCTION IF EXISTS public.get_buy_range(text, text, text, int, int, text, numeric);

CREATE OR REPLACE FUNCTION public.get_buy_range(
  p_make text,
  p_model text,
  p_variant_used text,
  p_year int,
  p_km int,
  p_region_id text,
  p_current_price numeric
)
RETURNS TABLE(
  match_scope text,
  sample_count int,
  q1_price numeric,
  median_price numeric,
  q3_price numeric,
  buy_low numeric,
  buy_high numeric,
  stretch_high numeric,
  position_label text,
  position_note text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  pm record;
BEGIN
  SELECT * INTO pm
  FROM public.get_price_memory(p_make, p_model, p_variant_used, p_year, p_km, p_region_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  match_scope := pm.match_scope;
  sample_count := pm.sample_count;
  q1_price := pm.q1_price;
  median_price := pm.median_price;
  q3_price := pm.q3_price;

  buy_low := pm.q1_price;
  buy_high := pm.median_price;
  stretch_high := pm.q3_price;

  IF p_current_price IS NULL OR p_current_price <= 0 THEN
    position_label := 'NO_PRICE';
    position_note := 'No current price/reserve. Track at auction.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF pm.q1_price IS NOT NULL AND p_current_price <= pm.q1_price THEN
    position_label := 'STRONG_BUY';
    position_note := 'At or below Q1 (cheap relative to history).';
  ELSIF pm.median_price IS NOT NULL AND p_current_price <= pm.median_price THEN
    position_label := 'BUY_WINDOW';
    position_note := 'Between Q1 and Median.';
  ELSIF pm.q3_price IS NOT NULL AND p_current_price <= pm.q3_price THEN
    position_label := 'STRETCH';
    position_note := 'Between Median and Q3 (margin tightening).';
  ELSE
    position_label := 'OVER';
    position_note := 'Above Q3 (not attractive unless special).';
  END IF;

  RETURN NEXT;
END;
$$;