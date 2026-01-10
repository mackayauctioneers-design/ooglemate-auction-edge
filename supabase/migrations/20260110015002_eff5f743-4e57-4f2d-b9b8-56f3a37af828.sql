
-- Update get_benchmark_coverage function to match new view logic
CREATE OR REPLACE FUNCTION public.get_benchmark_coverage()
RETURNS TABLE(
  region_id text,
  total_deals bigint,
  benchmarked bigint,
  coverage_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    region_id,
    COUNT(*)::bigint as total_deals,
    COUNT(*) FILTER (WHERE fingerprint_price IS NOT NULL)::bigint as benchmarked,
    ROUND(100.0 * COUNT(*) FILTER (WHERE fingerprint_price IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as coverage_pct
  FROM trap_deals
  GROUP BY region_id
  ORDER BY total_deals DESC;
$$;
