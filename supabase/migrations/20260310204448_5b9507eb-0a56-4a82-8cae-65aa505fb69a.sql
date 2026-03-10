
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS fingerprint_hash text;
ALTER TABLE public.retail_listings ADD COLUMN IF NOT EXISTS fingerprint_hash text;
