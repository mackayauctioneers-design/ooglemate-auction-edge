-- Schedule outward hunt to run automatically for all active hunts
-- Run every 30 minutes to check for due outward scans

SELECT cron.schedule(
  'outward-hunt-cron',
  '*/30 * * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('supabase.functions_url') || '/outward-hunt',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('supabase.service_key')
      ),
      body := jsonb_build_object(
        'hunt_id', s.id,
        'max_results', 10
      ),
      timeout_milliseconds := 55000
    )
  FROM sale_hunts s
  WHERE s.status = 'active'
    AND s.outward_enabled = true
    AND (
      s.last_outward_scan_at IS NULL
      OR s.last_outward_scan_at < now() - make_interval(mins := COALESCE(s.outward_interval_minutes, 60))
    )
  LIMIT 5;
  $$
);

-- Schedule unified candidates rebuild every 30 minutes (after outward scans)
SELECT cron.schedule(
  'unified-candidates-rebuild',
  '15,45 * * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('supabase.functions_url') || '/build-unified-candidates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('supabase.service_key')
      ),
      body := jsonb_build_object('run_all_active', true),
      timeout_milliseconds := 55000
    );
  $$
);