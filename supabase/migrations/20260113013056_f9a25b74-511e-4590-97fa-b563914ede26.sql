-- Benchmark coverage summary RPC (global + by-region)
CREATE OR REPLACE FUNCTION public.get_benchmark_coverage_summary()
RETURNS TABLE(
  total_deals bigint,
  benchmarked bigint,
  coverage_pct numeric,
  by_region jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      region_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE fingerprint_price IS NOT NULL) AS bench
    FROM public.trap_deals
    GROUP BY region_id
  ),
  agg AS (
    SELECT
      SUM(total) AS total_deals,
      SUM(bench) AS benchmarked
    FROM base
  ),
  region_json AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'region_id', region_id,
        'total_deals', total,
        'benchmarked', bench,
        'coverage_pct', CASE WHEN total = 0 THEN 0 ELSE ROUND(bench::numeric / total::numeric * 100, 1) END
      )
      ORDER BY total DESC
    ) AS by_region
    FROM base
  )
  SELECT
    a.total_deals,
    a.benchmarked,
    CASE WHEN a.total_deals = 0 THEN 0 ELSE ROUND(a.benchmarked::numeric / a.total_deals::numeric * 100, 1) END AS coverage_pct,
    COALESCE(r.by_region, '[]'::jsonb) AS by_region
  FROM agg a
  CROSS JOIN region_json r;
$$;