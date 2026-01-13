-- RPC function: get v2 adoption stats for "machine fed" dashboard
CREATE OR REPLACE FUNCTION public.get_fingerprint_v2_adoption()
RETURNS TABLE(
  total bigint,
  v2 bigint,
  v2_pct numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE fingerprint_version = 2) AS v2,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND((COUNT(*) FILTER (WHERE fingerprint_version = 2))::numeric / COUNT(*)::numeric * 100, 1)
    END AS v2_pct
  FROM public.vehicle_listings
  WHERE is_dealer_grade = true;
$$;