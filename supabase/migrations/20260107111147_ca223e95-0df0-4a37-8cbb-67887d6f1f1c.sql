-- Create dealer_profile_user_links table for proper auth linkage
CREATE TABLE public.dealer_profile_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_profile_id uuid NOT NULL REFERENCES public.dealer_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by text,
  UNIQUE(user_id),
  UNIQUE(dealer_profile_id)
);

-- Enable RLS
ALTER TABLE public.dealer_profile_user_links ENABLE ROW LEVEL SECURITY;

-- Users can view their own link
CREATE POLICY "Users can view own link"
ON public.dealer_profile_user_links
FOR SELECT
USING (auth.uid() = user_id);

-- Service can manage links
CREATE POLICY "Service can manage links"
ON public.dealer_profile_user_links
FOR ALL
USING (true)
WITH CHECK (true);

-- Create indexes for efficient lookups
CREATE INDEX idx_dealer_profile_user_links_user_id 
ON public.dealer_profile_user_links(user_id);

CREATE INDEX idx_dealer_profile_user_links_dealer_profile_id 
ON public.dealer_profile_user_links(dealer_profile_id);