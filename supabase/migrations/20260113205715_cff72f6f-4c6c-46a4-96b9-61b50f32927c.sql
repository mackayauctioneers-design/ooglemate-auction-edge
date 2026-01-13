-- ============================================================
-- SPEC-AWARE "LAST EQUIVALENT SALE" (DB + UI-ready)
-- ============================================================

-- 1) Indexes for speed (if not already created)
CREATE INDEX IF NOT EXISTS sales_norm_mmvy_idx
  ON public.sales_normalised (make, model, year, sale_date DESC);

CREATE INDEX IF NOT EXISTS sales_norm_variant_idx
  ON public.sales_normalised (make, model, variant_used, year, sale_date DESC);

CREATE INDEX IF NOT EXISTS sales_norm_region_idx
  ON public.sales_normalised (region_id, make, model, year, sale_date DESC);

CREATE INDEX IF NOT EXISTS sales_norm_km_idx
  ON public.sales_normalised (km);


-- 2) Helper: km band (tight but useful)
CREATE OR REPLACE FUNCTION public.km_band_minmax(p_km int)
RETURNS TABLE(km_min int, km_max int)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    CASE
      WHEN p_km IS NULL THEN NULL
      WHEN p_km < 60000 THEN 0
      WHEN p_km < 120000 THEN 60000
      WHEN p_km < 200000 THEN 120000
      ELSE 200000
    END AS km_min,
    CASE
      WHEN p_km IS NULL THEN NULL
      WHEN p_km < 60000 THEN 60000
      WHEN p_km < 120000 THEN 120000
      WHEN p_km < 200000 THEN 200000
      ELSE 999999
    END AS km_max;
$$;


-- 3) Core RPC: last equivalent sale (tiered)
-- Tier 1: region + make/model + variant + year + km band
-- Tier 2: national + make/model + variant + year + km band
-- Tier 3: national + make/model (ignore variant) + year + km band
DROP FUNCTION IF EXISTS public.get_last_equivalent_sale(text, text, text, int, int, text);

CREATE OR REPLACE FUNCTION public.get_last_equivalent_sale(
  p_make text,
  p_model text,
  p_variant_used text,
  p_year int,
  p_km int,
  p_region_id text
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
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_km_min int;
  v_km_max int;
BEGIN
  SELECT b.km_min, b.km_max INTO v_km_min, v_km_max
  FROM public.km_band_minmax(p_km) b;

  -- 1) REGION_STRICT
  IF COALESCE(TRIM(p_region_id), '') <> '' THEN
    RETURN QUERY
    SELECT
      s.sale_date,
      s.make,
      s.model,
      s.variant_used,
      s.year,
      s.km,
      s.sale_price,
      s.days_in_stock,
      s.region_id,
      'REGION_STRICT'::text
    FROM public.sales_normalised s
    WHERE upper(s.make) = upper(p_make)
      AND upper(s.model) = upper(p_model)
      AND upper(coalesce(s.variant_used,'')) = upper(coalesce(p_variant_used,''))
      AND s.year = p_year
      AND (v_km_min IS NULL OR s.km BETWEEN v_km_min AND v_km_max)
      AND upper(coalesce(s.region_id,'')) = upper(p_region_id)
    ORDER BY s.sale_date DESC NULLS LAST
    LIMIT 1;

    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2) NATIONAL (same variant)
  RETURN QUERY
  SELECT
    s.sale_date,
    s.make,
    s.model,
    s.variant_used,
    s.year,
    s.km,
    s.sale_price,
    s.days_in_stock,
    s.region_id,
    'NATIONAL'::text
  FROM public.sales_normalised s
  WHERE upper(s.make) = upper(p_make)
    AND upper(s.model) = upper(p_model)
    AND upper(coalesce(s.variant_used,'')) = upper(coalesce(p_variant_used,''))
    AND s.year = p_year
    AND (v_km_min IS NULL OR s.km BETWEEN v_km_min AND v_km_max)
  ORDER BY s.sale_date DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- 3) NO_VARIANT (still uses year + km band)
  RETURN QUERY
  SELECT
    s.sale_date,
    s.make,
    s.model,
    s.variant_used,
    s.year,
    s.km,
    s.sale_price,
    s.days_in_stock,
    s.region_id,
    'NO_VARIANT'::text
  FROM public.sales_normalised s
  WHERE upper(s.make) = upper(p_make)
    AND upper(s.model) = upper(p_model)
    AND s.year = p_year
    AND (v_km_min IS NULL OR s.km BETWEEN v_km_min AND v_km_max)
  ORDER BY s.sale_date DESC NULLS LAST
  LIMIT 1;

END;
$$;


-- 4) UI wrapper RPC (keeps params stable, returns [] if missing inputs)
DROP FUNCTION IF EXISTS public.get_last_equivalent_sale_ui(text, text, text, int, int, text);

CREATE OR REPLACE FUNCTION public.get_last_equivalent_sale_ui(
  p_make text,
  p_model text,
  p_variant_used text,
  p_year int,
  p_km int,
  p_region_id text
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
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT * FROM public.get_last_equivalent_sale(
    p_make, p_model, p_variant_used, p_year, p_km, p_region_id
  );
$$;


-- 5) SPEC-AWARE RPC: last equivalent sale for a dealer spec
-- Works with dealer_specs table (make, model, variant_family, year_min, region_scope)
DROP FUNCTION IF EXISTS public.get_last_equivalent_sale_for_spec(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_last_equivalent_sale_for_spec(
  p_dealer_id uuid,
  p_spec_id uuid
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
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_make text;
  v_model text;
  v_variant text;
  v_year int;
  v_region text;
BEGIN
  -- Try dealer_specs first (new table)
  SELECT
    s.make,
    s.model,
    COALESCE(s.variant_family, '') as variant,
    COALESCE(s.year_min, EXTRACT(YEAR FROM CURRENT_DATE)::int - 3) as year,
    CASE WHEN s.region_scope = 'ALL' THEN NULL ELSE s.region_scope END as region
  INTO v_make, v_model, v_variant, v_year, v_region
  FROM public.dealer_specs s
  WHERE s.id = p_spec_id
    AND s.dealer_id = p_dealer_id
    AND s.deleted_at IS NULL
  LIMIT 1;

  -- Fallback to dealer_fingerprints if not found in dealer_specs
  IF v_make IS NULL THEN
    SELECT
      df.make,
      df.model,
      COALESCE(df.variant_family, '') as variant,
      df.year_min as year,
      NULL as region
    INTO v_make, v_model, v_variant, v_year, v_region
    FROM public.dealer_fingerprints df
    WHERE df.id = p_spec_id
      AND df.dealer_profile_id = p_dealer_id
    LIMIT 1;
  END IF;

  IF v_make IS NULL OR v_model IS NULL THEN
    RETURN;
  END IF;

  -- km unknown at spec level, pass NULL -> handled by function via NULL band
  RETURN QUERY
  SELECT *
  FROM public.get_last_equivalent_sale(
    v_make,
    v_model,
    v_variant,
    COALESCE(v_year, EXTRACT(YEAR FROM CURRENT_DATE)::int - 2),
    NULL,
    v_region
  );
END;
$$;