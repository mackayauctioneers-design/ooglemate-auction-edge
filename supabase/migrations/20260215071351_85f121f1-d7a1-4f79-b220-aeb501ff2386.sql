-- Add priority_level to opportunities table
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS priority_level integer DEFAULT 3;

-- Add index for dashboard sort
CREATE INDEX IF NOT EXISTS idx_opportunities_priority_delta ON public.opportunities (priority_level ASC, deviation DESC NULLS LAST, created_at DESC);