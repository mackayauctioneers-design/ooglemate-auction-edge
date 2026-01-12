CREATE OR REPLACE VIEW public.fingerprint_benchmark_watchlist AS
SELECT
  f.region_id,
  f.make,
  f.model,
  f.variant_family,
  f.year_min,
  f.year_max,

  f.cleared_total,
  f.listing_total,
  f.avg_days_to_clear,
  f.avg_price,

  -- confidence bucket
  CASE
    WHEN f.cleared_total >= 10 THEN 'high'
    WHEN f.cleared_total >= 3 THEN 'medium'
    WHEN f.cleared_total >= 1 THEN 'low'
    ELSE 'none'
  END AS confidence_level,

  -- benchmark problems
  (f.avg_price IS NULL) AS missing_benchmark,
  (f.cleared_total BETWEEN 1 AND 2) AS thin_benchmark,
  (f.updated_at < now() - interval '60 days') AS stale_benchmark,

  -- impact score (higher = more important)
  (COALESCE(f.cleared_total, 0) * 
   (1.0 / GREATEST(COALESCE(f.avg_days_to_clear, 30), 1))) AS impact_score

FROM public.fingerprint_outcomes_latest f
WHERE f.cleared_total >= 1
ORDER BY impact_score DESC;