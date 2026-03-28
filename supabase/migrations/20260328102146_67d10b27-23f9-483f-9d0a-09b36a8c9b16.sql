ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS auction_location   text,
  ADD COLUMN IF NOT EXISTS auction_segment    text,
  ADD COLUMN IF NOT EXISTS auction_lot_number text;

CREATE INDEX IF NOT EXISTS idx_vl_pickles_syd_gov
  ON public.vehicle_listings (auction_house, auction_location, auction_segment, auction_datetime)
  WHERE auction_house = 'Pickles'
    AND auction_location = 'Sydney'
    AND auction_segment = 'Government';