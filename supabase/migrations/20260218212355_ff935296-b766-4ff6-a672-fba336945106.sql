
-- Drop the old materialized view and recreate with platform_class
DROP MATERIALIZED VIEW IF EXISTS public.sales_fingerprints_v1;

CREATE MATERIALIZED VIEW public.sales_fingerprints_v1 AS
SELECT 
    account_id,
    UPPER(make) AS make,
    UPPER(model) AS model,
    COALESCE(platform_class, 'UNKNOWN') AS platform_class,
    count(*) AS sales_count,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY km::double precision) AS km_median,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY km::double precision) AS km_p25,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY km::double precision) AS km_p75,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price::double precision) AS price_median,
    max(sold_at) AS last_sold_at,
    mode() WITHIN GROUP (ORDER BY lower(transmission)) AS dominant_transmission,
    mode() WITHIN GROUP (ORDER BY lower(body_type)) AS dominant_body_type,
    mode() WITHIN GROUP (ORDER BY lower(fuel_type)) AS dominant_fuel_type,
    mode() WITHIN GROUP (ORDER BY lower(drive_type)) AS dominant_drive_type,
    count(transmission) FILTER (WHERE transmission IS NOT NULL) AS transmission_count,
    count(body_type) FILTER (WHERE body_type IS NOT NULL) AS body_type_count,
    count(fuel_type) FILTER (WHERE fuel_type IS NOT NULL) AS fuel_type_count,
    count(drive_type) FILTER (WHERE drive_type IS NOT NULL) AS drive_type_count
FROM vehicle_sales_truth
WHERE confidence = ANY (ARRAY['high', 'medium'])
GROUP BY account_id, UPPER(make), UPPER(model), COALESCE(platform_class, 'UNKNOWN');

-- Recreate the unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX ON public.sales_fingerprints_v1 (account_id, make, model, platform_class);

-- Refresh the function (unchanged logic, just refreshes the new view)
CREATE OR REPLACE FUNCTION public.refresh_sales_fingerprints()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_fingerprints_v1;
END;
$$;
