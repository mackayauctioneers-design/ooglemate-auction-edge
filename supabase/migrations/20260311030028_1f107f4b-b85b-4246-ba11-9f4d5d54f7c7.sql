ALTER TABLE public.cron_heartbeat
ADD COLUMN IF NOT EXISTS rows_inserted integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS unique_urls integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS states_failed integer DEFAULT 0;