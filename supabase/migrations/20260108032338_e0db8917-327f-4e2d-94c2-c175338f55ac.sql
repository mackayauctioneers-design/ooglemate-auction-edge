-- Health dashboard RPC functions
CREATE OR REPLACE FUNCTION public.get_nsw_rooftop_stats()
RETURNS TABLE (region_id text, enabled_count bigint, total_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT region_id, COUNT(*) FILTER (WHERE enabled) as enabled_count, COUNT(*) as total_count
  FROM dealer_rooftops WHERE region_id LIKE 'NSW%' GROUP BY region_id ORDER BY region_id;
$$;

CREATE OR REPLACE FUNCTION public.get_nsw_crawl_today()
RETURNS TABLE (vehicles_found bigint, vehicles_ingested bigint, vehicles_dropped bigint, crawl_runs bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT SUM(vehicles_found), SUM(vehicles_ingested), SUM(vehicles_dropped), COUNT(*)
  FROM dealer_crawl_runs
  WHERE run_date = CURRENT_DATE
    AND dealer_slug IN (SELECT dealer_slug FROM dealer_rooftops WHERE region_id LIKE 'NSW%');
$$;

CREATE OR REPLACE FUNCTION public.get_clearance_today()
RETURNS TABLE (count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM clearance_events WHERE cleared_at::date = CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.get_fingerprints_today()
RETURNS TABLE (count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM fingerprint_outcomes WHERE asof_date = CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.get_job_queue_stats()
RETURNS TABLE (pending bigint, processing bigint, completed bigint, failed bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'failed')
  FROM dealer_crawl_jobs;
$$;

CREATE OR REPLACE FUNCTION public.get_top_drop_reasons()
RETURNS TABLE (drop_reason text, count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT key as drop_reason, SUM((value)::int)::bigint as count
  FROM dealer_crawl_runs, jsonb_each_text(drop_reasons)
  WHERE run_date = CURRENT_DATE
    AND dealer_slug IN (SELECT dealer_slug FROM dealer_rooftops WHERE region_id LIKE 'NSW%')
  GROUP BY key ORDER BY count DESC LIMIT 5;
$$;