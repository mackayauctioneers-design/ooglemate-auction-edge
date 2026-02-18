
-- Shadow table for Caroogle API validation
CREATE TABLE public.vehicle_listings_shadow (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id TEXT NOT NULL,
  lot_id TEXT,
  source TEXT,
  shadow_source TEXT NOT NULL DEFAULT 'caroogle',
  make TEXT,
  model TEXT,
  year INT,
  asking_price NUMERIC,
  km INT,
  location TEXT,
  state TEXT,
  drivetrain TEXT,
  auction_date TIMESTAMPTZ,
  status TEXT,
  vin TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_listings_shadow_listing_id_key UNIQUE (listing_id)
);

-- Indexes
CREATE INDEX idx_shadow_listing_id ON public.vehicle_listings_shadow (listing_id);
CREATE INDEX idx_shadow_lot_id ON public.vehicle_listings_shadow (lot_id);
CREATE INDEX idx_shadow_last_seen_at ON public.vehicle_listings_shadow (last_seen_at);
CREATE INDEX idx_shadow_source ON public.vehicle_listings_shadow (shadow_source);

-- RLS enabled but open for service role only
ALTER TABLE public.vehicle_listings_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on shadow"
  ON public.vehicle_listings_shadow
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comparison view
CREATE OR REPLACE VIEW public.shadow_vs_production_stats AS
SELECT
  (SELECT COUNT(*) FROM public.vehicle_listings WHERE source = 'pickles') AS production_total,
  (SELECT COUNT(*) FROM public.vehicle_listings WHERE source = 'pickles' AND status = 'listed') AS production_active,
  (SELECT COUNT(*) FROM public.vehicle_listings_shadow) AS shadow_total,
  (SELECT COUNT(*) FROM public.vehicle_listings_shadow WHERE asking_price IS NOT NULL AND asking_price > 0) AS shadow_with_price,
  (SELECT COUNT(*) FROM public.vehicle_listings_shadow WHERE asking_price IS NULL OR asking_price = 0) AS shadow_zero_price,
  (SELECT MAX(last_seen_at) FROM public.vehicle_listings_shadow) AS shadow_last_seen_max,
  (SELECT MAX(last_seen_at) FROM public.vehicle_listings WHERE source = 'pickles') AS production_last_seen_max;
