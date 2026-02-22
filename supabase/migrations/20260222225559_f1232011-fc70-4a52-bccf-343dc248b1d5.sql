
-- Drop and recreate sales_fingerprints_v1 with market-rebased prices and expiry status
DROP MATERIALIZED VIEW IF EXISTS public.sales_fingerprints_v1;

CREATE MATERIALIZED VIEW public.sales_fingerprints_v1 AS
WITH decayed AS (
    SELECT
        vst.id,
        vst.account_id,
        vst.sold_at,
        vst.make,
        vst.model,
        vst.variant,
        vst.year,
        vst.km,
        vst.sale_price,
        vst.buy_price,
        vst.source,
        vst.confidence,
        vst.body_type,
        vst.fuel_type,
        vst.transmission,
        vst.drive_type,
        vst.platform_class,
        vst.trim_class,
        vst.drivetrain_bucket,
        EXTRACT(epoch FROM now() - vst.sold_at::timestamp with time zone) / (30.44 * 86400) AS months_ago,
        power(0.97, EXTRACT(epoch FROM now() - vst.sold_at::timestamp with time zone) / (30.44 * 86400)) AS decay_factor,
        COALESCE(vst.sale_price::numeric - vst.buy_price, 0) AS raw_profit,
        CASE WHEN vst.buy_price > 0 
            THEN (vst.sale_price::numeric - vst.buy_price) / vst.buy_price 
            ELSE 0 
        END AS margin_pct
    FROM vehicle_sales_truth vst
    WHERE vst.confidence IN ('high', 'medium')
      AND vst.sold_at IS NOT NULL
),
-- Aggregate fingerprints (same as before + margin)
fingerprints AS (
    SELECT
        account_id,
        upper(make) AS make,
        upper(model) AS model,
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
        round(sum(raw_profit * decay_factor), 0) AS weighted_profit_sum,
        round(avg(raw_profit * decay_factor), 0) AS weighted_profit_avg,
        round(avg(decay_factor), 3) AS avg_decay_factor,
        round(avg(raw_profit), 0) AS raw_profit_avg,
        round(avg(months_ago), 1) AS avg_months_ago,
        -- Historical margin percentage (median)
        round(avg(margin_pct)::numeric, 4) AS historical_margin_pct,
        -- Historical median buy price
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(buy_price, 0)::double precision)::numeric, 0) AS historical_buy_median,
        -- Historical median sell price  
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price::double precision)::numeric, 0) AS historical_sell_median,
        -- For expiry: months since most recent sale
        round(min(months_ago)::numeric, 1) AS newest_sale_months_ago,
        -- Count of sales in last 12 months
        count(*) FILTER (WHERE months_ago <= 12) AS recent_sales_count
    FROM decayed
    GROUP BY account_id, upper(make), upper(model), COALESCE(platform_class, 'UNKNOWN')
    HAVING avg(raw_profit * decay_factor) >= 500 OR count(*) >= 5
),
-- Current market medians from active vehicle_listings (same platform_class, ±1 year of fingerprint median year)
market AS (
    SELECT
        upper(vl.make) AS make,
        upper(vl.model) AS model,
        COALESCE(vl.platform_class, 'UNKNOWN') AS platform_class,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY vl.asking_price::double precision) AS market_median_price,
        count(*) AS market_sample_size
    FROM vehicle_listings vl
    WHERE vl.status IN ('listed', 'catalogue')
      AND vl.asking_price IS NOT NULL
      AND vl.asking_price > 0
    GROUP BY upper(vl.make), upper(vl.model), COALESCE(vl.platform_class, 'UNKNOWN')
)
SELECT
    f.account_id,
    f.make,
    f.model,
    f.platform_class,
    f.sales_count,
    f.km_median,
    f.km_p25,
    f.km_p75,
    f.price_median,
    f.last_sold_at,
    f.dominant_transmission,
    f.dominant_body_type,
    f.dominant_fuel_type,
    f.dominant_drive_type,
    f.transmission_count,
    f.body_type_count,
    f.fuel_type_count,
    f.drive_type_count,
    f.weighted_profit_sum,
    f.weighted_profit_avg,
    f.avg_decay_factor,
    f.raw_profit_avg,
    f.avg_months_ago,
    -- Historical margin
    f.historical_margin_pct,
    f.historical_buy_median,
    f.historical_sell_median,
    -- Rebased prices from current market
    round(COALESCE(m.market_median_price, f.price_median)::numeric, 0) AS rebased_buy_anchor,
    round((COALESCE(m.market_median_price, f.price_median) * (1 + GREATEST(f.historical_margin_pct, 0)))::numeric, 0) AS rebased_sell_price,
    -- Market context
    COALESCE(m.market_sample_size, 0)::integer AS market_sample_size,
    -- Market drift: how much has the market moved vs historical
    CASE WHEN f.price_median > 0 
        THEN round(((COALESCE(m.market_median_price, f.price_median) - f.price_median) / f.price_median * 100)::numeric, 1)
        ELSE 0 
    END AS market_drift_pct,
    -- Expiry status
    CASE
        -- >24 months, no recent sale → expired (stop using)
        WHEN f.newest_sale_months_ago > 24 AND f.recent_sales_count = 0 THEN 'expired'
        -- >12 months AND market drifted >10% → watch only
        WHEN f.newest_sale_months_ago > 12 
             AND abs(COALESCE(
                 CASE WHEN f.price_median > 0 
                     THEN ((COALESCE(m.market_median_price, f.price_median) - f.price_median) / f.price_median * 100)
                     ELSE 0 
                 END, 0)) > 10 THEN 'watch'
        ELSE 'active'
    END AS fingerprint_status,
    f.newest_sale_months_ago,
    f.recent_sales_count
FROM fingerprints f
LEFT JOIN market m ON m.make = f.make AND m.model = f.model AND m.platform_class = f.platform_class;

-- Recreate the refresh function
CREATE OR REPLACE FUNCTION public.refresh_sales_fingerprints()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.sales_fingerprints_v1;
END;
$$;
