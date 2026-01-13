-- Add dealer_name and dealer_url columns to vehicle_listings if not present
ALTER TABLE vehicle_listings 
  ADD COLUMN IF NOT EXISTS dealer_name text,
  ADD COLUMN IF NOT EXISTS dealer_url text,
  ADD COLUMN IF NOT EXISTS external_id text;

-- Create franchise_dealer_candidates table for auto-discovered dealers
CREATE TABLE IF NOT EXISTS public.franchise_dealer_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand text NOT NULL,
  dealer_name text NOT NULL,
  dealer_location text,
  dealer_url text,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'candidate',
  listing_count integer DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(brand, dealer_name)
);

-- Enable RLS
ALTER TABLE public.franchise_dealer_candidates ENABLE ROW LEVEL SECURITY;

-- RLS policies - admins can read/write
CREATE POLICY "Admins can manage franchise dealer candidates" 
  ON public.franchise_dealer_candidates 
  FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_franchise_candidates_brand_status 
  ON franchise_dealer_candidates(brand, status);

CREATE INDEX IF NOT EXISTS idx_franchise_candidates_dealer_name 
  ON franchise_dealer_candidates(brand, dealer_name);

-- Update trigger for updated_at
CREATE TRIGGER update_franchise_dealer_candidates_updated_at
  BEFORE UPDATE ON public.franchise_dealer_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();