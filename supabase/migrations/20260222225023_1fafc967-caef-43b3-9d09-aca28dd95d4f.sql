
-- Recreate sales_fingerprints_v1 with time-decayed profit weighting
-- Decay: 3% per month (0.97^months_since_sale)
-- Fingerprints with weighted_profit_avg < $500 are excluded

DROP MATERIALIZED VIEW IF EXISTS public.sales_fingerprints_v1;

CREATE MATERIALIZED VIEW public.sales_fingerprints_v1 AS
WITH decayed AS (
  SELECT
    *,
    -- Months since sale (fractional)
    EXTRACT(EPOCH FROM (now() - sold_at::timestamp)) / (30.44 * 86400) AS months_ago,
    -- Decay factor: 0.97^months
    POWER(0.97, EXTRACT(EPOCH FROM (now() - sold_at::timestamp)) / (30.44 * 86400)) AS decay_factor,
    -- Raw profit per sale
    COALESCE(sale_price - buy_price, 0) AS raw_profit
  FROM vehicle_sales_truth
  WHERE confidence = ANY (ARRAY['high', 'medium'])
    AND sold_at IS NOT NULL
)
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
    count(drive_type) FILTER (WHERE drive_type IS NOT NULL) AS drive_type_count,
    -- Time-decay profit columns
    ROUND(SUM(raw_profit * decay_factor)::numeric, 0) AS weighted_profit_sum,
    ROUND(AVG(raw_profit * decay_factor)::numeric, 0) AS weighted_profit_avg,
    ROUND(AVG(decay_factor)::numeric, 3) AS avg_decay_factor,
    ROUND(AVG(raw_profit)::numeric, 0) AS raw_profit_avg,
    ROUND(AVG(months_ago)::numeric, 1) AS avg_months_ago
FROM decayed
GROUP BY account_id, UPPER(make), UPPER(model), COALESCE(platform_class, 'UNKNOWN')
-- Only keep fingerprints with meaningful decayed profit signal
HAVING AVG(raw_profit * decay_factor) >= 500 OR count(*) >= 5;

-- Recreate the unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX ON public.sales_fingerprints_v1 (account_id, make, model, platform_class);

-- Refresh function (unchanged)
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
