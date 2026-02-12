-- Fix: make view security invoker so it respects RLS of the querying user
DROP VIEW IF EXISTS v_sales_truth_normalized;

CREATE OR REPLACE VIEW v_sales_truth_normalized
WITH (security_invoker = on) AS
SELECT
  vst.account_id AS dealer_key,
  a.display_name AS dealer_name,
  vst.year,
  initcap(lower(trim(vst.make))) AS make,
  initcap(lower(trim(vst.model))) AS model,
  initcap(lower(trim(coalesce(vst.variant, '')))) AS badge,
  NULL::integer AS kms,
  vst.buy_price,
  vst.sale_price AS sold_price,
  coalesce(
    CASE WHEN vst.buy_price IS NOT NULL AND vst.sale_price IS NOT NULL
         THEN vst.sale_price - vst.buy_price
         ELSE NULL END,
    vst.profit_pct
  ) AS profit,
  vst.sold_at AS sale_date,
  vst.days_to_clear
FROM vehicle_sales_truth vst
LEFT JOIN accounts a ON a.id = vst.account_id;