
-- Add engine_code to sales_target_candidates
ALTER TABLE public.sales_target_candidates
ADD COLUMN IF NOT EXISTS engine_code text;

-- Add engine_code to fingerprint_targets
ALTER TABLE public.fingerprint_targets
ADD COLUMN IF NOT EXISTS engine_code text;
