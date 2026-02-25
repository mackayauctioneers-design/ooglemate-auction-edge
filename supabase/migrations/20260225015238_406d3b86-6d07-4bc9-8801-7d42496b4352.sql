-- Add starred/watchlist and auction reminder columns
ALTER TABLE public.operator_opportunities
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_at timestamptz;

-- Index for quick starred filter
CREATE INDEX IF NOT EXISTS idx_operator_opportunities_starred
  ON public.operator_opportunities (is_starred) WHERE is_starred = true;
