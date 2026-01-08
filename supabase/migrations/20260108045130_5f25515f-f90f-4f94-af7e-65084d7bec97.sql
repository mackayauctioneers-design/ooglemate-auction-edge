-- Fix get_nsw_crawl_today to use trap_slug instead of dealer_slug
CREATE OR REPLACE FUNCTION public.get_nsw_crawl_today()
RETURNS TABLE(vehicles_found bigint, vehicles_ingested bigint, vehicles_dropped bigint, crawl_runs bigint) 
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(vehicles_found), 0), COALESCE(SUM(vehicles_ingested), 0), COALESCE(SUM(vehicles_dropped), 0), COUNT(*)
  FROM trap_crawl_runs
  WHERE run_date = CURRENT_DATE
    AND trap_slug IN (SELECT trap_slug FROM dealer_traps WHERE region_id LIKE 'NSW%');
$$;