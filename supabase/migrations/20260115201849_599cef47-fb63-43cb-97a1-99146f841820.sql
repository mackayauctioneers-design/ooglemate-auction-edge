-- Drop the unique constraint that limits to 1 row per cron per day
ALTER TABLE public.cron_audit_log DROP CONSTRAINT IF EXISTS cron_audit_log_cron_name_run_date_key;