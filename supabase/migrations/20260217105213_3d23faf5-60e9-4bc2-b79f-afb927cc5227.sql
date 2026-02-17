
-- Fix: change account_id to UUID type and rebuild function
ALTER TABLE public.dealer_platform_clusters ALTER COLUMN account_id TYPE UUID USING account_id::UUID;

CREATE OR REPLACE FUNCTION public.rebuild_platform_clusters(p_account_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  row_count INT;
BEGIN
  DELETE FROM public.dealer_platform_clusters WHERE account_id = p_account_id;

  INSERT INTO public.dealer_platform_clusters (
    account_id, make, model, generation, engine_type, drivetrain,
    year_min, year_max, total_flips,
    median_buy_price, median_sell_price, median_profit, median_km,
    last_sale_date
  )
  SELECT
    p_account_id,
    INITCAP(TRIM(s.make)),
    INITCAP(TRIM(s.model)),
    public.derive_generation(s.make, s.model, s.year),
    COALESCE(UPPER(NULLIF(TRIM(s.drive_type), '')), 'UNKNOWN'),
    COALESCE(
      CASE
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('4X4','4WD','AWD') THEN '4X4'
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('2WD','FWD','RWD') THEN '2WD'
        ELSE 'UNKNOWN'
      END, 'UNKNOWN'),
    MIN(s.year),
    MAX(s.year),
    COUNT(*)::INT,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.buy_price),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.sale_price),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (s.sale_price - COALESCE(s.buy_price, 0))),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.km),
    MAX(s.sold_at::DATE)
  FROM public.vehicle_sales_truth s
  WHERE s.account_id = p_account_id
    AND s.sale_price IS NOT NULL
    AND s.buy_price IS NOT NULL
    AND (s.sale_price - COALESCE(s.buy_price, 0)) > 0
  GROUP BY
    INITCAP(TRIM(s.make)),
    INITCAP(TRIM(s.model)),
    public.derive_generation(s.make, s.model, s.year),
    COALESCE(UPPER(NULLIF(TRIM(s.drive_type), '')), 'UNKNOWN'),
    COALESCE(
      CASE
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('4X4','4WD','AWD') THEN '4X4'
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('2WD','FWD','RWD') THEN '2WD'
        ELSE 'UNKNOWN'
      END, 'UNKNOWN');

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
