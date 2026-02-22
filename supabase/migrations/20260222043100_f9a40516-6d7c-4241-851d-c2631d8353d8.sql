
-- Ingestion source registry
CREATE TABLE public.ingestion_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  cron_schedule TEXT,                    -- e.g. '*/5 * * * *'
  expected_interval_minutes INT NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT true,
  alert_email BOOLEAN NOT NULL DEFAULT true,
  alert_slack BOOLEAN NOT NULL DEFAULT true,
  min_listings_24h INT,                  -- alert if below this (e.g. 100 for autotrader)
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ingestion_sources ENABLE ROW LEVEL SECURITY;

-- Operator read-only (service role for writes)
CREATE POLICY "Authenticated users can view ingestion_sources"
  ON public.ingestion_sources FOR SELECT
  USING (auth.role() = 'authenticated');

-- Health summary view joining cron_audit_log + cron_heartbeat
CREATE OR REPLACE VIEW public.ingestion_source_health AS
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
  -- Last success
  (SELECT MAX(run_at) FROM cron_audit_log WHERE cron_name = s.source_key AND success = true) AS last_success_at,
  -- Last error
  (SELECT MAX(run_at) FROM cron_audit_log WHERE cron_name = s.source_key AND success = false) AS last_error_at,
  (SELECT error FROM cron_audit_log WHERE cron_name = s.source_key AND success = false ORDER BY run_at DESC LIMIT 1) AS last_error_message,
  -- 24h stats
  (SELECT COUNT(*) FROM cron_audit_log WHERE cron_name = s.source_key AND run_at > now() - interval '24 hours') AS runs_24h,
  (SELECT COUNT(*) FROM cron_audit_log WHERE cron_name = s.source_key AND success = true AND run_at > now() - interval '24 hours') AS successes_24h,
  (SELECT COALESCE(SUM((result->>'total_new')::int), 0) FROM cron_audit_log WHERE cron_name = s.source_key AND run_at > now() - interval '24 hours' AND result IS NOT NULL) AS new_24h,
  (SELECT COALESCE(SUM((result->>'total_updated')::int), 0) FROM cron_audit_log WHERE cron_name = s.source_key AND run_at > now() - interval '24 hours' AND result IS NOT NULL) AS updated_24h,
  -- Health status calculation
  CASE
    WHEN NOT s.enabled THEN 'disabled'
    WHEN h.last_seen_at IS NULL THEN 'never_run'
    WHEN h.last_ok = false THEN 'erroring'
    WHEN h.last_seen_at < now() - (s.expected_interval_minutes * 2 || ' minutes')::interval THEN 'stale'
    ELSE 'healthy'
  END AS health_status
FROM ingestion_sources s
LEFT JOIN cron_heartbeat h ON h.cron_name = s.source_key;

-- Trigger for updated_at
CREATE TRIGGER update_ingestion_sources_updated_at
  BEFORE UPDATE ON public.ingestion_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
