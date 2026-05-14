CREATE TABLE public.external_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  make TEXT,
  model TEXT,
  year INTEGER,
  price NUMERIC,
  mileage INTEGER,
  location TEXT,
  listing_url TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_external_listings_received_at ON public.external_listings (received_at DESC);
CREATE INDEX idx_external_listings_listing_url ON public.external_listings (listing_url);

ALTER TABLE public.external_listings ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (edge function) can read/write. Client access is denied.