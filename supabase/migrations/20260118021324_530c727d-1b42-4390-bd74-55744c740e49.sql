
-- Add missing gap_dollars column to hunt_unified_candidates
ALTER TABLE public.hunt_unified_candidates 
ADD COLUMN IF NOT EXISTS gap_dollars integer;

-- Also add gap_pct if it doesn't exist (likely needed for the same RPC)
ALTER TABLE public.hunt_unified_candidates 
ADD COLUMN IF NOT EXISTS gap_pct numeric;

COMMENT ON COLUMN public.hunt_unified_candidates.gap_dollars IS 'Price gap in dollars vs proven exit value';
COMMENT ON COLUMN public.hunt_unified_candidates.gap_pct IS 'Price gap as percentage vs proven exit value';
