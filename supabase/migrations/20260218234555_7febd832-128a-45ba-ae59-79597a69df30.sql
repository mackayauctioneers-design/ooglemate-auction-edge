
-- Add promoted_at to shadow table
ALTER TABLE public.vehicle_listings_shadow
ADD COLUMN IF NOT EXISTS promoted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_shadow_promoted_at ON public.vehicle_listings_shadow(promoted_at) WHERE promoted_at IS NULL;
