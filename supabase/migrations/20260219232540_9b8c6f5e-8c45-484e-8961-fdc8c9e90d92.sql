
-- Allow listing_norm_id to be null (no longer primary lookup key)
ALTER TABLE public.matched_opportunities_v1 
ALTER COLUMN listing_norm_id DROP NOT NULL;
