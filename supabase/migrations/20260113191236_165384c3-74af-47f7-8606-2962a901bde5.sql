-- Schedule fields on auction_sources
ALTER TABLE public.auction_sources
  ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_tz text NOT NULL DEFAULT 'Australia/Sydney',
  ADD COLUMN IF NOT EXISTS schedule_days text[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI'],
  ADD COLUMN IF NOT EXISTS schedule_time_local text NOT NULL DEFAULT '07:05',
  ADD COLUMN IF NOT EXISTS schedule_min_interval_minutes int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS schedule_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_pause_reason text,
  ADD COLUMN IF NOT EXISTS last_scheduled_run_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_auction_sources_schedule
  ON public.auction_sources (schedule_enabled, schedule_paused);