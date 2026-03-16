
-- Add auction lifecycle columns to vehicle_listings
ALTER TABLE public.vehicle_listings 
  ADD COLUMN IF NOT EXISTS auction_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS relist_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lemon_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lemon_reason text;

-- Index for fast auction_status filtering
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_auction_status 
  ON public.vehicle_listings (auction_status) 
  WHERE source_class = 'auction';

-- Index for lemon detection queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_lemon 
  ON public.vehicle_listings (lemon_flag) 
  WHERE lemon_flag = true;

COMMENT ON COLUMN public.vehicle_listings.auction_status IS 'Page status: active, sold, withdrawn, invalid';
COMMENT ON COLUMN public.vehicle_listings.relist_count IS 'Number of times this listing has reappeared after being marked dead/sold';
COMMENT ON COLUMN public.vehicle_listings.lemon_flag IS 'True if vehicle shows lemon patterns (repeat relists, withdrawals)';
COMMENT ON COLUMN public.vehicle_listings.lemon_reason IS 'Reason for lemon flag (e.g. relisted_3x, withdrawn_twice)';
