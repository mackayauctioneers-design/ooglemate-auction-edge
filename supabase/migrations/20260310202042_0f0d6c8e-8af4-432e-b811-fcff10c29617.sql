ALTER TABLE public.retail_listings
  ADD COLUMN IF NOT EXISTS market_price integer,
  ADD COLUMN IF NOT EXISTS price_difference integer,
  ADD COLUMN IF NOT EXISTS price_difference_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS market_price_source text DEFAULT 'badge_estimate';