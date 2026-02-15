
-- Raw scraped listings from retail sources (EasyAuto123 etc.)
CREATE TABLE public.retail_source_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'easyauto123',
  listing_url TEXT NOT NULL UNIQUE,
  year INT,
  make TEXT,
  model TEXT,
  badge TEXT,
  kms INT,
  price INT,
  location TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  grok_estimate INT,
  grok_estimated_at TIMESTAMPTZ,
  price_at_grok INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.retail_source_listings ENABLE ROW LEVEL SECURITY;

-- Admin-only access (service role bypasses RLS, edge functions use service role)
CREATE POLICY "Admin read retail_source_listings"
  ON public.retail_source_listings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid()
  ));

-- Index for dedup and lookups
CREATE INDEX idx_retail_source_listings_url ON public.retail_source_listings(listing_url);
CREATE INDEX idx_retail_source_listings_source ON public.retail_source_listings(source);
