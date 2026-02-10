-- Add spec_completeness to track how many identity fields are populated
-- This distinguishes "identical" (fully spec'd) from "similar" (partially spec'd) shapes
ALTER TABLE public.sales_target_candidates 
ADD COLUMN IF NOT EXISTS spec_completeness integer DEFAULT 0;

COMMENT ON COLUMN public.sales_target_candidates.spec_completeness IS 'Count of non-null spec fields (variant, body_type, fuel_type, transmission, drive_type) out of 5. Higher = more precise fingerprint.';