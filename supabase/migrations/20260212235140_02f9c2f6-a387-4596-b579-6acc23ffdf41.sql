-- Drop old view that reads from dealer_sales (37 rows)
DROP VIEW IF EXISTS v_sales_truth_normalized;

-- Recreate view reading from vehicle_sales_truth (1,792 rows)
CREATE OR REPLACE VIEW v_sales_truth_normalized AS
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
    vst.profit_pct  -- fallback: not ideal but non-null signals profit exists
  ) AS profit,
  vst.sold_at AS sale_date,
  vst.days_to_clear
FROM vehicle_sales_truth vst
LEFT JOIN accounts a ON a.id = vst.account_id;