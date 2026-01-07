-- Add dealer_profile_id to dealer_fingerprints for proper dealer isolation
ALTER TABLE public.dealer_fingerprints 
ADD COLUMN IF NOT EXISTS dealer_profile_id uuid REFERENCES public.dealer_profiles(id);

-- Create index for efficient dealer-scoped queries
CREATE INDEX IF NOT EXISTS idx_dealer_fingerprints_dealer_profile_id 
ON public.dealer_fingerprints(dealer_profile_id);