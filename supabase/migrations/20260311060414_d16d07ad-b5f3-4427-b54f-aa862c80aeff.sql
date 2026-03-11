
ALTER TABLE public.retail_listings 
  ADD COLUMN IF NOT EXISTS comp_count int DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS market_confidence text DEFAULT NULL;
