-- =============================================================================
-- LAST EQUIVALENT SALE RPC
-- Uses sales_normalised table/view as single source of truth
-- Tiered matching: REGION_STRICT → NATIONAL → NO_VARIANT
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_last_equivalent_sale(
  p_make text,
  p_model text,
  p_variant_used text,
  p_year int,
  p_km int,
  p_region_id text DEFAULT NULL
)
RETURNS TABLE(
  sale_date date,
  make text,
  model text,
  variant_used text,
  year int,
  km int,
  sale_price numeric,
  days_in_stock int,
  region_id text,
  match_scope text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_year_band int;
  v_km_band_min int;
  v_km_band_max int;
BEGIN
  -- Year: ±0 band (exact year match only for now)
  v_year_band := p_year;
  
  -- KM bands: 0–60k, 60–120k, 120–200k, 200k+
  IF p_km IS NULL THEN
    v_km_band_min := NULL;
    v_km_band_max := NULL;
  ELSIF p_km < 60000 THEN
    v_km_band_min := 0;
    v_km_band_max := 59999;
  ELSIF p_km < 120000 THEN
    v_km_band_min := 60000;
    v_km_band_max := 119999;
  ELSIF p_km < 200000 THEN
    v_km_band_min := 120000;
    v_km_band_max := 199999;
  ELSE
    v_km_band_min := 200000;
    v_km_band_max := 9999999;
  END IF;

  -- 1) Strict: exact region match (if provided)
  IF p_region_id IS NOT NULL AND trim(p_region_id) <> '' THEN
    RETURN QUERY
    SELECT
      s.sale_date::date,
      s.make::text,
      s.model::text,
      s.variant_used::text,
      s.year::int,
      s.km::int,
      s.sale_price::numeric,
      s.days_in_stock::int,
      s.region_id::text,
      'REGION_STRICT'::text AS match_scope
    FROM public.sales_normalised s
    WHERE upper(s.make) = upper(p_make)
      AND upper(s.model) = upper(p_model)
      AND upper(coalesce(s.variant_used,'')) = upper(coalesce(p_variant_used,''))
      AND s.year = v_year_band
      AND (v_km_band_min IS NULL OR s.km BETWEEN v_km_band_min AND v_km_band_max)
      AND upper(coalesce(s.region_id,'')) = upper(p_region_id)
    ORDER BY s.sale_date DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- 2) Fallback: ignore region (national)
  RETURN QUERY
  SELECT
    s.sale_date::date,
    s.make::text,
    s.model::text,
    s.variant_used::text,
    s.year::int,
    s.km::int,
    s.sale_price::numeric,
    s.days_in_stock::int,
    s.region_id::text,
    'NATIONAL'::text AS match_scope
  FROM public.sales_normalised s
  WHERE upper(s.make) = upper(p_make)
    AND upper(s.model) = upper(p_model)
    AND upper(coalesce(s.variant_used,'')) = upper(coalesce(p_variant_used,''))
    AND s.year = v_year_band
    AND (v_km_band_min IS NULL OR s.km BETWEEN v_km_band_min AND v_km_band_max)
  ORDER BY s.sale_date DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- 3) Wider fallback: same make/model, ignore variant (still uses year/km bands)
  RETURN QUERY
  SELECT
    s.sale_date::date,
    s.make::text,
    s.model::text,
    s.variant_used::text,
    s.year::int,
    s.km::int,
    s.sale_price::numeric,
    s.days_in_stock::int,
    s.region_id::text,
    'NO_VARIANT'::text AS match_scope
  FROM public.sales_normalised s
  WHERE upper(s.make) = upper(p_make)
    AND upper(s.model) = upper(p_model)
    AND s.year = v_year_band
    AND (v_km_band_min IS NULL OR s.km BETWEEN v_km_band_min AND v_km_band_max)
  ORDER BY s.sale_date DESC
  LIMIT 1;

END;
$$;