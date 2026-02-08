-- Recreate sales_clearance_velocity with median_profit_pct
CREATE OR REPLACE VIEW public.sales_clearance_velocity
WITH (security_invoker = true)
AS
SELECT
  account_id,
  make,
  model,
  variant,
  count(*)::integer AS sales_count,
  round(avg(days_to_clear))::integer AS avg_days_to_clear,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_clear::double precision)::integer AS median_days_to_clear,
  round(100.0 * count(*) FILTER (WHERE days_to_clear <= 30)::numeric / NULLIF(count(*) FILTER (WHERE days_to_clear IS NOT NULL), 0)::numeric, 1) AS pct_under_30,
  round(100.0 * count(*) FILTER (WHERE days_to_clear <= 60)::numeric / NULLIF(count(*) FILTER (WHERE days_to_clear IS NOT NULL), 0)::numeric, 1) AS pct_under_60,
  round(100.0 * count(*) FILTER (WHERE days_to_clear <= 90)::numeric / NULLIF(count(*) FILTER (WHERE days_to_clear IS NOT NULL), 0)::numeric, 1) AS pct_under_90,
  max(sold_at) AS last_sold_at,
  round(
    percentile_cont(0.5) WITHIN GROUP (ORDER BY profit_pct)
    FILTER (WHERE profit_pct IS NOT NULL)::numeric,
  4) AS median_profit_pct
FROM vehicle_sales_truth
WHERE days_to_clear IS NOT NULL
GROUP BY account_id, make, model, variant;

-- Recreate sales_variation_performance with median_profit_pct
CREATE OR REPLACE VIEW public.sales_variation_performance
WITH (security_invoker = true)
AS
SELECT
  account_id,
  make,
  model,
  variant,
  transmission,
  fuel_type,
  body_type,
  count(*)::integer AS sales_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY km::double precision)::integer AS median_km,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price::double precision)::integer AS median_sale_price,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_clear::double precision)::integer AS median_days_to_clear,
  round(
    percentile_cont(0.5) WITHIN GROUP (ORDER BY profit_pct)
    FILTER (WHERE profit_pct IS NOT NULL)::numeric,
  4) AS median_profit_pct
FROM vehicle_sales_truth
GROUP BY account_id, make, model, variant, transmission, fuel_type, body_type;