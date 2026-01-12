-- View: fingerprint_benchmark_gaps
-- Purpose: fingerprints with activity but no benchmark price yet

CREATE OR REPLACE VIEW fingerprint_benchmark_gaps AS
SELECT
  region_id,
  make,
  model,
  COALESCE(variant_family, 'ALL') AS variant_family,
  year_min,
  year_max,
  cleared_total,
  listing_total,
  avg_days_to_clear,
  avg_price
FROM fingerprint_outcomes_latest
WHERE
  cleared_total >= 2
  AND avg_price IS NULL
ORDER BY
  cleared_total DESC,
  avg_days_to_clear ASC NULLS LAST;