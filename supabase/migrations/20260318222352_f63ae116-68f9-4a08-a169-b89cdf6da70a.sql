UPDATE vehicle_sales_truth
SET platform_class = public.derive_platform_class(UPPER(TRIM(make)), UPPER(TRIM(model)))
WHERE account_id = '8140eae1-2c36-40b6-a358-4f5ed05bbbcf'
  AND platform_class NOT LIKE '%:%'
  AND platform_class NOT IN ('PRADO', 'LANDCRUISER', 'OUTLANDER', 'PAJERO_SPORT', 'PATROL')