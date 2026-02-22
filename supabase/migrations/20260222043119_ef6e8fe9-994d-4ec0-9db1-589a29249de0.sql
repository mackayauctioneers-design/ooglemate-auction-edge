
-- Fix the view to use SECURITY INVOKER (default in newer PG, but be explicit)
DROP VIEW IF EXISTS public.ingestion_source_health;

CREATE VIEW public.ingestion_source_health
WITH (security_invoker = true) AS
SELECT
  s.source_key,
  s.display_name,
  s.enabled,
  s.expected_interval_minutes,
  s.min_listings_24h,
  s.cron_schedule,
  h.last_seen_at AS last_run_at,
  h.last_ok,
  h.note AS last_note,
  (SELECT MAX(run_at) FROM cron_audit_log WHERE cron_name = s.source_key AND success = true) AS last_success_at,
  (SELECT MAX(run_at) FROM cron_audit_log WHERE cron_name = s.source_key AND success = false) AS last_error_at,
  (SELECT error FROM cron_audit_log WHERE cron_name = s.source_key AND success = false ORDER BY run_at DESC LIMIT 1) AS last_error_message,
  (SELECT COUNT(*) FROM cron_audit_log WHERE cron_name = s.source_key AND run_at > now() - interval '24 hours') AS runs_24h,
  (SELECT COUNT(*) FROM cron_audit_log WHERE cron_name = s.source_key AND success = true AND run_at > now() - interval '24 hours') AS successes_24h,
  (SELECT COALESCE(SUM((result->>'total_new')::int), 0) FROM cron_audit_log WHERE cron_name = s.source_key AND run_at > now() - interval '24 hours' AND result IS NOT NULL) AS new_24h,
  (SELECT COALESCE(SUM((result->>'total_updated')::int), 0) FROM cron_audit_log WHERE cron_name = s.source_key AND run_at > now() - interval '24 hours' AND result IS NOT NULL) AS updated_24h,
  CASE
    WHEN NOT s.enabled THEN 'disabled'
    WHEN h.last_seen_at IS NULL THEN 'never_run'
    WHEN h.last_ok = false THEN 'erroring'
    WHEN h.last_seen_at < now() - (s.expected_interval_minutes * 2 || ' minutes')::interval THEN 'stale'
    ELSE 'healthy'
  END AS health_status
FROM ingestion_sources s
LEFT JOIN cron_heartbeat h ON h.cron_name = s.source_key;
