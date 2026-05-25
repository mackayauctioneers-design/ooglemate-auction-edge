ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS account_id uuid,
  ADD COLUMN IF NOT EXISTS dealer_id uuid,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS colour text,
  ADD COLUMN IF NOT EXISTS vin text;

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_account_id ON public.vehicle_listings(account_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_dealer_id ON public.vehicle_listings(dealer_id);