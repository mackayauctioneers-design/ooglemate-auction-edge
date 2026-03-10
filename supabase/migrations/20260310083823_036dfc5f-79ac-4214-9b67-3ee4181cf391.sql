
-- Add mandate_id and dispatch_date to outward_jobs
ALTER TABLE public.outward_jobs
  ADD COLUMN IF NOT EXISTS mandate_id text,
  ADD COLUMN IF NOT EXISTS dispatch_date date;

-- Index for fast cooldown lookups
CREATE INDEX IF NOT EXISTS idx_outward_jobs_mandate_cooldown
  ON public.outward_jobs (mandate_id, source_key, dispatched_at)
  WHERE mandate_id IS NOT NULL;

-- Prevent duplicate Lindy dispatches per mandate+source+day
CREATE UNIQUE INDEX IF NOT EXISTS idx_outward_jobs_mandate_source_day
  ON public.outward_jobs (mandate_id, source_key, dispatch_date)
  WHERE mandate_id IS NOT NULL AND status IN ('dispatched', 'complete');
