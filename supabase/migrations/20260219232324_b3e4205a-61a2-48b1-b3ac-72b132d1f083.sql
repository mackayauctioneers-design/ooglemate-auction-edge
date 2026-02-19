
-- Add listing_id column to matched_opportunities_v1 for direct vehicle_listings reference
ALTER TABLE public.matched_opportunities_v1 
ADD COLUMN IF NOT EXISTS listing_id UUID;

-- Drop the old unique constraint
ALTER TABLE public.matched_opportunities_v1 
DROP CONSTRAINT IF EXISTS matched_opportunities_v1_account_id_listing_norm_id_key;

-- Create new unique constraint on (account_id, listing_id)
ALTER TABLE public.matched_opportunities_v1 
ADD CONSTRAINT matched_opportunities_v1_account_id_listing_id_key UNIQUE (account_id, listing_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_matched_opportunities_v1_listing_id 
ON public.matched_opportunities_v1 (listing_id);
