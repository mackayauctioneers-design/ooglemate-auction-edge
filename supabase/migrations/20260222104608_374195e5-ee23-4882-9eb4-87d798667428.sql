
-- Add auction pipeline columns to operator_opportunities
ALTER TABLE public.operator_opportunities
  ADD COLUMN IF NOT EXISTS auction_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS auction_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS auction_target_price numeric,
  ADD COLUMN IF NOT EXISTS auction_house text;

-- Add comment for clarity
COMMENT ON COLUMN public.operator_opportunities.auction_status IS 'none | upcoming | watch | bid_target | live_buy';
COMMENT ON COLUMN public.operator_opportunities.auction_target_price IS 'Calculated ceiling = historical_buy - buffer (10%)';
