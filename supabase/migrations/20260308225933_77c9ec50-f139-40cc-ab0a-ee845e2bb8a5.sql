
-- Add listing_hash for cross-demand dedup and margin_estimate for UI display
ALTER TABLE public.demand_opportunities 
  ADD COLUMN IF NOT EXISTS listing_hash text,
  ADD COLUMN IF NOT EXISTS margin_estimate numeric;

-- Create index on listing_hash for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_demand_opps_listing_hash ON public.demand_opportunities (listing_hash);

-- Add search_priority column to dealer_demands for urgency-based scheduling
ALTER TABLE public.dealer_demands
  ADD COLUMN IF NOT EXISTS search_interval_minutes integer DEFAULT 1440;

-- Set search intervals based on urgency for existing rows
UPDATE public.dealer_demands SET search_interval_minutes = 1440 WHERE urgency = 'low';
UPDATE public.dealer_demands SET search_interval_minutes = 720 WHERE urgency = 'normal';
UPDATE public.dealer_demands SET search_interval_minutes = 240 WHERE urgency = 'high';
UPDATE public.dealer_demands SET search_interval_minutes = 60 WHERE urgency = 'urgent';
