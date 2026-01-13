-- Drop and recreate get_auction_sources_health with schedule fields
DROP FUNCTION IF EXISTS public.get_auction_sources_health();

CREATE OR REPLACE FUNCTION public.get_auction_sources_health()
RETURNS TABLE(
  source_key text,
  display_name text,
  platform text,
  enabled boolean,
  preflight_status text,
  last_crawl_success_at timestamptz,
  last_crawl_fail_at timestamptz,
  consecutive_crawl_failures int,
  last_lots_found int,
  last_crawl_error text,
  auto_disabled_at timestamptz,
  auto_disabled_reason text,
  schedule_enabled boolean,
  schedule_paused boolean,
  schedule_pause_reason text,
  schedule_time_local text,
  schedule_days text[],
  last_scheduled_run_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    a.source_key,
    a.display_name,
    a.platform,
    a.enabled,
    a.preflight_status,
    a.last_success_at,
    a.last_crawl_fail_at,
    COALESCE(a.consecutive_failures, 0) AS consecutive_crawl_failures,
    a.last_lots_found,
    a.last_error,
    a.auto_disabled_at,
    a.auto_disabled_reason,
    a.schedule_enabled,
    a.schedule_paused,
    a.schedule_pause_reason,
    a.schedule_time_local,
    a.schedule_days,
    a.last_scheduled_run_at
  FROM public.auction_sources a
  ORDER BY a.enabled DESC, COALESCE(a.last_success_at, '1970-01-01') DESC;
$$;