
-- 1. Add days_to_clear to vehicle_sales_truth
ALTER TABLE public.vehicle_sales_truth
ADD COLUMN IF NOT EXISTS acquired_at date,
ADD COLUMN IF NOT EXISTS days_to_clear integer;

-- 2. View A — Clearance Velocity
CREATE OR REPLACE VIEW public.sales_clearance_velocity AS
SELECT
  account_id,
  make,
  model,
  variant,
  COUNT(*)::int AS sales_count,
  ROUND(AVG(days_to_clear))::int AS avg_days_to_clear,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_clear)::int AS median_days_to_clear,
  ROUND(100.0 * COUNT(*) FILTER (WHERE days_to_clear <= 30) / NULLIF(COUNT(*) FILTER (WHERE days_to_clear IS NOT NULL), 0), 1) AS pct_under_30,
  ROUND(100.0 * COUNT(*) FILTER (WHERE days_to_clear <= 60) / NULLIF(COUNT(*) FILTER (WHERE days_to_clear IS NOT NULL), 0), 1) AS pct_under_60,
  ROUND(100.0 * COUNT(*) FILTER (WHERE days_to_clear <= 90) / NULLIF(COUNT(*) FILTER (WHERE days_to_clear IS NOT NULL), 0), 1) AS pct_under_90,
  MAX(sold_at) AS last_sold_at
FROM public.vehicle_sales_truth
WHERE days_to_clear IS NOT NULL
GROUP BY account_id, make, model, variant;

-- 3. View B — Volume & Consistency (monthly)
CREATE OR REPLACE VIEW public.sales_volume_trends AS
SELECT
  account_id,
  make,
  model,
  DATE_TRUNC('month', sold_at)::date AS month,
  COUNT(*)::int AS sales_count
FROM public.vehicle_sales_truth
GROUP BY account_id, make, model, DATE_TRUNC('month', sold_at)::date;

-- 4. View C — Variation Performance
CREATE OR REPLACE VIEW public.sales_variation_performance AS
SELECT
  account_id,
  make,
  model,
  variant,
  transmission,
  fuel_type,
  body_type,
  COUNT(*)::int AS sales_count,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY km)::int AS median_km,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sale_price)::int AS median_sale_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_clear)::int AS median_days_to_clear
FROM public.vehicle_sales_truth
GROUP BY account_id, make, model, variant, transmission, fuel_type, body_type;

-- 5. RLS: views inherit RLS from the underlying table, which already has policies.
-- Ensure the views are accessible via the API by granting select.
GRANT SELECT ON public.sales_clearance_velocity TO anon, authenticated;
GRANT SELECT ON public.sales_volume_trends TO anon, authenticated;
GRANT SELECT ON public.sales_variation_performance TO anon, authenticated;
