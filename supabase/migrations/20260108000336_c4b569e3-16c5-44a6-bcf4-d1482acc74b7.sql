-- Add successful_validation_runs tracking
ALTER TABLE public.dealer_rooftops
ADD COLUMN IF NOT EXISTS successful_validation_runs integer NOT NULL DEFAULT 0;