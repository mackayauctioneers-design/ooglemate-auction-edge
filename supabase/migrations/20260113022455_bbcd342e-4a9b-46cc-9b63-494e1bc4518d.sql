-- UI wrapper: returns the best match row (or zero rows)
CREATE OR REPLACE FUNCTION public.get_last_equivalent_sale_ui(
  p_make TEXT,
  p_model TEXT,
  p_variant_used TEXT,
  p_year INT,
  p_km INT,
  p_region_id TEXT
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
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT *
  FROM public.get_last_equivalent_sale(
    p_make,
    p_model,
    COALESCE(p_variant_used,''),
    p_year,
    p_km,
    p_region_id
  )
  LIMIT 1;
$$;