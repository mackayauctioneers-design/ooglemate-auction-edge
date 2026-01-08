-- Fix get_top_drop_reasons to use trap_slug instead of dealer_slug
CREATE OR REPLACE FUNCTION public.get_top_drop_reasons()
RETURNS TABLE(drop_reason text, count bigint) 
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT key as drop_reason, SUM((value)::int)::bigint as count
  FROM trap_crawl_runs, jsonb_each_text(drop_reasons)
  WHERE run_date = CURRENT_DATE
    AND trap_slug IN (SELECT trap_slug FROM dealer_traps WHERE region_id LIKE 'NSW%')
  GROUP BY key ORDER BY count DESC LIMIT 5;
$$;